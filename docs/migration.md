# Migrating an outsourced contact centre onto Connect

The approach used when a partner-run contact centre, with its own telephony, IVR and agents, moves onto this estate. Tooling is in [contact-centre-migration-toolkit](https://github.com/rexhinokovaci/contact-centre-migration-toolkit).

## Principles

1. **Move routing before agents.** Once calls enter Connect first, routing is in our hands. The partner's agents can stay on their platform behind a SIP transfer until their seats move.
2. **Cut over by number, not by date.** Each DID moves on its own, lowest volume first. Every number has a rollback, which is pointing it back at the old platform.
3. **Measure parity before and after.** Same calls in, same outcomes out. Reconciliation is automated, not a spreadsheet exercise at the end.

## Phases

| Phase | What happens | Exit criteria |
|---|---|---|
| Discover | Export the legacy call tree, number inventory, hours, queues, holiday schedule. Pull 4 weeks of call volumes per DID and per menu option. | Every DID has an owner and a target flow |
| Convert | Toolkit turns the call tree into Connect Flow Language and a tenant config. Engineers review and simplify. Legacy trees usually have dead branches. | Generated flow passes the linter, product owner signs off |
| Shadow | Test numbers on the new flow. Scripted test calls for every branch. | All branches tested, prompts approved |
| Pilot | Lowest-volume DID moves. Old platform stays live as transfer target and rollback. | 5 working days within ±5% of baseline on abandonment, queue time and transfers |
| Wave | Remaining DIDs in waves, sized by volume. | Same parity check per wave |
| Decommission | Old IVR removed, SIP trunk to partner retained only if their agents remain. | 30 days with no fallback use |

## Cutover runbook (per number)

1. Freeze changes to the legacy IVR for that DID 48h before.
2. Confirm the Connect flow version and tenant config in prod match what was tested (`cdk diff` is empty).
3. Re-point the number. This is a carrier or porting action, done in the agreed window.
4. Place test calls covering every top-level option. Check the CTR stream picks them up.
5. Watch the dashboard for 2 hours. Rollback triggers: abandonment > baseline + 5 pts, any technical-error disconnects, emergency transfer failure.
6. Run reconciliation daily for the first week (`ccmt reconcile`).

## What usually goes wrong

- **Holiday schedules.** Legacy platforms often hard-code bank holidays in the IVR. Put them in Connect hours overrides before cutover, not after the first bank holiday.
- **DTMF method mismatches** with the partner's SBC break "press 1" menus on transferred calls.
- **Hidden routing rules.** A queue that "everyone knows" goes to a particular team leader's phone on Fridays. Interview the floor managers, not just the documentation.
- **Reporting definitions differ.** The partner's "abandoned" might exclude calls under 5 seconds. Agree definitions before comparing numbers.
