/* Healthy Eating - vanilla JS PWA. No dependencies.
   The only network use is the optional "Find calories" lookup (Open Food Facts + USDA FoodData Central). */
(() => {
'use strict';

const VERSION = '1.2.0';
const KEY = 'healthyEating.v1'; // storage key is unchanged so existing data is found and migrated in place
const SCHEMA = 3;
const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const SLOT_LABEL = Object.fromEntries(SLOTS);
const LOOKUP_TIMEOUT = 8000;
const UIKEY = 'healthyEating.ui'; // per-device view preferences (Menu Meals/Foods, Plan Day/Week)
const PHOTO_LS = 'healthyEating.photo.'; // fallback photo storage when IndexedDB is unavailable (small photos only)
const EMOJI = window.HEA_EMOJI || { map: [], grid: [], fallback: '🍽️' };
const EMOJI_RULES = EMOJI.map.map(([re, e]) => [new RegExp(re, 'i'), e]);
const EMOJI_GRID = EMOJI.grid;
const FALLBACK_EMOJI = EMOJI.fallback || '🍽️';

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
  down: '<path d="M6 9l6 6 6-6"/>',
  cart: '<path d="M3.5 5h2.3l2.1 9.6h9.7l1.9-7.1H7"/><circle cx="9.6" cy="18.8" r="1.3"/><circle cx="16.6" cy="18.8" r="1.3"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/>',
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

/* ---------- pictures: emoji rules + photo store (IndexedDB) ---------- */
function autoEmoji(text, strict) {
  const t = String(text || '');
  for (const [re, e] of EMOJI_RULES) if (re.test(t)) return e;
  return strict ? null : FALLBACK_EMOJI;
}
/* default picture: food -> keyword emoji; meal (has items) -> emoji of its first food, else the plate */
function autoPictureFor(obj, foods) {
  if (obj && Array.isArray(obj.items)) {
    const first = obj.items[0];
    if (first) {
      const f = first.foodId ? (foods || state.foods).find((x) => x.id === first.foodId) : null;
      if (f) return { type: 'emoji', value: f.picture && f.picture.type === 'emoji' ? f.picture.value : autoEmoji(f.name) };
      if (first.customName) return { type: 'emoji', value: autoEmoji(first.customName) };
    }
    return { type: 'emoji', value: FALLBACK_EMOJI };
  }
  return { type: 'emoji', value: autoEmoji(obj && obj.name) };
}

const photoCache = new Map(); // id -> dataURL, so rendering never waits on IndexedDB
const DB_NAME = 'healthyEating', DB_STORE = 'photos';
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbPromise;
}
/* run one transaction; fn(store, out) may return a request whose result is reported */
function idbRun(mode, fn) {
  return openDb().then((db) => (!db ? { ok: false } : new Promise((res) => {
    try {
      const tx = db.transaction(DB_STORE, mode), out = {};
      const req = fn(tx.objectStore(DB_STORE), out);
      tx.oncomplete = () => res({ ok: true, value: req ? req.result : out.value });
      tx.onerror = tx.onabort = () => res({ ok: false });
    } catch (e) { res({ ok: false }); }
  })));
}
async function photoSave(id, dataUrl) {
  const r = await idbRun('readwrite', (st) => st.put(dataUrl, id));
  if (r.ok) { photoCache.set(id, dataUrl); return true; }
  if (dataUrl.length < 60 * 1024) { // IndexedDB unavailable: small photos may live in localStorage
    try { localStorage.setItem(PHOTO_LS + id, dataUrl); photoCache.set(id, dataUrl); return true; } catch (e) { /* too big or blocked */ }
  }
  return false;
}
function photoDelete(id) {
  photoCache.delete(id);
  try { localStorage.removeItem(PHOTO_LS + id); } catch (e) { /* ignore */ }
  return idbRun('readwrite', (st) => st.delete(id));
}
async function photoLoadAll() {
  const r = await idbRun('readonly', (st, out) => {
    out.value = {};
    const c = st.openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out.value[cur.key] = cur.value; cur.continue(); } };
    return null;
  });
  const all = r.ok && r.value ? r.value : {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PHOTO_LS)) all[k.slice(PHOTO_LS.length)] = localStorage.getItem(k);
    }
  } catch (e) { /* ignore */ }
  return all;
}
async function photoClearAll() {
  photoCache.clear();
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PHOTO_LS)) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  await idbRun('readwrite', (st) => st.clear());
}
const referencedPhotoIds = (st = state) => [...new Set([...st.foods, ...st.meals].map((x) => x.picture).filter((p) => p && p.type === 'photo').map((p) => p.id))];
async function loadPhotos() {
  const all = await photoLoadAll();
  for (const [id, url] of Object.entries(all)) if (typeof url === 'string' && url.startsWith('data:image/')) photoCache.set(id, url);
  render();
}
/* file -> 320x320 centre-cropped JPEG dataURL (Safari applies EXIF orientation for createImageBitmap/<img>) */
async function photoFromFile(file) {
  let bmp = null, cleanup = () => {};
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = null; }
  if (!bmp) {
    const url = URL.createObjectURL(file);
    cleanup = () => URL.revokeObjectURL(url);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('bad image')); img.src = url; });
    bmp = img;
  }
  try {
    const w = bmp.naturalWidth || bmp.width, hgt = bmp.naturalHeight || bmp.height;
    if (!w || !hgt) throw new Error('empty image');
    const side = Math.min(w, hgt);
    const cv = document.createElement('canvas'); cv.width = cv.height = 320;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 320, 320);
    ctx.drawImage(bmp, (w - side) / 2, (hgt - side) / 2, side, side, 0, 0, 320, 320);
    return cv.toDataURL('image/jpeg', 0.8);
  } finally { cleanup(); if (bmp && bmp.close) bmp.close(); }
}
const fmtBytes = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/* ---------- state, migration & storage ---------- */
const blank = () => ({ schemaVersion: SCHEMA, pantry: [], foods: [], meals: [], weeks: {}, settings: { dailyGoal: null, seededFoodsV1: false, seededMealsV1: false } });
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

/* v1 -> v2 (v2 -> v3 happens in normalize()): meals become foods (serving "1 serving", no components), plan entries get servings 1 and foodId. Never drops data. */
function migrate(raw) {
  const s = unwrap(raw);
  const v = schemaOf(s);
  if (v > SCHEMA) throw new Error('This backup was made by a newer version of the app.');
  if (v >= 2) return s; // v2 and v3 are shaped alike; normalize() adds meals, entry kinds and pictures
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

function normPicture(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.type === 'emoji' && typeof p.value === 'string' && p.value.trim()) return { type: 'emoji', value: p.value.trim().slice(0, 16) };
  if (p.type === 'photo' && typeof p.id === 'string' && p.id) return { type: 'photo', id: p.id };
  return null;
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
      pantryIds: Array.isArray(f.pantryIds) ? [...new Set(f.pantryIds.filter((x) => pantryIds.has(x)))] : [],
      picture: normPicture(f.picture) || { type: 'emoji', value: autoEmoji(f.name) } });
  });
  const mealIds = new Set();
  (Array.isArray(src.meals) ? src.meals : []).forEach((m, i) => {
    if (!m || typeof m !== 'object' || typeof m.name !== 'string' || !m.name.trim()) throw new Error(`Meal ${i + 1} is not valid.`);
    const id = typeof m.id === 'string' && m.id && !mealIds.has(m.id) ? m.id : uid();
    mealIds.add(id);
    const itemIds = new Set();
    const items = (Array.isArray(m.items) ? m.items : []).filter((it) => it && typeof it === 'object').map((it) => {
      const iid = typeof it.id === 'string' && it.id && !itemIds.has(it.id) ? it.id : uid();
      itemIds.add(iid);
      const sv = Number(it.servings), servings = Number.isFinite(sv) && sv > 0 ? Math.min(99, sv) : 1;
      if (typeof it.foodId === 'string' && foodIds.has(it.foodId)) return { id: iid, foodId: it.foodId, servings };
      // the food is gone: keep a custom line with the last known name and calories (never drop data)
      const cc = Number(it.customCalories);
      return { id: iid, customName: typeof it.customName === 'string' && it.customName.trim() ? it.customName.trim() : '(deleted food)',
        customCalories: Number.isFinite(cc) && cc >= 0 ? cc : 0, servings };
    });
    const meal = { id, name: m.name.trim(), items, notes: typeof m.notes === 'string' ? m.notes.trim() : '', picture: normPicture(m.picture) };
    meal.picture = meal.picture || autoPictureFor(meal, out.foods);
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
          const sv = Number(e.servings);
          const entry = { id, eaten: e.eaten === true, servings: Number.isFinite(sv) && sv > 0 ? sv : 1 };
          if (e.kind === 'meal' && typeof e.mealId === 'string' && mealIds.has(e.mealId)) { entry.kind = 'meal'; entry.mealId = e.mealId; }
          else if (typeof e.foodId === 'string' && foodIds.has(e.foodId)) { entry.kind = 'food'; entry.foodId = e.foodId; }
          else if (typeof e.customName === 'string' && e.customName.trim()) {
            entry.kind = 'custom';
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
  out.settings.seededMealsV1 = st.seededMealsV1 === true;
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
    const from = schemaOf(unwrap(parsed));
    state = normalize(parsed);
    if (from < SCHEMA) {
      // keep the untouched pre-migration copy once (v1 data under .preV2, anything older than v3 under .preV3), then store the migrated data
      try { if (from < 2 && !localStorage.getItem(KEY + '.preV2')) localStorage.setItem(KEY + '.preV2', raw); } catch (_) { /* ignore */ }
      try { if (!localStorage.getItem(KEY + '.preV3')) localStorage.setItem(KEY + '.preV3', raw); } catch (_) { /* ignore */ }
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
const mealById = (id) => state.meals.find((m) => m.id === id);
const findMealByName = (n) => state.meals.find((m) => m.name.toLowerCase() === n.trim().toLowerCase());
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

const entryKind = (e) => e.kind || (e.mealId ? 'meal' : e.foodId ? 'food' : 'custom');

/* one line of a meal: a food x servings, or a custom line left behind by a deleted food */
function mealItemInfo(it) {
  const sv = isNum(it.servings) && it.servings > 0 ? it.servings : 1;
  const f = it.foodId ? foodById(it.foodId) : null;
  if (f) {
    const k = foodKcal(f);
    return { name: f.name, serving: f.serving, cal: k == null ? null : k * sv, est: f.estimate, missing: foodStatus(f).missing, picItem: f, sv, food: f };
  }
  const nm = it.customName || '(deleted food)';
  return { name: nm, serving: 'custom line', cal: (isNum(it.customCalories) ? it.customCalories : 0) * sv, est: false, missing: [], picItem: { name: nm, picture: null }, sv, food: null };
}
/* meal kcal = sum of food kcal x servings; foods without calories count 0 and set unknown */
function mealKcal(m) {
  let total = 0, unknown = false, est = false;
  for (const it of m.items) { const i = mealItemInfo(it); if (i.cal == null) unknown = true; else total += i.cal; if (i.est) est = true; }
  return { total, unknown, est };
}
const mealKcalText = (k) => `${k.est ? '≈ ' : ''}${fmt(k.total)} kcal${k.unknown ? ' ?' : ''}`;
function mealStatus(m) {
  const set = new Set();
  for (const it of m.items) { const f = it.foodId ? foodById(it.foodId) : null; if (f) foodStatus(f).missing.forEach((n) => set.add(n)); }
  const missing = [...set].sort((a, b) => a.localeCompare(b));
  return { ok: missing.length === 0, missing };
}
function mealSummary(m) {
  return m.items.map((it) => { const i = mealItemInfo(it); return i.name + (i.sv !== 1 ? ` ×${servingsLabel(i.sv)}` : ''); }).join(' + ') || 'No foods yet';
}

function entryInfo(e) {
  const sv = isNum(e.servings) && e.servings > 0 ? e.servings : 1;
  const kind = entryKind(e);
  if (kind === 'meal') {
    const m = mealById(e.mealId);
    if (!m) return { kind, name: 'Removed meal', cal: 0, unknown: false, est: false, sv, serving: 'meal', custom: false, missing: [], kcalText: '0 kcal', picItem: { name: 'Removed meal', picture: null } };
    const k = mealKcal(m);
    return { kind, name: m.name, cal: Math.round(k.total * sv), unknown: k.unknown, est: k.est, sv, serving: 'meal', custom: false, missing: mealStatus(m).missing,
      kcalText: `${k.est ? '≈ ' : ''}${fmt(k.total * sv)} kcal${k.unknown ? ' ?' : ''}`, picItem: m };
  }
  if (kind === 'food') {
    const f = foodById(e.foodId);
    if (!f) return { kind, name: 'Removed food', cal: 0, unknown: false, est: false, sv, serving: '', custom: false, missing: [], kcalText: '0 kcal', picItem: { name: 'Removed food', picture: null } };
    const k = foodKcal(f);
    return { kind, name: f.name, cal: k == null ? 0 : Math.round(k * sv), unknown: k == null, est: f.estimate, sv, serving: f.serving, custom: false, missing: foodStatus(f).missing,
      kcalText: k == null ? 'kcal ?' : `${f.estimate ? '≈ ' : ''}${fmt(k * sv)} kcal`, picItem: f };
  }
  const nm = e.customName || 'Something else';
  const cal = Math.round((e.customCalories || 0) * sv);
  return { kind: 'custom', name: nm, cal, unknown: false, est: false, sv, serving: '', custom: true, missing: [], kcalText: `${fmt(cal)} kcal`, picItem: { name: nm, picture: null } };
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
const ui = { tab: 'plan', week: mondayOf(today()), day: today(), menuMode: 'meals', menuQ: '', menuCan: false, planView: 'day', pickMode: 'meals', pantryQ: '' };
function loadUi() {
  try {
    const p = JSON.parse(localStorage.getItem(UIKEY) || 'null');
    if (p && typeof p === 'object') {
      if (p.menuMode === 'meals' || p.menuMode === 'foods') ui.menuMode = p.menuMode;
      if (p.planView === 'day' || p.planView === 'week') ui.planView = p.planView;
      if (p.pickMode === 'meals' || p.pickMode === 'foods') ui.pickMode = p.pickMode;
    }
  } catch (e) { /* storage unavailable: defaults */ }
}
function saveUi() { try { localStorage.setItem(UIKEY, JSON.stringify({ menuMode: ui.menuMode, planView: ui.planView, pickMode: ui.pickMode })); } catch (e) { /* ignore */ } }

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
function forEachEntry(fn) { for (const w of Object.values(state.weeks)) for (const d of Object.values(w.days)) for (const l of Object.values(d)) for (const e of l) fn(e); }
function deleteFood(food) {
  // keep history readable: plan entries and meal lines become custom lines with the last known name and calories (servings kept)
  const k = foodKcal(food);
  forEachEntry((e) => {
    if (e.foodId === food.id) { e.kind = 'custom'; e.customName = food.name; e.customCalories = k == null ? 0 : k; delete e.foodId; }
  });
  for (const m of state.meals) for (const it of m.items) {
    if (it.foodId === food.id) { it.customName = food.name; it.customCalories = k == null ? 0 : k; delete it.foodId; }
  }
  if (food.picture && food.picture.type === 'photo') photoDelete(food.picture.id);
  state.foods = state.foods.filter((f) => f.id !== food.id);
  commit();
}
function deleteMeal(meal) {
  const total = mealKcal(meal).total;
  forEachEntry((e) => {
    if (e.mealId === meal.id) { e.kind = 'custom'; e.customName = meal.name; e.customCalories = total; delete e.mealId; }
  });
  if (meal.picture && meal.picture.type === 'photo') photoDelete(meal.picture.id);
  state.meals = state.meals.filter((m) => m.id !== meal.id);
  commit();
}
function addEntry(date, slot, data, time) {
  const e = { id: uid(), kind: 'custom', ...data, eaten: false };
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
      pantryIds: [...new Set((f.pantry || []).map(pid).filter(Boolean))], picture: { type: 'emoji', value: autoEmoji(f.name) } });
    res.foods++;
  }
  return res;
}

/* starter meals (SEED_MEALS): matched by name, foods looked up by exact name, missing foods skipped */
function mergeMeals() {
  const res = { meals: 0 };
  for (const m of window.SEED_MEALS || []) {
    if (!m || !m.name || findMealByName(m.name)) continue;
    const items = [];
    for (const it of m.items || []) {
      const f = findFoodByName(it.food || '');
      if (f) items.push({ id: uid(), foodId: f.id, servings: isNum(it.servings) && it.servings > 0 ? it.servings : 1 });
    }
    if (!items.length) continue;
    const meal = { id: uid(), name: m.name, items, notes: m.notes || '', picture: null };
    meal.picture = autoPictureFor(meal);
    state.meals.push(meal); res.meals++;
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

/* ---------- PICTURES: tiles, picker sheet, holder for editors ---------- */
const PASTELS = ['#FFE3D1', '#D8F5E8', '#E5DDFF', '#FFF5C4', '#FFE0EC', '#DDF0FF'];
function tileBg(name) { let n = 7; for (const ch of String(name || '')) n = (n * 31 + ch.codePointAt(0)) >>> 0; return PASTELS[n % PASTELS.length]; }
/* item: { name, picture } (food, meal or a stand-in); size in px: 24 32 36 44 52 72 120 */
function tile(item, size) {
  const pic = item && item.picture;
  const t = h('span', { class: 'tile t' + size, style: '--tb:' + tileBg(item && item.name), 'aria-hidden': 'true' });
  if (pic && pic.type === 'photo' && photoCache.has(pic.id)) t.append(h('img', { src: photoCache.get(pic.id), alt: '', draggable: 'false' }));
  else t.append(document.createTextNode(pic && pic.type === 'emoji' ? pic.value : autoPictureFor(item || {}).value));
  return t;
}
function applyPicture(item, p) {
  const old = item.picture;
  item.picture = p;
  if (old && old.type === 'photo' && !(p.type === 'photo' && p.id === old.id)) photoDelete(old.id);
  commit();
}
/* editors keep a pending picture; photos stored while editing are removed again if the edit is cancelled */
function picHolder(initial) {
  const H = {
    pic: initial ? { ...initial } : null, created: [],
    choose(p) { if (p.type === 'photo') H.created.push(p.id); H.pic = p; },
    finish(saved, oldPic) {
      const keep = saved && H.pic && H.pic.type === 'photo' ? H.pic.id : null;
      H.created.filter((id) => id !== keep).forEach(photoDelete);
      if (saved && oldPic && oldPic.type === 'photo' && oldPic.id !== keep) photoDelete(oldPic.id);
    },
  };
  return H;
}
function pictureSheet({ current, auto, onPick }) {
  let q = '';
  const status = h('p', { class: 'lk-status', role: 'status', hidden: true });
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden-file', tabindex: '-1', id: 'photo-file', 'aria-label': 'Choose a photo',
    onChange: async () => {
      const f = fileIn.files && fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      status.textContent = 'Saving photo…'; status.hidden = false;
      let url;
      try { url = await photoFromFile(f); } catch (e) { status.hidden = true; return toast('Couldn’t read that photo'); }
      const id = 'ph-' + uid();
      if (!(await photoSave(id, url))) { status.hidden = true; return toast('Couldn’t save photo'); }
      api.close(); onPick({ type: 'photo', id });
    } });
  const grid = h('div', { class: 'emoji-grid', role: 'group', 'aria-label': 'Emoji' });
  const drawGrid = () => {
    const n = q.trim().toLowerCase();
    const hit = n ? autoEmoji(n, true) : null;
    const list = EMOJI_GRID.filter(([e, kw]) => !n || kw.includes(n) || e === hit);
    grid.replaceChildren(...(list.length ? list.map(([e, kw]) => h('button', { type: 'button', 'aria-label': kw.split(' ')[0], onClick: () => { api.close(); onPick({ type: 'emoji', value: e }); } }, e))
      : [h('p', { class: 'sub', style: 'grid-column:1/-1' }, 'No emoji match that word.')]));
  };
  drawGrid();
  const isPhoto = current && current.type === 'photo';
  const api = openSheet('Picture', [
    h('button', { class: 'btn tonal block', type: 'button', onClick: () => fileIn.click() }, icon('camera'), 'Take or choose photo'), fileIn, status,
    h('div', { class: 'field' }, h('span', null, 'Or pick an emoji'), searchBox('', 'Search emoji, e.g. pasta', (v) => { q = v; drawGrid(); })),
    grid,
    h('button', { class: 'btn secondary block', type: 'button', onClick: () => { api.close(); onPick(auto()); } }, isPhoto ? 'Remove photo' : 'Use automatic picture')]);
}

/* pickup reminder: "Pick up: Milk, Bananas" (button that opens Shopping when go is true) */
function pickupText(missing) {
  const shown = missing.length > 3 ? missing.slice(0, 2) : missing;
  const more = missing.length - shown.length;
  return 'Pick up: ' + shown.join(', ') + (more > 0 ? ` +${more} more` : '');
}
function goShopping() { while (sheetStack.length) sheetStack[sheetStack.length - 1].close(); ui.tab = 'shopping'; render(); window.scrollTo(0, 0); }
function pickup(missing, go) {
  if (!missing.length) return null;
  const kids = [icon('cart'), h('span', null, pickupText(missing))];
  return go
    ? h('button', { class: 'pickup', type: 'button', 'aria-label': pickupText(missing) + '. Open Shopping', onClick: (ev) => { ev.stopPropagation(); goShopping(); } }, kids)
    : h('span', { class: 'pickup' }, kids);
}
/* "Can make" tag, or the pick-up reminder when something is out */
function flag(st, go) { return st.ok ? h('span', { class: 'tag ok' }, 'Can make') : pickup(st.missing, go); }

/* ---------- PLAN ---------- */
function weekRange(mon) {
  const end = addDays(mon, 6), md = { month: 'short', day: 'numeric' }, yr = new Date().getFullYear();
  const sameYear = parseYmd(mon).getFullYear() === yr && parseYmd(end).getFullYear() === yr;
  return `${fmtDate(mon, md)} – ${fmtDate(end, sameYear ? md : { ...md, year: 'numeric' })}`;
}
function viewPlan() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(ui.week, i));
  if (!days.includes(ui.day)) ui.day = days[0];
  const range = weekRange(ui.week);
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
      h('button', { class: 'range range-btn', type: 'button', id: 'week-title', 'aria-label': `Week ${range}. Choose another week`, onClick: weekPickerSheet }, h('span', null, range), icon('down')),
      iconBtn('right', 'Next week', () => shift(1))),
    segmented([['day', 'Day'], ['week', 'Week']], ui.planView, (v) => { ui.planView = v; saveUi(); render(); }));
  if (ui.planView === 'day') {
    put(root, h('div', { class: 'days', role: 'group', 'aria-label': 'Days of the week' }, days.map((d) => {
      const t = dayTotals(d).planned;
      const long = fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' });
      return h('button', { class: 'day' + (d === today() ? ' today' : ''), type: 'button', 'aria-pressed': String(d === ui.day),
        'aria-label': `${long}, ${fmt(t)} kcal planned`, onClick: () => { ui.day = d; render(); } },
        h('span', { class: 'dow' }, fmtDate(d, { weekday: 'short' })),
        h('span', { class: 'num' }, String(parseYmd(d).getDate())),
        h('span', { class: 'tot' }, t ? String(Math.round(t)) : '–'));
    })));
  }

  if (weekEntryCount(ui.week) === 0 && weekEntryCount(addDays(ui.week, -7)) > 0) {
    put(root, h('div', { class: 'card pad' },
      h('p', { class: 'sub', style: 'margin-bottom:10px' }, 'This week is empty. Start from last week’s plan?'),
      h('button', { class: 'btn tonal block', type: 'button', onClick: () => copyLastWeek(ui.week) }, 'Copy last week')));
  }
  if (ui.planView === 'week') { weekBody(root, days); return root; }

  const tot = dayTotals(ui.day), goal = state.settings.dailyGoal;
  const summary = h('section', { class: 'card pad summary', 'aria-label': 'Daily summary' },
    h('div', { class: 'date' }, fmtDate(ui.day, { weekday: 'long', month: 'long', day: 'numeric' })),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', { id: 'planned-total' }, fmt(tot.planned)), h('span', null, 'Planned kcal')),
      h('div', { class: 'stat' }, h('b', { id: 'eaten-total' }, fmt(tot.eaten)), h('span', null, 'Eaten kcal'))));
  if (tot.unknown) summary.append(h('p', { class: 'note-line', id: 'unknown-note' }, `${tot.unknown} ${tot.unknown === 1 ? 'item' : 'items'} without calories (counted as 0)`));
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
  const meta = [amount, info.kcalText, e.time ? fmtTime(e.time) : null, info.custom ? 'Custom' : null].filter(Boolean).join(' · ');
  const miss = info.missing.length > 0 && !e.eaten; // already eaten: nothing left to pick up
  const check = h('button', { class: 'circle', type: 'button', role: 'checkbox', 'aria-checked': String(e.eaten), 'aria-label': `Ate ${info.name}`,
    onClick: () => { e.eaten = !e.eaten; commit(); } }, h('i', null, icon('check')));
  return h('div', { class: 'row entry' + (miss ? ' needs' : ''), 'data-kind': info.kind }, check, tile(info.picItem, 32),
    h('div', { class: 'grow' }, h('div', { class: 'name' + (e.eaten ? ' done' : '') }, info.name), h('div', { class: 'meta' }, meta), miss ? pickup(info.missing, true) : null),
    iconBtn('swap', `Edit ${info.name}`, () => entrySheet({ date, slot, entry: e })),
    iconBtn('trash', `Remove ${info.name}`, () => {
      const list = slotArr(date, slot, false); const idx = list.indexOf(e);
      list.splice(idx, 1); commit();
      toast(`Removed ${info.name}`, { action: 'Undo', onAction: () => { slotArr(date, slot, true).splice(idx, 0, e); commit(); } });
    }, 'muted'));
}

/* week overview: a vertical list of day cards, each with four slot rows */
function weekBody(root, days) {
  const goal = state.settings.dailyGoal;
  let wk = 0, unknown = 0;
  days.forEach((d) => { const t = dayTotals(d); wk += t.planned; unknown += t.unknown; });
  put(root, h('div', { class: 'card pad wk-sum' }, h('span', null, 'Planned this week'), h('b', { id: 'week-total' }, `${fmt(wk)} kcal`)));
  if (unknown) put(root, h('p', { class: 'note-line', id: 'unknown-note' }, `${unknown} ${unknown === 1 ? 'item' : 'items'} without calories (counted as 0)`));
  for (const d of days) {
    const t = dayTotals(d);
    const long = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
    const card = h('section', { class: 'card daycard' + (d === today() ? ' today' : ''), 'aria-label': long, 'data-date': d });
    card.append(h('div', { class: 'dc-head' },
      h('button', { class: 'dc-name', type: 'button', 'aria-label': `Open ${long} in Day view`,
        onClick: () => { ui.day = d; ui.planView = 'day'; saveUi(); render(); window.scrollTo(0, 0); } },
        h('b', null, fmtDate(d, { weekday: 'short' })), h('span', null, fmtDate(d, { month: 'short', day: 'numeric' }))),
      h('span', { class: 'dc-tot' + (goal && t.planned > goal ? ' over' : ''), 'data-total': String(Math.round(t.planned)) },
        goal ? `${fmt(t.planned)} / ${fmt(goal)} kcal` : (t.planned ? `${fmt(t.planned)} kcal` : '– kcal'))));
    for (const [slot, label] of SLOTS) {
      const list = sortedEntries(d, slot);
      const addLabel = `Add to ${label} on ${fmtDate(d, { weekday: 'long' })}`;
      if (!list.length) {
        card.append(h('button', { class: 'wk-empty', type: 'button', 'data-slot': slot, 'aria-label': addLabel, onClick: () => entrySheet({ date: d, slot }) },
          h('span', { class: 'pill' }, label), h('span', { class: 'wk-add' }, '+ Add')));
      } else {
        const sum = list.reduce((a, e) => a + entryInfo(e).cal, 0);
        card.append(h('div', { class: 'wk-slot', 'data-slot': slot },
          h('div', { class: 'wk-hd' }, h('span', { class: 'pill' }, label), h('span', { class: 'sub' }, `${fmt(sum)} kcal`), h('span', { class: 'sp' }),
            iconBtn('plus', addLabel, () => entrySheet({ date: d, slot }))),
          list.map((e) => weekEntry(e, d, slot))));
      }
    }
    put(root, card);
  }
}
function weekEntry(e, date, slot) {
  const info = entryInfo(e);
  const miss = info.missing.length > 0 && !e.eaten;
  const main = h('button', { class: 'wk-main', type: 'button', 'aria-label': `Edit ${info.name}`, onClick: () => entrySheet({ date, slot, entry: e }) },
    tile(info.picItem, 32),
    h('span', { class: 'nm' + (e.eaten ? ' done' : '') }, info.sv !== 1 ? `${info.name} ×${servingsLabel(info.sv)}` : info.name),
    h('span', { class: 'k' }, info.kcalText.replace(' kcal', '')));
  return h('div', { class: 'wk-entry' + (miss ? ' needs' : ''), 'data-kind': info.kind }, main, miss ? pickup(info.missing, true) : null);
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

/* month calendar; tapping any date picks the Monday-Sunday week it belongs to (the whole week row is highlighted) */
function calendarEl(initial, onPick) {
  let sel = initial;
  let view = parseYmd(initial); view = new Date(view.getFullYear(), view.getMonth(), 1);
  const wrap = h('div', { class: 'cal' });
  const draw = () => {
    const first = ymd(view), last = ymd(new Date(view.getFullYear(), view.getMonth() + 1, 0));
    const selMon = mondayOf(sel), tdy = today();
    const rows = [];
    for (let w = mondayOf(first); w <= last; w = addDays(w, 7)) {
      rows.push(h('div', { class: 'cal-week' + (w === selMon ? ' sel' : ''), 'data-week': w },
        Array.from({ length: 7 }, (_, i) => {
          const d = addDays(w, i), inMonth = d.slice(0, 7) === first.slice(0, 7);
          return h('button', { class: 'cal-day' + (inMonth ? '' : ' out') + (d === tdy ? ' today' : ''), type: 'button', 'data-date': d,
            'aria-pressed': String(d === sel), 'aria-label': fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
            onClick: () => { sel = d; onPick(d); draw(); } }, String(parseYmd(d).getDate()));
        })));
    }
    const dows = Array.from({ length: 7 }, (_, i) => fmtDate(addDays('2024-01-01', i), { weekday: 'narrow' })); // 2024-01-01 is a Monday
    wrap.replaceChildren(
      h('div', { class: 'cal-head' },
        iconBtn('left', 'Previous month', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); draw(); }),
        h('b', { 'aria-live': 'polite', id: 'cal-month' }, fmtDate(first, { month: 'long', year: 'numeric' })),
        iconBtn('right', 'Next month', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); draw(); })),
      h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, dows.map((x) => h('span', null, x))), ...rows);
  };
  draw();
  return { el: wrap, set(d) { sel = d; const p = parseYmd(d); view = new Date(p.getFullYear(), p.getMonth(), 1); draw(); } };
}
function weekPickerSheet() {
  const choose = (d) => { ui.week = mondayOf(d); ui.day = d; api.close(); render(); };
  const cal = calendarEl(ui.day, choose);
  const thisMon = mondayOf(today());
  const api = openSheet('Choose a week', [
    h('div', { class: 'form-row' },
      h('button', { class: 'btn tonal', type: 'button', id: 'pick-this-week', onClick: () => choose(today()) }, 'This week'),
      h('button', { class: 'btn tonal', type: 'button', id: 'pick-next-week', onClick: () => choose(addDays(thisMon, 7)) }, 'Next week')),
    cal.el,
    h('p', { class: 'sub', style: 'text-align:center' }, 'Tap any date to show that Monday–Sunday week.')]);
}

/* searchable list of meals or foods (can-make first); used by the entry sheet and the meal editor */
function pickPane(kind, getSel, onPick) {
  let q = '';
  const list = h('div', { class: 'card pick-list' });
  const draw = () => {
    const needle = q.trim().toLowerCase();
    const isMeals = kind === 'meals';
    const src = isMeals ? state.meals : state.foods;
    if (!src.length) { list.replaceChildren(h('div', { class: 'slot-empty' }, isMeals ? 'No meals yet. Create one in the Menu tab, or use Foods.' : 'No foods yet. Use Custom, or add foods in the Menu tab.')); return; }
    const arr = src.filter((x) => x.name.toLowerCase().includes(needle)).map((x) => ({ x, st: isMeals ? mealStatus(x) : foodStatus(x) }))
      .sort((a, b) => (b.st.ok - a.st.ok) || byName(a.x, b.x));
    if (!arr.length) { list.replaceChildren(h('div', { class: 'slot-empty' }, isMeals ? 'No meals match.' : 'No foods match.')); return; }
    const sel = getSel();
    list.replaceChildren(...arr.map(({ x, st }) => {
      const k = isMeals ? mealKcal(x) : null;
      return h('button', { class: 'row has-tile pick-row' + (st.ok ? '' : ' needs'), type: 'button', role: 'radio', 'aria-checked': String(sel === x.id), 'data-id': x.id,
        onClick: () => { onPick(x.id); draw(); } },
        tile(x, 44),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, x.name), h('div', { class: 'sv clamp' }, isMeals ? mealSummary(x) : x.serving), flag(st)),
        h('span', { class: 'kcal' }, isMeals ? mealKcalText(k) : fmtKcal(foodKcal(x), x.estimate)),
        h('span', { class: 'circle', 'aria-hidden': 'true', style: 'width:32px' }, h('i', { style: sel === x.id ? 'background:var(--accent);border-color:var(--accent);color:var(--accent-ink)' : '' }, icon('check'))));
    }));
  };
  draw();
  return { el: h('div', { class: 'stack' }, searchBox('', kind === 'meals' ? 'Search meals' : 'Search foods', (v) => { q = v; draw(); }), list), redraw: draw };
}

/* add / edit an entry in a slot: Meals | Foods | Custom */
function entrySheet({ date, slot, entry }) {
  const editing = !!entry;
  const ek = entry ? entryKind(entry) : null;
  let mode = editing ? (ek === 'custom' ? 'custom' : ek === 'meal' ? 'meals' : 'foods') : (ui.pickMode === 'foods' ? 'foods' : 'meals');
  const sel = { meals: ek === 'meal' ? entry.mealId : null, foods: ek === 'food' ? entry.foodId : null };
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const preview = h('div', { class: 'preview', id: 'entry-preview', hidden: true });
  const step = stepper(entry && entry.servings > 0 ? entry.servings : 1, () => updatePreview());

  const updatePreview = () => {
    const sv = step.get();
    let text = '';
    if (mode === 'foods') {
      const f = sel.foods ? foodById(sel.foods) : null;
      if (f) { const k = foodKcal(f); text = `${servingsLabel(sv)} × ${f.serving} = ${k == null ? 'kcal ?' : fmt(k * sv) + ' kcal'}`; }
    } else if (mode === 'meals') {
      const m = sel.meals ? mealById(sel.meals) : null;
      if (m) { const k = mealKcal(m); text = `${servingsLabel(sv)} × ${m.name} = ${fmt(k.total * sv)} kcal${k.unknown ? ' ?' : ''}`; }
    } else {
      const c = Number(calIn.value);
      if (calIn.value.trim() !== '' && Number.isFinite(c) && c >= 0) text = `${servingsLabel(sv)} × ${fmt(c)} kcal = ${fmt(c * sv)} kcal`;
    }
    preview.textContent = text; preview.hidden = !text;
  };

  const mealsPane = pickPane('meals', () => sel.meals, (id) => { sel.meals = id; showErr(''); updatePreview(); });
  const foodsPane = pickPane('foods', () => sel.foods, (id) => { sel.foods = id; showErr(''); updatePreview(); });
  const cInfo = entry && ek === 'custom' ? { name: entry.customName || '', cal: entry.customCalories || 0 } : null;
  const nameIn = textInput({ value: cInfo ? cInfo.name : '', placeholder: 'e.g. Sandwich from the cafe', 'aria-label': 'Custom food name', autocapitalize: 'sentences' });
  const calIn = numInput({ value: cInfo ? String(cInfo.cal) : '', placeholder: 'e.g. 450', 'aria-label': 'Custom calories', onInput: () => updatePreview() });
  const customPane = h('div', { class: 'stack' }, field(editing ? 'What I actually had' : 'Name', nameIn), field('Calories (for 1 serving)', calIn));
  const timeIn = h('input', { class: 'input', type: 'time', value: entry && entry.time ? entry.time : '', 'aria-label': 'Time (optional)' });

  const panes = h('div');
  const showPane = () => { panes.replaceChildren(mode === 'meals' ? mealsPane.el : mode === 'foods' ? foodsPane.el : customPane); showErr(''); updatePreview(); };
  const seg = segmented([['meals', 'Meals'], ['foods', 'Foods'], ['custom', 'Custom']], mode, (v) => {
    mode = v; if (v !== 'custom') { ui.pickMode = v; saveUi(); } showPane();
  });
  showPane();

  const save_ = () => {
    let data;
    const servings = step.get();
    if (mode === 'meals') {
      if (!sel.meals) return showErr('Pick a meal first, or use Foods or Custom.');
      data = { kind: 'meal', mealId: sel.meals, servings };
    } else if (mode === 'foods') {
      if (!sel.foods) return showErr('Pick a food first, or use Meals or Custom.');
      data = { kind: 'food', foodId: sel.foods, servings };
    } else {
      const name = nameIn.value.trim(), cal = Number(calIn.value);
      if (!name) return showErr('Please enter a name.');
      if (calIn.value.trim() === '' || !Number.isFinite(cal) || cal < 0) return showErr('Please enter calories (0 or more).');
      data = { kind: 'custom', customName: name, customCalories: cal, servings };
    }
    const time = timeIn.value || '';
    if (editing) {
      delete entry.foodId; delete entry.mealId; delete entry.customName; delete entry.customCalories;
      Object.assign(entry, data);
      if (time) entry.time = time; else delete entry.time;
    } else addEntry(date, slot, data, time);
    api.close(); commit();
  };
  const api = openSheet(editing ? 'Edit entry' : `Add to ${SLOT_LABEL[slot]} · ${fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}`,
    [seg, panes, h('div', { class: 'field' }, h('span', null, mode === 'meals' ? 'Amount (servings of the whole meal)' : 'Amount (servings)'), step.el), preview, field('Time (optional)', timeIn), err],
    h('button', { class: 'btn', type: 'button', onClick: save_ }, editing ? 'Save' : 'Add'));
}

/* meal or food -> pick week (this / next / calendar), day, slot, amount */
function addToPlanSheet(item, kind) {
  const isMeal = kind === 'meal';
  let date = isDate(ui.day) ? ui.day : today(), slot = 'dinner', showCal = false;
  const thisMon = mondayOf(today()), nextMon = addDays(thisMon, 7);
  const timeIn = h('input', { class: 'input', type: 'time', 'aria-label': 'Time (optional)' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const slotSeg = segmented(SLOTS, slot, (v) => { slot = v; });
  const preview = h('div', { class: 'preview', id: 'entry-preview' });
  const kcalNow = () => (isMeal ? mealKcal(item).total : foodKcal(item));
  const upd = () => {
    const sv = step.get(), k = kcalNow(), unk = isMeal ? mealKcal(item).unknown : k == null;
    preview.textContent = `${servingsLabel(sv)} × ${isMeal ? item.name : item.serving} = ${k == null ? 'kcal ?' : fmt(k * sv) + ' kcal'}${isMeal && unk ? ' ?' : ''}`;
  };
  const step = stepper(1, upd);
  upd();

  const weekLabel = h('p', { class: 'sub', id: 'plan-week-label', style: 'text-align:center' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Week' });
  const dayGrid = h('div', { class: 'daypick', role: 'group', 'aria-label': 'Day' });
  const calHost = h('div', { hidden: true });
  const cal = calendarEl(date, (d) => { date = d; drawWeek(); });
  calHost.append(cal.el);
  const moveTo = (mon) => { date = addDays(mon, (parseYmd(date).getDay() + 6) % 7); showCal = false; drawWeek(); };
  const drawWeek = () => {
    const mon = mondayOf(date);
    chips.replaceChildren(
      h('button', { class: 'chip', type: 'button', id: 'wk-this', 'aria-pressed': String(!showCal && mon === thisMon), onClick: () => moveTo(thisMon) }, 'This week'),
      h('button', { class: 'chip', type: 'button', id: 'wk-next', 'aria-pressed': String(!showCal && mon === nextMon), onClick: () => moveTo(nextMon) }, 'Next week'),
      h('button', { class: 'chip', type: 'button', id: 'wk-pick', 'aria-pressed': String(showCal || (mon !== thisMon && mon !== nextMon)), onClick: () => { showCal = true; cal.set(date); drawWeek(); } }, 'Pick a date…'));
    calHost.hidden = !showCal;
    weekLabel.textContent = weekRange(mon);
    dayGrid.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i);
      return h('button', { type: 'button', 'aria-pressed': String(d === date), 'data-date': d, 'aria-label': fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }),
        onClick: () => { date = d; drawWeek(); } }, h('span', null, fmtDate(d, { weekday: 'short' })), h('b', null, String(parseYmd(d).getDate())));
    }));
  };
  drawWeek();

  const go = () => {
    if (!isDate(date)) { err.textContent = 'Please choose a day.'; err.hidden = false; return; }
    addEntry(date, slot, isMeal ? { kind: 'meal', mealId: item.id, servings: step.get() } : { kind: 'food', foodId: item.id, servings: step.get() }, timeIn.value);
    api.close(); save(); render();
    const dd = date;
    toast(`Added to ${SLOT_LABEL[slot]}, ${fmtDate(dd, { weekday: 'short', month: 'short', day: 'numeric' })}`, {
      action: 'View', onAction: () => { ui.tab = 'plan'; ui.week = mondayOf(dd); ui.day = dd; render(); window.scrollTo(0, 0); } });
  };
  const st = isMeal ? mealStatus(item) : foodStatus(item);
  const api = openSheet('Add to plan', [
    h('div', { class: 'pick-head' }, tile(item, 44),
      h('div', { class: 'grow' }, h('div', { class: 'name', style: 'font-weight:600' }, item.name), h('div', { class: 'sv' }, isMeal ? mealSummary(item) : item.serving), pickup(st.missing, false))),
    h('div', { class: 'field' }, h('span', null, 'Week'), chips, calHost, weekLabel),
    h('div', { class: 'field' }, h('span', null, 'Day'), dayGrid),
    h('div', { class: 'field' }, h('span', null, 'Meal slot'), slotSeg),
    h('div', { class: 'field' }, h('span', null, isMeal ? 'Amount (servings of the whole meal)' : 'Amount (servings)'), step.el), preview,
    field('Time (optional)', timeIn), err],
    h('button', { class: 'btn', type: 'button', id: 'add-to-plan-go', onClick: go }, 'Add to plan'));
}

/* ---------- MENU: Meals | Foods ---------- */
function viewMenu() {
  const root = h('div', { class: 'view' });
  const list = h('div');
  const isMeals = ui.menuMode === 'meals';
  const draw = () => {
    const needle = ui.menuQ.trim().toLowerCase();
    const all = isMeals ? state.meals : state.foods;
    let arr = all.filter((x) => x.name.toLowerCase().includes(needle));
    if (ui.menuCan) arr = arr.filter((x) => (isMeals ? mealStatus(x) : foodStatus(x)).ok);
    arr.sort(byName);
    if (!all.length) return list.replaceChildren(isMeals
      ? emptyState('No meals yet', 'Tap + to combine foods you often eat together, like toast and an apple.')
      : emptyState('No foods yet', 'Tap + to add your first food, or add your starter foods in Settings.'));
    if (!arr.length) return list.replaceChildren(emptyState(ui.menuCan && !needle ? `No ${isMeals ? 'meals' : 'foods'} you can make right now` : 'No matches', ui.menuCan ? 'Check the Shopping tab for what you are out of.' : 'Try a different search.'));
    list.replaceChildren(h('div', { class: 'card' }, arr.map(isMeals ? mealRow : foodRow)));
  };
  const chip = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ui.menuCan), onClick: () => { ui.menuCan = !ui.menuCan; chip.setAttribute('aria-pressed', String(ui.menuCan)); draw(); } }, 'Can make now');
  put(root, storageBanner(),
    h('header', { class: 'top' }, h('h1', null, 'Menu'), iconBtn('plus', isMeals ? 'Add meal' : 'Add food', () => (isMeals ? mealSheet() : foodSheet()))),
    segmented([['meals', 'Meals'], ['foods', 'Foods']], ui.menuMode, (v) => { ui.menuMode = v; saveUi(); render(); }),
    searchBox(ui.menuQ, isMeals ? 'Search meals' : 'Search foods', (v) => { ui.menuQ = v; draw(); }),
    h('div', { class: 'chips' }, chip), list);
  draw(); return root;
}
function foodRow(f) {
  const st = foodStatus(f), k = foodKcal(f);
  return h('button', { class: 'row has-tile menu-row' + (st.ok ? '' : ' needs'), type: 'button', 'data-kind': 'food', onClick: () => foodDetail(f) },
    tile(f, 52),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'sv' }, f.serving), flag(st)),
    h('span', { class: 'kcal' + (k == null ? ' unk' : '') }, fmtKcal(k, f.estimate)));
}
function mealRow(m) {
  const st = mealStatus(m), k = mealKcal(m);
  return h('button', { class: 'row has-tile menu-row' + (st.ok ? '' : ' needs'), type: 'button', 'data-kind': 'meal', onClick: () => mealDetail(m) },
    tile(m, 52),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, m.name), h('div', { class: 'sv clamp' }, mealSummary(m)), flag(st)),
    h('span', { class: 'kcal' + (k.unknown ? ' unk' : '') }, mealKcalText(k)));
}

function detailTop(item, onPic, bigText, subText, chips) {
  const btn = h('button', { class: 'pic-btn', type: 'button', 'aria-label': 'Change picture', id: 'detail-pic', onClick: onPic });
  const draw = () => btn.replaceChildren(tile(item, 120), h('span', { class: 'pic-hint' }, 'Change picture'));
  draw();
  return { el: h('div', { class: 'detail-top' }, btn, h('div', { class: 'big-kcal' }, bigText), subText ? h('div', { class: 'sv' }, subText) : null, h('div', { class: 'chip-row' }, chips)), draw };
}
function foodDetail(food) {
  const k = foodKcal(food);
  const pantry = allPantryIds(food).map(pantryById).filter(Boolean).sort(byName);
  const top = detailTop(food, () => pictureSheet({ current: food.picture, auto: () => ({ type: 'emoji', value: autoEmoji(food.name) }),
    onPick: (p) => { applyPicture(food, p); top.draw(); } }), fmtKcal(k, food.estimate), `per ${food.serving}`,
    [flag(foodStatus(food), true), food.estimate ? h('span', { class: 'tag est' }, '≈ estimate') : null]);
  const inMeals = state.meals.filter((m) => m.items.some((it) => it.foodId === food.id)).sort(byName);
  const body = [
    top.el,
    food.components.length ? h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Ingredients & amounts'),
      h('div', { class: 'card' }, food.components.map((c) => h('div', { class: 'row ing-row' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, c.name), c.amount ? h('div', { class: 'amt' }, c.amount) : null),
        h('span', { class: 'kcal' + (c.calories == null ? ' unk' : '') }, c.calories == null ? 'kcal ?' : `${fmt(c.calories)} kcal`))))) : null,
    h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Pantry items'),
      pantry.length ? h('div', { class: 'card' }, pantry.map((p) => h('div', { class: 'row' },
        h('div', { class: 'grow name' }, p.name), h('span', { class: 'tag ' + (p.status === 'have' ? 'ok' : 'warn'), style: 'margin:0' }, p.status === 'have' ? 'Have' : 'Out'))))
        : h('p', { class: 'sub' }, 'No linked pantry items.')),
    inMeals.length ? h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Used in meals'), h('p', { class: 'sub' }, inMeals.map((m) => m.name).join(', '))) : null,
    food.notes ? h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Notes'), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, food.notes)) : null,
    h('div', { class: 'form-row' },
      h('button', { class: 'btn secondary', type: 'button', onClick: () => { api.close(); foodSheet(food); } }, 'Edit'),
      h('button', { class: 'btn danger', type: 'button', onClick: async () => {
        const ok = await confirmSheet({ title: 'Delete food?', confirmLabel: 'Delete', danger: true,
          message: `“${food.name}” will be removed. Plan entries and meals using it keep its name and calories as custom lines.` });
        if (ok) { api.close(); deleteFood(food); toast('Food deleted'); }
      } }, 'Delete')),
  ];
  const api = openSheet(food.name, body, h('button', { class: 'btn', type: 'button', onClick: () => { api.close(); addToPlanSheet(food, 'food'); } }, 'Add to plan'));
}

function mealDetail(meal) {
  const k = mealKcal(meal), st = mealStatus(meal);
  const top = detailTop(meal, () => pictureSheet({ current: meal.picture, auto: () => autoPictureFor(meal),
    onPick: (p) => { applyPicture(meal, p); top.draw(); } }), mealKcalText(k), 'for one serving of this meal',
    [flag(st, true), k.est ? h('span', { class: 'tag est' }, '≈ estimate') : null]);
  const body = [
    top.el,
    h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Foods in this meal'),
      h('div', { class: 'card' }, meal.items.map((it) => {
        const i = mealItemInfo(it);
        return h('div', { class: 'row has-tile' + (i.missing.length ? ' needs' : ''), 'data-kind': 'item' }, tile(i.picItem, 36),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, i.name), h('div', { class: 'sv' }, `${servingsLabel(it.servings)} × ${i.serving}`), pickup(i.missing, false)),
          h('span', { class: 'kcal' + (i.cal == null ? ' unk' : '') }, i.cal == null ? 'kcal ?' : `${fmt(i.cal)} kcal`));
      }))),
    h('div', { class: 'total-line' }, h('span', null, 'Total'), h('b', { id: 'meal-detail-total' }, mealKcalText(k))),
    meal.notes ? h('div', null, h('div', { class: 'group-title', style: 'margin-top:0' }, 'Notes'), h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, meal.notes)) : null,
    h('div', { class: 'form-row' },
      h('button', { class: 'btn secondary', type: 'button', id: 'meal-edit', onClick: () => { api.close(); mealSheet(meal); } }, 'Edit'),
      h('button', { class: 'btn danger', type: 'button', id: 'meal-delete', onClick: async () => {
        const ok = await confirmSheet({ title: 'Delete meal?', confirmLabel: 'Delete', danger: true,
          message: `“${meal.name}” will be removed (your foods stay). Plan entries using it stay in your plan as custom entries.` });
        if (ok) { api.close(); deleteMeal(meal); toast('Meal deleted'); }
      } }, 'Delete')),
  ];
  const api = openSheet(meal.name, body, h('button', { class: 'btn', type: 'button', id: 'meal-add-plan', onClick: () => { api.close(); addToPlanSheet(meal, 'meal'); } }, 'Add to plan'));
}

function mealSheet(meal) {
  const editing = !!meal;
  const items = (meal ? meal.items : []).map((it) => ({ ...it }));
  const oldPic = meal ? meal.picture : null;
  const holder = picHolder(oldPic);
  let saved = false;
  const nameIn = textInput({ value: meal ? meal.name : '', placeholder: 'e.g. Toast & apple', 'aria-label': 'Meal name', autocapitalize: 'sentences', onInput: () => drawPic() });
  const notesIn = h('textarea', { class: 'input', placeholder: 'Optional notes', 'aria-label': 'Notes', value: meal ? meal.notes : '' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const showErr = (m, el) => { err.textContent = m; err.hidden = !m; if (el) el.focus(); };
  const itemsWrap = h('div', { class: 'stack', id: 'meal-items' });
  const totalBox = h('div', { class: 'total-line', id: 'meal-total' });
  const totalHint = h('p', { class: 'hint', hidden: true }, 'Some foods have no calories yet (kcal ?), so the total may be low.');

  const curAuto = () => autoPictureFor({ name: nameIn.value, items });
  const picBtn = h('button', { class: 'pic-btn', type: 'button', id: 'meal-pic', 'aria-label': 'Change picture',
    onClick: () => pictureSheet({ current: holder.pic, auto: curAuto, onPick: (p) => { holder.choose(p); drawPic(); } }) });
  const drawPic = () => picBtn.replaceChildren(tile({ name: nameIn.value || 'meal', picture: holder.pic || curAuto() }, 72), h('span', { class: 'pic-hint' }, 'Change'));
  const drawTotal = () => {
    const k = mealKcal({ items });
    totalBox.replaceChildren(h('span', null, 'Total per serving'), h('b', { id: 'meal-total-val' }, `${fmt(k.total)} kcal${k.unknown ? ' ?' : ''}`));
    totalHint.hidden = !k.unknown;
  };
  const drawItems = () => {
    itemsWrap.replaceChildren(...(items.length ? items.map((it) => {
      const i = mealItemInfo(it);
      const kc = h('span', { class: 'kcal' }, '');
      const setK = () => { const x = mealItemInfo(it); kc.textContent = x.cal == null ? 'kcal ?' : `${fmt(x.cal)} kcal`; };
      setK();
      const stp = stepper(it.servings, (v) => { it.servings = v; setK(); drawTotal(); drawPic(); });
      return h('div', { class: 'mi', 'data-item': it.id },
        h('div', { class: 'mi-top' }, tile(i.picItem, 36),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, i.name), h('div', { class: 'sv' }, i.serving), pickup(i.missing, false)), kc,
          iconBtn('trash', `Remove ${i.name}`, () => { items.splice(items.indexOf(it), 1); drawItems(); drawTotal(); drawPic(); }, 'muted')),
        stp.el);
    }) : [h('div', { class: 'slot-empty card' }, 'No foods yet. Tap “Add food” below.')]));
  };
  const addFood = () => {
    const pane = pickPane('foods', () => null, (id) => {
      items.push({ id: uid(), foodId: id, servings: 1 }); p.close(); drawItems(); drawTotal(); drawPic(); showErr('');
    });
    const p = openSheet('Add food to meal', pane.el);
  };

  const submit = () => {
    const name = nameIn.value.trim();
    if (!name) return showErr('Please enter a meal name.', nameIn);
    if (!items.length) return showErr('Add at least one food to the meal.');
    const data = { name, items: items.map((it) => ({ ...it })), notes: notesIn.value.trim(), picture: holder.pic || autoPictureFor({ name, items }) };
    if (editing) Object.assign(meal, data); else state.meals.push({ id: uid(), ...data });
    holder.finish(true, oldPic); saved = true;
    api.close(); commit(); toast(editing ? 'Meal saved' : 'Meal added');
  };
  drawPic(); drawItems(); drawTotal();
  const api = openSheet(editing ? 'Edit meal' : 'New meal', [
    h('div', { class: 'form-row pic-row' }, picBtn, field('Name', nameIn)),
    h('div', { class: 'field' }, h('span', null, 'Foods in this meal'),
      h('div', { class: 'stack' }, itemsWrap,
        h('button', { class: 'btn tonal block', type: 'button', id: 'meal-add-food', onClick: addFood }, '+ Add food'), totalBox, totalHint)),
    field('Notes', notesIn), err],
    [h('button', { class: 'btn secondary', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn', type: 'button', id: 'meal-save', onClick: submit }, 'Save')]);
  api.onClose = () => { if (!saved) holder.finish(false); };
}

function foodSheet(food) {
  const editing = !!food;
  const chosen = new Set(food ? food.pantryIds : []);
  let q = '';
  let estimate = food ? food.estimate : false;
  const oldPic = food ? food.picture : null;
  const holder = picHolder(oldPic);
  let saved = false;
  const nameIn = textInput({ value: food ? food.name : '', placeholder: 'e.g. Banana or Smoothie', 'aria-label': 'Food name', autocapitalize: 'sentences', onInput: () => drawPic() });
  const curAuto = () => ({ type: 'emoji', value: autoEmoji(nameIn.value) });
  const picBtn = h('button', { class: 'pic-btn', type: 'button', id: 'food-pic', 'aria-label': 'Change picture',
    onClick: () => pictureSheet({ current: holder.pic, auto: curAuto, onPick: (p) => { holder.choose(p); drawPic(); } }) });
  const drawPic = () => picBtn.replaceChildren(tile({ name: nameIn.value || 'food', picture: holder.pic || curAuto() }, 72), h('span', { class: 'pic-hint' }, 'Change'));
  drawPic();
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
    const data = { name, serving, calories: cal, estimate, notes: notesIn.value.trim(), components: comps, pantryIds: [...chosen].filter(pantryById),
      picture: holder.pic || { type: 'emoji', value: autoEmoji(name) } };
    if (editing) Object.assign(food, data); else state.foods.push({ id: uid(), ...data });
    holder.finish(true, oldPic); saved = true;
    api.close(); commit(); toast(editing ? 'Food saved' : 'Food added');
  };
  const api = openSheet(editing ? 'Edit food' : 'New food', [
    h('div', { class: 'form-row pic-row' }, picBtn, field('Name', nameIn)),
    field('Serving', servingIn),
    h('div', { class: 'field' }, h('span', null, 'Calories per serving'), h('div', { class: 'form-row cal-row' }, calIn, findCal), calHint),
    h('div', { class: 'field' }, h('span', null, 'Accuracy'), estSeg),
    h('div', { class: 'field' }, h('span', null, 'Ingredients & amounts (optional)'),
      h('div', { class: 'stack' }, compsWrap, totalBox,
        h('button', { class: 'btn tonal block', type: 'button', onClick: () => { const r = addRow(); refresh(); r.nameIn.focus(); } }, '+ Add ingredient'))),
    h('div', { class: 'field' }, h('span', null, 'Linked pantry items (for “Can make”)'), h('div', { class: 'stack' }, search, plist, count)),
    field('Notes', notesIn), err],
    [h('button', { class: 'btn secondary', type: 'button', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn', type: 'button', onClick: submit }, 'Save')]);
  api.onClose = () => { if (!saved) holder.finish(false); };
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
      h('p', { class: 'setting-desc' }, 'Adds your starter pantry items, foods and meals. Anything already in the app (matched by name) is skipped, so it is safe to tap again.'),
      h('button', { class: 'btn tonal block', type: 'button', onClick: addStarter }, 'Add my starter foods')),
    h('section', { class: 'card pad' },
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Backup'),
      h('p', { class: 'setting-desc' }, 'Your data lives only on this device. Export a copy now and then, and to move to a new phone.'),
      h('p', { class: 'setting-desc', id: 'backup-size' }, backupNote()),
      h('div', { class: 'stack' },
        h('button', { class: 'btn secondary block', type: 'button', onClick: exportBackup }, 'Export backup'),
        h('button', { class: 'btn secondary block', type: 'button', onClick: () => fileIn.click() }, 'Import backup'), fileIn)),
    h('section', { class: 'card pad' },
      h('h2', { style: 'font-size:17px;margin-bottom:4px' }, 'Your data'),
      h('div', { class: 'stack' }, h('button', { class: 'btn danger block', type: 'button', onClick: eraseAll }, 'Erase all data'))),
    h('p', { class: 'about' }, `Healthy Eating v${VERSION}`));
  return root;
}

function backupNote() {
  const ids = referencedPhotoIds();
  let bytes = JSON.stringify(state).length;
  ids.forEach((id) => { const u = photoCache.get(id); if (u) bytes += u.length + 24; });
  return ids.length
    ? `You have ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}. Backups include them, so a backup is about ${fmtBytes(bytes)} now (each photo adds roughly 30 to 40 KB).`
    : `Backups include photos too (each adds roughly 30 to 40 KB). Without photos a backup is about ${fmtBytes(bytes)}.`;
}
function addStarter() {
  const r = mergeSeed(), m = mergeMeals();
  state.settings.seededFoodsV1 = true; state.settings.seededMealsV1 = true;
  commit();
  if (!r.foods && !r.pantry && !m.meals) toast('Everything is already here');
  else toast(`Added ${r.foods} ${r.foods === 1 ? 'food' : 'foods'}, ${m.meals} ${m.meals === 1 ? 'meal' : 'meals'} and ${r.pantry} pantry ${r.pantry === 1 ? 'item' : 'items'}`);
}
async function eraseAll() {
  const ok = await confirmSheet({ title: 'Erase all data?', confirmLabel: 'Erase everything', danger: true,
    message: 'This permanently deletes your pantry, foods, meals, photos, plans and settings from this device. Export a backup first if you might want it back.' });
  if (!ok) return;
  await photoClearAll();
  state = blank(); state.settings.seededFoodsV1 = true; state.settings.seededMealsV1 = true; // do not re-add starter foods on next launch
  ui.menuQ = ''; ui.pantryQ = ''; ui.menuCan = false; commit(); toast('All data erased');
}

async function exportBackup() {
  const name = `healthy-eating-backup-${ymd(new Date())}.json`;
  const photos = {};
  for (const id of referencedPhotoIds()) { const u = photoCache.get(id); if (u) photos[id] = u; }
  const json = JSON.stringify({ ...state, photos, exportedAt: new Date().toISOString() }, null, 2);
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
  let parsed, photosIn = {};
  try {
    const text = file.text ? await file.text() : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
    const json = JSON.parse(text);
    parsed = normalize(json); // v1 and v2 backups are migrated here too
    const ph = unwrap(json).photos;
    if (ph && typeof ph === 'object' && !Array.isArray(ph)) for (const [id, u] of Object.entries(ph)) if (typeof u === 'string' && u.startsWith('data:image/')) photosIn[id] = u;
  } catch (e) {
    return messageSheet('Can’t import that file', e instanceof SyntaxError ? 'The file is not valid JSON.' : e.message);
  }
  const entries = Object.keys(parsed.weeks).reduce((a, k) => a + (parsed.weeks[k] ? Object.values(parsed.weeks[k].days).reduce((x, d) => x + Object.values(d).reduce((y, l) => y + l.length, 0), 0) : 0), 0);
  const ok = await confirmSheet({ title: 'Replace all data?', confirmLabel: 'Replace', danger: true,
    message: `This backup has ${parsed.pantry.length} pantry items, ${parsed.foods.length} foods, ${parsed.meals.length} meals, ${Object.keys(photosIn).length} photos and ${entries} planned entries. Importing replaces everything currently in the app.` });
  if (!ok) return;
  parsed.settings.seededFoodsV1 = true; parsed.settings.seededMealsV1 = true; // an imported backup is what the user wants; do not merge starter foods on top
  await photoClearAll();
  let lost = 0;
  for (const it of [...parsed.foods, ...parsed.meals]) {
    if (!it.picture || it.picture.type !== 'photo') continue;
    const url = photosIn[it.picture.id];
    if (url && await photoSave(it.picture.id, url)) continue;
    it.picture = autoPictureFor(it, parsed.foods); lost++; // photo missing from the file or could not be stored
  }
  state = parsed; ui.week = mondayOf(today()); ui.day = today(); commit();
  toast(lost ? `Backup imported (${lost} ${lost === 1 ? 'photo' : 'photos'} could not be restored)` : 'Backup imported');
}

/* ---------- shell ---------- */
const views = { plan: viewPlan, menu: viewMenu, pantry: viewPantry, shopping: viewShopping, settings: viewSettings };
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

loadUi();
load();
let seeded = null, seededMeals = 0;
if (!state.settings.seededFoodsV1) { seeded = mergeSeed(); state.settings.seededFoodsV1 = true; }
if (!state.settings.seededMealsV1) { seededMeals = mergeMeals().meals; state.settings.seededMealsV1 = true; }
if (seeded || seededMeals) save();
render();
if (seeded && seeded.foods) toast(`Added ${seeded.foods} of your foods${seededMeals ? ` and ${seededMeals} meals` : ''}`);
else if (seeded && seeded.pantry) toast(`Added ${seeded.pantry} pantry items`);
else if (seededMeals) toast(`Added ${seededMeals} starter ${seededMeals === 1 ? 'meal' : 'meals'}`);
loadPhotos().catch(() => { /* photos are optional */ });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ }); });
}
})();
