# Security policy

## Reporting a vulnerability

Please report privately through [GitHub security advisories](https://github.com/rexhinokovaci/amazon-connect-voice-platform/security/advisories/new). Don't open a public issue. You'll get an acknowledgement within 3 working days.

## Scope notes

This repository handles a voice channel that touches personal data. These are treated as security bugs, not just quality issues:

- PII reaching logs (`src/shared/logger.ts` should catch it)
- A Lambda readable or invocable outside its own tenant's Connect instance
- Unencrypted data at rest or in transit
- A flow path where a caller can reach account data without identification

## Practices

- No long-lived AWS keys. CI deploys through GitHub OIDC to a scoped role.
- One KMS customer-managed key per tenant, with rotation enabled.
- Dependabot and CodeQL run weekly and on every PR.
- Fixtures use Ofcom drama-range numbers (`+44 113 496 0xxx`, `+44 7700 900xxx`), never real ones.
