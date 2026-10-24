import type { Context } from 'aws-lambda';
import { formatBalance, type AccountRepository, type MeterType } from '../../domain/accounts';
import { DynamoAccountRepository } from '../../domain/dynamo-account-repository';
import { validateReading } from '../../domain/meter-readings';
import { BudgetExceededError, remainingBudget, withBudget } from '../../shared/budget';
import { createLogger } from '../../shared/logger';
import { count, distribution } from '../../shared/metrics';
import { tenantConfig } from '../../shared/tenant';
import type { LexEvent, LexIntent, LexResponse } from './lex-types';

const baseLogger = createLogger({ fn: 'lex-fulfillment' });
let repo: AccountRepository | undefined;

export function setRepository(r: AccountRepository): void {
  repo = r;
}

function repository(): AccountRepository {
  return (repo ??= new DynamoAccountRepository(process.env.ACCOUNTS_TABLE!));
}

const MAX_READING_ATTEMPTS = 2;

export async function handler(event: LexEvent, context: Context): Promise<LexResponse> {
  const started = Date.now();
  const cfg = tenantConfig();
  const intent = event.sessionState.intent;
  const attrs = { ...(event.sessionState.sessionAttributes ?? {}) };
  const log = baseLogger.child({
    tenant: cfg.tenantId,
    sessionId: event.sessionId,
    intent: intent.name,
    source: event.invocationSource,
  });
  const tags = { tenant: cfg.tenantId, intent: intent.name, mode: event.inputMode };
  const budget = remainingBudget(context.getRemainingTimeInMillis);

  try {
    switch (intent.name) {
      case 'CheckBalance':
        return await checkBalance(intent, attrs, budget);
      case 'SubmitMeterReading':
        return await submitMeterReading(event, intent, attrs, budget);
      default:
        // Routing intents (SpeakToAgent, ReportGasEmergency) are fulfilled by the flow.
        return close(intent, attrs, 'Fulfilled');
    }
  } catch (err) {
    const timedOut = err instanceof BudgetExceededError;
    log.error('fulfilment failed', { err, timedOut });
    count('lex.fulfilment_error', { ...tags, timeout: timedOut });
    // Fail to an agent, not to a dead end. The flow reads `handoff`.
    attrs.handoff = 'true';
    attrs.handoffReason = timedOut ? 'backend_timeout' : 'backend_error';
    return close(
      intent,
      attrs,
      'Failed',
      "Sorry, I can't get to that right now. I'll put you through to the team.",
    );
  } finally {
    distribution('lex.fulfilment_ms', Date.now() - started, tags);
  }
}

async function checkBalance(
  intent: LexIntent,
  attrs: Record<string, string>,
  budget: number,
): Promise<LexResponse> {
  const accountId = attrs.accountId;
  if (!accountId) {
    attrs.handoff = 'true';
    attrs.handoffReason = 'unidentified';
    return close(
      intent,
      attrs,
      'Failed',
      "I couldn't match this number to an account, so I'll pass you to someone who can help.",
    );
  }
  const account = await withBudget('find_account', budget, (s) =>
    repository().findById(accountId, s),
  );
  if (!account) {
    attrs.handoff = 'true';
    attrs.handoffReason = 'account_not_found';
    return close(
      intent,
      attrs,
      'Failed',
      "I couldn't find your account details. Let me put you through.",
    );
  }
  return close(intent, attrs, 'Fulfilled', formatBalance(account.balancePence));
}

async function submitMeterReading(
  event: LexEvent,
  intent: LexIntent,
  attrs: Record<string, string>,
  budget: number,
): Promise<LexResponse> {
  const accountId = attrs.accountId;
  if (!accountId) {
    attrs.handoff = 'true';
    attrs.handoffReason = 'unidentified';
    return close(
      intent,
      attrs,
      'Failed',
      "I need to confirm who you are before taking a reading. I'll pass you to the team.",
    );
  }

  const meterType = slotValue(intent, 'MeterType') as MeterType | undefined;
  const rawReading = slotValue(intent, 'Reading', true);

  if (event.invocationSource === 'DialogCodeHook') {
    if (!meterType) return delegate(intent, attrs);
    if (!rawReading) return delegate(intent, attrs);

    const previous = await withBudget('last_reading', budget, (s) =>
      repository().lastReading(accountId, meterType, s),
    );
    const result = validateReading(rawReading, meterType, previous);
    if (result.ok) return delegate(intent, attrs);

    const attempts = Number(attrs.readingAttempts ?? '0') + 1;
    attrs.readingAttempts = String(attempts);
    count('lex.reading_rejected', { reason: result.reason, attempt: attempts });

    if (attempts >= MAX_READING_ATTEMPTS) {
      attrs.handoff = 'true';
      attrs.handoffReason = `reading_${result.reason}`;
      return close(
        intent,
        attrs,
        'Failed',
        "I'm having trouble with that reading, so I'll put you through to someone who can take it.",
      );
    }
    intent.slots.Reading = null;
    return elicit(intent, attrs, 'Reading', result.prompt);
  }

  if (!meterType || !rawReading) return delegate(intent, attrs);
  const previous = await withBudget('last_reading', budget, (s) =>
    repository().lastReading(accountId, meterType, s),
  );
  const result = validateReading(rawReading, meterType, previous);
  if (!result.ok) return elicit(intent, attrs, 'Reading', result.prompt);

  await withBudget('save_reading', budget, (s) =>
    repository().saveReading(
      {
        accountId,
        meterType,
        value: result.value,
        readAt: new Date().toISOString(),
        source: 'ivr',
      },
      s,
    ),
  );
  delete attrs.readingAttempts;
  const spoken = String(result.value).split('').join(' ');
  return close(
    intent,
    attrs,
    'Fulfilled',
    `Thanks. I've submitted your ${meterType} reading of ${spoken}.`,
  );
}

function slotValue(intent: LexIntent, name: string, original = false): string | undefined {
  const slot = intent.slots[name];
  if (!slot) return undefined;
  return original
    ? slot.value.originalValue
    : (slot.value.interpretedValue ?? slot.value.resolvedValues?.[0] ?? slot.value.originalValue);
}

function close(
  intent: LexIntent,
  sessionAttributes: Record<string, string>,
  state: 'Fulfilled' | 'Failed',
  message?: string,
): LexResponse {
  return {
    sessionState: {
      dialogAction: { type: 'Close' },
      intent: { ...intent, state },
      sessionAttributes,
    },
    ...(message ? { messages: [{ contentType: 'PlainText' as const, content: message }] } : {}),
  };
}

function delegate(intent: LexIntent, sessionAttributes: Record<string, string>): LexResponse {
  return { sessionState: { dialogAction: { type: 'Delegate' }, intent, sessionAttributes } };
}

function elicit(
  intent: LexIntent,
  sessionAttributes: Record<string, string>,
  slot: string,
  message: string,
): LexResponse {
  return {
    sessionState: {
      dialogAction: { type: 'ElicitSlot', slotToElicit: slot },
      intent: { ...intent, state: 'InProgress' },
      sessionAttributes,
    },
    messages: [{ contentType: 'PlainText', content: message }],
  };
}
