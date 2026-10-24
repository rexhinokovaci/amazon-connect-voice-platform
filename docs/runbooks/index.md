# Runbooks

Written for whoever is on call, assuming they didn't build the thing. Each one starts with "is this hurting callers right now?" because that decides how fast you need to move.

| Runbook | Typical trigger | Severity |
|---|---|---|
| [Emergency transfer failure](emergency-transfer-failure.md) | Log alert on failed `TransferParticipantToThirdParty` | P1 |
| [Lex fulfilment errors](lex-fulfilment-errors.md) | `fulfilment_error` count, `fulfilment_ms` p95 | P2 / P3 |
| [Router degraded](router-degraded.md) | `router.error` > 5 in 5m | P2 |
| [Queue backlog / high abandonment](queue-backlog.md) | Abandonment > 12% | P3 |
| [CTR pipeline lag](ctr-pipeline-lag.md) | Kinesis iterator age > 10m | P4 |

New runbook? Start from the [template](template.md).

## General first steps

1. Open the [estate dashboard](https://app.datadoghq.eu/dashboard/lists?q=connect%20voice) filtered to the tenant in the alert.
2. Check recent deploys: GitHub Actions → Deploy. If a deploy landed in the last hour, rolling back is usually faster than diagnosing.
3. Check the [AWS Health Dashboard](https://health.aws.amazon.com/health/status) for Connect, Lex and Lambda in the tenant's region.
4. Post in #connect-voice-alerts that you're on it.

## Rolling back

```bash
# Re-run the Deploy workflow for the last good commit, or locally:
git checkout <last-good-sha>
npx cdk deploy -c stage=prod -c tenant=<tenant> --require-approval never
```

Flows, Lambdas and the Lex alias all roll back together, since they're one stack. Data (DynamoDB, S3) is retained.
