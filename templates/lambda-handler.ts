// Starting point for a flow-invoked Lambda. Copy into src/lambdas/<name>/handler.ts.
//
// Rules this template already follows:
//  - returns a flat map of strings (Connect rejects anything else)
//  - never throws back to the flow; falls back to a safe default
//  - downstream calls run under a latency budget
//  - logs are structured and PII-redacted; one duration metric per call

import type { ConnectContactFlowEvent, Context } from 'aws-lambda';
import { remainingBudget, withBudget } from '../../shared/budget';
import { createLogger } from '../../shared/logger';
import { count, distribution } from '../../shared/metrics';
import { tenantConfig } from '../../shared/tenant';

const baseLogger = createLogger({ fn: 'CHANGE-ME' });

export async function handler(
  event: ConnectContactFlowEvent,
  context: Context,
): Promise<Record<string, string>> {
  const started = Date.now();
  const cfg = tenantConfig();
  const log = baseLogger.child({
    tenant: cfg.tenantId,
    contactId: event.Details.ContactData.ContactId,
  });
  const tags = { tenant: cfg.tenantId };

  try {
    const result = await withBudget(
      'CHANGE-ME',
      remainingBudget(context.getRemainingTimeInMillis),
      async (_signal) => {
        // call downstream with { abortSignal: _signal }
        return { ok: 'true' };
      },
    );
    return result;
  } catch (err) {
    log.error('CHANGE-ME failed, returning default', { err });
    count('CHANGE-ME.error', tags);
    return { ok: 'false' };
  } finally {
    distribution('CHANGE-ME.duration_ms', Date.now() - started, tags);
  }
}
