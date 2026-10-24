export type MeterType = 'electricity' | 'gas';

export interface Account {
  accountId: string;
  /** Spoken back to callers, so first name only. */
  firstName: string;
  balancePence: number;
  /** Priority Services Register: vulnerable customers get routed ahead of the queue. */
  priorityServicesRegister: boolean;
  meters: MeterType[];
}

export interface MeterReading {
  accountId: string;
  meterType: MeterType;
  value: number;
  readAt: string;
  source: 'ivr' | 'voice-agent' | 'agent' | 'smart';
}

export interface AccountRepository {
  findByPhone(phoneE164: string, signal?: AbortSignal): Promise<Account | undefined>;
  findById(accountId: string, signal?: AbortSignal): Promise<Account | undefined>;
  lastReading(
    accountId: string,
    meterType: MeterType,
    signal?: AbortSignal,
  ): Promise<MeterReading | undefined>;
  saveReading(reading: MeterReading, signal?: AbortSignal): Promise<void>;
}

/** Used by tests and the local voice-agent demo. */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly readings: MeterReading[] = [];

  constructor(
    private readonly accounts: Array<Account & { phone: string }>,
    seedReadings: MeterReading[] = [],
  ) {
    this.readings.push(...seedReadings);
  }

  async findByPhone(phone: string) {
    return this.accounts.find((a) => a.phone === phone);
  }

  async findById(id: string) {
    return this.accounts.find((a) => a.accountId === id);
  }

  async lastReading(accountId: string, meterType: MeterType) {
    return this.readings
      .filter((r) => r.accountId === accountId && r.meterType === meterType)
      .sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
  }

  async saveReading(reading: MeterReading) {
    this.readings.push(reading);
  }
}

export function formatBalance(pence: number): string {
  const pounds = Math.abs(pence) / 100;
  const amount = pounds.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
  if (pence === 0) return 'Your account is fully up to date.';
  return pence < 0 ? `You're in credit by ${amount}.` : `Your current balance is ${amount}.`;
}
