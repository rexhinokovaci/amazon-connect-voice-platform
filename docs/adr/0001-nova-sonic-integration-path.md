# 0001. Nova Sonic integration path

- **Status:** Accepted
- **Date:** 2026-03-12

## Context

We want more natural voice interactions in two places: existing IVR journeys (balance, readings, routing), and the voice channel of a new agentic assistant that does multi-step tasks with tools.

Nova Sonic is available two ways: as the speech model behind a Lex bot inside Connect, and as a raw bidirectional streaming API on Bedrock.

## Options considered

1. **Native Connect for everything.** Least to build. But the agentic assistant needs conversation control (custom tools, memory, session handover) that an intent model doesn't give us.
2. **Custom stream for everything.** Full control. But it means operating a media bridge for journeys that work fine today, plus a new failure domain on the main inbound path.
3. **Native for IVR, custom stream for the assistant.** Each journey gets the simplest thing that meets its needs.

## Decision

Option 3.

- IVR: enable Nova Sonic on the bot per tenant behind `features.novaSonic`, starting with whichever tenant first lands in a supported region and language. Today that's none, see [Nova Sonic integration](../nova-sonic.md).
- Assistant: `nova-sonic-voice-agent` owns the bidirectional stream, tool calls and session renewal. Its tools reuse the same domain functions as the Lex fulfilment.

## Consequences

- Business rules stay in one place (`src/domain`), whichever channel calls them.
- Regional availability limits which tenants get native Nova Sonic. Tenant region is per-config partly for this reason.
- We operate a media bridge for the assistant. Its latency gets the same budget treatment and Datadog monitors as the IVR.
- Revisit when native Connect supports custom tool orchestration with Nova Sonic, which could collapse both paths into one.
