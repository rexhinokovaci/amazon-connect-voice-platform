// Every example here is exercised by test/unit/demo-scenarios.test.ts, so the
// demo can't advertise something that doesn't actually work.

export interface Example {
  text: string;
  intent: string;
}

export const OPENERS: Example[] = [
  { text: "What's my balance?", intent: 'CheckBalance' },
  { text: 'Am I in credit?', intent: 'CheckBalance' },
  { text: 'How much do I owe you', intent: 'CheckBalance' },
  { text: 'Meter reading', intent: 'SubmitMeterReading' },
  { text: 'I want to submit my gas reading', intent: 'SubmitMeterReading' },
  { text: 'I can smell gas', intent: 'ReportGasEmergency' },
  { text: 'Carbon monoxide alarm is going off', intent: 'ReportGasEmergency' },
  { text: 'My power has gone off', intent: 'ReportPowerCut' },
  { text: "I can't afford my bill", intent: 'PaymentDifficulty' },
  { text: 'I want to make a complaint', intent: 'MakeComplaint' },
  { text: "My smart meter isn't working", intent: 'SmartMeterQuery' },
  { text: "I'm moving house", intent: 'MovingHome' },
  { text: 'Talk to a person', intent: 'SpeakToAgent' },
  { text: 'Real person please', intent: 'SpeakToAgent' },
  { text: "Erm, it's about the thing", intent: 'FallbackIntent' },
];

export const METER_ANSWERS = ['Electricity', 'Gas', 'The electric one'];
export const READING_ANSWERS = [
  '1 2 3 4 5',
  '1 1 0 0 0',
  'one two oh four five',
  '9 9 9 9 9',
  'not sure',
];

export interface Scenario {
  id: string;
  title: string;
  description: string;
  tenant: number;
  caller: number;
  clock: number;
  lines: string[];
  expect: { outcome: string; detail?: string; says?: string };
}

// caller: 0 Arben (known), 1 Lena (PSR), 2 unknown number, 3 withheld
// clock: 0 now, 1 weekday 10:00, 2 weekday 21:30, 3 Sunday 12:00
export const SCENARIOS: Scenario[] = [
  {
    id: 'balance',
    title: 'Balance check',
    description:
      'Known caller is identified by number and served by the Lex code hook. No agent needed.',
    tenant: 0,
    caller: 0,
    clock: 1,
    lines: ["What's my balance?"],
    expect: { outcome: 'Call ended in self-service', says: 'Your current balance is £42.50.' },
  },
  {
    id: 'credit',
    title: 'In credit',
    description: 'Negative balance is read back as credit, not as money owed.',
    tenant: 0,
    caller: 1,
    clock: 1,
    lines: ['Am I in credit?'],
    expect: { outcome: 'Call ended in self-service', says: "You're in credit by £12.00." },
  },
  {
    id: 'reading-ok',
    title: 'Meter reading',
    description: 'Slot elicitation, validation against the last reading, write to the database.',
    tenant: 0,
    caller: 0,
    clock: 1,
    lines: ['Meter reading', 'Electricity', '1 2 3 4 5'],
    expect: {
      outcome: 'Call ended in self-service',
      says: "Thanks. I've submitted your electricity reading of 1 2 3 4 5.",
    },
  },
  {
    id: 'reading-spoken',
    title: 'Spoken digits',
    description: '"One two oh four five" is normalised to 12045 before validation.',
    tenant: 0,
    caller: 0,
    clock: 1,
    lines: ['I want to submit my gas reading', 'one two oh four five'],
    expect: {
      outcome: 'Call ended in self-service',
      says: "Thanks. I've submitted your gas reading of 1 2 0 4 5.",
    },
  },
  {
    id: 'reading-bad',
    title: 'Rejected reading',
    description:
      'Reading lower than last time, twice. The bot gives up and hands off with a reason.',
    tenant: 0,
    caller: 0,
    clock: 1,
    lines: ['Meter reading', 'Electricity', '1 1 0 0 0', '1 1 0 0 0'],
    expect: { outcome: 'Queued for an agent', detail: 'Meter Readings · priority 5' },
  },
  {
    id: 'reading-jump',
    title: 'Implausible jump',
    description: 'A reading far above normal usage is challenged, then accepted when corrected.',
    tenant: 0,
    caller: 0,
    clock: 1,
    lines: ['Meter reading', 'Electricity', '9 9 9 9 9', '1 2 3 4 5'],
    expect: {
      outcome: 'Call ended in self-service',
      says: "Thanks. I've submitted your electricity reading of 1 2 3 4 5.",
    },
  },
  {
    id: 'psr-agent',
    title: 'Priority customer',
    description: 'Lena is on the Priority Services Register, so she jumps the queue.',
    tenant: 0,
    caller: 1,
    clock: 1,
    lines: ['Talk to a person'],
    expect: { outcome: 'Queued for an agent', detail: 'General Enquiries · priority 2' },
  },
  {
    id: 'gas',
    title: 'Gas emergency',
    description: 'Safety message then external transfer. This path never touches a Lambda.',
    tenant: 0,
    caller: 2,
    clock: 1,
    lines: ['I can smell gas'],
    expect: { outcome: 'Transferred externally', detail: '+44800111999' },
  },
  {
    id: 'co-alarm',
    title: 'CO alarm',
    description: 'A different phrasing still hits the emergency intent.',
    tenant: 0,
    caller: 0,
    clock: 3,
    lines: ['Carbon monoxide alarm is going off'],
    expect: { outcome: 'Transferred externally', detail: '+44800111999' },
  },
  {
    id: 'unknown-balance',
    title: 'Unknown caller',
    description:
      "Number isn't on an account, so the bot hands off to billing rather than guessing.",
    tenant: 0,
    caller: 2,
    clock: 1,
    lines: ['How much do I owe you'],
    expect: { outcome: 'Queued for an agent', detail: 'Billing · priority 5' },
  },
  {
    id: 'payment',
    title: 'Payment difficulty',
    description:
      'Treated as potentially vulnerable: billing queue at priority 2, even for unknown callers.',
    tenant: 0,
    caller: 3,
    clock: 1,
    lines: ["I can't afford my bill"],
    expect: { outcome: 'Queued for an agent', detail: 'Billing · priority 2' },
  },
  {
    id: 'moving',
    title: 'Moving home',
    description: 'Withheld number, routing-only intent.',
    tenant: 0,
    caller: 3,
    clock: 1,
    lines: ["I'm moving house"],
    expect: { outcome: 'Queued for an agent', detail: 'Home Moves · priority 5' },
  },
  {
    id: 'smart',
    title: 'Smart meter',
    description: 'Routed to the meter team.',
    tenant: 0,
    caller: 0,
    clock: 1,
    lines: ["My smart meter isn't working"],
    expect: { outcome: 'Queued for an agent', detail: 'Meter Readings · priority 5' },
  },
  {
    id: 'fallback',
    title: 'Not understood',
    description: 'Low NLU confidence falls through to the default queue, never a dead end.',
    tenant: 0,
    caller: 0,
    clock: 1,
    lines: ["Erm, it's about the thing"],
    expect: { outcome: 'Queued for an agent', detail: 'General Enquiries · priority 5' },
  },
  {
    id: 'sunday',
    title: 'Out of hours',
    description:
      'Closed message plays, emergency route stays available, then the call still reaches a queue.',
    tenant: 0,
    caller: 0,
    clock: 3,
    lines: ['Talk to a person'],
    expect: { outcome: 'Queued for an agent', detail: 'General Enquiries · priority 5' },
  },
  {
    id: 'drita-outage',
    title: 'Drita: power cut',
    description: 'Albanian tenant, Tirana hours. Outages go to "Defekte dhe ndërprerje".',
    tenant: 1,
    caller: 2,
    clock: 1,
    lines: ['My power has gone off'],
    expect: { outcome: 'Queued for an agent', detail: 'Defekte dhe ndërprerje · priority 5' },
  },
  {
    id: 'drita-complaint',
    title: 'Drita: complaint',
    description: 'Same flow, different tenant config. Complaints land in "Informacion".',
    tenant: 1,
    caller: 3,
    clock: 1,
    lines: ['I want to make a complaint'],
    expect: { outcome: 'Queued for an agent', detail: 'Informacion · priority 5' },
  },
];
