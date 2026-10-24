import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { TenantVoiceStack } from '../../infra/lib/tenant-voice-stack';
import { loadTenant } from '../helpers';

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new TenantVoiceStack(app, 'test', {
    tenant: loadTenant(),
    stage: 'prod',
    version: 'test',
    env: { account: '111111111111', region: 'eu-west-2' },
  });
  template = Template.fromStack(stack);
});

describe('TenantVoiceStack', () => {
  it('creates one queue per configured queue', () => {
    template.resourceCountIs('AWS::Connect::Queue', 4);
  });

  it('keeps Connect- and Lex-invoked Lambdas inside the 8s ceiling', () => {
    const fns = Object.values(template.findResources('AWS::Lambda::Function')).filter(
      (fn) => fn.Properties.Environment?.Variables?.TENANT_CONFIG,
    );
    expect(fns).toHaveLength(2);
    for (const fn of fns) expect(fn.Properties.Timeout).toBeLessThanOrEqual(8);
  });

  it('encrypts recordings with a rotating CMK and blocks public access', () => {
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
              KMSMasterKeyID: Match.anyValue(),
            },
          }),
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: { Rules: [Match.objectLike({ ExpirationInDays: 180 })] },
    });
  });

  it('retains stateful resources in prod', () => {
    template.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
    template.hasResource('AWS::Connect::Instance', { DeletionPolicy: 'Retain' });
  });

  it('only lets this Connect instance invoke the router', () => {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Principal: 'connect.amazonaws.com',
      SourceArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('Instance'), 'Arn'] },
    });
  });

  it('streams CTRs with partial batch failure and a DLQ', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      BisectBatchOnFunctionError: true,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  it('renders a flow with no unresolved placeholders', () => {
    const flows = template.findResources('AWS::Connect::ContactFlow');
    const content = JSON.stringify(Object.values(flows)[0]!.Properties.Content);
    expect(content).not.toMatch(/\$\{[A-Z_]+\}/);
  });
});
