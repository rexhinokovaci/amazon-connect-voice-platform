// The Lambda code writes logs/metrics to process.stdout. In the browser we
// route those lines to the inspector panel instead.
type Sink = (line: string) => void;
const sinks: Sink[] = [];

export function onStdout(fn: Sink): void {
  sinks.push(fn);
}

const g = globalThis as unknown as { process?: unknown };
g.process = {
  env: {} as Record<string, string | undefined>,
  stdout: {
    write: (line: string) => {
      sinks.forEach((s) => s(line.trimEnd()));
      return true;
    },
  },
};
