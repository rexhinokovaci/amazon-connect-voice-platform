# Voice latency budget

On a phone call, silence is the failure mode. Callers start saying "hello?" at about 1.5 seconds and hang up not long after. Every component in the turn gets a budget, and code that might overrun it degrades to a slower but certain path.

## Lex IVR turn (target p95 ≤ 1.4s from end of speech to first audio)

| Stage | Budget | Owner | Notes |
|---|---|---|---|
| End-of-speech detection | 400-700 ms | Lex | Driven by `end timeout` settings. Shorter means faster turns but more cut-offs on slow speakers. Readings use a longer timeout. |
| ASR + NLU | 150-300 ms | Lex | Mostly fixed. |
| Code hook (our Lambda) | **≤ 300 ms p95** | us | Warm path is ~40 ms. The budget is there for DynamoDB tail latency and cold starts. |
| TTS first byte | 100-250 ms | Polly | Neural voices. Generative voices add ~100 ms. |
| Network / media | ~100 ms | Connect | |

Our share is the only part we control directly, so it gets enforced in code:

```ts
const budget = remainingBudget(context.getRemainingTimeInMillis); // remaining - 300ms headroom
const account = await withBudget('find_account', budget, (signal) => repo.findById(id, signal));
```

`withBudget` aborts the SDK call through its `AbortSignal`. On a timeout the handler sets `handoff=true` and the flow puts the caller through to an agent. A slow database turns into a short queue, not dead air.

## Flow-invoked Lambda (router)

`InvocationTimeLimitSeconds` is 3. Connect allows 8, but 8 seconds of silence before the first prompt loses callers. The flow linter warns above 3s and fails above 8.

The router's DynamoDB lookup gets `remaining - 500ms`. If it times out, we route without customer context: no name, no Priority Services Register bump. Calls still flow.

## Speech-to-speech (Nova Sonic) turn

With speech-to-speech, ASR, reasoning and synthesis become one model call, so the budget is shaped differently:

| Stage | Budget | Notes |
|---|---|---|
| Turn detection | model-driven | Tuned with `endpointingSensitivity`. |
| Time to first audio (no tool) | ≤ 800 ms p95 | Measured from the user's final ASR text to the first `audioOutput` chunk. |
| Tool call round trip | ≤ 400 ms p95 | If a tool may be slow, the system prompt tells the model to say a short holding phrase first. |
| Barge-in to silence | ≤ 200 ms | Flush the playback buffer when the `interrupted` signal arrives. |

[nova-sonic-voice-agent](https://github.com/rexhinokovaci/nova-sonic-voice-agent) instruments each of these per turn and emits them as Datadog distributions.

## How it's measured

- `connect_voice.lex.fulfilment_ms` and `connect_voice.router.duration_ms`: distributions tagged by tenant, intent and input mode.
- `connect_voice.contact.ivr_seconds`: from CTRs. This is the caller's whole IVR experience, not just our code.
- Monitors page on p95 breaches sustained for 10 minutes ([observability](observability.md)).
