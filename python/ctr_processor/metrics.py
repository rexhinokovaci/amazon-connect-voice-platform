"""Turns Contact Trace Records into the handful of numbers ops actually watch.

CTR schema: https://docs.aws.amazon.com/connect/latest/adminguide/ctr-data-model.html
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# Contacts that end in these states without reaching an agent were handled by
# self-service (or abandoned in the IVR - disambiguated below).
_SELF_SERVICE_DISCONNECTS = {"CONTACT_FLOW_DISCONNECT", "CUSTOMER_DISCONNECT"}


@dataclass(frozen=True)
class ContactMetrics:
    contact_id: str
    channel: str
    initiation_method: str
    queue: str | None
    disconnect_reason: str | None
    ivr_seconds: float | None
    queue_wait_seconds: float | None
    handle_seconds: float | None
    answered: bool
    abandoned_in_queue: bool
    contained: bool
    transferred_external: bool
    tags: dict[str, str] = field(default_factory=dict)


def _ts(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _seconds(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    return max(0.0, (end - start).total_seconds())


def from_ctr(ctr: dict[str, Any]) -> ContactMetrics:
    queue = ctr.get("Queue") or {}
    agent = ctr.get("Agent") or {}

    initiated = _ts(ctr.get("InitiationTimestamp"))
    enqueued = _ts(queue.get("EnqueueTimestamp"))
    connected_to_agent = _ts(agent.get("ConnectedToAgentTimestamp"))
    disconnected = _ts(ctr.get("DisconnectTimestamp"))

    answered = connected_to_agent is not None
    reason = ctr.get("DisconnectReason")
    # TransferCompletedTimestamp is set for third-party transfers (e.g. gas emergency).
    transferred_external = bool(ctr.get("TransferCompletedTimestamp")) and not answered

    ivr_end = enqueued or (disconnected if not answered else None)

    return ContactMetrics(
        contact_id=ctr["ContactId"],
        channel=ctr.get("Channel", "UNKNOWN"),
        initiation_method=ctr.get("InitiationMethod", "UNKNOWN"),
        queue=queue.get("Name"),
        disconnect_reason=reason,
        ivr_seconds=_seconds(initiated, ivr_end),
        queue_wait_seconds=queue.get("Duration") if enqueued else None,
        handle_seconds=_seconds(connected_to_agent, disconnected) if answered else None,
        answered=answered,
        abandoned_in_queue=enqueued is not None and not answered and not transferred_external,
        contained=(
            enqueued is None
            and not answered
            and not transferred_external
            and reason in _SELF_SERVICE_DISCONNECTS
        ),
        transferred_external=transferred_external,
        tags={
            "channel": ctr.get("Channel", "unknown").lower(),
            "queue": (queue.get("Name") or "none").lower().replace(" ", "_"),
            "intent": str((ctr.get("Attributes") or {}).get("intent", "none")).lower(),
        },
    )
