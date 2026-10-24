import type { ConnectContactFlowEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRepository } from '../../src/domain/accounts';
import { handler, setRepository } from '../../src/lambdas/connect-router/handler';
import { setMetricSender } from '../../src/shared/metrics';
import { resetTenantConfigCache } from '../../src/shared/tenant';
import { fixtureRepo, lambdaContext, rawTenant } from '../helpers';

function event(ani: string, params: Record<string, string>): ConnectContactFlowEvent {
  return {
    Name: 'ContactFlowEvent',
    Details: {
      ContactData: {
        ContactId: 'contact-1',
        Channel: 'VOICE',
        InitiationMethod: 'INBOUND',
        CustomerEndpoint: { Type: 'TELEPHONE_NUMBER', Address: ani },
        SystemEndpoint: { Type: 'TELEPHONE_NUMBER', Address: '+441134960000' },
        Attributes: {},
      },
      Parameters: params,
    },
  } as unknown as ConnectContactFlowEvent;
}

beforeEach(() => {
  process.env.TENANT_CONFIG = JSON.stringify(rawTenant());
  process.env.QUEUE_ARNS = JSON.stringify({
    billing: 'arn:queue/billing',
    'meter-readings': 'arn:queue/meter',
    'home-moves': 'arn:queue/moves',
    general: 'arn:queue/general',
  });
  resetTenantConfigCache();
  setRepository(fixtureRepo());
  setMetricSender(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('connect-router', () => {
  it('identifies a known caller', async () => {
    const res = await handler(event('+447700900456', { operation: 'identify' }), lambdaContext());
    expect(res).toEqual({ identified: 'true', accountId: 'A200', firstName: 'Lena', psr: 'true' });
  });

  it('returns string values only (Connect requirement)', async () => {
    const res = await handler(
      event('+447700900123', { operation: 'route', intent: 'CheckBalance' }),
      lambdaContext(),
    );
    for (const v of Object.values(res)) expect(typeof v).toBe('string');
    expect(res).toMatchObject({ action: 'queue', queueArn: 'arn:queue/billing', priority: '5' });
  });

  it('treats withheld numbers as unidentified', async () => {
    const res = await handler(event('anonymous', { operation: 'identify' }), lambdaContext());
    expect(res.identified).toBe('false');
  });

  it('still routes when the account lookup times out', async () => {
    const slow: AccountRepository = Object.assign(fixtureRepo(), {
      findByPhone: () => new Promise<undefined>(() => {}),
    });
    setRepository(slow);
    const res = await handler(
      event('+447700900456', { operation: 'route', intent: 'CheckBalance' }),
      lambdaContext(700), // 700 - 500 headroom = 200ms budget
    );
    expect(res).toMatchObject({ action: 'queue', queueKey: 'billing', priority: '5' });
  });

  it('falls back to the default queue on unexpected failure', async () => {
    process.env.QUEUE_ARNS = JSON.stringify({ general: 'arn:queue/general' });
    const res = await handler(
      event('+447700900123', { operation: 'route', intent: 'CheckBalance' }),
      lambdaContext(),
    );
    expect(res).toMatchObject({ queueArn: 'arn:queue/general', reason: 'router_error' });
  });
});
