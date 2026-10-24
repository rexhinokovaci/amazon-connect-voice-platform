# Emergency transfer failure

**Severity:** P1 · **Pages:** yes · **Owner:** Connect & Channels

## Is this hurting callers right now?

Yes, potentially seriously. A caller reporting a gas leak wasn't connected to the emergency service. They heard the fallback message telling them to dial 0800 111 999 themselves, but every failure needs looking at.

## Confirm

```text
service:connect-voice env:prod @contactFlowModuleType:TransferParticipantToThirdParty
```

Open the contact in Connect (Contact search → contact ID from the log) and check the `Results` field and the CTR's `DisconnectReason`.

## Mitigate

1. **Place a test call** to the tenant's number, say "gas leak", and confirm whether the transfer works now.
2. If it fails consistently, check whether outbound calling is working on the instance at all. Try a manual outbound call from the CCP.
3. If outbound is broken across the instance, raise a **Sev 1 AWS support case** and tell the emergency service liaison.
4. Don't change the flow during the incident unless the fault is clearly in it. The fallback message is the safety net.

## Diagnose

| Cause | Check |
|---|---|
| Outbound calling disabled or quota hit | Instance settings → Telephony. Service Quotas → Connect |
| Destination number changed or wrong | `routing.gasEmergencyNumber` in tenant config against the published number |
| Carrier issue on the external leg | Several failures with `CallFailed` close together, other outbound also failing |
| Country not allowed for outbound | Instance outbound call settings |

## Fix / follow-up

- Always run a postmortem, even for a single failure.
- If the config was wrong, add a test asserting the expected number for each tenant.
