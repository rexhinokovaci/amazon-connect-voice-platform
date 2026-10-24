import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintFlow, placeholders, renderFlow, type Flow } from '../src/flows/flow';

const dir = join(__dirname, '..', 'contact-flows');
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const template = readFileSync(join(dir, file), 'utf8');
  // Dummy values: we're checking structure, not the environment.
  const values = Object.fromEntries(
    placeholders(template).map((k) => [k, `test-${k.toLowerCase()}`]),
  );
  let flow: Flow;
  try {
    flow = JSON.parse(renderFlow(template, values)) as Flow;
  } catch (err) {
    console.error(`✗ ${file}: ${(err as Error).message}`);
    failed = true;
    continue;
  }
  const issues = lintFlow(flow);
  if (issues.length === 0) {
    console.log(`✓ ${file} (${flow.Actions.length} blocks)`);
    continue;
  }
  failed = true;
  console.error(`✗ ${file}`);
  for (const i of issues) console.error(`    [${i.rule}] ${i.action ?? ''} ${i.message}`);
}

process.exit(failed ? 1 : 0);
