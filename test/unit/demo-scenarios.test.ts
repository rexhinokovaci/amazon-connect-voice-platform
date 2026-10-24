import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallSimulator, type EngineEvent } from '../../demo/src/engine';
import { classify, resolveMeterType } from '../../demo/src/nlu';
import { METER_ANSWERS, OPENERS, SCENARIOS } from '../../demo/src/scenarios';
import { placeholders, renderFlow, type Flow } from '../../src/flows/flow';
import { setRepository as setRouterRepo } from '../../src/lambdas/connect-router/handler';
import { setRepository as setLexRepo } from '../../src/lambdas/lex-fulfillment/handler';
import { setMetricSender } from '../../src/shared/metrics';
import { resetTenantConfigCache } from '../../src/shared/tenant';
import { fixtureRepo, loadTenant, rawTenant } from '../helpers';

const TENANTS = ['brightwell-energy', 'drita-energji'];
const ANIS = ['+447700900123', '+447700900456', '+447700900999', 'anonymous'];
const CLOCKS = [
  new Date('2026-10-21T09:00:00Z'),
  new Date('2026-10-21T09:00:00Z'), // Wed 10:00 London / 11:00 Tirana
  new Date('2026-10-21T20:30:00Z'),
  new Date('2026-10-25T11:00:00Z'), // Sunday
];
const template = readFileSync(
  join(__dirname, '..', '..', 'contact-flows', 'main-ivr.json'),
  'utf8',
);

describe('demo openers', () => {
  it.each(OPENERS.map((o) => [o.text, o.intent]))('"%s" -> %s', (text, intent) => {
    expect(classify(text).intent).toBe(intent);
  });

  it.each(METER_ANSWERS)('"%s" resolves to a meter type', (answer) => {
    expect(resolveMeterType(answer)).toBeDefined();
  });
});

describe('demo scenarios', () => {
  beforeEach(() => {
    const repo = fixtureRepo();
    setRouterRepo(repo);
    setLexRepo(repo);
    setMetricSender(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it.each(SCENARIOS.map((s) => [s.id, s]))('%s', async (_id, s) => {
    const tenantId = TENANTS[s.tenant]!;
    const tenant = loadTenant(tenantId);
    const queueArns = Object.fromEntries(tenant.queues.map((q) => [q.key, `arn:queue/${q.key}`]));
    process.env.TENANT_CONFIG = JSON.stringify(rawTenant(tenantId));
    process.env.QUEUE_ARNS = JSON.stringify(queueArns);
    resetTenantConfigCache();

    const flow = JSON.parse(
      renderFlow(template, {
        ...Object.fromEntries(placeholders(template).map((k) => [k, k])),
        DEFAULT_QUEUE_ARN: queueArns[tenant.defaultQueue]!,
        GAS_EMERGENCY_NUMBER: tenant.routing.gasEmergencyNumber,
      }),
    ) as Flow;

    const events: EngineEvent[] = [];
    const lines = [...s.lines];
    await new CallSimulator({
      tenant,
      flow,
      ani: ANIS[s.caller]!,
      now: CLOCKS[s.clock]!,
      queueNames: Object.fromEntries(tenant.queues.map((q) => [queueArns[q.key]!, q.name])),
      emit: (e) => events.push(e),
      listen: async () => lines.shift() ?? '',
    }).run();

    const end = events.find((e) => e.kind === 'end') as Extract<EngineEvent, { kind: 'end' }>;
    expect(end.outcome).toBe(s.expect.outcome);
    if (s.expect.detail) expect(end.detail).toBe(s.expect.detail);
    if (s.expect.says) {
      expect(events.flatMap((e) => (e.kind === 'say' ? [e.text] : []))).toContain(s.expect.says);
    }
    expect(lines, 'scenario has unused lines').toEqual([]);
  });
});
