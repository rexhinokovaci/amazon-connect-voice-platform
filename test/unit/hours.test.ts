import { describe, expect, it } from 'vitest';
import { INTENTS } from '../../src/domain/bot-definition';
import { isOpen } from '../../src/domain/hours';
import { loadTenant } from '../helpers';

const cfg = loadTenant();

describe('isOpen', () => {
  it.each([
    ['2026-10-21T07:59:00Z', true], // Wed 08:59 BST
    ['2026-10-21T06:59:00Z', false], // Wed 07:59 BST
    ['2026-10-21T18:59:00Z', true], // Wed 19:59 BST
    ['2026-10-21T19:00:00Z', false], // Wed 20:00 BST - close is exclusive
    ['2026-10-24T10:00:00Z', true], // Sat 11:00 BST
    ['2026-10-25T12:00:00Z', false], // Sunday closed
    ['2026-12-02T08:30:00Z', true], // Wed 08:30 GMT - DST handled
    ['2026-12-02T07:30:00Z', false],
  ])('%s -> %s', (iso, expected) => {
    expect(isOpen(cfg, new Date(iso))).toBe(expected);
  });
});

describe('bot definition', () => {
  it('has no utterance shared between intents', () => {
    const seen = new Map<string, string>();
    for (const intent of INTENTS) {
      for (const u of intent.utterances) {
        const key = u.toLowerCase();
        expect(seen.get(key), `"${u}" in ${intent.name} and ${seen.get(key)}`).toBeUndefined();
        seen.set(key, intent.name);
      }
    }
  });

  it('every slotted intent uses a dialog hook for validation', () => {
    for (const i of INTENTS.filter((x) => x.slots?.length)) expect(i.dialogHook).toBe(true);
  });
});
