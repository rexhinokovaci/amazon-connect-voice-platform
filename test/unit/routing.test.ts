import { describe, expect, it } from 'vitest';
import { decideRoute } from '../../src/domain/routing';
import { loadTenant } from '../helpers';

const cfg = loadTenant();
const psrAccount = {
  accountId: 'A2',
  firstName: 'Lena',
  balancePence: 0,
  priorityServicesRegister: true,
  meters: [],
};

describe('decideRoute', () => {
  it('sends gas emergencies to the external number regardless of anything else', () => {
    expect(
      decideRoute(cfg, { intent: 'ReportGasEmergency', account: psrAccount, incidentMode: true }),
    ).toEqual({
      action: 'external_transfer',
      externalNumber: '+44800111999',
      priority: 1,
      promptKey: 'gas_emergency',
      reason: 'gas_emergency',
    });
  });

  it('maps intents to queues', () => {
    expect(
      decideRoute(cfg, { intent: 'SubmitMeterReading', account: undefined, incidentMode: false }),
    ).toMatchObject({
      queueKey: 'meter-readings',
      priority: 5,
    });
  });

  it('falls back to the default queue for unknown or missing intents', () => {
    expect(
      decideRoute(cfg, { intent: 'Nonsense', account: undefined, incidentMode: false }).queueKey,
    ).toBe('general');
    expect(
      decideRoute(cfg, { intent: undefined, account: undefined, incidentMode: false }),
    ).toMatchObject({
      queueKey: 'general',
      reason: 'no_intent',
    });
  });

  it('prioritises Priority Services Register customers', () => {
    expect(
      decideRoute(cfg, { intent: 'CheckBalance', account: psrAccount, incidentMode: false }),
    ).toMatchObject({
      priority: 2,
      promptKey: 'psr_welcome',
    });
  });

  it('switches prompt during an incident', () => {
    expect(
      decideRoute(cfg, { intent: 'CheckBalance', account: undefined, incidentMode: true })
        .promptKey,
    ).toBe('incident_banner');
  });
});

describe('vulnerability', () => {
  it('treats payment difficulty as vulnerable even for unknown callers', () => {
    expect(
      decideRoute(cfg, { intent: 'PaymentDifficulty', account: undefined, incidentMode: false }),
    ).toMatchObject({ queueKey: 'billing', priority: 2, promptKey: 'psr_welcome' });
  });
});
