import type { ConnectContactFlowEvent, ConnectContactFlowResult, Context } from 'aws-lambda';
import type { AccountRepository } from '../../domain/accounts';
import { DynamoAccountRepository } from '../../domain/dynamo-account-repository';
import { decideRoute } from '../../domain/routing';
import { remainingBudget, withBudget } from '../../shared/budget';
import { createLogger } from '../../shared/logger';
import { count, distribution } from '../../shared/metrics';
import { tenantConfig } from '../../shared/tenant';

// Connect only accepts a flat map of string values back from Lambda.
type FlowResult = ConnectContactFlowResult & Record<string, string>;

const baseLogger = createLogger({ fn: 'connect-router' });
let repo: AccountRepository | undefined;

export function setRepository(r: AccountRepository): void {
  repo = r;
}

function repository(): AccountRepository {
  return (repo ??= new DynamoAccountRepository(process.env.ACCOUNTS_TABLE!));
}

/**
 * Invoked twice per call from the main IVR flow:
 *   operation=identify  - ANI lookup before the bot, so Lex can greet by name
 *   operation=route     - after the bot, turns intent + customer into a queue
 */
export async function handler(
  event: ConnectContactFlowEvent,
  context: Context,
): Promise<FlowResult> {
  const started = Date.now();
  const cfg = tenantConfig();
  const contact = event.Details.ContactData;
  const params = event.Details.Parameters ?? {};
  const operation = params.operation ?? 'route';
  const log = baseLogger.child({
    tenant: cfg.tenantId,
    contactId: contact.ContactId,
    operation,
  });
  const tags = { tenant: cfg.tenantId, operation };

  const ani =
    contact.CustomerEndpoint?.Type === 'TELEPHONE_NUMBER'
      ? contact.CustomerEndpoint.Address
      : undefined;

  try {
    // Withheld numbers come through as "anonymous" or empty.
    const account =
      ani && ani.startsWith('+')
        ? await withBudget(
            'account_lookup',
            remainingBudget(context.getRemainingTimeInMillis, 500),
            (s) => repository().findByPhone(ani, s),
          ).catch((err) => {
            log.warn('account lookup degraded', { err });
            count('router.lookup_degraded', tags);
            return undefined;
          })
        : undefined;

    if (operation === 'identify') {
      return {
        identified: String(Boolean(account)),
        accountId: account?.accountId ?? '',
        firstName: account?.firstName ?? '',
        psr: String(account?.priorityServicesRegister ?? false),
      };
    }

    const decision = decideRoute(cfg, {
      intent: params.intent || contact.Attributes?.intent,
      account,
      incidentMode: process.env.INCIDENT_MODE === 'true',
    });

    log.info('route decided', { ...decision });
    count('router.decision', { ...tags, reason: decision.reason, action: decision.action });

    return {
      action: decision.action,
      queueArn: decision.queueKey ? queueArn(decision.queueKey) : '',
      queueKey: decision.queueKey ?? '',
      externalNumber: decision.externalNumber ?? '',
      priority: String(decision.priority),
      promptKey: decision.promptKey,
      reason: decision.reason,
    };
  } catch (err) {
    // Never fail the flow: the error branch would play a generic message.
    // Default queue is always a better experience.
    log.error('router failed, falling back to default queue', { err });
    count('router.error', tags);
    return {
      action: 'queue',
      queueArn: queueArn(cfg.defaultQueue),
      queueKey: cfg.defaultQueue,
      externalNumber: '',
      priority: '5',
      promptKey: 'standard',
      reason: 'router_error',
    };
  } finally {
    distribution('router.duration_ms', Date.now() - started, tags);
  }
}

function queueArn(key: string): string {
  const arns = JSON.parse(process.env.QUEUE_ARNS ?? '{}') as Record<string, string>;
  const arn = arns[key];
  if (!arn) throw new Error(`no queue ARN for key ${key}`);
  return arn;
}
