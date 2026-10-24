# 0004. TypeScript for call-path Lambdas, Python for analytics

- **Status:** Accepted
- **Date:** 2026-02-03

## Context

The team writes both. We wanted a rule rather than a per-function debate.

## Decision

- **TypeScript** for anything a caller waits on: flow-invoked Lambdas, Lex code hooks, voice agent tools. Shared types with CDK, fast cold starts on arm64 with esbuild bundling, and one language for infra and handlers.
- **Python** for asynchronous data work: the CTR processor, reconciliation, migration tooling. That's where pandas and the data team's existing code live.

## Consequences

- Business rules a caller depends on exist once, in TypeScript. Python code consumes the outputs (CTRs, metrics). It doesn't reimplement routing.
- Two toolchains in CI (eslint/prettier/vitest and ruff/mypy/pytest). Both are fast.
