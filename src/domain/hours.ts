import type { TenantConfig } from './tenant-config';

type Window = { open: string; close: string } | null;

/**
 * Same answer Connect's CheckHoursOfOperation block gives, for use outside a
 * flow (voice agent, demo, callback scheduling).
 */
export function isOpen(cfg: TenantConfig, at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.hours.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = get('weekday');
  const time = `${get('hour')}:${get('minute')}`;

  const window: Window =
    day === 'Sat' ? cfg.hours.saturday : day === 'Sun' ? cfg.hours.sunday : cfg.hours.weekdays;
  return window !== null && time >= window.open && time < window.close;
}
