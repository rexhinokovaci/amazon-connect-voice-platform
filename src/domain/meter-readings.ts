import type { MeterReading, MeterType } from './accounts';

export type ReadingValidation =
  | { ok: true; value: number }
  | {
      ok: false;
      reason: 'not_a_number' | 'wrong_length' | 'lower_than_previous' | 'implausible_jump';
      prompt: string;
    };

/** Typical UK domestic usage tops out well under this per day. */
const MAX_UNITS_PER_DAY: Record<MeterType, number> = { electricity: 60, gas: 25 };

/**
 * Speech recognisers return readings in many shapes: "zero four five one two",
 * "4 5 1 2", "four thousand five hundred". Lex's AMAZON.Number slot handles the
 * last; this normalises the digit-by-digit cases.
 */
export function normaliseSpokenDigits(input: string): string {
  const words: Record<string, string> = {
    zero: '0',
    oh: '0',
    o: '0',
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
  };
  return input
    .toLowerCase()
    .split(/[\s,.-]+/)
    .map((t) => words[t] ?? t)
    .join('')
    .replace(/[^0-9]/g, '');
}

export function validateReading(
  raw: string,
  meterType: MeterType,
  previous: MeterReading | undefined,
  now: Date = new Date(),
): ReadingValidation {
  const digits = normaliseSpokenDigits(raw);
  if (!digits) {
    return {
      ok: false,
      reason: 'not_a_number',
      prompt:
        "Sorry, I didn't catch the numbers. Please read the black digits on your meter, one at a time.",
    };
  }
  if (digits.length < 4 || digits.length > 6) {
    return {
      ok: false,
      reason: 'wrong_length',
      prompt: `I heard ${digits.length} digits. Most meters show four to six black digits. Could you read them again?`,
    };
  }
  const value = Number(digits);
  if (!previous) return { ok: true, value };

  if (value < previous.value) {
    return {
      ok: false,
      reason: 'lower_than_previous',
      prompt:
        'That reading is lower than your last one. Please check you are reading the black digits only and try again.',
    };
  }
  const days = Math.max(1, (now.getTime() - new Date(previous.readAt).getTime()) / 86_400_000);
  if (value - previous.value > MAX_UNITS_PER_DAY[meterType] * days) {
    return {
      ok: false,
      reason: 'implausible_jump',
      prompt:
        "That's much higher than we'd expect since your last reading. Could you read it once more to confirm?",
    };
  }
  return { ok: true, value };
}
