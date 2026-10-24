import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { KinesisEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { renderFlow } from '../../src/flows/flow';
import type { TenantConfig } from '../../src/domain/tenant-config';
import { LexBot } from './lex-bot';
import { Observability } from './observability';

export interface TenantVoiceStackProps extends StackProps {
  tenant: TenantConfig;
  stage: 'dev' | 'staging' | 'prod';
  version: string;
  datadogApiKeySecretArn?: string;
}

const ROOT = join(__dirname, '..', '..');
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;

export class TenantVoiceStack extends Stack {
  constructor(scope: Construct, id: string, props: TenantVoiceStackProps) {
    super(scope, id, props);
    const { tenant, stage } = props;
    const prod = stage === 'prod';
    const retain = prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    Tags.of(this).add('tenant', tenant.tenantId);
    Tags.of(this).add('stage', stage);
    Tags.of(this).add('service', 'connect-voice');

    // --- Data at rest -----------------------------------------------------

    const key = new kms.Key(this, 'DataKey', {
      alias: `alias/${tenant.tenantId}-${stage}-voice`,
      enableKeyRotation: true,
      removalPolicy: retain,
    });

    const recordings = new s3.Bucket(this, 'Recordings', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: prod,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [{ expiration: Duration.days(tenant.retention.recordingDays) }],
      removalPolicy: retain,
      autoDeleteObjects: !prod,
    });

    const ctrStream = new kinesis.Stream(this, 'CtrStream', {
      streamMode: kinesis.StreamMode.ON_DEMAND,
      encryption: kinesis.StreamEncryption.KMS,
      encryptionKey: key,
      retentionPeriod: Duration.hours(48),
    });

    const accounts = new dynamodb.TableV2(this, 'Accounts', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
        },
      ],
      billing: dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.customerManagedKey(key),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: prod,
      removalPolicy: retain,
    });

    // --- Connect instance -------------------------------------------------

    const instance = new connect.CfnInstance(this, 'Instance', {
      instanceAlias: `${tenant.instanceAlias}-${stage}`,
      identityManagementType: 'CONNECT_MANAGED',
      attributes: {
        inboundCalls: true,
        outboundCalls: true,
        contactflowLogs: true,
        contactLens: true,
        autoResolveBestVoices: true,
        earlyMedia: true,
        useCustomTtsVoices: false,
      },
    });
    instance.applyRemovalPolicy(retain);

    new connect.CfnInstanceStorageConfig(this, 'RecordingStorage', {
      instanceArn: instance.attrArn,
      resourceType: 'CALL_RECORDINGS',
      storageType: 'S3',
      s3Config: {
        bucketName: recordings.bucketName,
        bucketPrefix: 'recordings',
        encryptionConfig: { encryptionType: 'KMS', keyId: key.keyArn },
      },
    });

    new connect.CfnInstanceStorageConfig(this, 'CtrStorage', {
      instanceArn: instance.attrArn,
      resourceType: 'CONTACT_TRACE_RECORDS',
      storageType: 'KINESIS_STREAM',
      kinesisStreamConfig: { streamArn: ctrStream.streamArn },
    });

    const toHours = (t: string) => {
      const [hours, minutes] = t.split(':').map(Number);
      return { hours: hours!, minutes: minutes! };
    };
    const window = (day: string, w: { open: string; close: string }) => ({
      day,
      startTime: toHours(w.open),
      endTime: toHours(w.close),
    });

    const hours = new connect.CfnHoursOfOperation(this, 'Hours', {
      instanceArn: instance.attrArn,
      name: `${tenant.displayName} opening hours`,
      timeZone: tenant.hours.timezone,
      config: [
        ...DAYS.map((d) => window(d, tenant.hours.weekdays)),
        ...(tenant.hours.saturday ? [window('SATURDAY', tenant.hours.saturday)] : []),
        ...(tenant.hours.sunday ? [window('SUNDAY', tenant.hours.sunday)] : []),
      ],
    });

    const queues = Object.fromEntries(
      tenant.queues.map((q) => [
        q.key,
        new connect.CfnQueue(this, `Queue-${q.key}`, {
          instanceArn: instance.attrArn,
          name: q.name,
          description: q.description ?? `${q.name} (target answer ${q.serviceLevelSeconds}s)`,
          hoursOfOperationArn: hours.attrHoursOfOperationArn,
          maxContacts: q.maxContacts,
        }),
      ]),
    );
    const queueArns = Object.fromEntries(
      Object.entries(queues).map(([k, q]) => [k, q.attrQueueArn]),
    );

    // --- Lambdas ----------------------------------------------------------

    const commonEnv = {
      TENANT_CONFIG: JSON.stringify(tenant),
      ACCOUNTS_TABLE: accounts.tableName,
      NODE_OPTIONS: '--enable-source-maps',
      LOG_LEVEL: prod ? 'info' : 'debug',
    };

    const nodeFn = (
      name: string,
      entry: string,
      timeout: Duration,
      env: Record<string, string> = {},
    ) =>
      new nodejs.NodejsFunction(this, name, {
        entry: join(ROOT, entry),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 1024,
        timeout,
        environment: { ...commonEnv, ...env },
        tracing: lambda.Tracing.DISABLED,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node22',
          // Provided by the runtime / Datadog layer.
          externalModules: ['@aws-sdk/*', 'datadog-lambda-js', 'dd-trace'],
        },
      });

    // Connect gives up at the flow's InvocationTimeLimitSeconds (3s); the
    // function timeout sits just above so we log rather than vanish.
    const router = nodeFn('Router', 'src/lambdas/connect-router/handler.ts', Duration.seconds(4), {
      QUEUE_ARNS: JSON.stringify(queueArns),
      INCIDENT_MODE: 'false',
    });
    const fulfilment = nodeFn(
      'LexFulfilment',
      'src/lambdas/lex-fulfillment/handler.ts',
      Duration.seconds(5),
    );

    accounts.grantReadData(router);
    accounts.grantReadWriteData(fulfilment);

    router.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: instance.attrArn,
      sourceAccount: this.account,
    });

    const ctrDlq = new sqs.Queue(this, 'CtrDlq', {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      enforceSSL: true,
    });

    const ctrProcessor = new lambda.Function(this, 'CtrProcessor', {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      handler: 'ctr_processor.handler.handler',
      code: lambda.Code.fromAsset(join(ROOT, 'python'), {
        exclude: ['tests', '**/__pycache__', '*.toml', '.pytest_cache', '.ruff_cache'],
      }),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: { TENANT_ID: tenant.tenantId, STAGE: stage },
      logGroup: new logs.LogGroup(this, 'CtrProcessorLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    ctrProcessor.addEventSource(
      new KinesisEventSource(ctrStream, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(5),
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        retryAttempts: 3,
        onFailure: new SqsDlq(ctrDlq),
      }),
    );

    new Observability(this, 'Observability', {
      service: 'connect-voice',
      env: stage,
      version: props.version,
      apiKeySecretArn: props.datadogApiKeySecretArn,
    }).instrument(router, fulfilment, ctrProcessor);

    // --- Lex + associations ----------------------------------------------

    const bot = new LexBot(this, 'Lex', { tenant, fulfilment });

    const lambdaAssoc = new connect.CfnIntegrationAssociation(this, 'RouterAssociation', {
      instanceId: instance.attrArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: router.functionArn,
    });
    const lexAssoc = new connect.CfnIntegrationAssociation(this, 'LexAssociation', {
      instanceId: instance.attrArn,
      integrationType: 'LEX_BOT',
      integrationArn: bot.aliasArn,
    });

    // --- Flows ------------------------------------------------------------

    const template = readFileSync(join(ROOT, 'contact-flows', 'main-ivr.json'), 'utf8');
    const flow = new connect.CfnContactFlow(this, 'MainIvr', {
      instanceArn: instance.attrArn,
      name: 'Main IVR',
      type: 'CONTACT_FLOW',
      description: 'Inbound entry flow (managed by CDK)',
      content: renderFlow(template, {
        DISPLAY_NAME: tenant.displayName,
        VOICE_ID: tenant.voice.id,
        VOICE_ENGINE: tenant.voice.engine === 'generative' ? 'Generative' : 'Neural',
        HOURS_ARN: hours.attrHoursOfOperationArn,
        ROUTER_LAMBDA_ARN: router.functionArn,
        LEX_ALIAS_ARN: bot.aliasArn,
        DEFAULT_QUEUE_ARN: queueArns[tenant.defaultQueue]!,
        GAS_EMERGENCY_NUMBER: tenant.routing.gasEmergencyNumber,
      }),
    });
    // Connect validates referenced resources when the flow is saved.
    flow.addResourceDependency(lambdaAssoc);
    flow.addResourceDependency(lexAssoc);

    new CfnOutput(this, 'RouterFunctionName', { value: router.functionName });
    new CfnOutput(this, 'FulfilmentFunctionName', { value: fulfilment.functionName });
    new CfnOutput(this, 'InstanceArn', { value: instance.attrArn });
  }
}
