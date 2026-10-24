# Lex fulfilment errors / latency

**Severity:** P2 (errors) / P3 (latency) · **Pages:** errors only · **Owner:** Connect & Channels

## Is this hurting callers right now?

Partly. Failures set `handoff=true`, so callers go to an agent instead of finishing in self-service. Nobody gets dropped, but queues grow and containment falls. Latency breaches mean longer pauses mid-conversation.

## Confirm

- Dashboard → *Failures* → "Fulfilment errors by intent". Is it one intent or all of them? Is `timeout:true` dominant?
- Logs: `service:connect-voice fn:lex-fulfillment level:error`, grouped by `error.kind`.

## Mitigate

| Pattern | Action |
|---|---|
| Started after a deploy | Roll back (see [index](index.md#rolling-back)) |
| `timeout:true`, DynamoDB latency up | Check DynamoDB throttling and latency. On-demand tables throttle when traffic jumps above twice the previous peak. Errors are self-healing via handoff, so focus on root cause. |
| One intent only | Usually a data shape issue. Check recent writes to the accounts table. |
| `AccessDenied` | IAM regression. Roll back. |

## Diagnose

1. APM → service `connect-voice` → `lex-fulfillment`. Look at the DynamoDB span latency.
2. Cold starts: check `aws.lambda.enhanced.init_duration`. A spike after a deploy plus low traffic means cold starts. Consider provisioned concurrency for that tenant.
3. Look at `reading_rejected` alongside. A rise there with no errors is a prompt or ASR problem, not a backend one.

## Fix / follow-up

Postmortem if errors went above 50 in 15 minutes or lasted more than 30 minutes.
