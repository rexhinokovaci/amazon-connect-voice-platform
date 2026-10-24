# Nova Sonic integration

Amazon Nova Sonic is a speech-to-speech foundation model: audio in, audio out, with tool use in between. There are two ways to get it onto a Connect call, and they suit different needs.

## Option A: Connect native (Lex bot with Nova Sonic speech)

Connect can use Nova Sonic as the speech model behind a Lex V2 bot. The flow, intents and fulfilment Lambdas stay the same. Callers get more natural turn-taking and expressive voices.

- Enabled per bot locale. The flow needs a `Set voice` block with a compatible expressive voice.
- Region and language support is narrower than standard Lex. At launch it was US East (N. Virginia) and US West (Oregon), so check the current admin guide before planning a tenant around it.
- Neither current tenant can use it yet. `brightwell-energy` runs in eu-west-2 and is waiting for EU region support. `drita-energji` also needs Albanian, which neither Lex V2 nor Polly supports, so it runs English prompts on standard Lex. `features.novaSonic` stays `false` for both until that changes.

**Use when** you want better voice quality on an existing intent-based IVR with minimal change.

## Option B: Custom bidirectional stream

Call `InvokeModelWithBidirectionalStream` directly and bridge audio to and from the call: Connect media streaming via Kinesis Video Streams, or a SIP leg through Chime SDK Voice Connector.

- You own the conversation: system prompt, tools, guardrails, session renewal (the 8 minute connection limit), and barge-in.
- Works outside Connect too: web, mobile, an agentic platform's voice channel.
- More moving parts. You run a media bridge, and its latency and availability are yours.

**Use when** the voice channel is a front end for a broader agentic platform (tools, memory, multi-step tasks), not a menu.

## Recommendation

Start with **A** for existing IVR journeys. It's a configuration change behind a feature flag and can be rolled back per brand. Build **B** for the agentic assistant, where tool use and conversation control are the product.

Option B's implementation lives in [nova-sonic-voice-agent](https://github.com/rexhinokovaci/nova-sonic-voice-agent). Its tools call the same domain functions as the Lex fulfilment (`validateReading`, `formatBalance`, `decideRoute`), so both channels apply the same business rules.

See [ADR 0001](adr/0001-nova-sonic-integration-path.md) for the full decision record.
