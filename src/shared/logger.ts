// One JSON object per line (Datadog facets). PII is masked before it leaves the process.

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEYS = new Set([
  'accountnumber',
  'customerphone',
  'phonenumber',
  'ani',
  'postcode',
  'dateofbirth',
  'dob',
  'email',
  'meterreading',
  'transcript',
  'inputtranscript',
]);

// E.164 numbers, UK postcodes and long digit runs (account / card numbers).
const PATTERNS: Array<[RegExp, string]> = [
  [/\+\d{8,15}/g, '[phone]'],
  [/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, '[postcode]'],
  [/\b\d{8,19}\b/g, '[number]'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') {
    return PATTERNS.reduce((acc, [re, label]) => acc.replace(re, label), value);
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  base: Record<string, unknown> = {},
  sink: (line: string) => void = (line) => process.stdout.write(line + '\n'),
): Logger {
  const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

  const write = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < threshold) return;
    const err = fields?.err instanceof Error ? fields.err : undefined;
    const entry = {
      level,
      msg,
      timestamp: new Date().toISOString(),
      service: process.env.DD_SERVICE,
      env: process.env.DD_ENV,
      ...(redact(base) as object),
      ...(redact({ ...fields, err: undefined }) as object),
      ...(err ? { error: { kind: err.name, message: err.message, stack: err.stack } } : {}),
    };
    sink(JSON.stringify(entry));
  };

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}
