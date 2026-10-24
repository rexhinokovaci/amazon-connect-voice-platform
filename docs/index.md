# Amazon Connect voice platform

Infrastructure, contact flows and Lambda code for running inbound voice on Amazon Connect across more than one brand, with the operational pieces (dashboards, monitors, runbooks) that keep it running.

**[Open the live IVR simulator →](demo/)** · **[Admin console →](demo/admin.html)** · **[Demo guide →](demo-guide.md)**

The simulator runs this repo's real contact flow JSON and the same Lambda handlers that get deployed. DynamoDB is swapped for an in-memory store and Lex NLU for a keyword matcher, so you can try a balance check, a meter reading, a gas emergency or an out-of-hours call without an AWS account.

## What's here

| Area | Where | Notes |
|---|---|---|
| Contact flows as code | `contact-flows/`, `src/flows/flow.ts` | Flow Language JSON with placeholders, rendered at synth time and linted in CI |
| IVR bot | `src/domain/bot-definition.ts`, `infra/lib/lex-bot.ts` | Lex V2, voice-first utterances, dialog + fulfilment code hooks |
| Lambda fulfilment (TypeScript) | `src/lambdas/` | Router invoked from the flow, Lex code hook for balance and meter readings |
| CTR analytics (Python) | `python/ctr_processor/` | Kinesis consumer that turns contact trace records into Datadog metrics |
| Infrastructure | `infra/` | CDK, one stack per brand per stage |
| Tenant config | `config/tenants/*.json` | Validated with zod at synth time and at Lambda cold start |
| Observability | `observability/datadog/` | Dashboard, monitors and SLOs as code |
| Operations | [Runbooks](runbooks/index.md), [Onboarding](onboarding.md) | Written for the person on call at 2am |

## Related repositories

- [nova-sonic-voice-agent](https://github.com/rexhinokovaci/nova-sonic-voice-agent): speech-to-speech agent on Amazon Nova Sonic with tool use, barge-in and per-turn latency tracing.
- [contact-centre-migration-toolkit](https://github.com/rexhinokovaci/contact-centre-migration-toolkit): converts a legacy IVR call tree into Connect flows and reconciles traffic during cutover.

## Design decisions

The reasoning behind the non-obvious choices is in the [ADRs](adr/index.md). Start with [instance per tenant](adr/0002-instance-per-tenant.md) and [flows as code](adr/0003-flows-as-code.md).
