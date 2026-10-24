# Demo guide

Two pages, no AWS account needed. Both open a short guided tour on first visit. You can reopen it any time with **Take the tour** in the top bar.

- [IVR simulator](https://rexhinokovaci.github.io/amazon-connect-voice-platform/demo/)
- [Admin console](https://rexhinokovaci.github.io/amazon-connect-voice-platform/demo/admin.html)

## The five-minute walkthrough

A script for showing this to someone else. Each step takes under a minute.

1. **Balance check.** Simulator → Scenarios → *Balance check*. Point out that the caller was identified by phone number before the bot spoke (`identify-caller` block), and that the answer came from the Lex code hook. Open *Invocations* and show the real Lex event and response.
2. **Rejected meter reading.** Run *Rejected reading*. The reading is lower than last time, so the bot re-prompts, then hands off with `handoffReason=reading_lower_than_previous`, which the agent sees. This is [ADR 0005](adr/0005-fail-to-a-person.md): failures end at a person.
3. **Gas emergency.** Run *Gas emergency*. In the flow panel, no `InvokeLambdaFunction` block lights up after the bot. The safety path has no dependencies, and a unit test enforces that.
4. **Vulnerable callers.** Run *Payment difficulty*: billing queue at priority 2, even though the caller is unknown.
5. **Second tenant.** Run *Drita: power cut*. It's the same flow and the same code, but the Albanian tenant's config routes it to *Defekte dhe ndërprerje*.
6. **Admin console.** Change a queue's *Target* from 60 to 45. The pending change panel shows a diff against `config/tenants/brightwell-energy.json`, validated by the real schema. Then set an agent to *Break* and show it in the audit log. That's the split between config (reviewed in git) and operations (live, audited).
7. **Break the flow.** Simulator → *Flow lint* tab. Delete an `"Errors"` array from the Lambda block and press *Run lint*. The same checks run in CI.

## Simulator, piece by piece

| Area | What it shows |
|---|---|
| Call card | Transcript of the call. IVR prompts on the left, the caller on the right, with the intent and confidence the NLU detected. |
| Controls | Caller (known, priority, unknown, withheld), brand, time of day, read-aloud toggle, call / hang-up. |
| Suggestion chips | Phrases that work at the current step. They change when the bot asks for a meter type or a reading. |
| Scenarios | Seventeen scripted calls. Click one and it dials and talks by itself. |
| How the call was routed | Every block in `main-ivr.json`. Visited blocks show their step numbers. The current block is outlined. |
| Under the hood | **Invocations**: exact Lambda and Lex payloads with timings. **Logs**: structured JSON as Datadog ingests it, with PII masked. **Flow lint**: edit the rendered flow and lint it. |
| Call summary | When a call ends, a summary pops up: who called, what they wanted, how it ended, duration, blocks run and Lambda calls. |

**What's real and what's simulated.** The flow JSON, the router and fulfilment Lambda code, routing rules, meter reading validation, opening hours and the logger are the production modules, bundled for the browser. DynamoDB is an in-memory store with two customers. Lex NLU is a keyword matcher over the bot's real sample utterances, at the bot's confidence threshold.

## Admin console, piece by piece

| Area | Kind of change | Notes |
|---|---|---|
| KPIs | Read-only | Waiting, longest wait, agents available, service level, lines open. Traffic is simulated. |
| Queue board | Config (Target, Max) | Edits become a diff. Service level bars go amber below 80% and red below 70%. |
| Agents | Operational | Status changes apply immediately and are logged with the Connect API they map to (`PutUserStatus`). |
| Routing | Config | Intent to queue. The gas emergency route is locked. |
| Opening hours | Config | Validated: opening must come before closing. Lines open/closed updates live. |
| Pending change | — | Diff plus schema validation. *Copy config JSON* gives you the file content for a PR. |
| Incident mode | Operational | Plays the incident banner to callers. Audited. |
| Audit log | — | Every operational change this session. |

Why the split? Queue limits, routing and hours change how every call is handled, so they go through review and the deploy pipeline ([ADR 0003](adr/0003-flows-as-code.md)). Agent status and incident mode are things a supervisor must be able to do in seconds during a busy morning.

## Running it locally

```bash
npm ci
npm run demo:serve      # http://localhost:8080 (simulator) and /admin.html
```

## FAQ

**Can I place a real phone call?** Not from the demo. Deploying the CDK stacks to your own AWS account gives you a real Connect instance; then associate a phone number with the *Main IVR* flow.

**Why does the timer say 00:01 for a whole conversation?** Scripted scenarios run faster than real speech. Real calls take longer.

**The tour keeps reopening.** Your browser is blocking local storage (private window). Press *Skip*.
