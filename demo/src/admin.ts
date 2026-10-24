import energy from '../../config/tenants/brightwell-energy.json';
import drita from '../../config/tenants/drita-energji.json';
import { INTENTS } from '../../src/domain/bot-definition';
import { isOpen } from '../../src/domain/hours';
import { createTour } from './tour';
import {
  TenantConfigSchema,
  parseTenantConfig,
  type TenantConfig,
} from '../../src/domain/tenant-config';

// Operational state (agent status, incident mode) is applied live and audited.
// Configuration (queues, routing, hours) is edited as a diff against the
// tenant JSON in git and validated with the same schema CI uses.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const sources = [energy, drita];
const originals: TenantConfig[] = sources.map((s) => parseTenantConfig(s));

type Status = 'Available' | 'On contact' | 'After contact work' | 'Break' | 'Offline';
const STATUSES: Status[] = ['Available', 'On contact', 'After contact work', 'Break', 'Offline'];

interface Agent {
  name: string;
  skills: string[];
  status: Status;
  since: number;
}

interface QueueLive {
  waiting: number;
  oldest: number;
  answered: number;
  withinTarget: number;
}

const PEOPLE: Record<string, Array<[string, string[]]>> = {
  'brightwell-energy': [
    ['Arta Krasniqi', ['billing', 'general']],
    ['Jonas Becker', ['billing']],
    ['Blerim Gashi', ['meter-readings', 'general']],
    ['Hannah Weber', ['home-moves', 'general']],
    ['Elira Hoxha', ['billing', 'meter-readings']],
    ['Lukas Fischer', ['general']],
    ['Dritan Shala', ['home-moves']],
    ['Klara Hoffmann', ['billing', 'general']],
    ['Ermal Berisha', ['meter-readings']],
    ['Mia Wagner', ['general', 'home-moves']],
  ],
  'drita-energji': [
    ['Besnik Morina', ['defekte']],
    ['Elona Dervishi', ['faturat', 'informacion']],
    ['Valon Rexhepi', ['defekte', 'kontrata']],
    ['Ardita Hysa', ['faturat']],
    ['Gentian Kola', ['informacion']],
    ['Teuta Bajrami', ['defekte']],
    ['Florian Leka', ['kontrata', 'faturat']],
  ],
};

const initialStatus: Status[] = [
  'Available',
  'On contact',
  'On contact',
  'Available',
  'After contact work',
  'On contact',
  'Break',
  'Available',
  'On contact',
  'Offline',
];

interface TenantState {
  draft: TenantConfig;
  agents: Agent[];
  live: Record<string, QueueLive>;
  incident: boolean;
}

const state: TenantState[] = originals.map((cfg) => ({
  draft: structuredClone(cfg),
  agents: (PEOPLE[cfg.tenantId] ?? []).map(([name, skills], i) => ({
    name,
    skills,
    status: initialStatus[i % initialStatus.length]!,
    since: Date.now() - ((i * 97_000) % 1_800_000),
  })),
  live: Object.fromEntries(
    cfg.queues.map((q, i) => [
      q.key,
      {
        waiting: 2 + ((i * 3) % 5),
        oldest: 20 + i * 25,
        answered: 120 + i * 40,
        withinTarget: 100 + i * 30,
      },
    ]),
  ),
  incident: false,
}));

let current = 0;
const tenant = () => state[current]!;
const original = () => originals[current]!;

// ---- header -----------------------------------------------------------------

$<HTMLSelectElement>('tenant').innerHTML = originals
  .map((t, i) => `<option value="${i}">${esc(t.displayName)}</option>`)
  .join('');
$('tenant').addEventListener('change', () => {
  current = Number($<HTMLSelectElement>('tenant').value);
  renderAll();
});

$('incident').addEventListener('change', () => {
  const on = $<HTMLInputElement>('incident').checked;
  tenant().incident = on;
  audit(`Incident mode ${on ? 'enabled' : 'disabled'}`, `router INCIDENT_MODE=${on}`);
  renderIncident();
});

function renderIncident() {
  $<HTMLInputElement>('incident').checked = tenant().incident;
  $('incident-banner').hidden = !tenant().incident;
}

// ---- KPIs -------------------------------------------------------------------

function fmtSecs(s: number) {
  return s >= 60
    ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`
    : `${Math.round(s)}s`;
}

function renderKpis() {
  const t = tenant();
  const live = Object.values(t.live);
  const waiting = live.reduce((a, q) => a + q.waiting, 0);
  const oldest = Math.max(0, ...live.map((q) => q.oldest));
  const available = t.agents.filter((a) => a.status === 'Available').length;
  const staffed = t.agents.filter((a) => a.status !== 'Offline').length;
  const answered = live.reduce((a, q) => a + q.answered, 0);
  const sl = answered ? (live.reduce((a, q) => a + q.withinTarget, 0) / answered) * 100 : 100;
  const open = isOpen(t.draft, new Date());

  const kpi = (k: string, v: string, d: string, tone = '') =>
    `<div class="kpi ${tone}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;

  $('kpis').innerHTML = [
    kpi(
      'Waiting now',
      String(waiting),
      `across ${t.draft.queues.length} queues`,
      waiting > 15 ? 'bad' : waiting > 8 ? 'warn' : '',
    ),
    kpi(
      'Longest wait',
      fmtSecs(oldest),
      'oldest contact in queue',
      oldest > 240 ? 'bad' : oldest > 120 ? 'warn' : '',
    ),
    kpi(
      'Agents available',
      `${available}<small>/ ${staffed}</small>`,
      'available / logged in',
      available === 0 ? 'bad' : '',
    ),
    kpi(
      'Service level',
      `${sl.toFixed(1)}<small>%</small>`,
      'answered within target today',
      sl < 70 ? 'bad' : sl < 80 ? 'warn' : 'good',
    ),
    kpi(
      'Lines',
      open ? 'Open' : 'Closed',
      `${t.draft.hours.timezone} · ${hoursToday(t.draft)}`,
      open ? 'good' : 'warn',
    ),
  ].join('');
}

function hoursToday(cfg: TenantConfig) {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.hours.timezone,
    weekday: 'short',
  }).format(new Date());
  const w =
    day === 'Sat' ? cfg.hours.saturday : day === 'Sun' ? cfg.hours.sunday : cfg.hours.weekdays;
  return w ? `${w.open}–${w.close}` : 'closed today';
}

// ---- queues -----------------------------------------------------------------

function renderQueues() {
  const t = tenant();
  const orig = new Map(original().queues.map((q) => [q.key, q]));
  $('queues').querySelector('tbody')!.innerHTML = t.draft.queues
    .map((q) => {
      const live = t.live[q.key]!;
      const staffed = t.agents.filter((a) => a.skills.includes(q.key) && a.status !== 'Offline');
      const avail = staffed.filter((a) => a.status === 'Available').length;
      const sl = live.answered ? (live.withinTarget / live.answered) * 100 : 100;
      const tone = sl < 70 ? 'bad' : sl < 80 ? 'warn' : '';
      const o = orig.get(q.key);
      const dirtyT = o?.serviceLevelSeconds !== q.serviceLevelSeconds ? 'dirty' : '';
      const dirtyM = (o?.maxContacts ?? '') !== (q.maxContacts ?? '') ? 'dirty' : '';
      return `<tr>
        <td>${esc(q.name)}<span class="sub">${q.key}</span></td>
        <td class="num">${live.waiting}</td>
        <td class="num">${fmtSecs(live.oldest)}</td>
        <td class="num">${avail}<span class="sub">of ${staffed.length}</span></td>
        <td><div class="sl"><div class="sl-bar ${tone}"><i style="width:${sl.toFixed(1)}%"></i></div><b>${sl.toFixed(0)}%</b></div></td>
        <td class="num"><input class="num-input ${dirtyT}" type="number" min="1" max="3600" data-q="${q.key}" data-f="serviceLevelSeconds" value="${q.serviceLevelSeconds}" aria-label="${esc(q.name)} target seconds" /></td>
        <td class="num"><input class="num-input ${dirtyM}" type="number" min="1" max="1000" placeholder="∞" data-q="${q.key}" data-f="maxContacts" value="${q.maxContacts ?? ''}" aria-label="${esc(q.name)} max contacts" /></td>
      </tr>`;
    })
    .join('');
}

$('queues').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (!el.dataset.q) return;
  const q = tenant().draft.queues.find((x) => x.key === el.dataset.q)!;
  const v = el.value === '' ? undefined : Number(el.value);
  if (el.dataset.f === 'maxContacts') q.maxContacts = v;
  else q.serviceLevelSeconds = v ?? q.serviceLevelSeconds;
  renderQueues();
  renderDiff();
});

// ---- agents -----------------------------------------------------------------

let filter = 'all';
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    filter = b.dataset.filter!;
    document
      .querySelectorAll('[data-filter]')
      .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderAgents();
  }),
);

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function renderAgents() {
  const t = tenant();
  const names = new Map(t.draft.queues.map((q) => [q.key, q.name]));
  const match = (a: Agent) =>
    filter === 'all' ||
    (filter === 'Away'
      ? ['Break', 'Offline', 'After contact work'].includes(a.status)
      : a.status === filter);
  $('agents').innerHTML = t.agents
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => match(a))
    .map(
      ({ a, i }) => `<li data-s="${a.status}">
        <span class="avatar">${initials(a.name)}</span>
        <span class="who"><b>${esc(a.name)}</b><span>${a.skills.map((s) => esc(names.get(s) ?? s)).join(' · ')} · ${fmtSecs((Date.now() - a.since) / 1000)}</span></span>
        <label class="status-select"><select data-agent="${i}" aria-label="Status for ${esc(a.name)}">
          ${STATUSES.map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select></label>
      </li>`,
    )
    .join('');
  const avail = t.agents.filter((a) => a.status === 'Available').length;
  $('agent-summary').textContent = `${avail} available`;
}

$('agents').addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  if (!el.dataset.agent) return;
  const agent = tenant().agents[Number(el.dataset.agent)]!;
  const before = agent.status;
  agent.status = el.value as Status;
  agent.since = Date.now();
  audit(`${agent.name}: ${before} → ${agent.status}`, 'PutUserStatus');
  renderAgents();
  renderKpis();
  renderQueues();
});

// ---- routing + hours ---------------------------------------------------------

function renderRouting() {
  const t = tenant();
  const intents = INTENTS.filter((i) => i.name !== 'ReportGasEmergency').map((i) => i.name);
  const extra = Object.keys(t.draft.routing.intentQueues).filter((k) => !intents.includes(k));
  const all = [...intents, ...extra];
  const opts = (sel: string | undefined) =>
    `<option value="">Default (${esc(t.draft.defaultQueue)})</option>` +
    t.draft.queues
      .map(
        (q) =>
          `<option value="${q.key}" ${q.key === sel ? 'selected' : ''}>${esc(q.name)}</option>`,
      )
      .join('');
  $('routing').innerHTML =
    `<div class="form-row"><span class="lbl">ReportGasEmergency<small>Fixed: external transfer to ${t.draft.routing.gasEmergencyNumber}</small></span><span class="tag">Locked</span></div>` +
    all
      .map((intent) => {
        const val = t.draft.routing.intentQueues[intent];
        const dirty = original().routing.intentQueues[intent] !== val ? 'dirty' : '';
        return `<div class="form-row"><span class="lbl">${intent}</span><select class="${dirty}" data-intent="${intent}" aria-label="Queue for ${intent}">${opts(val)}</select></div>`;
      })
      .join('');
}

$('routing').addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  const map = tenant().draft.routing.intentQueues;
  if (el.value) map[el.dataset.intent!] = el.value;
  else delete map[el.dataset.intent!];
  renderRouting();
  renderDiff();
});

type Day = 'weekdays' | 'saturday' | 'sunday';
const DAY_LABEL: Record<Day, string> = {
  weekdays: 'Mon – Fri',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

function renderHours() {
  const h = tenant().draft.hours;
  const o = original().hours;
  $('tz').textContent = h.timezone;
  $('hours').innerHTML = (Object.keys(DAY_LABEL) as Day[])
    .map((d) => {
      const w = h[d];
      const ow = o[d];
      if (!w) {
        return `<div class="form-row"><span class="lbl">${DAY_LABEL[d]}</span><span class="time-pair">Closed <button class="closed-toggle" data-open="${d}" type="button">Open this day</button></span></div>`;
      }
      const dOpen = ow?.open !== w.open ? 'dirty' : '';
      const dClose = ow?.close !== w.close ? 'dirty' : '';
      return `<div class="form-row"><span class="lbl">${DAY_LABEL[d]}</span><span class="time-pair">
        <input type="time" class="${dOpen}" data-day="${d}" data-edge="open" value="${w.open}" aria-label="${DAY_LABEL[d]} opens" /> to
        <input type="time" class="${dClose}" data-day="${d}" data-edge="close" value="${w.close}" aria-label="${DAY_LABEL[d]} closes" />
        ${d === 'weekdays' ? '' : `<button class="closed-toggle" data-close="${d}" type="button">Close</button>`}</span></div>`;
    })
    .join('');
}

$('hours').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const d = el.dataset.day as Day | undefined;
  if (!d) return;
  const w = tenant().draft.hours[d];
  if (w) w[el.dataset.edge as 'open' | 'close'] = el.value;
  renderHours();
  renderDiff();
  renderKpis();
});
$('hours').addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const h = tenant().draft.hours as Record<Day, { open: string; close: string } | null>;
  if (el.dataset.open) h[el.dataset.open as Day] = { open: '09:00', close: '17:00' };
  else if (el.dataset.close) h[el.dataset.close as Day] = null;
  else return;
  renderHours();
  renderDiff();
  renderKpis();
});

// ---- diff ---------------------------------------------------------------------

function lineDiff(a: string[], b: string[]): string {
  // LCS diff; tenant files are small enough that O(n*m) is fine.
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Array<{ t: ' ' | '+' | '-'; l: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ t: ' ', l: a[i]! });
      i++;
      j++;
    } else if (j < m && (i === n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      out.push({ t: '+', l: b[j]! });
      j++;
    } else {
      out.push({ t: '-', l: a[i]! });
      i++;
    }
  }
  // Show 2 lines of context around changes.
  const keep = out.map((_, k) => out.slice(Math.max(0, k - 2), k + 3).some((x) => x.t !== ' '));
  let html = '';
  let gap = false;
  out.forEach((x, k) => {
    if (!keep[k]) {
      if (!gap) html += '<span class="hunk">@@</span>';
      gap = true;
      return;
    }
    gap = false;
    const cls = x.t === '+' ? 'add' : x.t === '-' ? 'del' : 'ctx';
    html += `<span class="${cls}">${x.t} ${esc(x.l)}</span>`;
  });
  return html;
}

function cleanJson(cfg: unknown) {
  return JSON.stringify(cfg, (_k, v) => (v === undefined ? undefined : v), 2);
}

function renderDiff() {
  const before = cleanJson(sources[current]).split('\n');
  const draftJson = cleanJson(tenant().draft);
  const changed = draftJson !== cleanJson(original());
  const tag = $('valid-tag');
  const copy = $<HTMLButtonElement>('copy');
  const reset = $<HTMLButtonElement>('reset');
  reset.disabled = !changed;
  $('copy-note').textContent = '';

  if (!changed) {
    $('diff').innerHTML =
      '<span class="diff-empty">Edit a queue target, max contacts, a route or opening hours to see the diff here.</span>';
    tag.className = 'tag';
    tag.textContent = 'No changes';
    copy.disabled = true;
    return;
  }

  const result = TenantConfigSchema.safeParse(JSON.parse(draftJson));
  const errors = result.success
    ? ''
    : `<span class="diff-errors">${result.error.issues.map((i) => `✗ ${esc(i.path.join('.'))}: ${esc(i.message)}`).join('\n')}</span>`;
  $('diff').innerHTML = errors + lineDiff(before, draftJson.split('\n'));
  tag.className = result.success ? 'tag ok' : 'tag bad';
  tag.textContent = result.success
    ? 'Schema valid · ready for PR'
    : `${result.error.issues.length} validation error(s)`;
  copy.disabled = !result.success;
}

$('copy').addEventListener('click', async () => {
  const file = `config/tenants/${tenant().draft.tenantId}.json`;
  try {
    await navigator.clipboard.writeText(cleanJson(tenant().draft) + '\n');
    $('copy-note').textContent = `Copied. Paste into ${file} and open a PR.`;
  } catch {
    $('copy-note').textContent = 'Clipboard blocked by the browser.';
  }
});

$('reset').addEventListener('click', () => {
  tenant().draft = structuredClone(original());
  renderAll();
});

// ---- audit --------------------------------------------------------------------

function audit(what: string, api: string) {
  const list = $('audit');
  list.querySelector('.audit-empty')?.remove();
  const time = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  list.insertAdjacentHTML(
    'afterbegin',
    `<li><time>${time}</time><span>${esc(what)} <span class="actor">· ${esc(original().displayName)}</span></span><span class="actor">admin@demo · ${esc(api)}</span></li>`,
  );
}

// ---- simulation ----------------------------------------------------------------

function tick() {
  for (const t of state) {
    for (const a of t.agents) {
      // Agents drift between contact states like a real floor would.
      const r = Math.random();
      if (a.status === 'On contact' && r < 0.18) {
        a.status = 'After contact work';
        a.since = Date.now();
      } else if (a.status === 'After contact work' && r < 0.4) {
        a.status = 'Available';
        a.since = Date.now();
      }
    }
    for (const q of t.draft.queues) {
      const live = t.live[q.key]!;
      const free = t.agents.filter((a) => a.skills.includes(q.key) && a.status === 'Available');
      const arrivals = Math.random() < (t.incident ? 0.7 : 0.35) ? 1 : 0;
      const served = free.length && live.waiting > 0 && Math.random() < 0.75 ? 1 : 0;
      if (served) {
        const agent = free[Math.floor(Math.random() * free.length)]!;
        agent.status = 'On contact';
        agent.since = Date.now();
        live.answered++;
        if (live.oldest <= q.serviceLevelSeconds) live.withinTarget++;
      }
      live.waiting = Math.max(0, Math.min(q.maxContacts ?? 99, live.waiting + arrivals - served));
      live.oldest =
        live.waiting === 0 ? 0 : served ? Math.max(5, live.oldest * 0.6) : live.oldest + 2;
    }
  }
  renderKpis();
  if (!document.activeElement?.closest('#queues')) renderQueues();
  if (!document.activeElement?.closest('#agents')) renderAgents();
}

function renderAll() {
  renderIncident();
  renderKpis();
  renderQueues();
  renderAgents();
  renderRouting();
  renderHours();
  renderDiff();
}

renderAll();
setInterval(tick, 2000);

const tour = createTour('admin', [
  {
    target: '.head-controls',
    title: 'One console, every brand',
    body: 'Switch between tenants here. Each brand has its own Connect instance, queues, agents and opening hours.',
  },
  {
    target: '#kpis',
    title: 'Live floor at a glance',
    body: 'Contacts waiting, longest wait, agents available, service level against target, and whether lines are open right now. The numbers update every two seconds (simulated traffic).',
  },
  {
    target: '#queues',
    title: 'Queue board',
    body: 'Live load per queue. <b>Target</b> and <b>Max</b> are editable. Change one and watch the pending configuration change below.',
  },
  {
    target: '#agents',
    title: 'Agent roster',
    body: "Change an agent's status (Available, Break, Offline...). Operational changes like this apply immediately and are written to the audit log.",
  },
  {
    target: '#routing',
    title: 'Intent routing and hours',
    body: 'Decide which queue each bot intent lands in, and edit opening hours. The gas emergency route is locked: it never goes through a queue.',
  },
  {
    target: '#diff',
    title: 'Config changes go through review',
    body: 'Queue, routing and hours edits become a diff against <code>config/tenants/*.json</code>, validated live by the same schema CI uses. Copy it into a PR. Nothing goes straight to prod.',
  },
  {
    target: '.incident',
    title: 'Incident mode',
    body: "During a regional outage, flip this to play an incident banner to callers before routing. It's audited too.",
  },
  {
    target: '#audit',
    title: 'Audit log',
    body: 'Who changed what and when, with the Connect API each action maps to.',
  },
]);
$('tour-btn').addEventListener('click', () => tour.open());
tour.autoStart();
