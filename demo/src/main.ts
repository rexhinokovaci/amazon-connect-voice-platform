import { onStdout } from './shims';
import energy from '../../config/tenants/brightwell-energy.json';
import drita from '../../config/tenants/drita-energji.json';
import flowTemplate from '../../contact-flows/main-ivr.json';
import { InMemoryAccountRepository } from '../../src/domain/accounts';
import { parseTenantConfig, type TenantConfig } from '../../src/domain/tenant-config';
import { lintFlow, placeholders, renderFlow, type Flow } from '../../src/flows/flow';
import { setRepository as setRouterRepo } from '../../src/lambdas/connect-router/handler';
import { setRepository as setLexRepo } from '../../src/lambdas/lex-fulfillment/handler';
import { resetTenantConfigCache } from '../../src/shared/tenant';
import { CallSimulator, type EngineEvent } from './engine';
import { METER_ANSWERS, OPENERS, READING_ANSWERS, SCENARIOS } from './scenarios';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tenants: TenantConfig[] = [parseTenantConfig(energy), parseTenantConfig(drita)];
const env = (globalThis as unknown as { process: { env: Record<string, string> } }).process.env;

const callers = [
  {
    name: 'Arben',
    initials: 'AR',
    note: 'Known customer · gas + electricity',
    ani: '+447700900123',
    psr: false,
  },
  {
    name: 'Lena',
    initials: 'LE',
    note: 'Priority Services Register',
    ani: '+447700900456',
    psr: true,
  },
  {
    name: 'Unknown',
    initials: '??',
    note: 'Number not on any account',
    ani: '+447700900999',
    psr: false,
  },
  { name: 'Withheld', initials: '—', note: 'Caller ID hidden', ani: 'anonymous', psr: false },
];

function at(dayOffset: number, hh: number, mm: number): () => Date {
  return () => {
    const d = new Date();
    // Wednesday this week as an anchor, then offset.
    d.setDate(d.getDate() - ((d.getDay() + 4) % 7) + dayOffset);
    d.setHours(hh, mm, 0, 0);
    return d;
  };
}
const clocks: Array<{ label: string; now: () => Date }> = [
  { label: 'Now', now: () => new Date() },
  { label: 'Weekday 10:00', now: at(0, 10, 0) },
  { label: 'Weekday 21:30', now: at(0, 21, 30) },
  { label: 'Sunday 12:00', now: at(4, 12, 0) },
];

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function options(id: string, labels: string[]) {
  $<HTMLSelectElement>(id).innerHTML = labels
    .map((l, i) => `<option value="${i}">${escapeHtml(l)}</option>`)
    .join('');
}
const picked = (id: string) => Number($<HTMLSelectElement>(id).value || 0);

options(
  'caller',
  callers.map((c) => `${c.name} · ${c.note}`),
);
options(
  'tenant',
  tenants.map((t) => t.displayName),
);
options(
  'clock',
  clocks.map((c) => c.label),
);

function repo() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return new InMemoryAccountRepository(
    [
      {
        accountId: 'A100',
        phone: '+447700900123',
        firstName: 'Arben',
        balancePence: 4250,
        priorityServicesRegister: false,
        meters: ['electricity', 'gas'],
      },
      {
        accountId: 'A200',
        phone: '+447700900456',
        firstName: 'Lena',
        balancePence: -1200,
        priorityServicesRegister: true,
        meters: ['electricity'],
      },
    ],
    [
      {
        accountId: 'A100',
        meterType: 'electricity',
        value: 12000,
        readAt: thirtyDaysAgo,
        source: 'smart',
      },
    ],
  );
}

function fakeArn(tenant: TenantConfig, kind: string, id: string) {
  return `arn:aws:connect:${tenant.region}:111111111111:instance/${tenant.tenantId}/${kind}/${id}`;
}

function renderFor(tenant: TenantConfig): { flow: Flow; queueArns: Record<string, string> } {
  const queueArns = Object.fromEntries(
    tenant.queues.map((q) => [q.key, fakeArn(tenant, 'queue', q.key)]),
  );
  const template = JSON.stringify(flowTemplate, null, 2);
  const values: Record<string, string> = {
    DISPLAY_NAME: tenant.displayName,
    VOICE_ID: tenant.voice.id,
    VOICE_ENGINE: tenant.voice.engine,
    HOURS_ARN: fakeArn(tenant, 'operating-hours', 'main'),
    ROUTER_LAMBDA_ARN: `arn:aws:lambda:${tenant.region}:111111111111:function:router`,
    LEX_ALIAS_ARN: `arn:aws:lex:${tenant.region}:111111111111:bot-alias/DEMO/live`,
    DEFAULT_QUEUE_ARN: queueArns[tenant.defaultQueue]!,
    GAS_EMERGENCY_NUMBER: tenant.routing.gasEmergencyNumber,
  };
  const missing = placeholders(template).filter((k) => !(k in values));
  if (missing.length) throw new Error(`demo missing values: ${missing.join(', ')}`);
  return { flow: JSON.parse(renderFlow(template, values)) as Flow, queueArns };
}

// ---- rendering -------------------------------------------------------------

const transcript = $<HTMLOListElement>('transcript');
const blocks = $<HTMLOListElement>('blocks');
const invocations = $('tab-invocations');
const logs = $<HTMLPreElement>('logs');
const chips = $('chips');
const input = $<HTMLInputElement>('utterance');

let sim: CallSimulator | undefined;
let pendingListen: ((s: string) => void) | undefined;
let step = 0;
let invCount = 0;
let logCount = 0;
let timer: number | undefined;
let callStarted = 0;
let lastIntent: string | undefined;
let lastOutcome: { outcome: string; detail: string } | undefined;

const INTENT_LABELS: Record<string, string> = {
  CheckBalance: 'Balance enquiry',
  SubmitMeterReading: 'Meter reading',
  ReportGasEmergency: 'Gas emergency',
  MovingHome: 'Moving home',
  SpeakToAgent: 'Asked for an agent',
  FallbackIntent: 'Not understood',
};

function toast(title: string, body: string, facts: Array<[string, string]>, tone: 'ok' | 'warn') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.setAttribute('role', 'status');
  const icon =
    tone === 'ok'
      ? '<path d="m9 16.2-3.5-3.5L4 14.1l5 5 11-11-1.4-1.4z"/>'
      : '<path d="M13 3h-2v10h2zm-1 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>';
  el.innerHTML = `<div class="toast-top"><span class="toast-badge"><svg viewBox="0 0 24 24">${icon}</svg></span><span class="toast-kicker">Call completed</span>
    <button class="toast-x" aria-label="Dismiss">×</button></div>
    <strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>
    <dl>${facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
  document.body.append(el);
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('.toast-x')!.addEventListener('click', close);
  setTimeout(close, 9000);
}

function updateCallerCard() {
  const caller = callers[picked('caller')]!;
  const avatar = $('avatar');
  avatar.textContent = caller.initials;
  avatar.className =
    'avatar' +
    (caller.psr
      ? ' psr'
      : caller.ani.startsWith('+44770090099') || caller.ani === 'anonymous'
        ? ' anon'
        : '');
}
['caller', 'tenant'].forEach((id) =>
  $(id).addEventListener('change', () => {
    updateCallerCard();
    if (!sim) drawBlocks(renderFor(tenants[picked('tenant')]!).flow);
  }),
);

const IVR_ICON =
  '<svg viewBox="0 0 28 20" aria-hidden="true"><rect x="0" y="7" width="3" height="6" rx="1.5"/><rect x="6" y="3" width="3" height="14" rx="1.5"/><rect x="12" y="0" width="3" height="20" rx="1.5"/><rect x="18" y="4" width="3" height="12" rx="1.5"/><rect x="24" y="7" width="3" height="6" rx="1.5"/></svg>';

function message(kind: 'sys' | 'me' | 'note', text: string, meta?: string) {
  transcript.querySelector('.empty')?.remove();
  transcript.querySelectorAll('.speaking').forEach((n) => n.classList.remove('speaking'));
  const li = document.createElement('li');
  li.className = `msg ${kind}` + (kind === 'sys' ? ' speaking' : '');
  const who = kind === 'me' ? escapeHtml(callers[picked('caller')]!.initials) : IVR_ICON;
  li.innerHTML = `<span class="who">${who}</span><div><div class="bubble">${escapeHtml(text)}</div>${meta ? `<span class="meta">Detected: ${escapeHtml(meta)}</span>` : ''}</div>`;
  transcript.append(li);
  transcript.scrollTop = transcript.scrollHeight;
  if (kind === 'sys')
    setTimeout(() => li.classList.remove('speaking'), Math.min(4000, 400 + text.length * 35));
}

const TYPE_LABELS: Record<string, string> = {
  UpdateFlowLoggingBehavior: 'Enable flow logs',
  UpdateContactTextToSpeechVoice: 'Set voice',
  UpdateContactRecordingBehavior: 'Set recording',
  CheckHoursOfOperation: 'Check opening hours',
  MessageParticipant: 'Play prompt',
  InvokeLambdaFunction: 'Invoke Lambda',
  UpdateContactAttributes: 'Set contact attributes',
  ConnectParticipantWithLexBot: 'Lex V2 bot',
  TransferParticipantToThirdParty: 'Transfer to external number',
  Compare: 'Check attribute',
  UpdateContactTargetQueue: 'Set working queue',
  UpdateContactRoutingBehavior: 'Set queue priority',
  TransferContactToQueue: 'Transfer to queue',
  DisconnectParticipant: 'Disconnect',
};

function drawBlocks(flow: Flow) {
  blocks.innerHTML = flow.Actions.map(
    (a, i) =>
      `<li data-id="${a.Identifier}"><span class="ic">${String(i + 1).padStart(2, '0')}</span><span class="txt"><span class="id">${a.Identifier}</span><span class="ty">${TYPE_LABELS[a.Type] ?? a.Type}</span></span><span class="n"></span></li>`,
  ).join('');
}

function markBlock(id: string) {
  blocks.querySelector('.current')?.classList.remove('current');
  const li = blocks.querySelector<HTMLLIElement>(`[data-id="${id}"]`);
  if (!li) return;
  step++;
  const n = li.querySelector('.n')!;
  n.textContent = n.textContent ? `${n.textContent}, ${step}` : `Step ${step}`;
  li.classList.add('visited', 'current');
}

function highlightJson(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2)).replace(
    /(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (m, str, colon, bool, num) =>
      str
        ? `<span class="${colon ? 'j-k' : 'j-s'}">${str}</span>${colon ?? ''}`
        : bool
          ? `<span class="j-b">${m}</span>`
          : num
            ? `<span class="j-n">${m}</span>`
            : m,
  );
}

function addInvocation(target: string, request: unknown, response: unknown, ms: number) {
  invocations.querySelector('.tray-empty')?.remove();
  const d = document.createElement('details');
  d.className = 'inv-row';
  const lex = target.startsWith('lex');
  d.innerHTML = `<summary><span class="verb ${lex ? 'lex' : ''}">${lex ? 'LEX' : 'λ'}</span><span class="name">${escapeHtml(target)}</span><span class="ms">${ms.toFixed(1)} ms</span><span class="chev"></span></summary>
    <div class="io"><div><h4>Event</h4><pre>${highlightJson(request)}</pre></div>
    <div><h4>Response</h4><pre>${highlightJson(response)}</pre></div></div>`;
  invocations.append(d);
  $('inv-count').textContent = String(++invCount);
}

onStdout((line) => {
  let cls = 'lvl-info';
  try {
    const parsed = JSON.parse(line) as { level?: string; metric?: string };
    cls = parsed.metric ? 'lvl-metric' : `lvl-${parsed.level ?? 'info'}`;
  } catch {
    /* not JSON */
  }
  logs.insertAdjacentHTML('beforeend', `<span class="${cls}">${escapeHtml(line)}</span>\n`);
  $('log-count').textContent = String(++logCount);
});

function speak(text: string) {
  if (!$<HTMLInputElement>('speak').checked || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  speechSynthesis.speak(u);
}

const SUGGESTIONS: Record<string, string[]> = {
  start: OPENERS.map((o) => o.text),
  meter: METER_ANSWERS,
  reading: READING_ANSWERS,
};

function setChips(kind: keyof typeof SUGGESTIONS | null) {
  chips.innerHTML = '';
  for (const s of kind ? SUGGESTIONS[kind]! : []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.onclick = () => submit(s);
    chips.append(b);
  }
}

function setListening(on: boolean) {
  input.disabled = !on;
  $<HTMLButtonElement>('send').disabled = !on;
  $<HTMLButtonElement>('mic').disabled = !on;
  input.placeholder = on ? 'Type what the caller says…' : 'IVR is speaking…';
  if (on) input.focus({ preventScroll: true });
}

let lastPrompt = '';
function handle(e: EngineEvent) {
  switch (e.kind) {
    case 'block':
      markBlock(e.action.Identifier);
      break;
    case 'say':
      lastPrompt = e.text;
      message('sys', e.text);
      speak(e.text);
      break;
    case 'hear':
      if (e.intent) lastIntent = e.intent;
      message(
        'me',
        e.text,
        e.intent ? `${e.intent} ${(e.confidence! * 100).toFixed(0)}%` : undefined,
      );
      break;
    case 'invoke':
      addInvocation(e.target, e.request, e.response, e.ms);
      break;
    case 'end': {
      lastOutcome = { outcome: e.outcome, detail: e.detail };
      const o = $('outcome');
      o.hidden = false;
      o.className = 'outcome' + (e.outcome.startsWith('Transferred') ? ' external' : '');
      $('outcome-title').textContent = e.outcome;
      $('outcome-detail').textContent = e.detail;
      break;
    }
  }
}

function listen(): Promise<string> {
  if (queuedLines.length) {
    const line = queuedLines.shift()!;
    setChips(null);
    return new Promise((resolve) => setTimeout(() => resolve(line), 1100));
  }
  setListening(true);
  const p = lastPrompt.toLowerCase();
  setChips(
    p.includes('electricity or')
      ? 'meter'
      : p.includes('numbers') || p.includes('reading')
        ? 'reading'
        : 'start',
  );
  return new Promise((resolve) => (pendingListen = resolve));
}

function submit(text: string) {
  if (!pendingListen || !text.trim()) return;
  const r = pendingListen;
  pendingListen = undefined;
  input.value = '';
  setListening(false);
  setChips(null);
  r(text.trim());
}

$('say').addEventListener('submit', (e) => {
  e.preventDefault();
  submit(input.value);
});

function setLive(live: boolean, label: string) {
  $('status-wrap').classList.toggle('live', live);
  $('status').textContent = label;
  $<HTMLButtonElement>('call').hidden = live;
  $<HTMLButtonElement>('hangup').hidden = !live;
  $('say').hidden = !live;
  document.body.classList.toggle('calling', live);
  ['caller', 'tenant', 'clock'].forEach((id) => ($<HTMLSelectElement>(id).disabled = live));
  clearInterval(timer);
  if (live) {
    const started = Date.now();
    $('timer').textContent = '00:00';
    timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      $('timer').textContent =
        `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  }
}

async function placeCall() {
  const tenant = tenants[picked('tenant')]!;
  const caller = callers[picked('caller')]!;
  const now = clocks[picked('clock')]!.now();
  const { flow, queueArns } = renderFor(tenant);

  env.TENANT_CONFIG = JSON.stringify(tenant);
  env.QUEUE_ARNS = JSON.stringify(queueArns);
  env.DD_SERVICE = 'connect-voice';
  env.DD_ENV = 'demo';
  resetTenantConfigCache();
  const r = repo();
  setRouterRepo(r);
  setLexRepo(r);

  transcript.innerHTML = '';
  invocations.innerHTML = '';
  logs.textContent = '';
  invCount = logCount = 0;
  $('inv-count').textContent = $('log-count').textContent = '0';
  $('outcome').hidden = true;
  step = 0;
  drawBlocks(flow);
  $<HTMLTextAreaElement>('flowsrc').value = JSON.stringify(flow, null, 2);
  setLive(true, 'Connected');
  callStarted = Date.now();
  lastIntent = undefined;
  lastOutcome = undefined;

  const queueNames = Object.fromEntries(tenant.queues.map((q) => [queueArns[q.key]!, q.name]));
  sim = new CallSimulator({ tenant, flow, ani: caller.ani, now, queueNames, emit: handle, listen });
  try {
    await sim.run();
  } catch (err) {
    message('note', `Simulator error: ${(err as Error).message}`);
  } finally {
    endCall();
  }
}

function endCall() {
  sim?.hangUp();
  sim = undefined;
  if (pendingListen) {
    const r = pendingListen;
    pendingListen = undefined;
    r('');
  }
  setListening(false);
  setChips(null);
  const wasLive = callStarted > 0;
  queuedLines = [];
  setLive(false, 'Call ended');
  document.querySelectorAll('.scenario.running').forEach((x) => x.classList.remove('running'));
  if (wasLive) {
    const secs = Math.round((Date.now() - callStarted) / 1000);
    callStarted = 0;
    const who = callers[picked('caller')]!.name;
    const why = lastIntent ? (INTENT_LABELS[lastIntent] ?? lastIntent) : 'No request made';
    toast(
      lastOutcome ? `${who} · ${why}` : `${who} hung up`,
      lastOutcome
        ? `${lastOutcome.outcome}: ${lastOutcome.detail}.`
        : 'Caller ended the call before the flow finished.',
      [
        ['Duration', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
        ['Blocks run', String(step)],
        ['Lambda calls', String(invCount)],
      ],
      lastOutcome?.outcome.startsWith('Transferred') ? 'warn' : 'ok',
    );
  }
  transcript.querySelectorAll('.speaking').forEach((n) => n.classList.remove('speaking'));
}

$('call').addEventListener('click', () => void placeCall());

// Scenario gallery: set up the call, then feed the scripted lines in.
let queuedLines: string[] = [];
const tenantShort = (i: number) => tenants[i]!.displayName;
$('scenarios').innerHTML = SCENARIOS.map(
  (sc, i) => `<button type="button" class="scenario" data-sc="${i}">
    <span class="sc-top"><span class="sc-num">${String(i + 1).padStart(2, '0')}</span><span class="sc-tenant">${escapeHtml(tenantShort(sc.tenant))}</span></span>
    <strong>${escapeHtml(sc.title)}</strong>
    <span class="sc-desc">${escapeHtml(sc.description)}</span>
    <span class="sc-lines">${sc.lines.map((l) => `<i>${escapeHtml(l)}</i>`).join('')}</span>
    <span class="sc-expect">${escapeHtml(sc.expect.detail ?? sc.expect.outcome)}</span>
  </button>`,
).join('');
$('scenarios').addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sc]');
  if (!card || sim) return;
  const sc = SCENARIOS[Number(card.dataset.sc)]!;
  $<HTMLSelectElement>('tenant').value = String(sc.tenant);
  $<HTMLSelectElement>('caller').value = String(sc.caller);
  $<HTMLSelectElement>('clock').value = String(sc.clock);
  updateCallerCard();
  queuedLines = [...sc.lines];
  document.querySelectorAll('.scenario.running').forEach((x) => x.classList.remove('running'));
  card.classList.add('running');
  document.querySelector('.call-card')!.scrollIntoView({ behavior: 'smooth', block: 'start' });
  void placeCall();
});
$('hangup').addEventListener('click', endCall);

// Tabs
document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((t) => {
      t.setAttribute('aria-selected', String(t === tab));
      $(`tab-${t.dataset.tab}`).hidden = t !== tab;
    });
  });
});

// Lint
$('lint').addEventListener('click', () => {
  const out = $<HTMLPreElement>('lintout');
  try {
    const issues = lintFlow(JSON.parse($<HTMLTextAreaElement>('flowsrc').value) as Flow);
    out.className = issues.length ? 'lint-bad' : 'lint-ok';
    out.textContent = issues.length
      ? issues.map((i) => `[${i.rule}] ${i.action ?? ''} ${i.message}`).join('\n')
      : 'No issues.';
  } catch (err) {
    out.className = 'lint-bad';
    out.textContent = `Invalid JSON: ${(err as Error).message}`;
  }
});

// Optional speech input where the browser supports it.
type Recognition = {
  lang: string;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  start(): void;
};
const SR = (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
  .webkitSpeechRecognition;
if (SR) {
  const mic = $<HTMLButtonElement>('mic');
  mic.hidden = false;
  mic.addEventListener('click', () => {
    const rec = new SR();
    rec.lang = 'en-GB';
    rec.onresult = (e) => submit(e.results[0]![0]!.transcript);
    rec.start();
  });
}

const initial = renderFor(tenants[0]!);
drawBlocks(initial.flow);
updateCallerCard();
$<HTMLTextAreaElement>('flowsrc').value = JSON.stringify(initial.flow, null, 2);
