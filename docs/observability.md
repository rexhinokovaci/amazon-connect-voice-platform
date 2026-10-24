# Observability

Everything is in Datadog, defined in `observability/datadog/` and applied with `scripts/datadog-apply.ts`. Nothing gets created by clicking around in the UI. If it isn't in git, it doesn't exist.

## Signals

| Signal | Source | Used for |
|---|---|---|
| `connect_voice.lex.fulfilment_ms` | Fulfilment Lambda | Latency budget, SLO |
| `connect_voice.lex.fulfilment_error` (tag `timeout`) | Fulfilment Lambda | Paging |
| `connect_voice.lex.reading_rejected` (tag `reason`) | Fulfilment Lambda | Spotting prompt or ASR problems |
| `connect_voice.router.decision` (tags `reason`, `action`) | Router | Routing mix, intent drift |
| `connect_voice.router.error`, `router.lookup_degraded` | Router | Paging, degraded-mode visibility |
| `connect_voice.contact.*` | CTR processor | Containment, abandonment, queue wait, handle time |
| Flow logs | Connect → CloudWatch → Datadog | Per-block debugging of a single contact |
| APM traces | Datadog Lambda extension | Cold starts, DynamoDB spans |

Every metric and log line carries `tenant` and `env`. Logs are JSON with `contactId` (router) or `sessionId` (Lex), so one call can be followed across services.

## PII

Contact-centre logs get read by a lot of people. `src/shared/logger.ts` masks phone numbers, postcodes, long digit runs and emails inside strings. It also replaces known-sensitive keys (`transcript`, `accountNumber`, …) wholesale. Payload capture is off in the Datadog construct (`captureLambdaPayload: false`). Flow logs are kept 30 days.

## Alerting philosophy

- **Page** only for things hurting callers right now: fulfilment errors, router failing to default, emergency transfer failure.
- **Slack** for things that need a look today: latency budget breaches, containment drop, abandonment, CTR lag.
- Every monitor links to a runbook. A monitor without a runbook doesn't get merged.
- Abandonment alerts go to workforce management too, because nine times out of ten it's staffing, not software.

## Applying changes

```bash
DD_API_KEY=... DD_APP_KEY=... DD_SITE=datadoghq.eu npx tsx scripts/datadog-apply.ts --dry-run
DD_API_KEY=... DD_APP_KEY=... DD_SITE=datadoghq.eu npx tsx scripts/datadog-apply.ts
```

Upserts by name, so it's safe to re-run. CI runs the dry run on every PR that touches `observability/`.
