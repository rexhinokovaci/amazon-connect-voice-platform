import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, '..', 'site', 'demo');
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { app: join(here, 'src', 'main.ts'), admin: join(here, 'src', 'admin.ts') },
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  target: ['es2022'],
  platform: 'browser',
  outdir: out,
  // Datadog lib only exists in the Lambda layer; metrics fall back to stdout.
  external: ['datadog-lambda-js'],
  plugins: [
    {
      name: 'stub-dynamo',
      setup(b) {
        b.onResolve({ filter: /dynamo-account-repository$/ }, () => ({
          path: join(here, 'src', 'stub-dynamo.ts'),
        }));
      },
    },
  ],
  logLevel: 'info',
});

cpSync(join(here, 'index.html'), join(out, 'index.html'));
cpSync(join(here, 'admin.html'), join(out, 'admin.html'));
cpSync(join(here, 'styles.css'), join(out, 'styles.css'));
