"""Kinesis consumer for Contact Trace Records.

Partial batch responses are enabled on the event source mapping, so a bad
record is reported by sequence number and retried/bisected on its own instead
of poisoning the whole shard.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

from .metrics import ContactMetrics, from_ctr

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

TENANT = os.environ.get("TENANT_ID", "unknown")
STAGE = os.environ.get("STAGE", "dev")

try:  # Provided by the Datadog Python layer in deployed environments.
    from datadog_lambda.metric import lambda_metric  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - exercised implicitly in tests

    def lambda_metric(name: str, value: float, tags: list[str] | None = None) -> None:
        print(json.dumps({"metric": name, "value": value, "tags": tags or []}))


def _emit(m: ContactMetrics) -> None:
    tags = [f"tenant:{TENANT}", f"env:{STAGE}"] + [f"{k}:{v}" for k, v in m.tags.items()]

    lambda_metric("connect_voice.contact.count", 1, tags=tags)
    if m.ivr_seconds is not None:
        lambda_metric("connect_voice.contact.ivr_seconds", m.ivr_seconds, tags=tags)
    if m.queue_wait_seconds is not None:
        lambda_metric("connect_voice.contact.queue_wait_seconds", m.queue_wait_seconds, tags=tags)
    if m.handle_seconds is not None:
        lambda_metric("connect_voice.contact.handle_seconds", m.handle_seconds, tags=tags)
    if m.contained:
        lambda_metric("connect_voice.contact.contained", 1, tags=tags)
    if m.abandoned_in_queue:
        lambda_metric("connect_voice.contact.abandoned", 1, tags=tags)
    if m.transferred_external:
        lambda_metric("connect_voice.contact.transferred_external", 1, tags=tags)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    failures: list[dict[str, str]] = []
    processed = 0

    for record in event.get("Records", []):
        seq = record["kinesis"]["sequenceNumber"]
        try:
            ctr = json.loads(base64.b64decode(record["kinesis"]["data"]))
        except (ValueError, KeyError):
            # Undecodable data will never succeed on retry; log and drop.
            logger.error("dropping malformed CTR record seq=%s", seq)
            continue
        try:
            _emit(from_ctr(ctr))
            processed += 1
        except Exception:
            logger.exception("failed to process CTR contactId=%s", ctr.get("ContactId"))
            failures.append({"itemIdentifier": seq})

    logger.info("processed=%d failed=%d", processed, len(failures))
    return {"batchItemFailures": failures}
