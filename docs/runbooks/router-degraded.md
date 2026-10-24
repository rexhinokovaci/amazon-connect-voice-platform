# Router degraded

**Severity:** P2 · **Pages:** yes · **Owner:** Connect & Channels

## Is this hurting callers right now?

Mildly. Every call still reaches a queue, but it's the default one. Intent-based routing and Priority Services Register priority are lost, so vulnerable customers wait in the normal queue. That's why this pages.

## Confirm

- `connect_voice.router.decision{reason:router_error}` rising.
- Logs: `fn:connect-router level:error`. The common errors are `no queue ARN for key`, a config parse failure, or a timeout.

## Mitigate

| Error | Action |
|---|---|
| `no queue ARN for key X` | A queue was removed or renamed without updating `intentQueues`. Roll back the config change. |
| `Invalid TENANT_CONFIG` on cold start | Bad config deployed. Roll back. |
| Lookup timeouts (`router.lookup_degraded`) | DynamoDB issue. Calls route without customer context. Treat as P3 unless PSR volume is significant. |

## Fix / follow-up

The tenant schema should stop the first two at PR time. If one got through, find out how and add a test.
