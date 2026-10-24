import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler, setRepository } from '../../src/lambdas/lex-fulfillment/handler';
import type { LexEvent, LexSlots } from '../../src/lambdas/lex-fulfillment/lex-types';
import { setMetricSender } from '../../src/shared/metrics';
import { resetTenantConfigCache } from '../../src/shared/tenant';
import { fixtureRepo, lambdaContext, rawTenant } from '../helpers';

const slot = (v: string) => ({
  value: { originalValue: v, interpretedValue: v, resolvedValues: [v] },
});

function lexEvent(
  intent: string,
  opts: {
    slots?: LexSlots;
    attrs?: Record<string, string>;
    source?: LexEvent['invocationSource'];
  } = {},
): LexEvent {
  return {
    sessionId: 's-1',
    inputTranscript: '',
    invocationSource: opts.source ?? 'FulfillmentCodeHook',
    inputMode: 'Speech',
    bot: { id: 'b', name: 'bot', aliasId: 'a', localeId: 'en_GB', version: '1' },
    sessionState: {
      intent: { name: intent, slots: opts.slots ?? {}, state: 'ReadyForFulfillment' },
      sessionAttributes: opts.attrs ?? {},
    },
  };
}

let repo: ReturnType<typeof fixtureRepo>;

beforeEach(() => {
  process.env.TENANT_CONFIG = JSON.stringify(rawTenant());
  resetTenantConfigCache();
  repo = fixtureRepo();
  setRepository(repo);
  setMetricSender(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('CheckBalance', () => {
  it('reads the balance for an identified caller', async () => {
    const res = await handler(
      lexEvent('CheckBalance', { attrs: { accountId: 'A100' } }),
      lambdaContext(),
    );
    expect(res.sessionState.intent?.state).toBe('Fulfilled');
    expect(res.messages?.[0]?.content).toBe('Your current balance is £42.50.');
  });

  it('says "in credit" for negative balances', async () => {
    const res = await handler(
      lexEvent('CheckBalance', { attrs: { accountId: 'A200' } }),
      lambdaContext(),
    );
    expect(res.messages?.[0]?.content).toBe("You're in credit by £12.00.");
  });

  it('hands off when the caller is unidentified', async () => {
    const res = await handler(lexEvent('CheckBalance'), lambdaContext());
    expect(res.sessionState.sessionAttributes).toMatchObject({
      handoff: 'true',
      handoffReason: 'unidentified',
    });
  });

  it('hands off on backend timeout instead of hanging', async () => {
    setRepository(Object.assign(repo, { findById: () => new Promise<undefined>(() => {}) }));
    const res = await handler(
      lexEvent('CheckBalance', { attrs: { accountId: 'A100' } }),
      lambdaContext(400),
    );
    expect(res.sessionState.intent?.state).toBe('Failed');
    expect(res.sessionState.sessionAttributes).toMatchObject({
      handoff: 'true',
      handoffReason: 'backend_timeout',
    });
  });
});

describe('SubmitMeterReading', () => {
  const attrs = { accountId: 'A100' };

  it('delegates while slots are missing', async () => {
    const res = await handler(
      lexEvent('SubmitMeterReading', { attrs, source: 'DialogCodeHook' }),
      lambdaContext(),
    );
    expect(res.sessionState.dialogAction.type).toBe('Delegate');
  });

  it('re-prompts on an invalid reading, then hands off on the second failure', async () => {
    const slots = { MeterType: slot('electricity'), Reading: slot('1 1 0 0 0') };
    const first = await handler(
      lexEvent('SubmitMeterReading', { attrs, slots, source: 'DialogCodeHook' }),
      lambdaContext(),
    );
    expect(first.sessionState.dialogAction).toEqual({
      type: 'ElicitSlot',
      slotToElicit: 'Reading',
    });
    expect(first.sessionState.intent?.slots.Reading).toBeNull();

    const second = await handler(
      lexEvent('SubmitMeterReading', {
        attrs: first.sessionState.sessionAttributes,
        slots: { MeterType: slot('electricity'), Reading: slot('11000') },
        source: 'DialogCodeHook',
      }),
      lambdaContext(),
    );
    expect(second.sessionState.sessionAttributes).toMatchObject({
      handoff: 'true',
      handoffReason: 'reading_lower_than_previous',
    });
  });

  it('saves a valid reading and reads it back digit by digit', async () => {
    const slots = { MeterType: slot('electricity'), Reading: slot('12345') };
    const res = await handler(lexEvent('SubmitMeterReading', { attrs, slots }), lambdaContext());
    expect(res.messages?.[0]?.content).toBe(
      "Thanks. I've submitted your electricity reading of 1 2 3 4 5.",
    );
    expect((await repo.lastReading('A100', 'electricity'))?.value).toBe(12345);
  });
});

it('closes routing intents without touching the backend', async () => {
  const res = await handler(lexEvent('SpeakToAgent'), lambdaContext());
  expect(res.sessionState).toMatchObject({
    dialogAction: { type: 'Close' },
    intent: { state: 'Fulfilled' },
  });
});
