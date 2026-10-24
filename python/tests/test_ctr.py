import base64
import json

from ctr_processor.handler import handler
from ctr_processor.metrics import from_ctr


def ctr(**overrides):
    base = {
        "ContactId": "c-1",
        "Channel": "VOICE",
        "InitiationMethod": "INBOUND",
        "InitiationTimestamp": "2026-10-01T09:00:00Z",
        "DisconnectTimestamp": "2026-10-01T09:06:00Z",
        "DisconnectReason": "CUSTOMER_DISCONNECT",
        "Attributes": {"intent": "CheckBalance"},
        "Queue": None,
        "Agent": None,
    }
    base.update(overrides)
    return base


def test_contained_self_service():
    m = from_ctr(ctr(DisconnectReason="CONTACT_FLOW_DISCONNECT"))
    assert m.contained
    assert not m.answered
    assert m.ivr_seconds == 360
    assert m.tags["intent"] == "checkbalance"


def test_answered_contact():
    m = from_ctr(
        ctr(
            Queue={
                "Name": "Billing",
                "EnqueueTimestamp": "2026-10-01T09:01:00Z",
                "DequeueTimestamp": "2026-10-01T09:02:30Z",
                "Duration": 90,
            },
            Agent={"ConnectedToAgentTimestamp": "2026-10-01T09:02:30Z"},
        )
    )
    assert m.answered
    assert not m.contained
    assert m.ivr_seconds == 60
    assert m.queue_wait_seconds == 90
    assert m.handle_seconds == 210
    assert m.tags["queue"] == "billing"


def test_abandoned_in_queue():
    m = from_ctr(
        ctr(Queue={"Name": "Billing", "EnqueueTimestamp": "2026-10-01T09:01:00Z", "Duration": 300})
    )
    assert m.abandoned_in_queue
    assert not m.contained


def test_external_transfer_is_not_containment():
    m = from_ctr(ctr(TransferCompletedTimestamp="2026-10-01T09:00:40Z"))
    assert m.transferred_external
    assert not m.contained


def _record(seq, payload):
    data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return {"kinesis": {"sequenceNumber": seq, "data": base64.b64encode(data).decode()}}


def test_handler_reports_only_failed_items(capsys):
    event = {
        "Records": [
            _record("1", ctr()),
            _record("2", b"not json"),
            _record("3", {"no": "contact id"}),
        ]
    }
    result = handler(event, None)
    assert result == {"batchItemFailures": [{"itemIdentifier": "3"}]}
    assert "connect_voice.contact.count" in capsys.readouterr().out
