// Flow Language JSON with ${PLACEHOLDER}s. Same render + lint in CI, at synth and in the demo.

export interface FlowAction {
  Identifier: string;
  Type: string;
  Parameters: Record<string, unknown>;
  Transitions: {
    NextAction?: string;
    Conditions?: Array<{ NextAction: string; Condition: { Operator: string; Operands: string[] } }>;
    Errors?: Array<{ NextAction: string; ErrorType: string }>;
  };
}

export interface Flow {
  Version: string;
  StartAction: string;
  Metadata?: Record<string, unknown>;
  Actions: FlowAction[];
}

const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!))].sort();
}

export function renderFlow(template: string, values: Record<string, string>): string {
  const missing = placeholders(template).filter((k) => values[k] === undefined);
  if (missing.length) throw new Error(`missing flow values: ${missing.join(', ')}`);
  // JSON-escape so a display name with quotes can't break the document.
  return template.replace(PLACEHOLDER, (_, k: string) => JSON.stringify(values[k]).slice(1, -1));
}

export interface LintIssue {
  rule: string;
  action?: string;
  message: string;
}

// Actions where the call leaves the flow; no onward transition required.
const TERMINAL = new Set(['DisconnectParticipant', 'TransferContactToQueue', 'EndFlowExecution']);

// Actions Connect can fail at runtime; each must declare an error branch.
const NEEDS_ERROR_BRANCH = new Set([
  'InvokeLambdaFunction',
  'ConnectParticipantWithLexBot',
  'UpdateContactTargetQueue',
  'TransferContactToQueue',
  'TransferParticipantToThirdParty',
  'CheckHoursOfOperation',
  'GetParticipantInput',
]);

const MAX_LAMBDA_SECONDS = 8;
// Past this the caller hears silence long enough to hang up.
const SOFT_LAMBDA_SECONDS = 3;

export function lintFlow(flow: Flow): LintIssue[] {
  const issues: LintIssue[] = [];
  const ids = new Map<string, FlowAction>();

  for (const a of flow.Actions) {
    if (ids.has(a.Identifier)) {
      issues.push({ rule: 'unique-ids', action: a.Identifier, message: 'duplicate identifier' });
    }
    ids.set(a.Identifier, a);
  }

  if (!ids.has(flow.StartAction)) {
    issues.push({ rule: 'start-action', message: `StartAction "${flow.StartAction}" not found` });
  }

  const first = ids.get(flow.StartAction);
  if (first && first.Type !== 'UpdateFlowLoggingBehavior') {
    issues.push({
      rule: 'logging-first',
      action: first.Identifier,
      message: 'first block should enable flow logging, otherwise early failures are invisible',
    });
  }

  for (const a of flow.Actions) {
    const targets = edges(a);
    for (const t of targets) {
      if (!ids.has(t)) {
        issues.push({
          rule: 'dangling-transition',
          action: a.Identifier,
          message: `points at missing "${t}"`,
        });
      }
    }
    if (!TERMINAL.has(a.Type) && targets.length === 0) {
      issues.push({
        rule: 'dead-end',
        action: a.Identifier,
        message: `${a.Type} has no onward transition`,
      });
    }
    if (NEEDS_ERROR_BRANCH.has(a.Type) && !a.Transitions.Errors?.length) {
      issues.push({
        rule: 'error-branch',
        action: a.Identifier,
        message: `${a.Type} must handle errors`,
      });
    }
    if (a.Type === 'InvokeLambdaFunction') {
      const secs = Number(a.Parameters.InvocationTimeLimitSeconds ?? MAX_LAMBDA_SECONDS);
      if (!(secs > 0 && secs <= MAX_LAMBDA_SECONDS)) {
        issues.push({
          rule: 'lambda-timeout',
          action: a.Identifier,
          message: `timeout ${secs}s outside 1-${MAX_LAMBDA_SECONDS}s`,
        });
      } else if (secs > SOFT_LAMBDA_SECONDS) {
        issues.push({
          rule: 'lambda-timeout',
          action: a.Identifier,
          message: `timeout ${secs}s risks dead air; keep it <= ${SOFT_LAMBDA_SECONDS}s`,
        });
      }
    }
  }

  for (const id of unreachable(flow, ids)) {
    issues.push({ rule: 'unreachable', action: id, message: 'not reachable from StartAction' });
  }

  return issues;
}

export function edges(a: FlowAction): string[] {
  const t = a.Transitions ?? {};
  return [
    ...new Set(
      [
        t.NextAction,
        ...(t.Conditions ?? []).map((c) => c.NextAction),
        ...(t.Errors ?? []).map((e) => e.NextAction),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
}

function unreachable(flow: Flow, ids: Map<string, FlowAction>): string[] {
  const seen = new Set<string>();
  const stack = [flow.StartAction];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const a = ids.get(id);
    if (a) stack.push(...edges(a));
  }
  return [...ids.keys()].filter((id) => !seen.has(id));
}
