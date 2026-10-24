# Templates

| File | Copy to | Notes |
|---|---|---|
| `lambda-handler.ts` | `src/lambdas/<name>/handler.ts` | Wire it up in `infra/lib/tenant-voice-stack.ts` and add a test next to the others |
| `contact-flow.json` | `contact-flows/<name>.json` | `npm run flows:validate` must pass |
| `tenant-config.json` | `config/tenants/<tenant-id>.json` | Change every value. The schema enforces E.164, queue references and hours |

ADR and runbook templates live with the docs: `docs/adr/template.md`, `docs/runbooks/template.md`.
