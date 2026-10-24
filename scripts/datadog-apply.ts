/**
 * Upserts monitors, SLOs and the dashboard in observability/datadog.
 * Matches existing objects by name, so it's safe to re-run.
 *
 *   DD_API_KEY=... DD_APP_KEY=... DD_SITE=datadoghq.eu npx tsx scripts/datadog-apply.ts [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const site = process.env.DD_SITE ?? 'datadoghq.eu';
const dryRun = process.argv.includes('--dry-run');
const dir = join(__dirname, '..', 'observability', 'datadog');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  if (!apiKey || !appKey) throw new Error('DD_API_KEY and DD_APP_KEY are required');
  const res = await fetch(`https://api.${site}${path}`, {
    method,
    headers: {
      'DD-API-KEY': apiKey,
      'DD-APPLICATION-KEY': appKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

type Named = { name?: string; title?: string; id?: number | string };

async function upsert(
  kind: string,
  list: Named[],
  items: Named[],
  create: string,
  update: (id: string) => string,
) {
  for (const item of items) {
    const label = item.name ?? item.title!;
    const existing = list.find((x) => (x.name ?? x.title) === label);
    if (dryRun) {
      console.log(`[dry-run] ${existing ? 'update' : 'create'} ${kind}: ${label}`);
      continue;
    }
    if (existing) await api('PUT', update(String(existing.id)), item);
    else await api('POST', create, item);
    console.log(`${existing ? 'updated' : 'created'} ${kind}: ${label}`);
  }
}

async function main() {
  const monitors = load<Named[]>('monitors.json');
  const slos = load<Named[]>('slos.json');
  const dashboard = load<Named>('dashboard.json');

  if (dryRun) {
    await upsert('monitor', [], monitors, '', () => '');
    await upsert('slo', [], slos, '', () => '');
    await upsert('dashboard', [], [dashboard], '', () => '');
    return;
  }

  const existingMonitors = await api<Named[]>('GET', '/api/v1/monitor?tags=service:connect-voice');
  await upsert(
    'monitor',
    existingMonitors,
    monitors,
    '/api/v1/monitor',
    (id) => `/api/v1/monitor/${id}`,
  );

  const existingSlos = await api<{ data: Named[] }>(
    'GET',
    '/api/v1/slo?tags_query=service:connect-voice',
  );
  await upsert('slo', existingSlos.data, slos, '/api/v1/slo', (id) => `/api/v1/slo/${id}`);

  const dashboards = await api<{ dashboards: Named[] }>('GET', '/api/v1/dashboard');
  await upsert(
    'dashboard',
    dashboards.dashboards,
    [dashboard],
    '/api/v1/dashboard',
    (id) => `/api/v1/dashboard/${id}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
