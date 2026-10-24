import { parseTenantConfig, type TenantConfig } from '../domain/tenant-config';

let cached: TenantConfig | undefined;

/**
 * Tenant config is injected at deploy time as an environment variable, so a
 * Lambda can only ever see its own tenant. Parsed once per execution
 * environment; a bad value fails the cold start loudly rather than routing
 * calls with defaults.
 */
export function tenantConfig(): TenantConfig {
  if (cached) return cached;
  const raw = process.env.TENANT_CONFIG;
  if (!raw) throw new Error('TENANT_CONFIG is not set');
  cached = parseTenantConfig(JSON.parse(raw), 'TENANT_CONFIG');
  return cached;
}

export function resetTenantConfigCache(): void {
  cached = undefined;
}
