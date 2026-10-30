/* Healthy Eating - vanilla JS PWA. No dependencies.
   The only network use is the optional "Find calories" lookup (Open Food Facts + USDA FoodData Central). */
(() => {
'use strict';

const VERSION = '1.1.0';
const KEY = 'healthyEating.v1'; // storage key is unchanged so existing data is found and migrated in place
const SCHEMA = 2;
const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const SLOT_LABEL = Object.fromEntries(SLOTS);
const LOOKUP_TIMEOUT = 8000;

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
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (n) => Math.round(n * 10) / 10;
const fmtKcal = (k, est) => (k == null ? 'kcal ?' : `${est ? '≈ ' : ''}${fmt(k)} kcal`);

/* 0.25 steps shown as ¼ ½ ¾ */
function servingsLabel(n) {
  const q = Math.round(n * 4) / 4;
  if (Math.abs(q - n) > 1e-9) return String(+n.toFixed(2));
  const whole = Math.floor(q), frac = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[q - whole];
  return whole > 0 ? `${whole}${frac}` : (frac || '0');
}

const ICONS = {
  left: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  right: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
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

/* ---------- state, migration & storage ---------- */
const blank = () => ({ schemaVersion: SCHEMA, pantry: [], foods: [], weeks: {}, settings: { dailyGoal: null, seededFoodsV1: false } });
let state = blank();
let storageOk = true;
let storageNote = '';
const memStore = {}; // keeps the app usable if localStorage is unavailable

function unwrap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This is not a Healthy Eating backup.');
  if (!Array.isArray(raw.pantry) && raw.data && typeof raw.data === 'object') return raw.data;
  return raw;
}
const schemaOf = (s) => (typeof s.schemaVersion === 'number' ? s.schemaVersion : 1);

/* v1 -> v2: meals become foods (serving "1 serving", no components), plan entries get servings 1 and foodId. Never drops data. */
function migrate(raw) {
  const s = unwrap(raw);
  const v = schemaOf(s);
  if (v > SCHEMA) throw new Error('This backup was made by a newer version of the app.');
  if (v >= 2) return s;
  const out = { ...s, schemaVersion: 2 };
  if (Array.isArray(s.meals)) {
    out.foods = s.meals.map((m) => (m && typeof m === 'object'
      ? { id: m.id, name: m.name, serving: '1 serving', calories: m.calories, estimate: false,
          notes: typeof m.notes === 'string' ? m.notes : '', components: [], pantryIds: Array.isArray(m.ingredientIds) ? m.ingredientIds : [] }
      : m));
  }
  delete out.meals;
  const migrateEntry = (e) => { const n = { ...e, servings: 1 }; if ('mealId' in n) { n.foodId = n.mealId; delete n.mealId; } return n; };
  if (s.weeks && typeof s.weeks === 'object' && !Array.isArray(s.weeks)) {
    out.weeks = {};
    for (const [wk, week] of Object.entries(s.weeks)) {
      if (!week || typeof week !== 'object' || !week.days || typeof week.days !== 'object') { out.weeks[wk] = week; continue; }
      const days = {};
      for (const [date, slots] of Object.entries(week.days)) {
        if (!slots || typeof slots !== 'object') { days[date] = slots; continue; }
        const ns = {};
        for (const [slot, list] of Object.entries(slots)) ns[slot] = Array.isArray(list) ? list.map((e) => (e && typeof e === 'object' ? migrateEntry(e) : e)) : list;
        days[date] = ns;
      }
      out.weeks[wk] = { ...week, days };
    }
  }
  return out;
}

function normalize(raw) {
  const src = migrate(raw);
  if (!Array.isArray(src.pantry)) throw new Error('The pantry list is missing.');
  if (!Array.isArray(src.foods)) throw new Error('The foods list is missing.');
  if (!src.weeks || typeof src.weeks !== 'object' || Array.isArray(src.weeks)) throw new Error('The weekly plan is missing.');
  const out = blank();
  const pantryIds = new Set();
  src.pantry.forEach((p, i) => {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()) throw new Error(`Pantry item ${i + 1} is not valid.`);
    const id = typeof p.id === 'string' && p.id && !pantryIds.has(p.id) ? p.id : uid();
    pantryIds.add(id);
    out.pantry.push({ id, name: p.name.trim(), category: typeof p.category === 'string' ? p.category.trim() : '', status: p.status === 'out' ? 'out' : 'have' });
  });
  const foodIds = new Set();
  const calOrNull = (v, label) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} has invalid calories.`);
    return n;
  };
  src.foods.forEach((f, i) => {
    if (!f || typeof f !== 'object' || typeof f.name !== 'string' || !f.name.trim()) throw new Error(`Food ${i + 1} is not valid.`);
    const cal = calOrNull(f.calories, `Food "${f.name}"`);
    const id = typeof f.id === 'string' && f.id && !foodIds.has(f.id) ? f.id : uid();
    foodIds.add(id);
    const compIds = new Set();
    const components = (Array.isArray(f.components) ? f.components : []).map((c, j) => {
      if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim()) throw new Error(`An ingredient of "${f.name}" is not valid.`);
      const cid = typeof c.id === 'string' && c.id && !compIds.has(c.id) ? c.id : uid();
      compIds.add(cid);
      return { id: cid, name: c.name.trim(), amount: typeof c.amount === 'string' ? c.amount.trim() : '',
        calories: calOrNull(c.calories, `Ingredient "${c.name}"`), pantryId: typeof c.pantryId === 'string' && pantryIds.has(c.pantryId) ? c.pantryId : null };
    });
    out.foods.push({ id, name: f.name.trim(), serving: typeof f.serving === 'string' && f.serving.trim() ? f.serving.trim() : '1 serving',
      calories: cal, estimate: f.estimate === true, notes: typeof f.notes === 'string' ? f.notes.trim() : '', components,
      pantryIds: Array.isArray(f.pantryIds) ? [...new Set(f.pantryIds.filter((x) => pantryIds.has(x)))] : [] });
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
          const sv = Number(e.servings);
          const entry = { id, eaten: e.eaten === true, servings: Number.isFinite(sv) && sv > 0 ? sv : 1 };
          if (typeof e.foodId === 'string' && foodIds.has(e.foodId)) entry.foodId = e.foodId;
          else if (typeof e.customName === 'string' && e.customName.trim()) {
            entry.customName = e.customName.trim();
            entry.customCalories = Number.isFinite(Number(e.customCalories)) ? Math.max(0, Number(e.customCalories)) : 0;
          } else continue; // refers to a food that does not exist; skip it
          if (typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time)) entry.time = e.time;
          const mon = mondayOf(date);
          const w = out.weeks[mon] || (out.weeks[mon] = { days: {} });
          const d = w.days[date] || (w.days[date] = {});
          (d[slot] || (d[slot] = [])).push(entry);
        }
      }
    }
  }
  const st = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const g = Number(st.dailyGoal);
  out.settings.dailyGoal = st.dailyGoal != null && Number.isFinite(g) && g > 0 ? g : null;
  out.settings.seededFoodsV1 = st.seededFoodsV1 === true;
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
  try {
    const parsed = JSON.parse(raw);
    const migrating = schemaOf(unwrap(parsed)) < 2;
    state = normalize(parsed);
    if (migrating) {
      // keep the untouched v1 copy once, then store the migrated data
      try { if (!localStorage.getItem(KEY + '.preV2')) localStorage.setItem(KEY + '.preV2', raw); } catch (_) { /* ignore */ }
      save();
    }
  } catch (e) {
    storageNote = 'Your saved data could not be read, so the app started empty. The unreadable copy was kept aside.';
    try { localStorage.setItem(KEY + '.unreadable', raw); } catch (_) { /* ignore */ }
    state = blank();
  }
}
function save() {
  const json = JSON.stringify(state);
  memStore[KEY] = json;
  try { localStorage.setItem(KEY, json); }
  catch (e) { if (storageOk) storageNote = 'Storage is full or unavailable, so changes may not be kept. Export a backup from Settings.'; storageOk = false; }
}

/* ---------- selectors ---------- */
const pantryById = (id) => state.pantry.find((p) => p.id === id);
const foodById = (id) => state.foods.find((f) => f.id === id);
const outItems = () => state.pantry.filter((p) => p.status === 'out');
const findFoodByName = (n) => state.foods.find((f) => f.name.toLowerCase() === n.trim().toLowerCase());

/* calories per ONE serving: sum of components when every component has a number, else the manual value */
function compsTotal(comps) {
  if (!comps || !comps.length || comps.some((c) => !isNum(c.calories))) return null;
  return comps.reduce((a, c) => a + c.calories, 0);
}
function foodKcal(f) { const t = compsTotal(f.components); return t != null ? t : (isNum(f.calories) ? f.calories : null); }
const allPantryIds = (f) => [...new Set([...f.pantryIds, ...f.components.map((c) => c.pantryId).filter(Boolean)])];
function foodStatus(f) {
  const missing = allPantryIds(f).map(pantryById).filter((p) => p && p.status === 'out').map((p) => p.name).sort((a, b) => a.localeCompare(b));
  return { ok: missing.length === 0, missing };
}
const foodsUsing = (pid) => state.foods.filter((f) => allPantryIds(f).includes(pid)).sort(byName);

function entryInfo(e) {
  const sv = isNum(e.servings) && e.servings > 0 ? e.servings : 1;
  if (e.foodId) {
    const f = foodById(e.foodId);
    if (!f) return { name: 'Removed food', cal: 0, unknown: false, est: false, sv, serving: '', custom: false };
    const k = foodKcal(f);
    return { name: f.name, cal: k == null ? 0 : Math.round(k * sv), unknown: k == null, est: f.estimate, sv, serving: f.serving, custom: false };
  }
  return { name: e.customName || 'Something else', cal: Math.round((e.customCalories || 0) * sv), unknown: false, est: false, sv, serving: '', custom: true };
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
  let planned = 0, eaten = 0, unknown = 0;
  for (const [s] of SLOTS) for (const e of entriesOf(date, s)) {
    const i = entryInfo(e); planned += i.cal; if (e.eaten) eaten += i.cal; if (i.unknown) unknown++;
  }
  return { planned, eaten, unknown };
}
function weekEntryCount(mon) {
  const w = state.weeks[mon]; if (!w) return 0;
  let n = 0;
  for (const d of Object.values(w.days)) for (const l of Object.values(d)) n += l.length;
  return n;
}

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
const ui = { tab: 'plan', week: mondayOf(today()), day: today(), foodQ: '', foodCan: false, pantryQ: '' };

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
  state.foods.forEach((f) => {
    f.pantryIds = f.pantryIds.filter((x) => x !== item.id);
    f.components.forEach((c) => { if (c.pantryId === item.id) c.pantryId = null; });
  });
  commit();
}
function deleteFood(food) {
  // keep history readable: planned entries become custom entries (servings kept)
  const k = foodKcal(food);
  for (const w of Object.values(state.weeks)) for (const d of Object.values(w.days)) for (const l of Object.values(d)) for (const e of l) {
    if (e.foodId === food.id) { e.customName = food.name; e.customCalories = k == null ? 0 : k; delete e.foodId; }
  }
  state.foods = state.foods.filter((f) => f.id !== food.id);
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
      const c = { ...e, id: uid(), eaten: false }; // servings are carried over by the spread
      slotArr(nd, slot, true).push(c); n++;
    }
  }
  commit();
  toast(n ? `Copied ${n} ${n === 1 ? 'entry' : 'entries'} from last week` : 'Last week has nothing to copy');
}

/* ---------- starter foods ---------- */
function mergeSeed() {
  const S = window.SEED_FOODS;
  const res = { pantry: 0, foods: 0 };
  if (!S) return res;
  for (const p of S.pantry || []) {
    if (!p || !p.name || findPantryByName(p.name)) continue;
    addPantryItem(p.name, p.category || '', 'have'); res.pantry++;
  }
  const pid = (name) => { const p = name ? findPantryByName(name) : null; return p ? p.id : null; };
  for (const f of S.foods || []) {
    if (!f || !f.name || findFoodByName(f.name)) continue;
    const components = (f.components || []).map((c) => ({ id: uid(), name: c.name, amount: c.amount || '',
      calories: isNum(c.calories) ? c.calories : null, pantryId: pid(c.pantry) }));
    const total = compsTotal(components);
    state.foods.push({ id: uid(), name: f.name, serving: f.serving || '1 serving',
      calories: total != null ? total : (isNum(f.calories) ? f.calories : null),
      estimate: f.estimate === true, notes: f.notes || '', components,
      pantryIds: [...new Set((f.pantry || []).map(pid).filter(Boolean))] });
    res.foods++;
  }
  return res;
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
/* "Find calories now?" -> 'find' | 'skip' | null (dismissed) */
function askFindSheet() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const api = openSheet('Find calories now?',
      h('p', { style: 'color:var(--muted)' }, 'This food has no calories yet. I can look them up, or you can save it now and add them later.'),
      [h('button', { class: 'btn secondary', type: 'button', onClick: () => { finish('skip'); api.close(); } }, 'Save without'),
       h('button', { class: 'btn', type: 'button', onClick: () => { finish('find'); api.close(); } }, 'Yes, find')]);
    api.onClose = () => finish(null);
  });
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
function foodFlag(f) {
  const s = foodStatus(f);
  return s.ok ? h('span', { class: 'tag ok' }, 'Can make') : h('span', { class: 'tag warn' }, 'Missing: ' + s.missing.join(', '));
}
function storageBanner() {
  return (!storageOk || storageNote) ? h('div', { class: 'warn-banner', role: 'alert' }, storageNote || 'Storage is unavailable.') : null;
}
function emptyState(title, text) { return h('div', { class: 'empty card' }, h('strong', null, title), text); }

/* amount stepper: chips plus -/+ in 0.25 steps, min 0.25 */
function stepper(initial, onChange) {
  let val = Math.max(0.25, Math.round((initial || 1) * 4) / 4);
  const out = h('output', { 'aria-live': 'polite', 'aria-label': 'Amount in servings' });
  const chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Quick amounts' });
  const minus = h('button', { type: 'button', 'aria-label': 'Less', onClick: () => set(val - 0.25) }, icon('minus'));
  const plus = h('button', { type: 'button', 'aria-label': 'More', onClick: () => set(val + 0.25) }, icon('plus'));
  const quick = [0.5, 1, 1.5, 2];
  const draw = () => {
    out.textContent = servingsLabel(val);
    minus.disabled = val <= 0.25;
    chipsEl.replaceChildren(...quick.map((q) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(q === val), onClick: () => set(q) }, servingsLabel(q))));
  };
  const set = (v) => { val = Math.min(99, Math.max(0.25, Math.round(v * 4) / 4)); draw(); if (onChange) onChange(val); };
  draw();
  const el = h('div', { class: 'stepper' }, chipsEl, h('div', { class: 'step-ctl' }, minus, out, plus));
  return { el, get: () => val };
}

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
  if (tot.unknown) summary.append(h('p', { class: 'note-line', id: 'unknown-note' }, `${tot.unknown} ${tot.unknown === 1 ? 'food' : 'foods'} without calories (counted as 0)`));
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
    const sec = h('section', { 'aria-label': label, 'data-slot': slot });
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
  const amount = info.custom
    ? (info.sv !== 1 ? `${servingsLabel(info.sv)} ×` : null)
    : `${servingsLabel(info.sv)} × ${info.serving}`;
  const meta = [amount, info.unknown ? 'kcal ?' : `${info.est ? '≈ ' : ''}${fmt(info.cal)} kcal`, e.time ? fmtTime(e.time) : null, info.custom ? 'Custom' : null].filter(Boolean).join(' · ');
  const check = h('button', { class: 'circle', type: 'button', role: 'checkbox', 'aria-checked': String(e.eaten), 'aria-label': `Ate ${info.name}`,
    onClick: () => { e.eaten = !e.eaten; commit(); } }, h('i', null, icon('check')));
  return h('div', { class: 'row entry' }, check,
    h('div', { class: 'grow' }, h('div', { class: 'name' + (e.eaten ? ' done' : '') }, info.name), h('div', { class: 'meta' }, meta)),
    iconBtn('swap', `Edit ${info.name}`, () => entrySheet({ date, slot, entry: e })),
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
    } }, h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Copy last week’s plan'), h('div', { class: 'meta' }, 'Adds last week’s entries here (amounts kept), with eaten ticks cleared'))),
    h('button', { class: 'row', type: 'button', onClick: () => { api.close(); ui.week = mondayOf(today()); ui.day = today(); render(); } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Jump to today')))));
}

/* add / edit an entry in a slot */
function entrySheet({ date, slot, entry }) {
  const editing = !!entry;
  let mode = entry && !entry.foodId ? 'custom' : 'foods';
  let sel = entry && entry.foodId ? entry.foodId : null;
  let q = '';
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const preview = h('div', { class: 'preview', id: 'entry-preview', hidden: true });
  const step = stepper(entry && entry.servings > 0 ? entry.servings : 1, () => updatePreview());

  const updatePreview = () => {
    const sv = step.get();
    let text = '';
    if (mode === 'foods') {
      const f = sel ? foodById(sel) : null;
      if (f) { const k = foodKcal(f); text = `${servingsLabel(sv)} × ${f.serving} = ${k == null ? 'kcal ?' : fmt(k * sv) + ' kcal'}`; }
    } else {
      const c = Number(calIn.value);
      if (calIn.value.trim() !== '' && Number.isFinite(c) && c >= 0) text = `${servingsLabel(sv)} × ${fmt(c)} kcal = ${fmt(c * sv)} kcal`;
    }
    preview.textContent = text; preview.hidden = !text;
  };

  const list = h('div', { class: 'card pick-list' });
  const drawList = () => {
    const needle = q.trim().toLowerCase();
    const fs = state.foods.filter((f) => f.name.toLowerCase().includes(needle)).sort((a, b) => (foodStatus(b).ok - foodStatus(a).ok) || byName(a, b));
    if (!state.foods.length) { list.replaceChildren(h('div', { class: 'slot-empty' }, 'No foods yet. Use the Custom tab, or add foods in the Foods tab.')); return; }
    if (!fs.length) { list.replaceChildren(h('div', { class: 'slot-empty' }, 'No foods match.')); return; }
    list.replaceChildren(...fs.map((f) => h('button', { class: 'row pick-row', type: 'button', role: 'radio', 'aria-checked': String(sel === f.id),
      onClick: () => { sel = f.id; showErr(''); drawList(); updatePreview(); } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'sv' }, f.serving), foodFlag(f)),
      h('span', { class: 'kcal' }, fmtKcal(foodKcal(f), f.estimate)),
      h('span', { class: 'circle', style: 'width:32px' }, h('i', { style: sel === f.id ? 'background:var(--accent);border-color:var(--accent);color:var(--accent-ink)' : '' }, icon('check'))))));
  };
  const foodsPane = h('div', { class: 'stack' },
    searchBox('', 'Search foods', (v) => { q = v; drawList(); }), list);
  const cInfo = entry && !entry.foodId ? { name: entry.customName || '', cal: entry.customCalories || 0 } : null;
  const nameIn = textInput({ value: cInfo ? cInfo.name : '', placeholder: 'e.g. Sandwich from the cafe', 'aria-label': 'Custom food name', autocapitalize: 'sentences' });
  const calIn = numInput({ value: cInfo ? String(cInfo.cal) : '', placeholder: 'e.g. 450', 'aria-label': 'Custom calories', onInput: () => updatePreview() });
  const customPane = h('div', { class: 'stack' },
    field(editing ? 'What I actually had' : 'Name', nameIn), field('Calories (for 1 serving)', calIn));
  const timeIn = h('input', { class: 'input', type: 'time', value: entry && entry.time ? entry.time : '', 'aria-label': 'Time (optional)' });

  const panes = h('div');
  const showPane = () => { panes.replaceChildren(mode === 'foods' ? foodsPane : customPane); showErr(''); updatePreview(); };
  const seg = segmented([['foods', 'From foods'], ['custom', 'Custom']], mode, (v) => { mode = v; showPane(); });
  showPane(); drawList();

  const save_ = () => {
    let data;
    const servings = step.get();
    if (mode === 'foods') {
      if (!sel) return showErr('Pick a food first, or use the Custom tab.');
      data = { foodId: sel, servings };
    } else {
      const name = nameIn.value.trim(), cal = Number(calIn.value);
      if (!name) return showErr('Please enter a name.');
      if (calIn.value.trim() === '' || !Number.isFinite(cal) || cal < 0) return showErr('Please enter calories (0 or more).');
      data = { customName: name, customCalories: cal, servings };
    }
    const time = timeIn.value || '';
    if (editing) {
      delete entry.foodId; delete entry.customName; delete entry.customCalories;
      Object.assign(entry, data);
      if (time) entry.time = time; else delete entry.time;
    } else addEntry(date, slot, data, time);
    api.close(); commit();
  };
  const api = openSheet(editing ? 'Edit entry' : `Add to ${SLOT_LABEL[slot]}`,
    [seg, panes, h('div', { class: 'field' }, h('span', null, 'Amount (servings)'), step.el), preview, field('Time (optional)', timeIn), err],
    h('button', { class: 'btn', type: 'button', onClick: save_ }, editing ? 'Save' : 'Add'));
}

/* food -> pick day + slot + amount */
function addToPlanSheet(food) {
  let date = isDate(ui.day) ? ui.day : today(), slot = 'dinner';
  const dateIn = h('input', { class: 'input', type: 'date', value: date, 'aria-label': 'Day' });
  const timeIn = h('input', { class: 'input', type: 'time', 'aria-label': 'Time (optional)' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const seg = segmented(SLOTS, slot, (v) => { slot = v; });
  const preview = h('div', { class: 'preview', id: 'entry-preview' });
  const upd = () => { const sv = step.get(), k = foodKcal(food); preview.textContent = `${servingsLabel(sv)} × ${food.serving} = ${k == null ? 'kcal ?' : fmt(k * sv) + ' kcal'}`; };
  const step = stepper(1, upd);
  upd();
  const go = () => {
    if (!isDate(dateIn.value)) { err.textContent = 'Please choose a day.'; err.hidden = false; return; }
    date = dateIn.value;
    addEntry(date, slot, { foodId: food.id, servings: step.get() }, timeIn.value);
    api.close(); save(); render();
    toast(`Added to ${SLOT_LABEL[slot]}, ${fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}`, {
      action: 'View', onAction: () => { ui.tab = 'plan'; ui.week = mondayOf(date); ui.day = date; render(); window.scrollTo(0, 0); } });
  };
  const api = openSheet('Add to plan', [
    h('p', null, h('strong', null, food.name), ` · ${food.serving} · ${fmtKcal(foodKcal(food), food.estimate)}`),
    field('Day', dateIn), h('div', { class: 'field' }, h('span', null, 'Meal slot'), seg),
    h('div', { class: 'field' }, h('span', null, 'Amount (servings)'), step.el), preview,
    field('Time (optional)', timeIn), err],
    h('button', { class: 'btn', type: 'button', onClick: go }, 'Add to plan'));
}

/* ---------- FOODS ---------- */
function viewFoods() {
  const root = h('div', { class: 'view' });
  const list = h('div');
  const draw = () => {
    const needle = ui.foodQ.trim().toLowerCase();
    let fs = state.foods.filter((f) => f.name.toLowerCase().includes(needle));
    if (ui.foodCan) fs = fs.filter((f) => foodStatus(f).ok);
    fs.sort(byName);
    if (!state.foods.length) return list.replaceChildren(emptyState('No foods yet', 'Tap + to add your first food, or add your starter foods in Settings.'));
    if (!fs.length) return list.replaceChildren(emptyState(ui.foodCan && !needle ? 'Nothing you can make right now' : 'No matches', ui.foodCan ? 'Check the Shopping tab for what you are out of.' : 'Try a different search.'));
    list.replaceChildren(h('div', { class: 'card' }, fs.map((f) => {
      const k = foodKcal(f);
      return h('button', { class: 'row food-row', type: 'button', onClick: () => foodDetail(f) },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'sv' }, f.serving), foodFlag(f)),
        h('span', { class: 'kcal' + (k == null ? ' unk' : '') }, fmtKcal(k, f.estimate)));
    })));
  };
  const chip = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ui.foodCan), onClick: () => { ui.foodCan = !ui.foodCan; chip.setAttribute('aria-pressed', String(ui.foodCan)); draw(); } }, 'Can make now');
  put(root, storageBanner(),
    h('header', { class: 'top' }, h('h1', null, 'Foods'), iconBtn('plus', 'Add food', () => foodSheet())),
    searchBox(ui.foodQ, 'Search foods', (v) => { ui.foodQ = v; draw(); }),
    h('div', { class: 'chips' }, chip), list);
  draw(); return root;
}

function foodDetail(food) {
  const k = foodKcal(food);
  const pantry = allPantryIds(food).map(pantryById).filter(Boolean).sort(byName);
  const body = [
    h('div', null, h('div', { class: 'big-kcal' }, fmtKcal(k, food.estimate)),
      h('div', { class: 'sv' }, `per ${food.serving}`),
      h('div', { class: 'chip-row' }, foodFlag(food), food.estimate ? h('span', { class: 'tag est' }, '≈ estimate') : null)),
    food.components.length ? h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Ingredients & amounts'),
      h('div', { class: 'card' }, food.components.map((c) => h('div', { class: 'row ing-row' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, c.name), c.amount ? h('div', { class: 'amt' }, c.amount) : null),
        h('span', { class: 'kcal' + (c.calories == null ? ' unk' : '') }, c.calories == null ? 'kcal ?' : `${fmt(c.calories)} kcal`))))) : null,
    h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Pantry items'),
      pantry.length ? h('div', { class: 'card' }, pantry.map((p) => h('div', { class: 'row' },
        h('div', { class: 'grow name' }, p.name), h('span', { class: 'tag ' + (p.status === 'have' ? 'ok' : 'warn'), style: 'margin:0' }, p.status === 'have' ? 'Have' : 'Out'))))
        : h('p', { class: 'sub' }, 'No linked pantry items.')),
    food.notes ? h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Notes'), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, food.notes)) : null,
    h('div', { class: 'form-row' },
      h('button', { class: 'btn secondary', type: 'button', onClick: () => { api.close(); foodSheet(food); } }, 'Edit'),
      h('button', { class: 'btn danger', type: 'button', onClick: async () => {
        const ok = await confirmSheet({ title: 'Delete food?', confirmLabel: 'Delete', danger: true,
          message: `“${food.name}” will be removed. Any plan entries using it stay in your plan as custom entries.` });
        if (ok) { api.close(); deleteFood(food); toast('Food deleted'); }
      } }, 'Delete')),
  ];
  const api = openSheet(food.name, body, h('button', { class: 'btn', type: 'button', onClick: () => { api.close(); addToPlanSheet(food); } }, 'Add to plan'));
}

function foodSheet(food) {
  const editing = !!food;
  const chosen = new Set(food ? food.pantryIds : []);
  let q = '';
  let estimate = food ? food.estimate : false;
  const nameIn = textInput({ value: food ? food.name : '', placeholder: 'e.g. Banana or Smoothie', 'aria-label': 'Food name', autocapitalize: 'sentences' });
  const servingIn = textInput({ value: food ? food.serving : '', placeholder: 'e.g. 1 medium, 1 cup cooked, 1 sandwich', 'aria-label': 'Serving description', autocapitalize: 'none' });
  const calIn = numInput({ value: food && food.calories != null ? String(food.calories) : '', placeholder: 'e.g. 350', 'aria-label': 'Calories per serving' });
  const notesIn = h('textarea', { class: 'input', placeholder: 'Optional notes or recipe link', 'aria-label': 'Notes', value: food ? food.notes : '' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const showErr = (m, el) => { err.textContent = m; err.hidden = !m; if (el) el.focus(); };
  const setNote = (source) => { if (!notesIn.value.trim()) notesIn.value = `Calories from ${source}.`; };

  /* calories + find */
  const findCal = h('button', { class: 'btn tonal', type: 'button', 'aria-label': 'Find calories for this food',
    onClick: () => lookupSheet({ query: nameIn.value, onUse: (r) => {
      calIn.value = String(r.kcal); if (!servingIn.value.trim()) servingIn.value = r.amountText; setNote(r.source); refresh();
    } }) }, icon('search'), 'Find calories');
  const calHint = h('p', { class: 'hint' });

  /* ingredient rows */
  const rows = [];
  const compsWrap = h('div', { class: 'stack' });
  const totalBox = h('div', { class: 'total-line', id: 'comp-total', hidden: true });
  const rowKcal = (r) => { const v = r.kcalIn.value.trim(); if (v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const rowBlank = (r) => !r.nameIn.value.trim() && !r.amtIn.value.trim() && !r.kcalIn.value.trim();
  function refresh() {
    const have = rows.filter((r) => !rowBlank(r));
    const nums = have.map(rowKcal);
    const auto = have.length > 0 && nums.every((n) => n != null);
    const sum = nums.reduce((a, n) => a + (n || 0), 0);
    const missing = nums.filter((n) => n == null).length;
    totalBox.hidden = !have.length;
    totalBox.replaceChildren(h('span', null, auto ? 'Total per serving' : `Total so far (${missing} without kcal)`), h('b', null, `${fmt(sum)} kcal`));
    calIn.disabled = auto;
    if (auto) calIn.value = String(round1(sum));
    findCal.hidden = auto;
    calHint.textContent = auto ? 'Calculated from the ingredients below.' : (have.length ? 'Add kcal to every ingredient to total them automatically, or type the calories here.' : '');
    calHint.hidden = !calHint.textContent;
  }
  function makeRow(c) {
    const r = { id: c ? c.id : uid() };
    r.nameIn = textInput({ value: c ? c.name : '', placeholder: 'Ingredient, e.g. Banana', 'aria-label': 'Ingredient name', autocapitalize: 'sentences', onInput: refresh });
    r.amtIn = textInput({ value: c ? c.amount : '', placeholder: 'Amount, e.g. 2 slices', 'aria-label': 'Ingredient amount', autocapitalize: 'none' });
    r.kcalIn = numInput({ value: c && c.calories != null ? String(c.calories) : '', placeholder: 'kcal', 'aria-label': 'Ingredient kcal', onInput: refresh });
    r.sel = h('select', { class: 'input', 'aria-label': 'Linked pantry item' },
      h('option', { value: '' }, 'Not linked to a pantry item'),
      state.pantry.slice().sort(byName).map((p) => h('option', { value: p.id }, p.name)));
    r.sel.value = c && c.pantryId && pantryById(c.pantryId) ? c.pantryId : '';
    const find = h('button', { class: 'btn tonal', type: 'button', 'aria-label': 'Find calories for this ingredient',
      onClick: () => lookupSheet({ query: r.nameIn.value, onUse: (x) => {
        r.kcalIn.value = String(x.kcal); if (!r.amtIn.value.trim()) r.amtIn.value = x.amountText;
        if (!r.nameIn.value.trim()) r.nameIn.value = x.name;
        setNote(x.source); refresh();
      } }) }, icon('search'));
    r.el = h('div', { class: 'comp' },
      h('div', { class: 'r1' }, r.nameIn, iconBtn('trash', 'Remove ingredient', () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); refresh(); }, 'muted')),
      h('div', { class: 'r2' }, r.amtIn, r.kcalIn, find),
      r.sel);
    return r;
  }
  const addRow = (c) => { const r = makeRow(c); rows.push(r); compsWrap.append(r.el); return r; };
  (food ? food.components : []).forEach((c) => addRow(c));

  /* linked pantry items */
  const count = h('span', { class: 'sub' });
  const plist = h('div', { class: 'card pick-list' });
  const draw = () => {
    const needle = q.trim().toLowerCase();
    const items = state.pantry.filter((p) => p.name.toLowerCase().includes(needle)).sort(byName);
    const prow = items.map((p) => h('button', { class: 'row pick-row', type: 'button', role: 'checkbox', 'aria-checked': String(chosen.has(p.id)),
      onClick: () => { chosen.has(p.id) ? chosen.delete(p.id) : chosen.add(p.id); draw(); } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name), p.category || p.status === 'out' ? h('div', { class: 'meta' }, [p.category, p.status === 'out' ? 'Out' : null].filter(Boolean).join(' · ')) : null),
      h('span', { class: 'circle', 'aria-hidden': 'true', style: 'width:32px' }, h('i', { style: chosen.has(p.id) ? 'background:var(--accent);border-color:var(--accent);color:var(--accent-ink)' : '' }, icon('check')))));
    const trimmed = q.trim();
    if (trimmed && !findPantryByName(trimmed)) {
      prow.push(h('button', { class: 'row', type: 'button', style: 'color:var(--accent-text)', onClick: () => {
        const it = addPantryItem(trimmed, '', 'have'); chosen.add(it.id); q = ''; searchInput.value = ''; save(); draw(); render();
      } }, h('div', { class: 'grow name' }, `+ Add “${trimmed}” as a new pantry item`)));
    }
    if (!prow.length) prow.push(h('div', { class: 'slot-empty' }, 'Your pantry is empty. Type a name above to add an item.'));
    plist.replaceChildren(...prow);
    count.textContent = `${chosen.size} selected`;
  };
  const search = searchBox('', 'Search or add pantry items', (v) => { q = v; draw(); });
  const searchInput = search.querySelector('input');
  draw(); refresh();

  const estSeg = segmented([['exact', 'Exact'], ['est', '≈ Estimate']], estimate ? 'est' : 'exact', (v) => { estimate = v === 'est'; });

  const submit = async () => {
    const name = nameIn.value.trim();
    if (!name) return showErr('Please enter a food name.', nameIn);
    const serving = servingIn.value.trim() || '1 serving';
    const comps = [];
    for (const r of rows) {
      if (rowBlank(r)) continue;
      const cn = r.nameIn.value.trim();
      if (!cn) return showErr('Give each ingredient a name (or remove the empty row).', r.nameIn);
      const raw = r.kcalIn.value.trim();
      if (raw !== '' && rowKcal(r) == null) return showErr(`Ingredient “${cn}” needs kcal as a number (0 or more), or leave it empty.`, r.kcalIn);
      comps.push({ id: r.id, name: cn, amount: r.amtIn.value.trim(), calories: rowKcal(r), pantryId: r.sel.value && pantryById(r.sel.value) ? r.sel.value : null });
    }
    const total = compsTotal(comps);
    let cal;
    if (total != null) cal = round1(total);
    else if (calIn.value.trim() === '') cal = null;
    else {
      cal = Number(calIn.value);
      if (!Number.isFinite(cal) || cal < 0) return showErr('Calories must be a number, 0 or more.', calIn);
    }
    if (cal == null) {
      const choice = await askFindSheet();
      if (choice === null) return; // dismissed: stay in the editor
      if (choice === 'find') {
        lookupSheet({ query: name, onUse: (r) => {
          calIn.value = String(r.kcal); if (!servingIn.value.trim()) servingIn.value = r.amountText; setNote(r.source); refresh(); submit();
        } });
        return;
      }
    }
    const data = { name, serving, calories: cal, estimate, notes: notesIn.value.trim(), components: comps, pantryIds: [...chosen].filter(pantryById) };
    if (editing) Object.assign(food, data); else state.foods.push({ id: uid(), ...data });
    api.close(); commit(); toast(editing ? 'Food saved' : 'Food added');
  };
  const api = openSheet(editing ? 'Edit food' : 'New food', [
    field('Name', nameIn),
    field('Serving', servingIn),
    h('div', { class: 'field' }, h('span', null, 'Calories per serving'), h('div', { class: 'form-row cal-row' }, calIn, findCal), calHint),
    h('div', { class: 'field' }, h('span', null, 'Accuracy'), estSeg),
    h('div', { class: 'field' }, h('span', null, 'Ingredients & amounts (optional)'),
      h('div', { class: 'stack' }, compsWrap, totalBox,
        h('button', { class: 'btn tonal block', type: 'button', onClick: () => { const r = addRow(); refresh(); r.nameIn.focus(); } }, '+ Add ingredient'))),
    h('div', { class: 'field' }, h('span', null, 'Linked pantry items (for “Can make”)'), h('div', { class: 'stack' }, search, plist, count)),
    field('Notes', notesIn), err],
    [h('button', { class: 'btn secondary', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn', type: 'button', onClick: submit }, 'Save')]);
}

/* ---------- FIND CALORIES (Open Food Facts + USDA FoodData Central) ---------- */
async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LOOKUP_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}
const kcalNum = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const clip = (s, n = 120) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
function tidy(s) {
  s = clip(s);
  return s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s;
}
function gramsOf(label) { const m = /([\d.]+)\s*(g|ml)\b/i.exec(label || ''); return m ? Number(m[1]) : null; }

async function searchOFF(q) {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(q) +
    '&search_simple=1&action=process&json=1&page_size=12&fields=product_name,brands,serving_size,nutriments';
  const data = await fetchJson(url);
  const out = [];
  for (const p of (data && Array.isArray(data.products) ? data.products : [])) {
    const name = tidy(p && p.product_name); if (!name) continue;
    const nut = (p.nutriments && typeof p.nutriments === 'object') ? p.nutriments : {};
    const ks = kcalNum(nut['energy-kcal_serving']), k100 = kcalNum(nut['energy-kcal_100g']);
    if (ks == null && k100 == null) continue;
    const label = clip(p.serving_size, 40);
    out.push({ source: 'Open Food Facts', sourceKey: 'off', name, brand: clip(String(p.brands || '').split(',')[0], 60),
      kcalServing: ks, servingLabel: label, kcal100: k100 });
  }
  return out;
}
function usdaKcal(nutrients) {
  if (!Array.isArray(nutrients)) return null;
  const kcal = nutrients.filter((n) => n && String(n.unitName).toUpperCase() === 'KCAL');
  const pick = kcal.find((n) => n.nutrientName === 'Energy' || String(n.nutrientNumber) === '208') ||
    kcal.find((n) => ['957', '958'].includes(String(n.nutrientNumber)));
  return pick ? kcalNum(pick.value) : null;
}
async function searchUSDA(q) {
  const url = 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=' + encodeURIComponent(q) +
    '&pageSize=12&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS),Branded';
  const data = await fetchJson(url);
  const out = [];
  for (const f of (data && Array.isArray(data.foods) ? data.foods : [])) {
    const name = tidy(f && f.description); if (!name) continue;
    const k100 = usdaKcal(f.foodNutrients); if (k100 == null) continue;
    let ks = null, label = '';
    const size = Number(f.servingSize), unit = String(f.servingSizeUnit || '').toLowerCase();
    if (Number.isFinite(size) && size > 0 && /^(g|grm|ml|mlt)$/.test(unit)) { ks = k100 * size / 100; label = `${+size.toFixed(1)} ${unit.startsWith('m') ? 'ml' : 'g'}`; }
    out.push({ source: 'USDA', sourceKey: 'usda', name, brand: tidy(f.brandName || f.brandOwner || ''), kcalServing: ks, servingLabel: label, kcal100: k100 });
  }
  return out;
}
function mergeResults(a, b) { // interleave so both sources are visible
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (b[i]) out.push(b[i]); if (a[i]) out.push(a[i]); }
  return out;
}

function lookupSheet({ query, onUse }) {
  let token = 0, closed = false, results = [], statusMsg = '', statusBad = false, busy = false;
  const input = h('input', { class: 'input', type: 'search', value: query || '', placeholder: 'Search a food', 'aria-label': 'Search foods for calories', autocomplete: 'off', autocapitalize: 'none', enterkeyhint: 'search' });
  const form = h('form', { class: 'form-row', onSubmit: (e) => { e.preventDefault(); run(); } },
    h('div', { class: 'search' }, icon('search'), input), h('button', { class: 'btn', type: 'submit' }, 'Search'));
  const status = h('p', { class: 'lk-status', role: 'status' });
  const listEl = h('div', { class: 'card lk-list', id: 'lookup-results', hidden: true });
  const attrib = h('p', { class: 'attrib' }, 'Data: ',
    h('a', { href: 'https://world.openfoodfacts.org', target: '_blank', rel: 'noopener noreferrer' }, 'Open Food Facts'), ' (ODbL) · ',
    h('a', { href: 'https://fdc.nal.usda.gov', target: '_blank', rel: 'noopener noreferrer' }, 'USDA FoodData Central'));
  const searchView = h('div', { class: 'stack' }, form, status, listEl, attrib);
  const api = openSheet('Find calories', searchView);
  api.onClose = () => { closed = true; token++; };

  const basisText = (r) => (r.kcalServing != null ? `per serving${r.servingLabel ? ` (${r.servingLabel})` : ''}` : 'per 100 g');
  const showResults = () => {
    status.textContent = statusMsg; status.className = 'lk-status' + (statusBad ? ' bad' : ''); status.hidden = !statusMsg;
    listEl.hidden = !results.length;
    listEl.replaceChildren(...results.map((r) => h('button', { class: 'row', type: 'button', onClick: () => showPick(r) },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, r.name),
        h('div', { class: 'meta' }, h('span', { class: 'src ' + r.sourceKey }, r.source), r.brand || null)),
      h('div', { class: 'rt' }, h('span', { class: 'kcal' }, `${fmt(r.kcalServing != null ? r.kcalServing : r.kcal100)} kcal`), h('span', { class: 'sv' }, basisText(r))))));
    api.body.replaceChildren(searchView);
  };
  async function run() {
    const q = input.value.trim();
    if (!q) { results = []; statusMsg = 'Type a food to search for.'; statusBad = false; showResults(); return; }
    const my = ++token; busy = true;
    results = []; statusMsg = 'Searching…'; statusBad = false; showResults();
    const [a, b] = await Promise.allSettled([searchOFF(q), searchUSDA(q)]);
    if (closed || my !== token) return;
    busy = false;
    const ra = a.status === 'fulfilled' ? a.value : [], rb = b.status === 'fulfilled' ? b.value : [];
    results = mergeResults(ra, rb);
    if (a.status === 'rejected' && b.status === 'rejected') { statusMsg = 'Can’t search right now — are you online?'; statusBad = true; }
    else if (!results.length) { statusMsg = 'No matches. Try a simpler word, like “yogurt”.'; statusBad = false; }
    else if (a.status === 'rejected' || b.status === 'rejected') { statusMsg = `${a.status === 'rejected' ? 'Open Food Facts' : 'USDA'} didn’t respond, showing the other source only.`; statusBad = false; }
    else { statusMsg = ''; statusBad = false; }
    showResults();
  }

  function showPick(r) {
    const hasServ = r.kcalServing != null, has100 = r.kcal100 != null;
    let mode = hasServ ? 'serving' : 'grams';
    const amt = numInput({ value: hasServ ? '1' : '100', min: '0', 'aria-label': 'Amount', onInput: () => upd() });
    const amtLabel = h('span', null);
    const out = h('div', { class: 'preview', id: 'lookup-kcal' });
    const useBtn = h('button', { class: 'btn block', type: 'button', id: 'lookup-use' });
    const calc = () => {
      const n = Number(amt.value);
      if (amt.value.trim() === '' || !Number.isFinite(n) || n <= 0) return null;
      return Math.round(mode === 'serving' ? r.kcalServing * n : r.kcal100 * n / 100);
    };
    const upd = () => {
      amtLabel.textContent = mode === 'serving' ? `Number of servings${r.servingLabel ? ` (1 serving = ${r.servingLabel})` : ''}` : 'Amount in grams';
      const k = calc();
      out.textContent = k == null ? 'Enter an amount above 0.' : `${fmt(k)} kcal`;
      useBtn.textContent = k == null ? 'Use calories' : `Use ${fmt(k)} kcal`;
      useBtn.disabled = k == null;
    };
    useBtn.addEventListener('click', () => {
      const k = calc(); if (k == null) return;
      const n = Number(amt.value);
      const amountText = mode === 'serving'
        ? (n === 1 ? `1 serving${r.servingLabel ? ` (${r.servingLabel})` : ''}` : `${+n.toFixed(2)} servings`)
        : `${+n.toFixed(1)} g`;
      api.close();
      onUse({ kcal: k, amountText, source: r.sourceKey === 'off' ? 'Open Food Facts' : 'USDA FoodData Central', name: r.name });
    });
    const modeSeg = hasServ && has100 ? segmented([['serving', 'Servings'], ['grams', 'Grams']], mode, (v) => { mode = v; amt.value = v === 'serving' ? '1' : '100'; upd(); }) : null;
    upd();
    api.body.replaceChildren(h('div', { class: 'stack' },
      h('button', { class: 'pill-btn', type: 'button', style: 'padding-left:0', onClick: showResults }, '‹ Back to results'),
      h('div', null, h('div', { class: 'name', style: 'font-weight:600;font-size:18px;overflow-wrap:anywhere' }, r.name),
        h('div', { class: 'meta sv' }, h('span', { class: 'src ' + r.sourceKey }, r.source), r.brand || null)),
      h('p', { class: 'sub' }, hasServ ? `${fmt(r.kcalServing)} kcal ${basisText(r)}` : `${fmt(r.kcal100)} kcal per 100 g`),
      modeSeg,
      h('label', { class: 'field' }, amtLabel, amt),
      out, useBtn,
      h('p', { class: 'attrib' }, 'Values are estimates from public food databases.')));
  }
  if ((query || '').trim()) run(); else showResults();
  setTimeout(() => { if (!closed && !(query || '').trim()) input.focus(); }, 50);
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
  const used = foodsUsing(p.id);
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
    h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Used in foods'),
      used.length ? h('div', { class: 'card' }, used.map((m) => h('div', { class: 'row' }, h('div', { class: 'grow name' }, m.name))))
        : h('p', { class: 'sub' }, 'Not linked to any foods yet.')),
    err,
    h('button', { class: 'btn danger block', type: 'button', onClick: async () => {
      const ok = await confirmSheet({ title: 'Delete item?', confirmLabel: 'Delete', danger: true,
        message: used.length ? `“${p.name}” will be removed from your pantry and from ${used.length} ${used.length === 1 ? 'food' : 'foods'}.` : `“${p.name}” will be removed from your pantry.` });
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
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Starter foods'),
      h('p', { class: 'setting-desc' }, 'Adds your starter pantry items and foods. Anything already in the app (matched by name) is skipped, so it is safe to tap again.'),
      h('button', { class: 'btn tonal block', type: 'button', onClick: addStarter }, 'Add my starter foods')),
    h('section', { class: 'card pad' },
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Backup'),
      h('p', { class: 'setting-desc' }, 'Your data lives only on this device. Export a copy now and then, and to move to a new phone.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn secondary block', type: 'button', onClick: exportBackup }, 'Export backup'),
        h('button', { class: 'btn secondary block', type: 'button', onClick: () => fileIn.click() }, 'Import backup'), fileIn)),
    h('section', { class: 'card pad' },
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Your data'),
      h('div', { class: 'stack' }, h('button', { class: 'btn danger block', type: 'button', onClick: eraseAll }, 'Erase all data'))),
    h('p', { class: 'about' }, `Healthy Eating v${VERSION}`));
  return root;
}

function addStarter() {
  const r = mergeSeed();
  state.settings.seededFoodsV1 = true;
  commit();
  if (!r.foods && !r.pantry) toast('Everything is already here');
  else toast(`Added ${r.foods} ${r.foods === 1 ? 'food' : 'foods'} and ${r.pantry} pantry ${r.pantry === 1 ? 'item' : 'items'}`);
}
async function eraseAll() {
  const ok = await confirmSheet({ title: 'Erase all data?', confirmLabel: 'Erase everything', danger: true,
    message: 'This permanently deletes your pantry, foods, plans and settings from this device. Export a backup first if you might want it back.' });
  if (!ok) return;
  state = blank(); state.settings.seededFoodsV1 = true; // do not re-add starter foods on next launch
  ui.foodQ = ''; ui.pantryQ = ''; ui.foodCan = false; commit(); toast('All data erased');
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
    parsed = normalize(JSON.parse(text)); // v1 backups are migrated here too
  } catch (e) {
    return messageSheet('Can’t import that file', e instanceof SyntaxError ? 'The file is not valid JSON.' : e.message);
  }
  const entries = Object.keys(parsed.weeks).reduce((a, k) => a + (parsed.weeks[k] ? Object.values(parsed.weeks[k].days).reduce((x, d) => x + Object.values(d).reduce((y, l) => y + l.length, 0), 0) : 0), 0);
  const ok = await confirmSheet({ title: 'Replace all data?', confirmLabel: 'Replace', danger: true,
    message: `This backup has ${parsed.pantry.length} pantry items, ${parsed.foods.length} foods and ${entries} planned entries. Importing replaces everything currently in the app.` });
  if (!ok) return;
  parsed.settings.seededFoodsV1 = true; // an imported backup is what the user wants; do not merge starter foods on top
  state = parsed; ui.week = mondayOf(today()); ui.day = today(); commit(); toast('Backup imported');
}

/* ---------- shell ---------- */
const views = { plan: viewPlan, foods: viewFoods, pantry: viewPantry, shopping: viewShopping, settings: viewSettings };
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
let seeded = null;
if (!state.settings.seededFoodsV1) { seeded = mergeSeed(); state.settings.seededFoodsV1 = true; save(); }
render();
if (seeded && seeded.foods) toast(`Added ${seeded.foods} of your foods`);
else if (seeded && seeded.pantry) toast(`Added ${seeded.pantry} pantry items`);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ }); });
}
})();
