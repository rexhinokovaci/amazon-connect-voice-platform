import { INTENTS, METER_TYPES } from '../../src/domain/bot-definition';

// Stand-in for Lex NLU: token overlap against the real sample utterances.
// Good enough to demo routing; obviously not how Lex scores intents.

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/\{[^}]+\}/g, '')
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

const STOP = new Set([
  'i',
  'my',
  'a',
  'to',
  'the',
  'is',
  'you',
  'please',
  "i'd",
  'like',
  'want',
  'can',
  'do',
  'of',
  'me',
]);

export interface Classification {
  intent: string;
  confidence: number;
}

export function classify(utterance: string): Classification {
  const words = new Set(tokens(utterance));
  let best: Classification = { intent: 'FallbackIntent', confidence: 0 };
  for (const intent of INTENTS) {
    for (const sample of intent.utterances) {
      const t = tokens(sample);
      if (!t.length) continue;
      const hits = t.filter((w) => words.has(w)).length;
      const score = hits / t.length;
      if (score > best.confidence) best = { intent: intent.name, confidence: score };
    }
  }
  // Same threshold the bot is deployed with.
  return best.confidence >= 0.4 ? best : { intent: 'FallbackIntent', confidence: best.confidence };
}

export function resolveMeterType(utterance: string): string | undefined {
  const u = utterance.toLowerCase();
  for (const [value, synonyms] of Object.entries(METER_TYPES)) {
    if (u.includes(value) || synonyms.some((s) => u.includes(s))) return value;
  }
  return undefined;
}
