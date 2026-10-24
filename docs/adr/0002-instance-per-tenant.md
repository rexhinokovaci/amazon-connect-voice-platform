# 0002. One Connect instance per tenant

- **Status:** Accepted
- **Date:** 2026-01-20

## Context

We run voice for several brands with different numbers, hours, queues, regulatory positions and, in one case, a different AWS region. Connect lets you share one instance between brands, separating them with queues, routing profiles and naming conventions.

## Options considered

1. **Shared instance.** One place for agents, cheaper to administer. But a bad flow publish or quota exhaustion affects every brand at once. Data separation relies on IAM conditions and naming, which are easy to get wrong. Per-brand regions are impossible.
2. **Instance per tenant.** Hard blast-radius boundary, data in separate tables and buckets with separate keys, and a region per brand. Costs more admin, and agents who work across brands need a login per instance.

## Decision

Instance per tenant, provisioned from config by the same CDK stack.

## Consequences

- A bad change is caught at the first tenant in the deploy sequence.
- Per-tenant quotas (concurrent calls, API rate limits) don't interfere with each other.
- Cross-brand agents need multiple logins. Today that's under 5% of agents. If it grows, revisit with a shared agent instance and cross-instance transfer.
- Connect has a per-account instance quota, so we'll need a quota increase past ~5 tenants per region.
