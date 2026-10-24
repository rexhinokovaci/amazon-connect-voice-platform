import type { Account } from './accounts';
import type { TenantConfig } from './tenant-config';

export interface RoutingInput {
  intent: string | undefined;
  account: Account | undefined;
  /** Optional operational override, e.g. a regional outage message. */
  incidentMode: boolean;
}

export interface RoutingDecision {
  action: 'queue' | 'external_transfer';
  queueKey?: string;
  externalNumber?: string;
  /** Connect queue priority, 1 (highest) to 5 (default). */
  priority: number;
  promptKey: string;
  reason: string;
}

const DEFAULT_PRIORITY = 5;

// Callers who say they can't pay are treated as potentially vulnerable
// (Ofgem guidance), same priority as the Priority Services Register.
const VULNERABLE_INTENTS = new Set(['PaymentDifficulty']);

export function decideRoute(cfg: TenantConfig, input: RoutingInput): RoutingDecision {
  // Safety first: a reported gas leak never waits in a queue.
  if (input.intent === 'ReportGasEmergency') {
    return {
      action: 'external_transfer',
      externalNumber: cfg.routing.gasEmergencyNumber,
      priority: 1,
      promptKey: 'gas_emergency',
      reason: 'gas_emergency',
    };
  }

  const queueKey = (input.intent && cfg.routing.intentQueues[input.intent]) || cfg.defaultQueue;
  const psr = input.account?.priorityServicesRegister === true;
  const vulnerable = psr || (input.intent !== undefined && VULNERABLE_INTENTS.has(input.intent));

  return {
    action: 'queue',
    queueKey,
    priority: vulnerable ? cfg.routing.psrPriority : DEFAULT_PRIORITY,
    promptKey: input.incidentMode ? 'incident_banner' : vulnerable ? 'psr_welcome' : 'standard',
    reason: input.intent ? `intent:${input.intent}` : 'no_intent',
  };
}
