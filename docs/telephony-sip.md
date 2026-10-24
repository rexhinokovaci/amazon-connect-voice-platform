# Telephony and SIP notes

Things worth knowing when a Connect estate meets the rest of the telephony world: carriers, outsourced partners, legacy PBXs.

## Numbers

- Store and compare everything in **E.164** (`+441134960000`). The tenant schema rejects anything else.
- Withheld callers arrive with an ANI of `anonymous` or empty. The router treats any ANI that doesn't start with `+` as unidentified.
- A shared household number can match more than one account. The repository refuses to pick one: two matches means unidentified.
- UK number porting takes weeks and comes with a fixed cutover window. Plan migrations around the port date, not the other way round.

## SIP fundamentals that come up in practice

| Topic | What to know |
|---|---|
| Signalling vs media | SIP (5060/5061) sets up the call. RTP carries audio on a negotiated UDP port range. Firewalls that allow SIP but not the RTP range give you connected calls with no audio. |
| Codecs | G.711 (µ-law/A-law, 8 kHz) is the PSTN baseline. Wideband (G.722, Opus) helps ASR noticeably but only if every hop supports it. Connect's PSTN leg is narrowband, so speech models get 8 kHz audio upsampled to 16 kHz. |
| DTMF | RFC 2833/4733 (in RTP), SIP INFO, or in-band. Mismatches mean IVR menus that don't hear key presses. Confirm the method with every carrier and SBC. |
| SBC | A Session Border Controller sits between networks for security, NAT traversal, header manipulation and codec transcoding. Outsourced centres nearly always have one. |
| Headers | `P-Asserted-Identity`, `Diversion`, `User-to-User` (UUI). UUI is how context like a contact ID survives a SIP transfer to a third party. |
| TLS/SRTP | Encrypt signalling (SIP over TLS) and media (SRTP) on any leg that crosses the public internet. |

## Connect specifics

- **Transfers to external numbers** (`TransferParticipantToThirdParty`) use Connect's outbound PSTN, so the caller ID presented and the cost both depend on the number type.
- **Early media** is enabled on the instance so callers hear ringback and progress tones on transfers rather than silence.
- **Chime SDK Voice Connector** is the route for SIP trunking to a PBX or SBC, for example to keep an outsourced partner's platform reachable during a phased migration.

## Debugging checklist: "calls connect but no audio"

1. Check both directions. One-way audio almost always means NAT or firewall on the RTP range.
2. Codec negotiation in the SDP. Is there a common codec on both sides?
3. SRTP on one side and RTP on the other.
4. Is the SBC rewriting the media IP to a private address?
