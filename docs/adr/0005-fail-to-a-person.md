# 0005. Every failure path ends at an agent or an explicit message

- **Status:** Accepted
- **Date:** 2026-02-10

## Context

Default Connect behaviour on many errors is to disconnect. From the caller's side it looks like we hung up on them, and they ring back angrier.

## Decision

- Every block that can fail has an error branch (enforced by the linter).
- Lambda errors route to the default queue, not a disconnect. The router catches its own exceptions and returns the default queue rather than letting the flow's error branch run.
- The Lex fulfilment hook sets `handoff=true` on backend errors or timeouts, and the flow routes to an agent.
- The only intentional disconnects are after self-service completes, "queue at capacity" (with a message), and a technical error message as the last resort.
- The gas emergency path has a fallback message with the number to dial if the transfer fails.

## Consequences

- Backend incidents show up as queue growth rather than dropped calls. Monitors on `fulfilment_error` and `router.error` page before queues build.
- Agents occasionally get calls they can't help with because self-service failed. The handoff reason is in the contact attributes and shown in the agent's screen pop.
