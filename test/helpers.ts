import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from 'aws-lambda';
import { InMemoryAccountRepository } from '../src/domain/accounts';
import { parseTenantConfig, type TenantConfig } from '../src/domain/tenant-config';

export function loadTenant(id = 'brightwell-energy'): TenantConfig {
  return parseTenantConfig(
    JSON.parse(readFileSync(join(__dirname, '..', 'config', 'tenants', `${id}.json`), 'utf8')),
  );
}

export function rawTenant(id = 'brightwell-energy'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, '..', 'config', 'tenants', `${id}.json`), 'utf8'));
}

export function lambdaContext(remainingMs = 3000): Context {
  return { getRemainingTimeInMillis: () => remainingMs } as unknown as Context;
}

export function fixtureRepo() {
  return new InMemoryAccountRepository(
    [
      {
        accountId: 'A100',
        phone: '+447700900123',
        firstName: 'Arben',
        balancePence: 4250,
        priorityServicesRegister: false,
        meters: ['electricity', 'gas'],
      },
      {
        accountId: 'A200',
        phone: '+447700900456',
        firstName: 'Lena',
        balancePence: -1200,
        priorityServicesRegister: true,
        meters: ['electricity'],
      },
    ],
    [
      {
        accountId: 'A100',
        meterType: 'electricity',
        value: 12000,
        readAt: '2026-09-01T10:00:00.000Z',
        source: 'smart',
      },
    ],
  );
}
