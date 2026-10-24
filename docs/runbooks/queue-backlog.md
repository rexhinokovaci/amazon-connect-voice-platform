# Queue backlog / high abandonment

**Severity:** P3 · **Pages:** no · **Owner:** Connect & Channels + WFM

## Is this hurting callers right now?

Yes. People are giving up. Whether it's a technical problem is the first question.

## Confirm

1. Volume: is `contact.count` above the same hour last week? If yes, it's probably demand (bill run, outage, weather), not a fault.
2. Containment: if it fell at the same time, self-service is failing and pushing calls to agents. Go to [Lex fulfilment errors](lex-fulfilment-errors.md).
3. Staffing: Connect real-time metrics → agents available per queue. Ask WFM.

## Mitigate

- **Demand spike with a known cause** (regional outage): set `INCIDENT_MODE=true` on the router. Callers hear the incident banner, and many hang up satisfied, which takes pressure off the queues.
  ```bash
  aws lambda update-function-configuration --function-name <router> \
    --environment "Variables={...existing...,INCIDENT_MODE=true}"
  ```
  Raise the matching config PR after. The next deploy resets it otherwise.
- **Self-service broken:** fix that first. It's the multiplier.
- **Staffing:** WFM's call.

## Fix / follow-up

If self-service failure caused it, run a postmortem. If demand caused it, share the volume curve with WFM for forecasting.
