import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallSimulator, type EngineEvent } from '../../demo/src/engine';
import { placeholders, renderFlow, type Flow } from '../../src/flows/flow';
import { setRepository as setRouterRepo } from '../../src/lambdas/connect-router/handler';
import { setRepository as setLexRepo } from '../../src/lambdas/lex-fulfillment/handler';
import { setMetricSender } from '../../src/shared/metrics';
import { resetTenantConfigCache } from '../../src/shared/tenant';
import { fixtureRepo, loadTenant, rawTenant } from '../helpers';

// The browser demo drives the real flow JSON and handlers. These tests keep
// it honest: if the flow or handlers change shape, the demo breaks here first.

const tenant = loadTenant();
const template = readFileSync(
  join(__dirname, '..', '..', 'contact-flows', 'main-ivr.json'),
  'utf8',
);
const queueArns = Object.fromEntries(tenant.queues.map((q) => [q.key, `arn:queue/${q.key}`]));
const flow = JSON.parse(
  renderFlow(template, {
    ...Object.fromEntries(placeholders(template).map((k) => [k, k])),
    DEFAULT_QUEUE_ARN: queueArns.general!,
    GAS_EMERGENCY_NUMBER: tenant.routing.gasEmergencyNumber,
  }),
) as Flow;
const weekdayMorning = new Date('2026-10-21T09:00:00Z');

async function call(ani: string, said: string[], now = weekdayMorning) {
  const events: EngineEvent[] = [];
  const queue = [...said];
  await new CallSimulator({
    tenant,
    flow,
    ani,
    now,
    queueNames: Object.fromEntries(tenant.queues.map((q) => [queueArns[q.key]!, q.name])),
    emit: (e) => events.push(e),
    listen: async () => queue.shift() ?? '',
  }).run();
  const end = events.find((e) => e.kind === 'end') as Extract<EngineEvent, { kind: 'end' }>;
  const path = events.flatMap((e) => (e.kind === 'block' ? [e.action.Identifier] : []));
  const said_ = events.flatMap((e) => (e.kind === 'say' ? [e.text] : []));
  return { end, path, said: said_ };
}

beforeEach(() => {
  process.env.TENANT_CONFIG = JSON.stringify(rawTenant());
  process.env.QUEUE_ARNS = JSON.stringify(queueArns);
  resetTenantConfigCache();
  const repo = fixtureRepo();
  setRouterRepo(repo);
  setLexRepo(repo);
  setMetricSender(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('demo call simulator', () => {
  it('contains a balance enquiry in self-service', async () => {
    const r = await call('+447700900123', ["what's my balance"]);
    expect(r.said).toContain('Your current balance is £42.50.');
    expect(r.end.outcome).toBe('Call ended in self-service');
  });

  it('takes a meter reading end to end', async () => {
    const r = await call('+447700900123', ['meter reading', 'electricity', '1 2 3 4 5']);
    expect(r.said).toContain("Thanks. I've submitted your electricity reading of 1 2 3 4 5.");
    expect(r.end.outcome).toBe('Call ended in self-service');
  });

  it('hands off to the meter readings queue after two bad readings', async () => {
    const r = await call('+447700900123', [
      'submit a reading',
      'electricity',
      '1 1 0 0 0',
      '1 1 0 0 0',
    ]);
    expect(r.path).toContain('route');
    expect(r.end.detail).toBe('Meter Readings · priority 5');
  });

  it('bumps PSR customers asking for an agent', async () => {
    const r = await call('+447700900456', ['talk to a person']);
    expect(r.end.detail).toBe('General Enquiries · priority 2');
  });

  it('transfers gas emergencies without invoking the router', async () => {
    const r = await call('+447700900999', ['I can smell gas']);
    expect(r.end).toMatchObject({ outcome: 'Transferred externally', detail: '+44800111999' });
    expect(r.path.slice(r.path.indexOf('bot'))).not.toContain('route');
  });

  it('plays the closed message out of hours but still runs the bot', async () => {
    const r = await call('anonymous', ['agent'], new Date('2026-10-25T12:00:00Z'));
    expect(r.path).toContain('closed-menu');
    expect(r.end.outcome).toBe('Queued for an agent');
  });

  it('routes unrecognised speech to the default queue', async () => {
    const r = await call('+447700900123', ['blah blah']);
    expect(r.end.detail).toBe('General Enquiries · priority 5');
  });
});
