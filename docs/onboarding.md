# Developer onboarding

Getting from a fresh laptop to a change in dev, roughly half a day.

## Prerequisites

- Node 22 (`nvm use`), Python 3.12+, Docker not required.
- AWS SSO access to the `connect-voice-dev` account. Ask in #connect-channels.
- A Datadog login (read-only is fine to start).

## Local setup

```bash
git clone https://github.com/rexhinokovaci/amazon-connect-voice-platform
cd amazon-connect-voice-platform
npm ci
python3 -m venv .venv && .venv/bin/pip install -r python/requirements-dev.txt
npm run check            # typecheck, lint, format, flow lint, tests
(cd python && ../.venv/bin/pytest)
```

Then open the simulator locally:

```bash
npm run demo:serve       # builds demo/ and serves it on http://localhost:8080
```

## Repository map

```
config/tenants/      one JSON per brand - the only place tenant behaviour lives
contact-flows/       Connect Flow Language templates
src/domain/          business rules, no AWS imports except the Dynamo repository
src/lambdas/         thin handlers: parse event, call domain, shape response
src/flows/           flow render + lint (used by CDK, CI and the demo)
src/shared/          logger, metrics, latency budget, tenant loader
python/              CTR processor (Kinesis -> Datadog)
infra/               CDK app and constructs
observability/       Datadog monitors, SLOs, dashboard
demo/                browser simulator (GitHub Pages)
docs/                this site
```

## Your first change

A good first ticket is adding a sample utterance or a new intent route:

1. Add the utterance in `src/domain/bot-definition.ts`.
2. If it's a new intent, map it to a queue in each relevant `config/tenants/*.json`. The schema will tell you if the queue doesn't exist.
3. `npm test`. The bot definition test catches an utterance shared between two intents.
4. Try it in the simulator (`npm run demo:serve`).
5. `npx cdk diff -c stage=dev -c tenant=brightwell-energy`.
6. Open a PR. CI runs everything above plus `cdk synth` for all tenants.

## Deploying

Merges to `main` deploy to dev automatically. Staging and prod are promoted from the Actions tab (`Deploy` workflow, `workflow_dispatch`) and need approval from the `production` environment reviewers. Tenants deploy one at a time.

Never edit a managed flow in the Connect console. The next deploy overwrites it. If you need to hotfix in the console during an incident, raise a PR with the same change before you go home.

## Where to ask

- #connect-channels: day-to-day
- #connect-voice-alerts: what's firing
- On-call: PagerDuty schedule "Connect Voice"
