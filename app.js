/* Healthy Eating - vanilla JS PWA. No dependencies, no network. */
(() => {
'use strict';

const VERSION = '1.0.0';
const KEY = 'healthyEating.v1';
const SCHEMA = 1;
const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const SLOT_LABEL = Object.fromEntries(SLOTS);

/* ---------- small utils ---------- */
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local time, never toISOString
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const mondayOf = (s) => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
const today = () => ymd(new Date());
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;
const numFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const fmt = (n) => numFmt.format(Math.round(n || 0));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const fmtDate = (s, o) => parseYmd(s).toLocaleDateString(undefined, o);
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };

const ICONS = {
  left: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  right: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name]; // static trusted markup only
  return s;
}

/* Element builder. Text is always set via text nodes, never innerHTML. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}
const put = (el, ...k) => { k.forEach((x) => { if (x != null && x !== false) el.append(x); }); return el; };
const iconBtn = (name, label, onClick, cls = '') => {
  const b = h('button', { class: 'icon-btn ' + cls, type: 'button', 'aria-label': label, onClick });
  b.append(icon(name)); return b;
};

/* ---------- state & storage ---------- */
const blank = () => ({ schemaVersion: SCHEMA, pantry: [], meals: [], weeks: {}, settings: { dailyGoal: null } });
let state = blank();
let storageOk = true;
let storageNote = '';
const memStore = {}; // keeps the app usable if localStorage is unavailable

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This is not a Healthy Eating backup.');
  let src = raw;
  if (!Array.isArray(src.pantry) && src.data && typeof src.data === 'object') src = src.data;
  if (typeof src.schemaVersion === 'number' && src.schemaVersion > SCHEMA) throw new Error('This backup was made by a newer version of the app.');
  if (!Array.isArray(src.pantry)) throw new Error('The pantry list is missing.');
  if (!Array.isArray(src.meals)) throw new Error('The meals list is missing.');
  if (!src.weeks || typeof src.weeks !== 'object' || Array.isArray(src.weeks)) throw new Error('The weekly plan is missing.');
  const out = blank();
  const pantryIds = new Set();
  src.pantry.forEach((p, i) => {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()) throw new Error(`Pantry item ${i + 1} is not valid.`);
    const id = typeof p.id === 'string' && p.id && !pantryIds.has(p.id) ? p.id : uid();
    pantryIds.add(id);
    out.pantry.push({ id, name: p.name.trim(), category: typeof p.category === 'string' ? p.category.trim() : '', status: p.status === 'out' ? 'out' : 'have' });
  });
  const mealIds = new Set();
  src.meals.forEach((m, i) => {
    if (!m || typeof m !== 'object' || typeof m.name !== 'string' || !m.name.trim()) throw new Error(`Meal ${i + 1} is not valid.`);
    const cal = Number(m.calories);
    if (!Number.isFinite(cal) || cal < 0) throw new Error(`Meal "${m.name}" has invalid calories.`);
    const id = typeof m.id === 'string' && m.id && !mealIds.has(m.id) ? m.id : uid();
    mealIds.add(id);
    const ing = Array.isArray(m.ingredientIds) ? [...new Set(m.ingredientIds.filter((x) => pantryIds.has(x)))] : [];
    const meal = { id, name: m.name.trim(), calories: cal, ingredientIds: ing };
    if (typeof m.notes === 'string' && m.notes.trim()) meal.notes = m.notes.trim();
    out.meals.push(meal);
  });
  const entryIds = new Set();
  for (const [wk, week] of Object.entries(src.weeks)) {
    if (!isDate(wk)) throw new Error(`"${wk}" is not a valid week date.`);
    if (!week || typeof week !== 'object' || !week.days || typeof week.days !== 'object') throw new Error(`Week ${wk} is not valid.`);
    for (const [date, slots] of Object.entries(week.days)) {
      if (!isDate(date)) throw new Error(`"${date}" is not a valid date.`);
      if (!slots || typeof slots !== 'object') continue;
      for (const [slot] of SLOTS) {
        const list = slots[slot];
        if (list == null) continue;
        if (!Array.isArray(list)) throw new Error(`${date} ${slot} is not valid.`);
        for (const e of list) {
          if (!e || typeof e !== 'object') throw new Error(`An entry on ${date} is not valid.`);
          const id = typeof e.id === 'string' && e.id && !entryIds.has(e.id) ? e.id : uid();
          entryIds.add(id);
          const entry = { id, eaten: e.eaten === true };
          if (typeof e.mealId === 'string' && mealIds.has(e.mealId)) entry.mealId = e.mealId;
          else if (typeof e.customName === 'string' && e.customName.trim()) {
            entry.customName = e.customName.trim();
            entry.customCalories = Number.isFinite(Number(e.customCalories)) ? Math.max(0, Number(e.customCalories)) : 0;
          } else continue; // refers to a meal that does not exist; skip it
          if (typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time)) entry.time = e.time;
          const mon = mondayOf(date);
          const w = out.weeks[mon] || (out.weeks[mon] = { days: {} });
          const d = w.days[date] || (w.days[date] = {});
          (d[slot] || (d[slot] = [])).push(entry);
        }
      }
    }
  }
  const g = Number(src.settings && src.settings.dailyGoal);
  out.settings.dailyGoal = src.settings && src.settings.dailyGoal != null && Number.isFinite(g) && g > 0 ? g : null;
  return out;
}

function load() {
  let raw = null;
  try {
    localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe');
    raw = localStorage.getItem(KEY);
  } catch (e) {
    storageOk = false; storageNote = 'Storage is unavailable, so changes will not be kept after you close the app.';
    raw = memStore[KEY] || null;
  }
  if (!raw) return;
  try { state = normalize(JSON.parse(raw)); }
  catch (e) {
    storageNote = 'Your saved data could not be read, so the app started empty. The unreadable copy was kept aside.';
    try { localStorage.setItem(KEY + '.unreadable', raw); } catch (_) { /* ignore */ }
    state = blank();
  }
}
function save() {
  const json = JSON.stringify(state);
  memStore[KEY] = json;
  try { localStorage.setItem(KEY, json); }
  catch (e) { storageOk = false; storageNote = 'Storage is full or unavailable, so changes may not be kept. Export a backup from Settings.'; }
}

/* ---------- selectors ---------- */
const pantryById = (id) => state.pantry.find((p) => p.id === id);
const mealById = (id) => state.meals.find((m) => m.id === id);
const outItems = () => state.pantry.filter((p) => p.status === 'out');
function mealStatus(m) {
  const missing = m.ingredientIds.map(pantryById).filter((p) => p && p.status === 'out').map((p) => p.name).sort((a, b) => a.localeCompare(b));
  return { ok: missing.length === 0, missing };
}
const mealsUsing = (pid) => state.meals.filter((m) => m.ingredientIds.includes(pid)).sort(byName);
function entryInfo(e) {
  if (e.mealId) { const m = mealById(e.mealId); return { name: m ? m.name : 'Removed meal', cal: m ? m.calories : 0, custom: false }; }
  return { name: e.customName || 'Something else', cal: e.customCalories || 0, custom: true };
}
function slotArr(date, slot, create) {
  const wk = mondayOf(date);
  let w = state.weeks[wk];
  if (!w) { if (!create) return null; w = state.weeks[wk] = { days: {} }; }
  let d = w.days[date];
  if (!d) { if (!create) return null; d = w.days[date] = {}; }
  if (!d[slot]) { if (!create) return null; d[slot] = []; }
  return d[slot];
}
const entriesOf = (date, slot) => slotArr(date, slot, false) || [];
function sortedEntries(date, slot) {
  const l = entriesOf(date, slot).slice();
  return l.map((e, i) => [e, i]).sort((a, b) => {
    const ta = a[0].time, tb = b[0].time;
    if (ta && tb) return ta.localeCompare(tb) || a[1] - b[1];
    if (ta) return -1; if (tb) return 1; return a[1] - b[1];
  }).map((x) => x[0]);
}
function dayTotals(date) {
  let planned = 0, eaten = 0;
  for (const [s] of SLOTS) for (const e of entriesOf(date, s)) { const c = entryInfo(e).cal; planned += c; if (e.eaten) eaten += c; }
  return { planned, eaten };
}
function weekEntryCount(mon) {
  const w = state.weeks[mon]; if (!w) return 0;
  let n = 0;
  for (const d of Object.values(w.days)) for (const l of Object.values(d)) n += l.length;
  return n;
}
const isEmptyApp = () => !state.pantry.length && !state.meals.length && !Object.keys(state.weeks).some((k) => weekEntryCount(k));

function groupByCategory(items) {
  const map = new Map();
  for (const it of items) {
    const c = (it.category || '').trim(), k = c.toLowerCase();
    if (!map.has(k)) map.set(k, { key: k, label: c || 'Uncategorized', items: [] });
    map.get(k).items.push(it);
  }
  const arr = [...map.values()];
  arr.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.label.localeCompare(b.label)));
  arr.forEach((g) => g.items.sort(byName));
  return arr;
}

/* ---------- ui state (not persisted) ---------- */
const ui = { tab: 'plan', week: mondayOf(today()), day: today(), mealQ: '', mealCan: false, pantryQ: '' };

/* ---------- mutations ---------- */
function commit() { save(); render(); }

function setStatus(item, status, opts = {}) {
  const prev = item.status;
  if (prev === status) return;
  item.status = status; commit();
  if (opts.toast) toast(opts.toast, { action: 'Undo', onAction: () => { item.status = prev; commit(); } });
}
function addPantryItem(name, category, status) {
  const item = { id: uid(), name: name.trim(), category: (category || '').trim(), status };
  state.pantry.push(item); return item;
}
const findPantryByName = (n) => state.pantry.find((p) => p.name.toLowerCase() === n.trim().toLowerCase());
function deletePantryItem(item) {
  state.pantry = state.pantry.filter((p) => p.id !== item.id);
  state.meals.forEach((m) => { m.ingredientIds = m.ingredientIds.filter((x) => x !== item.id); });
  commit();
}
function deleteMeal(meal) {
  // keep history readable: planned entries become custom entries
  for (const w of Object.values(state.weeks)) for (const d of Object.values(w.days)) for (const l of Object.values(d)) for (const e of l) {
    if (e.mealId === meal.id) { e.customName = meal.name; e.customCalories = meal.calories; delete e.mealId; }
  }
  state.meals = state.meals.filter((m) => m.id !== meal.id);
  commit();
}
function addEntry(date, slot, data, time) {
  const e = { id: uid(), ...data, eaten: false };
  if (time) e.time = time;
  slotArr(date, slot, true).push(e);
  return e;
}
function copyLastWeek(target) {
  const prev = state.weeks[addDays(target, -7)];
  let n = 0;
  if (prev) for (const [date, slots] of Object.entries(prev.days)) {
    const nd = addDays(date, 7);
    for (const [slot] of SLOTS) for (const e of slots[slot] || []) {
      const c = { ...e, id: uid(), eaten: false };
      slotArr(nd, slot, true).push(c); n++;
    }
  }
  commit();
  toast(n ? `Copied ${n} ${n === 1 ? 'entry' : 'entries'} from last week` : 'Last week has nothing to copy');
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, opts = {}) {
  const t = document.getElementById('toast');
  t.replaceChildren(h('span', null, msg));
  if (opts.action) t.append(h('button', { type: 'button', onClick: () => { hideToast(); opts.onAction && opts.onAction(); } }, opts.action));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.ms || (opts.action ? 5000 : 2600));
}
function hideToast() { const t = document.getElementById('toast'); t.hidden = true; clearTimeout(toastTimer); }

/* ---------- sheets ---------- */
const sheetStack = [];
function openSheet(title, body, footer) {
  const host = document.getElementById('sheets');
  const back = h('div', { class: 'backdrop' });
  const bodyEl = h('div', { class: 'sheet-body' }, body);
  const api = { onClose: null, el: null, body: bodyEl };
  const close = () => {
    const i = sheetStack.indexOf(api); if (i < 0) return;
    sheetStack.splice(i, 1); back.remove();
    if (!sheetStack.length) document.body.classList.remove('locked');
    if (api.onClose) api.onClose();
  };
  api.close = close;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), iconBtn('close', 'Close', close, 'muted')),
    bodyEl, footer ? h('div', { class: 'sheet-foot' }, footer) : null);
  api.el = sheet;
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.append(sheet); host.append(back);
  sheetStack.push(api);
  document.body.classList.add('locked');
  hideToast();
  return api;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1].close(); });

function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const body = h('p', { style: 'color:var(--muted)' }, message);
    const cancel = h('button', { class: 'btn secondary', type: 'button', onClick: () => { finish(false); api.close(); } }, 'Cancel');
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : ''), type: 'button', onClick: () => { finish(true); api.close(); } }, confirmLabel);
    const api = openSheet(title, body, [cancel, ok]);
    api.onClose = () => finish(false);
  });
}
function messageSheet(title, message) {
  const api = openSheet(title, h('p', { style: 'color:var(--muted)' }, message),
    h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, 'OK'));
}

/* ---------- shared UI bits ---------- */
function searchBox(value, placeholder, onInput) {
  const input = h('input', { class: 'input', type: 'search', placeholder, value: value || '', 'aria-label': placeholder, autocomplete: 'off', autocapitalize: 'none', enterkeyhint: 'search', onInput: () => onInput(input.value) });
  return h('div', { class: 'search' }, icon('search'), input);
}
function field(label, input) { return h('label', { class: 'field' }, h('span', null, label), input); }
function textInput(extra) { return h('input', { class: 'input', type: 'text', autocomplete: 'off', ...extra }); }
function numInput(extra) { return h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: '0', step: 'any', ...extra }); }
function segmented(options, current, onPick) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const draw = (cur) => wrap.replaceChildren(...options.map(([val, label]) =>
    h('button', { type: 'button', 'aria-pressed': String(val === cur), onClick: () => { onPick(val); draw(val); } }, label)));
  draw(current); return wrap;
}
function mealFlag(m) {
  const s = mealStatus(m);
  return s.ok ? h('span', { class: 'tag ok' }, 'Can make') : h('span', { class: 'tag warn' }, 'Missing: ' + s.missing.join(', '));
}
function storageBanner() {
  return (!storageOk || storageNote) ? h('div', { class: 'warn-banner', role: 'alert' }, storageNote || 'Storage is unavailable.') : null;
}
function emptyState(title, text) { return h('div', { class: 'empty card' }, h('strong', null, title), text); }

/* ---------- PLAN ---------- */
function viewPlan() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(ui.week, i));
  if (!days.includes(ui.day)) ui.day = days[0];
  const sameYear = parseYmd(ui.week).getFullYear() === new Date().getFullYear() && parseYmd(days[6]).getFullYear() === new Date().getFullYear();
  const md = { month: 'short', day: 'numeric' };
  const range = `${fmtDate(days[0], md)} – ${fmtDate(days[6], sameYear ? md : { ...md, year: 'numeric' })}`;

  const goThisWeek = () => { ui.week = mondayOf(today()); ui.day = today(); render(); };
  const shift = (n) => { const idx = days.indexOf(ui.day); ui.week = addDays(ui.week, 7 * n); ui.day = addDays(ui.week, idx); render(); };

  const root = h('div', { class: 'view' });
  put(root, 
    storageBanner(),
    h('header', { class: 'top' }, h('h1', null, 'Plan'),
      h('div', { class: 'top-actions' },
        h('button', { class: 'pill-btn', type: 'button', onClick: goThisWeek }, 'This week'),
        iconBtn('more', 'More plan options', planMenu))),
    h('div', { class: 'weeknav' }, iconBtn('left', 'Previous week', () => shift(-1)),
      h('div', { class: 'range', 'aria-live': 'polite' }, range), iconBtn('right', 'Next week', () => shift(1))),
    h('div', { class: 'days', role: 'group', 'aria-label': 'Days of the week' }, days.map((d) => {
      const t = dayTotals(d).planned;
      const long = fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' });
      return h('button', { class: 'day' + (d === today() ? ' today' : ''), type: 'button', 'aria-pressed': String(d === ui.day),
        'aria-label': `${long}, ${fmt(t)} kcal planned`, onClick: () => { ui.day = d; render(); } },
        h('span', { class: 'dow' }, fmtDate(d, { weekday: 'short' })),
        h('span', { class: 'num' }, String(parseYmd(d).getDate())),
        h('span', { class: 'tot' }, t ? String(Math.round(t)) : '–'));
    })));

  if (weekEntryCount(ui.week) === 0 && weekEntryCount(addDays(ui.week, -7)) > 0) {
    put(root, h('div', { class: 'card pad' },
      h('p', { class: 'sub', style: 'margin-bottom:10px' }, 'This week is empty. Start from last week’s plan?'),
      h('button', { class: 'btn tonal block', type: 'button', onClick: () => copyLastWeek(ui.week) }, 'Copy last week')));
  }

  const tot = dayTotals(ui.day), goal = state.settings.dailyGoal;
  const summary = h('section', { class: 'card pad summary', 'aria-label': 'Daily summary' },
    h('div', { class: 'date' }, fmtDate(ui.day, { weekday: 'long', month: 'long', day: 'numeric' })),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', { id: 'planned-total' }, fmt(tot.planned)), h('span', null, 'Planned kcal')),
      h('div', { class: 'stat' }, h('b', { id: 'eaten-total' }, fmt(tot.eaten)), h('span', null, 'Eaten kcal'))));
  if (goal) {
    summary.append(h('div', { class: 'goal' },
      h('div', { class: 'line' }, h('span', null, 'Eaten / goal'), h('b', { id: 'goal-line' }, `${fmt(tot.eaten)} / ${fmt(goal)}`)),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(goal), 'aria-valuenow': String(Math.round(tot.eaten)) },
        h('i', { style: `width:${Math.min(100, (tot.eaten / goal) * 100)}%` }))));
  } else {
    summary.append(h('p', { class: 'sub', style: 'margin-top:10px' }, 'Optional: set a daily goal in Settings.'));
  }
  put(root, summary);

  for (const [slot, label] of SLOTS) {
    const list = sortedEntries(ui.day, slot);
    const sum = list.reduce((a, e) => a + entryInfo(e).cal, 0);
    const sec = h('section', { 'aria-label': label });
    sec.append(h('div', { class: 'slot-head' },
      h('div', { class: 'left' }, h('h2', null, label), list.length ? h('span', { class: 'sub' }, `${fmt(sum)} kcal`) : null),
      h('button', { class: 'pill-btn', type: 'button', 'aria-label': `Add to ${label}`, onClick: () => entrySheet({ date: ui.day, slot }) }, '+ Add')));
    sec.append(list.length
      ? h('div', { class: 'card' }, list.map((e) => entryRow(e, ui.day, slot)))
      : h('div', { class: 'card slot-empty' }, 'Nothing planned'));
    put(root, sec);
  }
  return root;
}

function entryRow(e, date, slot) {
  const info = entryInfo(e);
  const meta = [`${fmt(info.cal)} kcal`, e.time ? fmtTime(e.time) : null, info.custom ? 'Custom' : null].filter(Boolean).join(' · ');
  const check = h('button', { class: 'circle', type: 'button', role: 'checkbox', 'aria-checked': String(e.eaten), 'aria-label': `Ate ${info.name}`,
    onClick: () => { e.eaten = !e.eaten; commit(); } }, h('i', null, icon('check')));
  return h('div', { class: 'row entry' }, check,
    h('div', { class: 'grow' }, h('div', { class: 'name' + (e.eaten ? ' done' : '') }, info.name), h('div', { class: 'meta' }, meta)),
    iconBtn('swap', `Swap ${info.name}`, () => entrySheet({ date, slot, entry: e })),
    iconBtn('trash', `Remove ${info.name}`, () => {
      const list = slotArr(date, slot, false); const idx = list.indexOf(e);
      list.splice(idx, 1); commit();
      toast(`Removed ${info.name}`, { action: 'Undo', onAction: () => { slotArr(date, slot, true).splice(idx, 0, e); commit(); } });
    }, 'muted'));
}

function planMenu() {
  const api = openSheet('Plan options', h('div', { class: 'card' },
    h('button', { class: 'row', type: 'button', onClick: async () => {
      api.close();
      const n = weekEntryCount(ui.week);
      if (n > 0) {
        const ok = await confirmSheet({ title: 'Copy last week?', confirmLabel: 'Copy and add',
          message: `This week already has ${n} ${n === 1 ? 'entry' : 'entries'}. Last week’s entries will be added alongside them; nothing is overwritten.` });
        if (!ok) return;
      }
      copyLastWeek(ui.week);
    } }, h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Copy last week’s plan'), h('div', { class: 'meta' }, 'Adds last week’s entries here, with eaten ticks cleared'))),
    h('button', { class: 'row', type: 'button', onClick: () => { api.close(); ui.week = mondayOf(today()); ui.day = today(); render(); } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Jump to today')))));
}

/* add / swap an entry in a slot */
function entrySheet({ date, slot, entry }) {
  const editing = !!entry;
  let mode = entry && !entry.mealId ? 'custom' : 'meals';
  let sel = entry && entry.mealId ? entry.mealId : null;
  let q = '';
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };

  const list = h('div', { class: 'card pick-list' });
  const drawList = () => {
    const needle = q.trim().toLowerCase();
    const ms = state.meals.filter((m) => m.name.toLowerCase().includes(needle)).sort((a, b) => (mealStatus(b).ok - mealStatus(a).ok) || byName(a, b));
    if (!state.meals.length) { list.replaceChildren(h('div', { class: 'slot-empty' }, 'No meals yet. Use the Custom tab, or add meals in the Meals tab.')); return; }
    if (!ms.length) { list.replaceChildren(h('div', { class: 'slot-empty' }, 'No meals match.')); return; }
    list.replaceChildren(...ms.map((m) => h('button', { class: 'row pick-row', type: 'button', role: 'radio', 'aria-checked': String(sel === m.id),
      onClick: () => { sel = m.id; showErr(''); drawList(); } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, m.name), mealFlag(m)),
      h('span', { class: 'kcal' }, `${fmt(m.calories)} kcal`),
      h('span', { class: 'circle', style: 'width:32px' }, h('i', { style: sel === m.id ? 'background:var(--accent);border-color:var(--accent);color:var(--accent-ink)' : '' }, icon('check'))))));
  };
  const mealsPane = h('div', { class: 'stack' },
    searchBox('', 'Search meals', (v) => { q = v; drawList(); }), list);
  const cInfo = entry && !entry.mealId ? entryInfo(entry) : null;
  const nameIn = textInput({ value: cInfo ? cInfo.name : '', placeholder: 'e.g. Sandwich from the cafe', 'aria-label': 'Custom meal name', autocapitalize: 'sentences' });
  const calIn = numInput({ value: cInfo ? String(cInfo.cal) : '', placeholder: 'e.g. 450', 'aria-label': 'Custom calories' });
  const customPane = h('div', { class: 'stack' },
    field(editing ? 'What I actually had' : 'Name', nameIn), field('Calories', calIn));
  const timeIn = h('input', { class: 'input', type: 'time', value: entry && entry.time ? entry.time : '', 'aria-label': 'Time (optional)' });

  const panes = h('div');
  const showPane = () => { panes.replaceChildren(mode === 'meals' ? mealsPane : customPane); showErr(''); };
  const seg = segmented([['meals', 'From meals'], ['custom', 'Custom']], mode, (v) => { mode = v; showPane(); });
  showPane(); drawList();

  const save_ = () => {
    let data;
    if (mode === 'meals') {
      if (!sel) return showErr('Pick a meal first, or use the Custom tab.');
      data = { mealId: sel };
    } else {
      const name = nameIn.value.trim(), cal = Number(calIn.value);
      if (!name) return showErr('Please enter a name.');
      if (calIn.value.trim() === '' || !Number.isFinite(cal) || cal < 0) return showErr('Please enter calories (0 or more).');
      data = { customName: name, customCalories: cal };
    }
    const time = timeIn.value || '';
    if (editing) {
      delete entry.mealId; delete entry.customName; delete entry.customCalories;
      Object.assign(entry, data);
      if (time) entry.time = time; else delete entry.time;
    } else addEntry(date, slot, data, time);
    api.close(); commit();
  };
  const api = openSheet(editing ? 'Swap entry' : `Add to ${SLOT_LABEL[slot]}`,
    [seg, panes, field('Time (optional)', timeIn), err],
    h('button', { class: 'btn', type: 'button', onClick: save_ }, editing ? 'Save' : 'Add'));
}

/* meal -> pick day + slot */
function addToPlanSheet(meal) {
  let date = isDate(ui.day) ? ui.day : today(), slot = 'dinner';
  const dateIn = h('input', { class: 'input', type: 'date', value: date, 'aria-label': 'Day' });
  const timeIn = h('input', { class: 'input', type: 'time', 'aria-label': 'Time (optional)' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const seg = segmented(SLOTS, slot, (v) => { slot = v; });
  const go = () => {
    if (!isDate(dateIn.value)) { err.textContent = 'Please choose a day.'; err.hidden = false; return; }
    date = dateIn.value;
    addEntry(date, slot, { mealId: meal.id }, timeIn.value);
    api.close(); save(); render();
    toast(`Added to ${SLOT_LABEL[slot]}, ${fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}`, {
      action: 'View', onAction: () => { ui.tab = 'plan'; ui.week = mondayOf(date); ui.day = date; render(); window.scrollTo(0, 0); } });
  };
  const api = openSheet('Add to plan', [
    h('p', null, h('strong', null, meal.name), ` · ${fmt(meal.calories)} kcal`),
    field('Day', dateIn), h('div', { class: 'field' }, h('span', null, 'Meal slot'), seg), field('Time (optional)', timeIn), err],
    h('button', { class: 'btn', type: 'button', onClick: go }, 'Add to plan'));
}

/* ---------- MEALS ---------- */
function viewMeals() {
  const root = h('div', { class: 'view' });
  const list = h('div');
  const draw = () => {
    const needle = ui.mealQ.trim().toLowerCase();
    let ms = state.meals.filter((m) => m.name.toLowerCase().includes(needle));
    if (ui.mealCan) ms = ms.filter((m) => mealStatus(m).ok);
    ms.sort(byName);
    if (!state.meals.length) return list.replaceChildren(emptyState('No meals yet', 'Tap + to add your first meal, or load sample data in Settings.'));
    if (!ms.length) return list.replaceChildren(emptyState(ui.mealCan && !needle ? 'Nothing you can make right now' : 'No matches', ui.mealCan ? 'Check the Shopping tab for what you are out of.' : 'Try a different search.'));
    list.replaceChildren(h('div', { class: 'card' }, ms.map((m) =>
      h('button', { class: 'row', type: 'button', onClick: () => mealDetail(m) },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, m.name), mealFlag(m)),
        h('span', { class: 'kcal' }, `${fmt(m.calories)} kcal`)))));
  };
  const chip = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ui.mealCan), onClick: () => { ui.mealCan = !ui.mealCan; chip.setAttribute('aria-pressed', String(ui.mealCan)); draw(); } }, 'Can make now');
  put(root, storageBanner(),
    h('header', { class: 'top' }, h('h1', null, 'Meals'), iconBtn('plus', 'Add meal', () => mealSheet())),
    searchBox(ui.mealQ, 'Search meals', (v) => { ui.mealQ = v; draw(); }),
    h('div', { class: 'chips' }, chip), list);
  draw(); return root;
}

function mealDetail(meal) {
  const ings = meal.ingredientIds.map(pantryById).filter(Boolean).sort(byName);
  const body = [
    h('div', null, h('div', { style: 'font-size:28px;font-weight:700' }, `${fmt(meal.calories)} kcal`), mealFlag(meal)),
    h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Ingredients'),
      ings.length ? h('div', { class: 'card' }, ings.map((p) => h('div', { class: 'row' },
        h('div', { class: 'grow name' }, p.name), h('span', { class: 'tag ' + (p.status === 'have' ? 'ok' : 'warn'), style: 'margin:0' }, p.status === 'have' ? 'Have' : 'Out'))))
        : h('p', { class: 'sub' }, 'No linked ingredients.')),
    meal.notes ? h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Notes'), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, meal.notes)) : null,
    h('div', { class: 'form-row' },
      h('button', { class: 'btn secondary', type: 'button', onClick: () => { api.close(); mealSheet(meal); } }, 'Edit'),
      h('button', { class: 'btn danger', type: 'button', onClick: async () => {
        const ok = await confirmSheet({ title: 'Delete meal?', confirmLabel: 'Delete', danger: true,
          message: `“${meal.name}” will be removed. Any plan entries using it stay in your plan as custom entries.` });
        if (ok) { api.close(); deleteMeal(meal); toast('Meal deleted'); }
      } }, 'Delete')),
  ];
  const api = openSheet(meal.name, body, h('button', { class: 'btn', type: 'button', onClick: () => { api.close(); addToPlanSheet(meal); } }, 'Add to plan'));
}

function mealSheet(meal) {
  const editing = !!meal;
  const chosen = new Set(meal ? meal.ingredientIds : []);
  let q = '';
  const nameIn = textInput({ value: meal ? meal.name : '', placeholder: 'e.g. Veggie omelette', 'aria-label': 'Meal name', autocapitalize: 'sentences' });
  const calIn = numInput({ value: meal ? String(meal.calories) : '', placeholder: 'e.g. 350', 'aria-label': 'Calories' });
  const notesIn = h('textarea', { class: 'input', placeholder: 'Optional notes or recipe link', 'aria-label': 'Notes', value: meal && meal.notes ? meal.notes : '' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const count = h('span', { class: 'sub' });
  const list = h('div', { class: 'card pick-list' });
  const draw = () => {
    const needle = q.trim().toLowerCase();
    const items = state.pantry.filter((p) => p.name.toLowerCase().includes(needle)).sort(byName);
    const rows = items.map((p) => h('button', { class: 'row pick-row', type: 'button', role: 'checkbox', 'aria-checked': String(chosen.has(p.id)),
      onClick: () => { chosen.has(p.id) ? chosen.delete(p.id) : chosen.add(p.id); draw(); } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name), p.category || p.status === 'out' ? h('div', { class: 'meta' }, [p.category, p.status === 'out' ? 'Out' : null].filter(Boolean).join(' · ')) : null),
      h('span', { class: 'circle', 'aria-hidden': 'true', style: 'width:32px' }, h('i', { style: chosen.has(p.id) ? 'background:var(--accent);border-color:var(--accent);color:var(--accent-ink)' : '' }, icon('check')))));
    const trimmed = q.trim();
    if (trimmed && !findPantryByName(trimmed)) {
      rows.push(h('button', { class: 'row', type: 'button', style: 'color:var(--accent)', onClick: () => {
        const it = addPantryItem(trimmed, '', 'have'); chosen.add(it.id); q = ''; searchInput.value = ''; save(); draw(); render();
      } }, h('div', { class: 'grow name' }, `+ Add “${trimmed}” as a new ingredient`)));
    }
    if (!rows.length) rows.push(h('div', { class: 'slot-empty' }, 'Your pantry is empty. Type a name above to add an ingredient.'));
    list.replaceChildren(...rows);
    count.textContent = `${chosen.size} selected`;
  };
  const search = searchBox('', 'Search or add ingredients', (v) => { q = v; draw(); });
  const searchInput = search.querySelector('input');
  draw();

  const submit = () => {
    const name = nameIn.value.trim(), cal = Number(calIn.value);
    if (!name) { err.textContent = 'Please enter a meal name.'; err.hidden = false; nameIn.focus(); return; }
    if (calIn.value.trim() === '' || !Number.isFinite(cal) || cal < 0) { err.textContent = 'Calories are required (a number, 0 or more).'; err.hidden = false; calIn.focus(); return; }
    const data = { name, calories: cal, ingredientIds: [...chosen].filter(pantryById) };
    const notes = notesIn.value.trim();
    if (editing) { Object.assign(meal, data); if (notes) meal.notes = notes; else delete meal.notes; }
    else { const m = { id: uid(), ...data }; if (notes) m.notes = notes; state.meals.push(m); }
    api.close(); commit(); toast(editing ? 'Meal saved' : 'Meal added');
  };
  const api = openSheet(editing ? 'Edit meal' : 'New meal', [
    field('Name', nameIn), field('Calories', calIn),
    h('div', { class: 'field' }, h('span', null, 'Ingredients'), h('div', { class: 'stack' }, search, list, count)),
    field('Notes', notesIn), err],
    [h('button', { class: 'btn secondary', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn', type: 'button', onClick: submit }, 'Save')]);
}

/* ---------- PANTRY ---------- */
function categoryDatalist() {
  const cats = [...new Set(state.pantry.map((p) => (p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return h('datalist', { id: 'cats' }, cats.map((c) => h('option', { value: c })));
}
function viewPantry() {
  const root = h('div', { class: 'view' });
  const list = h('div');
  const draw = () => {
    const needle = ui.pantryQ.trim().toLowerCase();
    const items = state.pantry.filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.category || '').toLowerCase().includes(needle));
    if (!state.pantry.length) return list.replaceChildren(emptyState('Your pantry is empty', 'Add what you keep at home. Mark things as out to build your shopping list.'));
    if (!items.length) return list.replaceChildren(emptyState('No matches', 'Try a different search.'));
    list.replaceChildren(...groupByCategory(items).flatMap((g) => [
      h('h2', { class: 'group-title' }, g.label),
      h('div', { class: 'card' }, g.items.map((p) => h('div', { class: 'row' },
        h('button', { class: 'grow', type: 'button', style: 'text-align:left;min-height:44px', 'aria-label': `Edit ${p.name}`, onClick: () => pantrySheet(p) },
          h('div', { class: 'name' }, p.name)),
        h('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(p.status === 'have'), 'aria-label': `${p.name}: ${p.status === 'have' ? 'have' : 'out'}`,
          onClick: () => p.status === 'have'
            ? setStatus(p, 'out', { toast: `${p.name} moved to Shopping` })
            : setStatus(p, 'have', { toast: `${p.name} marked as have` }) },
          p.status === 'have' ? 'Have' : 'Out'))))]));
  };
  const nameIn = textInput({ placeholder: 'Add an item, e.g. Eggs', 'aria-label': 'New pantry item name', autocapitalize: 'sentences' });
  const catIn = textInput({ placeholder: 'Category (optional)', 'aria-label': 'New pantry item category', list: 'cats', autocapitalize: 'words' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const add = (e) => {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { err.textContent = 'Please enter a name.'; err.hidden = false; nameIn.focus(); return; }
    if (findPantryByName(name)) { err.textContent = `“${name}” is already in your pantry.`; err.hidden = false; return; }
    addPantryItem(name, catIn.value, 'have'); commit(); toast(`Added ${name}`);
  };
  put(root, storageBanner(),
    h('header', { class: 'top' }, h('h1', null, 'Pantry'), h('span', { class: 'sub' }, state.pantry.length ? `${state.pantry.length} items` : '')),
    h('form', { class: 'card pad stack', onSubmit: add }, nameIn,
      h('div', { class: 'form-row' }, catIn, h('button', { class: 'btn', type: 'submit' }, 'Add')), err, categoryDatalist()),
    state.pantry.length > 6 ? searchBox(ui.pantryQ, 'Search pantry', (v) => { ui.pantryQ = v; draw(); }) : null,
    list);
  draw(); return root;
}

function pantrySheet(p) {
  const nameIn = textInput({ value: p.name, 'aria-label': 'Item name', autocapitalize: 'sentences' });
  const catIn = textInput({ value: p.category || '', placeholder: 'Optional', list: 'cats', 'aria-label': 'Category', autocapitalize: 'words' });
  let status = p.status;
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const used = mealsUsing(p.id);
  const submit = () => {
    const name = nameIn.value.trim();
    if (!name) { err.textContent = 'Please enter a name.'; err.hidden = false; return; }
    const dupe = findPantryByName(name);
    if (dupe && dupe.id !== p.id) { err.textContent = `“${name}” already exists.`; err.hidden = false; return; }
    p.name = name; p.category = catIn.value.trim(); p.status = status;
    api.close(); commit();
  };
  const api = openSheet('Edit item', [
    field('Name', nameIn), field('Category', catIn),
    h('div', { class: 'field' }, h('span', null, 'Status'), segmented([['have', 'Have'], ['out', 'Out']], status, (v) => { status = v; })),
    h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Used in meals'),
      used.length ? h('div', { class: 'card' }, used.map((m) => h('div', { class: 'row' }, h('div', { class: 'grow name' }, m.name))))
        : h('p', { class: 'sub' }, 'Not linked to any meals yet.')),
    err,
    h('button', { class: 'btn danger block', type: 'button', onClick: async () => {
      const ok = await confirmSheet({ title: 'Delete item?', confirmLabel: 'Delete', danger: true,
        message: used.length ? `“${p.name}” will be removed from your pantry and from ${used.length} ${used.length === 1 ? 'meal' : 'meals'}.` : `“${p.name}” will be removed from your pantry.` });
      if (ok) { api.close(); deletePantryItem(p); toast('Item deleted'); }
    } }, 'Delete item')],
    [h('button', { class: 'btn secondary', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn', type: 'button', onClick: submit }, 'Save')]);
}

/* ---------- SHOPPING ---------- */
function viewShopping() {
  const root = h('div', { class: 'view' });
  const items = outItems();
  const nameIn = textInput({ placeholder: 'Add to list, e.g. Milk', 'aria-label': 'New shopping item name', autocapitalize: 'sentences' });
  const catIn = textInput({ placeholder: 'Category (optional)', 'aria-label': 'New shopping item category', list: 'cats', autocapitalize: 'words' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const add = (e) => {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { err.textContent = 'Please enter a name.'; err.hidden = false; nameIn.focus(); return; }
    const ex = findPantryByName(name);
    if (ex) {
      if (ex.status === 'out') { err.textContent = `“${ex.name}” is already on your list.`; err.hidden = false; return; }
      ex.status = 'out'; if (!ex.category && catIn.value.trim()) ex.category = catIn.value.trim();
      commit(); toast(`${ex.name} added to the list`); return;
    }
    addPantryItem(name, catIn.value, 'out'); commit(); toast(`${name} added to the list`);
  };
  put(root, storageBanner(),
    h('header', { class: 'top' }, h('h1', null, 'Shopping'), h('span', { class: 'sub' }, items.length ? `${items.length} to buy` : '')),
    h('form', { class: 'card pad stack', onSubmit: add }, nameIn,
      h('div', { class: 'form-row' }, catIn, h('button', { class: 'btn', type: 'submit' }, 'Add')), err));
  if (!items.length) put(root, emptyState('Nothing to buy', 'Items you mark as out in your pantry show up here.'));
  else for (const g of groupByCategory(items)) {
    put(root, h('h2', { class: 'group-title' }, g.label), h('div', { class: 'card' }, g.items.map((p) =>
      h('button', { class: 'row', type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': `Bought ${p.name}`,
        onClick: () => setStatus(p, 'have', { toast: `Bought ${p.name}` }) },
        h('span', { class: 'circle', style: 'margin-left:-8px' }, h('i', null, icon('check'))),
        h('div', { class: 'grow name' }, p.name)))));
  }
  return root;
}

/* ---------- SETTINGS ---------- */
function viewSettings() {
  const root = h('div', { class: 'view' });
  const goalIn = numInput({ value: state.settings.dailyGoal ? String(state.settings.dailyGoal) : '', placeholder: 'e.g. 2000', 'aria-label': 'Daily calorie goal', min: '1', inputmode: 'numeric' });
  const goalErr = h('p', { class: 'err', role: 'alert', hidden: true });
  const saveGoal = (e) => {
    e.preventDefault();
    const raw = goalIn.value.trim();
    if (raw === '') { state.settings.dailyGoal = null; commit(); toast('Goal cleared'); return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) { goalErr.textContent = 'Enter a number above 0, or clear the goal.'; goalErr.hidden = false; return; }
    state.settings.dailyGoal = Math.round(n); commit(); toast('Goal saved');
  };
  const fileIn = h('input', { type: 'file', class: 'hidden-file', accept: 'application/json,.json', id: 'import-file', 'aria-label': 'Choose backup file', tabindex: '-1', onChange: () => importFile(fileIn) });

  put(root, storageBanner(),
    h('header', { class: 'top' }, h('h1', null, 'Settings')),
    h('section', { class: 'card pad' },
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Daily calorie goal'),
      h('p', { class: 'setting-desc' }, 'Optional. Shown as a gentle reference on your Plan; it is never a limit.'),
      h('form', { class: 'stack', onSubmit: saveGoal }, goalIn, goalErr,
        h('div', { class: 'form-row' },
          h('button', { class: 'btn', type: 'submit' }, 'Save goal'),
          h('button', { class: 'btn secondary', type: 'button', onClick: () => { goalIn.value = ''; state.settings.dailyGoal = null; commit(); toast('Goal cleared'); } }, 'Clear')))),
    h('section', { class: 'card pad' },
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Backup'),
      h('p', { class: 'setting-desc' }, 'Your data lives only on this device. Export a copy now and then, and to move to a new phone.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn secondary block', type: 'button', onClick: exportBackup }, 'Export backup'),
        h('button', { class: 'btn secondary block', type: 'button', onClick: () => fileIn.click() }, 'Import backup'), fileIn)),
    h('section', { class: 'card pad' },
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Your data'),
      h('div', { class: 'stack' },
        isEmptyApp() ? [h('p', { class: 'setting-desc', style: 'margin:0' }, 'The app is empty. Load a few sample items to try it out.'),
          h('button', { class: 'btn tonal block', type: 'button', onClick: loadSample }, 'Load sample data')] : null,
        h('button', { class: 'btn danger block', type: 'button', onClick: eraseAll }, 'Erase all data'))),
    h('p', { class: 'about' }, `Healthy Eating v${VERSION}`));
  return root;
}

function loadSample() {
  if (!isEmptyApp()) return;
  const P = (name, category, status = 'have') => ({ id: uid(), name, category, status });
  const eggs = P('Eggs', 'Dairy & eggs'), yog = P('Greek yogurt', 'Dairy & eggs'), spin = P('Spinach', 'Produce', 'out'),
    tom = P('Tomatoes', 'Produce'), ban = P('Bananas', 'Produce'), oats = P('Rolled oats', 'Pantry staples'),
    rice = P('Brown rice', 'Pantry staples'), oil = P('Olive oil', 'Pantry staples'), chick = P('Canned chickpeas', 'Pantry staples'),
    chicken = P('Chicken breast', 'Protein');
  state.pantry = [eggs, yog, spin, tom, ban, oats, rice, oil, chick, chicken];
  const M = (name, calories, ing, notes) => ({ id: uid(), name, calories, ingredientIds: ing.map((x) => x.id), ...(notes ? { notes } : {}) });
  state.meals = [
    M('Veggie omelette', 320, [eggs, spin, tom, oil], 'Two eggs, a handful of spinach, sliced tomato.'),
    M('Overnight oats', 280, [oats, yog, ban]),
    M('Chicken and rice bowl', 540, [chicken, rice, tom, oil]),
    M('Chickpea salad', 410, [chick, tom, spin, oil], 'Lemon juice and a pinch of salt.'),
    M('Banana yogurt', 150, [yog, ban]),
  ];
  commit(); toast('Sample data loaded');
}
async function eraseAll() {
  const ok = await confirmSheet({ title: 'Erase all data?', confirmLabel: 'Erase everything', danger: true,
    message: 'This permanently deletes your pantry, meals, plans and settings from this device. Export a backup first if you might want it back.' });
  if (!ok) return;
  state = blank(); ui.mealQ = ''; ui.pantryQ = ''; ui.mealCan = false; commit(); toast('All data erased');
}

async function exportBackup() {
  const name = `healthy-eating-backup-${ymd(new Date())}.json`;
  const json = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Healthy Eating backup' });
      toast('Backup ready'); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; /* otherwise fall back to download */ }
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: name, style: 'display:none' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup downloaded');
  } catch (e) { messageSheet('Could not export', 'Your browser blocked the download. Please try again.'); }
}
async function importFile(input) {
  const file = input.files && input.files[0]; input.value = '';
  if (!file) return;
  let parsed;
  try {
    const text = file.text ? await file.text() : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
    parsed = normalize(JSON.parse(text));
  } catch (e) {
    return messageSheet('Can’t import that file', e instanceof SyntaxError ? 'The file is not valid JSON.' : e.message);
  }
  const entries = Object.keys(parsed.weeks).reduce((a, k) => a + weekEntryCount(k), 0);
  const ok = await confirmSheet({ title: 'Replace all data?', confirmLabel: 'Replace', danger: true,
    message: `This backup has ${parsed.pantry.length} pantry items, ${parsed.meals.length} meals and ${entries} planned entries. Importing replaces everything currently in the app.` });
  if (!ok) return;
  state = parsed; ui.week = mondayOf(today()); ui.day = today(); commit(); toast('Backup imported');
}

/* ---------- shell ---------- */
const views = { plan: viewPlan, meals: viewMeals, pantry: viewPantry, shopping: viewShopping, settings: viewSettings };
function render() {
  const view = document.getElementById('view');
  view.replaceChildren(views[ui.tab]());
  document.querySelectorAll('#tabbar button').forEach((b) => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const n = outItems().length, badge = document.getElementById('badge');
  badge.hidden = n === 0; badge.textContent = n > 99 ? '99+' : String(n);
  document.querySelector('#tabbar [data-tab="shopping"]').setAttribute('aria-label', n ? `Shopping, ${n} to buy` : 'Shopping');
}
document.getElementById('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  if (ui.tab !== b.dataset.tab) { ui.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }
  else window.scrollTo({ top: 0, behavior: 'smooth' });
});

load();
render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ }); });
}
})();
