import { describe, expect, it } from 'vitest';
import { parseTenantConfig } from '../../src/domain/tenant-config';
import { rawTenant } from '../helpers';

describe('tenant config', () => {
  it.each(['brightwell-energy', 'drita-energji'])('%s is valid', (id) => {
    expect(() => parseTenantConfig(rawTenant(id))).not.toThrow();
  });

  it('rejects intent routing to an unknown queue', () => {
    const raw = rawTenant();
    (raw.routing as { intentQueues: Record<string, string> }).intentQueues.CheckBalance = 'nope';
    expect(() => parseTenantConfig(raw)).toThrow(
      /routing\.intentQueues\.CheckBalance: unknown queue key "nope"/,
    );
  });

  it('rejects non-E.164 numbers', () => {
    const raw = rawTenant();
    (raw.routing as { gasEmergencyNumber: string }).gasEmergencyNumber = '0800 111 999';
    expect(() => parseTenantConfig(raw)).toThrow(/E\.164/);
  });

  it('rejects inverted opening hours', () => {
    const raw = rawTenant();
    (raw.hours as { weekdays: object }).weekdays = { open: '20:00', close: '08:00' };
    expect(() => parseTenantConfig(raw)).toThrow(/open must be before close/);
  });

  it('rejects duplicate queue keys', () => {
    const raw = rawTenant();
    const queues = raw.queues as object[];
    queues.push({ ...queues[0] });
    expect(() => parseTenantConfig(raw)).toThrow(/unique/);
  });
});
