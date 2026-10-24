import { describe, expect, it, vi } from 'vitest';
import { BudgetExceededError, remainingBudget, withBudget } from '../../src/shared/budget';
import { createLogger, redact } from '../../src/shared/logger';
import { distribution, setMetricSender, toTagList } from '../../src/shared/metrics';

describe('redact', () => {
  it('masks sensitive keys and inline PII', () => {
    expect(
      redact({
        accountNumber: '12345678',
        note: 'caller +447700900123 at LS1 4AP, email arben@example.com, card 4111111111111111',
        nested: { transcript: 'my reading is 12045' },
      }),
    ).toEqual({
      accountNumber: '[redacted]',
      note: 'caller [phone] at [postcode], email [email], card [number]',
      nested: { transcript: '[redacted]' },
    });
  });
});

describe('logger', () => {
  it('writes one JSON line with error details', () => {
    const lines: string[] = [];
    createLogger({ fn: 'x' }, (l) => lines.push(l))
      .child({ contactId: 'c1' })
      .error('boom', { err: new TypeError('bad') });
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: 'error', msg: 'boom', fn: 'x', contactId: 'c1' });
    expect(entry.error).toMatchObject({ kind: 'TypeError', message: 'bad' });
  });
});

describe('withBudget', () => {
  it('returns the result inside budget', async () => {
    await expect(withBudget('fast', 50, async () => 'ok')).resolves.toBe('ok');
  });

  it('aborts and rejects past budget', async () => {
    let aborted = false;
    const p = withBudget('slow', 10, (signal) => {
      signal.addEventListener('abort', () => (aborted = true));
      return new Promise(() => {});
    });
    await expect(p).rejects.toBeInstanceOf(BudgetExceededError);
    expect(aborted).toBe(true);
  });

  it('leaves headroom but never goes below the floor', () => {
    expect(remainingBudget(() => 3000)).toBe(2700);
    expect(remainingBudget(() => 200)).toBe(100);
  });
});

describe('metrics', () => {
  it('prefixes names and normalises tags', () => {
    const send = vi.fn();
    setMetricSender(send);
    distribution('x.ms', 12, { tenant: 'Brightwell Energy', empty: '', missing: undefined });
    expect(send).toHaveBeenCalledWith('connect_voice.x.ms', 12, 'tenant:brightwell_energy');
    setMetricSender(undefined);
  });

  it('toTagList drops empty values', () => {
    expect(toTagList({ a: 1, b: undefined, c: true })).toEqual(['a:1', 'c:true']);
  });
});
