# 0003. Contact flows are generated from templates in git

- **Status:** Accepted
- **Date:** 2026-01-27

## Context

Contact flows are usually built in the Connect console. That makes changes hard to review, impossible to test before publishing, and different between environments in ways nobody notices.

## Decision

Flows live in `contact-flows/` as Flow Language JSON with `${PLACEHOLDER}` tokens for anything environment specific. CDK renders and deploys them. A linter (`src/flows/flow.ts`) runs in CI and checks:

- every transition points at a block that exists
- no dead ends except terminal blocks
- every block that can fail has an error branch
- Lambda timeouts are 3s or less (hard fail above 8s)
- logging is the first block
- no unreachable blocks

## Consequences

- Flow changes get reviewed in PRs like code. The diff is noisy JSON, so the PR template asks for a one-line description of the routing change.
- Console edits get overwritten on deploy. That's intended, and it's in the onboarding doc.
- Designing visually in the console is still useful for prototyping. Export the JSON, replace ARNs with placeholders, and commit it.
- The same render and lint code drives the browser simulator, so what you try in the demo is the deployed flow.
