# CTR pipeline lag

**Severity:** P4 · **Pages:** no · **Owner:** Connect & Channels

## Is this hurting callers right now?

No. Calls are unaffected. Dashboards and containment or abandonment monitors are stale, so you're flying blind on those until it catches up.

## Confirm

- Kinesis `GetRecords.IteratorAgeMilliseconds` for the tenant's CTR stream.
- CTR processor Lambda errors and duration. Throttles?
- Messages in the CTR DLQ.

## Mitigate

| Cause | Action |
|---|---|
| Processor erroring on a record | Partial batch failure plus bisect isolates it. Bad records land in the DLQ after 3 retries. Check the DLQ and logs for the failing `ContactId`. |
| Throttled | Raise reserved concurrency, or check account-level concurrency. |
| Volume spike | On-demand stream scales, but the consumer may lag briefly. Wait if age is falling. |

## Fix / follow-up

Replay DLQ messages after fixing: they hold the Kinesis batch reference, so re-read those sequence numbers or reprocess from the CTR S3 export.
