import { Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lex from 'aws-cdk-lib/aws-lex';
import { Construct } from 'constructs';
import { INTENTS, METER_TYPES } from '../../src/domain/bot-definition';
import type { TenantConfig } from '../../src/domain/tenant-config';

type Intent = lex.CfnBot.IntentProperty;

const say = (value: string): lex.CfnBot.PromptSpecificationProperty => ({
  maxRetries: 2,
  allowInterrupt: true,
  messageGroupsList: [{ message: { plainTextMessage: { value } } }],
});

const utterances = (...u: string[]) => u.map((utterance) => ({ utterance }));

export interface LexBotProps {
  tenant: TenantConfig;
  fulfilment: lambda.IFunction;
}

/**
 * Voice-first bot. Utterances are written the way people talk on the phone,
 * not the way they type; the confidence threshold sits slightly lower than a
 * chat bot because ASR noise depresses scores on otherwise clear intents.
 */
export class LexBot extends Construct {
  readonly aliasArn: string;

  constructor(scope: Construct, id: string, props: LexBotProps) {
    super(scope, id);
    const { tenant } = props;
    const localeId = tenant.locale;

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      inlinePolicies: {
        polly: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }),
          ],
        }),
      },
    });

    const intents: Intent[] = [
      ...INTENTS.map((i): Intent => ({
        name: i.name,
        sampleUtterances: utterances(...i.utterances),
        ...(i.dialogHook ? { dialogCodeHook: { enabled: true } } : {}),
        ...(i.fulfilmentHook ? { fulfillmentCodeHook: { enabled: true } } : {}),
        ...(i.slots
          ? {
              slotPriorities: i.slots.map((slot, idx) => ({
                priority: idx + 1,
                slotName: slot.name,
              })),
              slots: i.slots.map((slot) => ({
                name: slot.name,
                slotTypeName: slot.type,
                valueElicitationSetting: {
                  slotConstraint: 'Required',
                  promptSpecification: say(slot.prompt),
                },
              })),
            }
          : {}),
      })),
      { name: 'FallbackIntent', parentIntentSignature: 'AMAZON.FallbackIntent' },
    ];

    const bot = new lex.CfnBot(this, 'Bot', {
      name: `${tenant.tenantId}-ivr`,
      roleArn: role.roleArn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: [
        {
          localeId,
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: tenant.voice.id, engine: tenant.voice.engine },
          slotTypes: [
            {
              name: 'MeterTypes',
              valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
              slotTypeValues: Object.entries(METER_TYPES).map(([value, synonyms]) => ({
                sampleValue: { value },
                synonyms: synonyms.map((v) => ({ value: v })),
              })),
            },
          ],
          intents,
        },
      ],
    });

    const version = new lex.CfnBotVersion(this, 'Version', {
      botId: bot.attrId,
      botVersionLocaleSpecification: [
        { localeId, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
      ],
    });

    const alias = new lex.CfnBotAlias(this, 'Alias', {
      botId: bot.attrId,
      botAliasName: 'live',
      botVersion: version.attrBotVersion,
      sentimentAnalysisSettings: { DetectSentiment: false },
      botAliasLocaleSettings: [
        {
          localeId,
          botAliasLocaleSetting: {
            enabled: true,
            codeHookSpecification: {
              lambdaCodeHook: {
                codeHookInterfaceVersion: '1.0',
                lambdaArn: props.fulfilment.functionArn,
              },
            },
          },
        },
      ],
    });

    props.fulfilment.addPermission('LexInvoke', {
      principal: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      sourceArn: Stack.of(this).formatArn({
        service: 'lex',
        resource: 'bot-alias',
        resourceName: `${bot.attrId}/*`,
      }),
    });

    this.aliasArn = alias.attrArn;
  }
}
