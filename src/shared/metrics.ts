// datadog-lambda-js comes from the Datadog layer (external in the bundle).
// Without it - locally, in tests, in the demo - metrics go to stdout.

type Sender = (name: string, value: number, ...tags: string[]) => void;

let sender: Sender | undefined;

function resolveSender(): Sender {
  if (sender) return sender;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dd = require('datadog-lambda-js') as { sendDistributionMetric: Sender };
    sender = dd.sendDistributionMetric;
  } catch {
    sender = (name, value, ...tags) =>
      process.stdout.write(JSON.stringify({ metric: name, value, tags }) + '\n');
  }
  return sender;
}

export type Tags = Record<string, string | number | boolean | undefined>;

export function toTagList(tags: Tags): string[] {
  return Object.entries(tags)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(
      ([k, v]) =>
        `${k}:${String(v)
          .toLowerCase()
          .replace(/[^a-z0-9_.:/-]/g, '_')}`,
    );
}

export function distribution(name: string, value: number, tags: Tags = {}): void {
  resolveSender()(`connect_voice.${name}`, value, ...toTagList(tags));
}

export function count(name: string, tags: Tags = {}): void {
  distribution(name, 1, tags);
}

/** Test hook. */
export function setMetricSender(fn: Sender | undefined): void {
  sender = fn;
}
