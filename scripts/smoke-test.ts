/**
 * Post-deploy check: invokes the deployed router and fulfilment functions with
 * synthetic events and asserts the responses have the shape the flow expects.
 * Uses a number that never matches an account, so no customer data is read.
 *
 *   npx tsx scripts/smoke-test.ts --stage dev --tenant brightwell-energy
 */
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { stage: { type: 'string' }, tenant: { type: 'string' } },
});
if (!values.stage || !values.tenant) {
  console.error('usage: smoke-test --stage <stage> --tenant <tenant>');
  process.exit(2);
}

const stackName = `${values.tenant}-${values.stage}`;

async function outputs(): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({});
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  return Object.fromEntries(
    (res.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey!, o.OutputValue!]),
  );
}

async function invoke(fn: string, payload: unknown): Promise<Record<string, unknown>> {
  const lambda = new LambdaClient({});
  const res = await lambda.send(
    new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(JSON.stringify(payload)) }),
  );
  if (res.FunctionError) throw new Error(`${fn}: ${Buffer.from(res.Payload!).toString()}`);
  return JSON.parse(Buffer.from(res.Payload!).toString());
}

function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.error(detail);
    process.exitCode = 1;
  }
}

async function main() {
  const out = await outputs();

  const routed = await invoke(out.RouterFunctionName!, {
    Name: 'ContactFlowEvent',
    Details: {
      ContactData: {
        ContactId: `smoke-${Date.now()}`,
        CustomerEndpoint: { Type: 'TELEPHONE_NUMBER', Address: '+447700900000' },
        Attributes: {},
      },
      Parameters: { operation: 'route', intent: 'SpeakToAgent' },
    },
  });
  check(
    'router returns a queue ARN and string-only values',
    routed.action === 'queue' &&
      String(routed.queueArn).startsWith('arn:aws:connect:') &&
      Object.values(routed).every((v) => typeof v === 'string'),
    routed,
  );
  check('router is not in fallback', routed.reason !== 'router_error', routed);

  const lex = await invoke(out.FulfilmentFunctionName!, {
    sessionId: 'smoke',
    inputTranscript: 'agent',
    invocationSource: 'FulfillmentCodeHook',
    inputMode: 'Text',
    bot: { id: 'smoke', name: 'smoke', aliasId: 'smoke', localeId: 'en_GB', version: '1' },
    sessionState: { intent: { name: 'SpeakToAgent', slots: {}, state: 'ReadyForFulfillment' } },
  });
  const state = lex.sessionState as { dialogAction?: { type?: string } } | undefined;
  check('fulfilment closes routing intents', state?.dialogAction?.type === 'Close', lex);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
