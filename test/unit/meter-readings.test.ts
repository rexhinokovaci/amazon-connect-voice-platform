import { describe, expect, it } from 'vitest';
import { normaliseSpokenDigits, validateReading } from '../../src/domain/meter-readings';

const previous = {
  accountId: 'A1',
  meterType: 'electricity' as const,
  value: 12000,
  readAt: '2026-09-01T00:00:00.000Z',
  source: 'smart' as const,
};
const now = new Date('2026-10-01T00:00:00.000Z'); // 30 days later

describe('normaliseSpokenDigits', () => {
  it.each([
    ['one two oh four five', '12045'],
    ['1 2 0 4 5', '12045'],
    ['zero, four, five, one', '0451'],
    ['12,045', '12045'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseSpokenDigits(input)).toBe(expected);
  });
});

describe('validateReading', () => {
  it('accepts a plausible reading', () => {
    expect(validateReading('12 5 0 0', 'electricity', previous, now)).toEqual({
      ok: true,
      value: 12500,
    });
  });

  it('accepts any well formed first reading', () => {
    expect(validateReading('0042', 'gas', undefined, now)).toEqual({ ok: true, value: 42 });
  });

  it('rejects readings lower than the last one', () => {
    expect(validateReading('11999', 'electricity', previous, now)).toMatchObject({
      ok: false,
      reason: 'lower_than_previous',
    });
  });

  it('rejects implausible jumps', () => {
    // 30 days * 60 kWh = 1800 max
    expect(validateReading('13801', 'electricity', previous, now)).toMatchObject({
      ok: false,
      reason: 'implausible_jump',
    });
    expect(validateReading('13800', 'electricity', previous, now)).toMatchObject({ ok: true });
  });

  it('rejects wrong length and non-numeric input', () => {
    expect(validateReading('123', 'gas', undefined, now)).toMatchObject({ reason: 'wrong_length' });
    expect(validateReading('erm not sure', 'gas', undefined, now)).toMatchObject({
      reason: 'not_a_number',
    });
  });
});
