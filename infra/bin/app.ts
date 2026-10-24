import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { parseTenantConfig } from '../../src/domain/tenant-config';
import { TenantVoiceStack } from '../lib/tenant-voice-stack';

const app = new App();
const stage = (app.node.tryGetContext('stage') ?? 'dev') as 'dev' | 'staging' | 'prod';
const only = app.node.tryGetContext('tenant') as string | undefined;
const version = (app.node.tryGetContext('version') as string | undefined) ?? 'local';
const datadogApiKeySecretArn = app.node.tryGetContext('datadogApiKeySecretArn') as
  string | undefined;

if (!['dev', 'staging', 'prod'].includes(stage)) {
  throw new Error(`unknown stage "${stage}"`);
}

const dir = join(__dirname, '..', '..', 'config', 'tenants');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const tenant = parseTenantConfig(JSON.parse(readFileSync(join(dir, file), 'utf8')), file);
  if (only && tenant.tenantId !== only) continue;

  new TenantVoiceStack(app, `${tenant.tenantId}-${stage}`, {
    tenant,
    stage,
    version,
    datadogApiKeySecretArn,
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: tenant.region },
    description: `Amazon Connect voice estate for ${tenant.displayName} (${stage})`,
    terminationProtection: stage === 'prod',
  });
}
