# Contributing

## Setup

```bash
nvm use && npm ci
python3 -m venv .venv && .venv/bin/pip install -r python/requirements-dev.txt
npm run check
```

See the [onboarding guide](docs/onboarding.md) for the full tour.

## Workflow

- Branch from `main`: `feat/…`, `fix/…`, `chore/…`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(router): …`, `fix(flow): …`). The changelog is built from them.
- Keep PRs small and about one thing. Flow JSON diffs are hard to review, so describe the caller-facing change in words.
- CI must be green. Prod deploys need an approval on the `production` environment.

## Conventions

- Business rules go in `src/domain` with no AWS imports. Handlers stay thin.
- Every Lambda response the flow reads is a flat map of strings.
- Anything a caller waits on has a latency budget (`withBudget`).
- New failure paths end at a person or an explicit message ([ADR 0005](docs/adr/0005-fail-to-a-person.md)).
- New monitors link to a runbook.
- Comments explain *why*. The code already says what.

## Templates

`templates/` has starting points for a new Lambda handler, a contact flow and a tenant config. `docs/adr/template.md` and `docs/runbooks/template.md` cover decisions and runbooks.
