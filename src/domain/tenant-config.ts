import { z } from 'zod';

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be E.164, e.g. +441134960000');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24h)');

const window = z.object({ open: hhmm, close: hhmm }).refine((w) => w.open < w.close, {
  message: 'open must be before close',
});

export const QueueSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  name: z.string().min(1).max(127),
  description: z.string().max(250).optional(),
  maxContacts: z.number().int().positive().max(1000).optional(),
  /** Target answer time, used by the Datadog SLO, not by Connect itself. */
  serviceLevelSeconds: z.number().int().positive().default(60),
});

export const TenantConfigSchema = z
  .object({
    tenantId: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
    displayName: z.string().min(1),
    /** Connect instance alias; globally unique within the account+region. */
    instanceAlias: z.string().regex(/^[a-z][a-z0-9-]{2,60}[a-z0-9]$/),
    region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
    locale: z.enum(['en_GB', 'en_US']),
    voice: z.object({
      id: z.string().min(1),
      engine: z.enum(['neural', 'generative']),
    }),
    dialledNumbers: z.record(e164, z.object({ entryPoint: z.enum(['residential', 'business']) })),
    hours: z.object({
      timezone: z.string().min(1),
      weekdays: window,
      saturday: window.nullable(),
      sunday: window.nullable(),
    }),
    queues: z.array(QueueSchema).min(1),
    defaultQueue: z.string(),
    routing: z.object({
      /** External number callers are transferred to for a reported gas leak. */
      gasEmergencyNumber: e164,
      /** Priority bump for Priority Services Register customers (lower = sooner). */
      psrPriority: z.number().int().min(1).max(5).default(2),
      intentQueues: z.record(z.string(), z.string()),
    }),
    features: z.object({
      novaSonic: z.boolean().default(false),
      callRecording: z.boolean().default(true),
    }),
    retention: z.object({
      ctrDays: z.number().int().min(1).max(3650),
      recordingDays: z.number().int().min(1).max(3650),
    }),
  })
  .superRefine((cfg, ctx) => {
    const keys = new Set(cfg.queues.map((q) => q.key));
    if (keys.size !== cfg.queues.length) {
      ctx.addIssue({ code: 'custom', path: ['queues'], message: 'queue keys must be unique' });
    }
    if (!keys.has(cfg.defaultQueue)) {
      ctx.addIssue({ code: 'custom', path: ['defaultQueue'], message: 'unknown queue key' });
    }
    for (const [intent, queue] of Object.entries(cfg.routing.intentQueues)) {
      if (!keys.has(queue)) {
        ctx.addIssue({
          code: 'custom',
          path: ['routing', 'intentQueues', intent],
          message: `unknown queue key "${queue}"`,
        });
      }
    }
  });

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
export type QueueConfig = z.infer<typeof QueueSchema>;

export function parseTenantConfig(raw: unknown, source = 'tenant config'): TenantConfig {
  const result = TenantConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid ${source}:\n${issues}`);
  }
  return result.data;
}
