# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [0.1.0] - 2026-10-24

### Added

- Main IVR contact flow as a template, with render and lint (dangling transitions, dead ends, error branches, Lambda timeouts, unreachable blocks).
- Lex V2 bot built from a shared bot definition: balance, meter readings, gas emergency, moving home, agent.
- Router Lambda (identify / route) with Priority Services Register priority and a default-queue fallback.
- Lex fulfilment Lambda with meter reading validation and a latency budget that hands off on backend timeout.
- Python CTR processor emitting containment, abandonment, queue wait and handle time to Datadog.
- CDK stack per tenant: Connect instance, hours, queues, KMS, S3 recordings, Kinesis CTR stream, DynamoDB.
- Datadog monitors, SLOs and dashboard as code, plus an idempotent apply script.
- Browser IVR simulator running the real flow and handlers, published on GitHub Pages.
- Docs: architecture, latency budget, multi-tenancy, Nova Sonic, voice prompting, SIP, migration, onboarding, 5 ADRs, 5 runbooks.

[0.1.0]: https://github.com/rexhinokovaci/amazon-connect-voice-platform/releases/tag/v0.1.0
