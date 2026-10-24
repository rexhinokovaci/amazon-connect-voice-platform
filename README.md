<h1>
  <img src="https://avatars.githubusercontent.com/u/55946528?v=4&s=80" width="36" height="36" align="left" alt="" />
  &nbsp;Amazon Connect voice platform
</h1>

[![CI](https://github.com/rexhinokovaci/amazon-connect-voice-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/rexhinokovaci/amazon-connect-voice-platform/actions/workflows/ci.yml)
[![CodeQL](https://github.com/rexhinokovaci/amazon-connect-voice-platform/actions/workflows/codeql.yml/badge.svg)](https://github.com/rexhinokovaci/amazon-connect-voice-platform/actions/workflows/codeql.yml)
[![Docs](https://github.com/rexhinokovaci/amazon-connect-voice-platform/actions/workflows/pages.yml/badge.svg)](https://rexhinokovaci.github.io/amazon-connect-voice-platform/)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)

Contact flows, Lex V2 bot, Lambda fulfilment, infrastructure and operations for running inbound voice on Amazon Connect across several brands.

**[Live IVR simulator](https://rexhinokovaci.github.io/amazon-connect-voice-platform/demo/)** · **[Admin console](https://rexhinokovaci.github.io/amazon-connect-voice-platform/demo/admin.html)** · **[Demo guide](https://rexhinokovaci.github.io/amazon-connect-voice-platform/demo-guide/)** · **[Docs](https://rexhinokovaci.github.io/amazon-connect-voice-platform/)**

The simulator runs this repo's real `main-ivr.json` flow and the deployed Lambda handlers in the browser. Seventeen scripted scenarios cover the main paths: balance, meter readings (valid, spoken, rejected), gas emergency, vulnerable callers, out of hours and a second tenant. Every one is a unit test, so the demo can't drift from the code. Both pages open a guided tour on first visit, and the [demo guide](docs/demo-guide.md) has a five-minute walkthrough.

## What's in here

```
contact-flows/      Flow Language templates, rendered at synth time, linted in CI
config/tenants/     one JSON per brand, validated with zod in CI, at synth and at cold start
src/domain/         routing, meter-reading validation, opening hours, bot definition (no AWS imports)
src/lambdas/        connect-router (flow-invoked) and lex-fulfillment (code hook)
src/flows/          flow render + lint, shared by CDK, CI and the demo
python/             CTR processor: Kinesis -> containment, abandonment, queue wait in Datadog
infra/              CDK, one stack per tenant per stage
observability/      Datadog monitors, SLOs and dashboard as code
demo/               simulator + admin console (GitHub Pages)
docs/               architecture, latency budget, ADRs, runbooks, onboarding
```

## Design points worth reading

- **The gas emergency path has no dependencies.** Intent to safety message to external transfer, with no Lambda or database in between. A test walks the flow graph to enforce it. ([architecture](docs/architecture.md))
- **Every failure ends at a person.** Lambda errors route to the default queue, backend timeouts set `handoff=true`, and the linter rejects any block without an error branch. ([ADR 0005](docs/adr/0005-fail-to-a-person.md))
- **Latency is budgeted in code.** Downstream calls run under `withBudget()` and abort through `AbortSignal`, so a slow DynamoDB means a short queue, not dead air. ([latency budget](docs/latency-budget.md))
- **Instance per tenant.** Separate Connect instance, KMS key, table and region per brand. ([ADR 0002](docs/adr/0002-instance-per-tenant.md))
- **Flows are code.** Templated JSON, reviewed in PRs, checked for dangling transitions, dead ends, missing error branches and slow Lambdas. ([ADR 0003](docs/adr/0003-flows-as-code.md))
- **Nova Sonic**: native Connect for IVR journeys, a custom bidirectional stream for the agentic assistant ([ADR 0001](docs/adr/0001-nova-sonic-integration-path.md), [nova-sonic-voice-agent](https://github.com/rexhinokovaci/nova-sonic-voice-agent)).

## Quick start

```bash
nvm use && npm ci
npm run check                 # typecheck, lint, format, flow lint, 100+ tests
npm run demo:serve            # simulator on http://localhost:8080

python3 -m venv .venv && .venv/bin/pip install -r python/requirements-dev.txt
(cd python && ../.venv/bin/pytest)

npx cdk synth -c stage=dev    # all tenants, no AWS account needed
```

Deploying needs an AWS account with Connect enabled. See [onboarding](docs/onboarding.md) and the `Deploy` workflow (GitHub OIDC, tenants one at a time, smoke test after each).

## Related

| Repo | What |
|---|---|
| [nova-sonic-voice-agent](https://github.com/rexhinokovaci/nova-sonic-voice-agent) | Speech-to-speech agent on Amazon Nova Sonic: tool use, barge-in, session renewal, per-turn latency |
| [contact-centre-migration-toolkit](https://github.com/rexhinokovaci/contact-centre-migration-toolkit) | Converts a legacy IVR call tree to Connect flows and reconciles traffic during cutover |

## Licence

MIT. Brands, people and phone numbers are fictional (UK numbers are from the Ofcom drama range).
