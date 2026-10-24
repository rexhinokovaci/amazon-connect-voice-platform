import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintFlow, placeholders, renderFlow, type Flow } from '../../src/flows/flow';

const template = readFileSync(
  join(__dirname, '..', '..', 'contact-flows', 'main-ivr.json'),
  'utf8',
);
const values = Object.fromEntries(placeholders(template).map((k) => [k, `v-${k}`]));
const flow = (): Flow => JSON.parse(renderFlow(template, values));

describe('renderFlow', () => {
  it('requires every placeholder', () => {
    expect(() => renderFlow(template, {})).toThrow(/missing flow values: .*ROUTER_LAMBDA_ARN/);
  });

  it('escapes values so they cannot break the JSON', () => {
    const rendered = renderFlow(template, { ...values, DISPLAY_NAME: 'Bob "the" Builder\\' });
    expect(() => JSON.parse(rendered)).not.toThrow();
  });
});

describe('lintFlow', () => {
  it('main IVR is clean', () => {
    expect(lintFlow(flow())).toEqual([]);
  });

  it('gas emergency path does not depend on Lambda', () => {
    const f = flow();
    const bot = f.Actions.find((a) => a.Identifier === 'bot')!;
    const target = bot.Transitions.Conditions!.find(
      (c) => c.Condition.Operands[0] === 'ReportGasEmergency',
    )!;
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const a = f.Actions.find((x) => x.Identifier === id)!;
      expect(a.Type).not.toBe('InvokeLambdaFunction');
      [a.Transitions.NextAction, ...(a.Transitions.Errors ?? []).map((e) => e.NextAction)]
        .filter(Boolean)
        .forEach((n) => walk(n!));
    };
    walk(target.NextAction);
  });

  it('flags dangling transitions, dead ends, missing error branches and slow lambdas', () => {
    const f: Flow = {
      Version: '2019-10-30',
      StartAction: 'a',
      Actions: [
        {
          Identifier: 'a',
          Type: 'UpdateFlowLoggingBehavior',
          Parameters: {},
          Transitions: { NextAction: 'b' },
        },
        {
          Identifier: 'b',
          Type: 'InvokeLambdaFunction',
          Parameters: { InvocationTimeLimitSeconds: '8' },
          Transitions: { NextAction: 'ghost' },
        },
        { Identifier: 'c', Type: 'MessageParticipant', Parameters: {}, Transitions: {} },
      ],
    };
    const rules = lintFlow(f).map((i) => `${i.rule}:${i.action}`);
    expect(rules).toEqual(
      expect.arrayContaining([
        'dangling-transition:b',
        'error-branch:b',
        'lambda-timeout:b',
        'dead-end:c',
        'unreachable:c',
      ]),
    );
  });

  it('requires logging as the first block', () => {
    const f = flow();
    f.StartAction = 'set-voice';
    expect(lintFlow(f).map((i) => i.rule)).toContain('logging-first');
  });
});
