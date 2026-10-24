## What and why

<!-- One or two sentences. Link the issue. -->

## Routing / caller impact

<!-- Flow JSON diffs are hard to read. Say in plain words what changes for a caller, or "none". -->

## Checklist

- [ ] `npm run check` passes locally
- [ ] Flow changes tried in the simulator (`npm run demo:serve`)
- [ ] `cdk diff` reviewed for every affected tenant (paste anything surprising below)
- [ ] New failure paths end at an agent or an explicit message ([ADR 0005](../docs/adr/0005-fail-to-a-person.md))
- [ ] No PII in logs, fixtures or screenshots
- [ ] New alerts link to a runbook
- [ ] Docs / ADR updated if behaviour or a decision changed

## Rollout

<!-- Tenants and order, feature flag, anything that needs doing outside the pipeline. -->
