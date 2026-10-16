"use strict";
/* ---------------------------------------------------------------- спецификация (из Excel-шаблона) */
const S = window.SPEC;
const CF_CODE = {};
const cfLabel = l => String(l).replace(/^\s*\d+\.\s*/, "").replace(/\s*\((сумма строк|строка)[^)]*\)?\s*$/i, "").replace(/\s*\(строка[^)]*\)/gi, "").trim().replace(/^./, ch => ch.toUpperCase());
const LINES = { bal: S.bal, odr: S.odr, cf: S.cfstd.map(([t, k, l, c]) => { if (k) CF_CODE[k] = c; return [t, k, k ? cfLabel(l) : l]; }) };
const BLOCK_TITLE = { bal: "Баланс", odr: "ОПиУ", cf: "ДДС" };
const LINE = {};          // key -> {typ, key, label, block}
for (const b of ["bal", "odr", "cf"]) for (const [typ, key, label] of LINES[b]) if (key) LINE[key] = { typ, key, label, block: b };
const INPUT_KEYS = Object.keys(LINE).filter(k => LINE[k].typ !== "calc");
S.elim = S.elim.filter(l => l[1] !== "conf" && !/^КОНТРОЛЬ/.test(l[2]));
const ELIM_KEYS = S.elim.filter(l => l[1]).map(l => l[1]);
const MAX_COMP = 7, MAX_PER = 9;

/* ---------------------------------------------------------------- числа */
const isNum = v => typeof v === "number" && isFinite(v);
const N = v => (isNum(v) ? v : 0);
function parseNum(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return isFinite(s) ? s : null;
  let t = String(s).trim().replace(/[   \s']/g, "");
  if (t === "" || t === "-" || t === "—") return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith("−") || t.startsWith("-")) { neg = !neg; t = t.slice(1); }
  const seps = (t.match(/[.,]/g) || []).length;
  if (seps > 1) {
    const p = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    t = (t.length - p - 1 === 3) ? t.replace(/[.,]/g, "") : t.slice(0, p).replace(/[.,]/g, "") + "." + t.slice(p + 1);
  } else t = t.replace(",", ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const v = parseFloat(t);
  return isFinite(v) ? (neg ? -v : v) : null;
}
const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmt(v, kind = "m") {
  if (!isNum(v)) return v === null || v === undefined ? "" : String(v);
  const s = kind === "x" ? nf2.format(v) + "×" : kind === "p" ? nf1.format(v * 100) + " %" : kind === "d" ? nf0.format(v) : kind === "m1" ? nf1.format(v)
    : (Math.abs(v) < 10 && v % 1 ? nf2.format(v) : nf0.format(v));
  return s.replace("-", "−");
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------------------------------------------------------------- хранение: только в этом браузере + файл клиента */
const STORE = "finkz.clients.v1", STORE_ENC = "finkz.clients.enc.v1";
// ПИН-код: данные в браузере шифруются (AES-GCM, ключ из ПИН через PBKDF2); ключ живёт только в памяти открытой вкладки
const LOCK = { on: false, key: null, salt: null };
let CLIENTS = loadAll();
function loadAll() {
  try { if (localStorage.getItem(STORE_ENC)) { LOCK.on = true; return []; } return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch (e) { return []; }
}
const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const cryptoOk = () => !!(globalThis.crypto && crypto.subtle);
async function pinKey(pin, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encStore() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, LOCK.key, new TextEncoder().encode(JSON.stringify(CLIENTS))));
  return JSON.stringify({ v: 1, salt: b64(LOCK.salt), iv: b64(iv), ct: b64(ct) });
}
async function unlockPin(pin) {
  const o = JSON.parse(localStorage.getItem(STORE_ENC)), salt = unb64(o.salt), key = await pinKey(pin, salt);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.ct));   // неверный ПИН → ошибка
  LOCK.key = key; LOCK.salt = salt; CLIENTS = JSON.parse(new TextDecoder().decode(pt));
}
async function setPin(pin) {
  LOCK.salt = crypto.getRandomValues(new Uint8Array(16)); LOCK.key = await pinKey(pin, LOCK.salt); LOCK.on = true;
  localStorage.setItem(STORE_ENC, await encStore()); localStorage.removeItem(STORE);
}
function removePin() { LOCK.on = false; LOCK.key = null; localStorage.setItem(STORE, JSON.stringify(CLIENTS)); localStorage.removeItem(STORE_ENC); }
let saveTimer = null, lastSaved = null, savePending = null;
function saveAll(now) {
  clearTimeout(saveTimer);
  const go = () => {
    if (LOCK.on) {
      if (!LOCK.key) return;
      savePending = encStore().then(v => { localStorage.setItem(STORE_ENC, v); lastSaved = new Date(); paintSaved(); })
        .catch(e => toast("Не удалось сохранить в браузере: " + e.message + ". Сохраните файл клиента.")).finally(() => (savePending = null));
      return;
    }
    try { localStorage.setItem(STORE, JSON.stringify(CLIENTS)); lastSaved = new Date(); paintSaved(); }
    catch (e) { toast("Не удалось сохранить в браузере: " + e.message + ". Сохраните файл клиента."); }
  };
  if (now) go(); else saveTimer = setTimeout(go, 350);
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------------------------------------------------------------- модель клиента */
// ОПиУ по стандартным строкам: прежние «курсовая разница» и «прочие неоперационные, нетто» → неоперационные доходы / расходы
function migrateOdr(c) {
  if (!c || c._odr2) return;
  for (const k of Object.keys(c.data || {})) {
    const d = c.data[k]; if (!d || (!d.fx && !d.onoi)) continue;
    const pids = new Set([...Object.keys(d.fx || {}), ...Object.keys(d.onoi || {})]);
    d.onoi_in = d.onoi_in || {}; d.onoi_out = d.onoi_out || {};
    for (const pid of pids) {
      const a = d.fx?.[pid], b = d.onoi?.[pid]; if (!isNum(a) && !isNum(b)) continue;
      d.onoi_in[pid] = N(d.onoi_in[pid]) + Math.max(N(a), 0) + Math.max(N(b), 0);
      d.onoi_out[pid] = N(d.onoi_out[pid]) + Math.max(-N(a), 0) + Math.max(-N(b), 0);
    }
    delete d.fx; delete d.onoi;
  }
  c._odr2 = true;
}
function newClient(name) {
  const y = new Date().getFullYear();
  return {
    id: uid(), created: Date.now(), updated: Date.now(),
    card: { name: name || "Новый клиент", bin: "", activity: "", oked: [{ code: "", name: "" }], region: "", analyst: "", date: new Date().toISOString().slice(0, 10),
      purpose: S.lists.fpurpose[0], product: S.lists.product[0], amount: null, tol: 1 },
    companies: [{ name: "", bin: "", role: S.lists.role[0], form: S.lists.form[0], vat: "Да", regime: S.lists.regime[0] }],
    periods: [y - 3, y - 2, y - 1].map(yy => ({ id: uid(), label: String(yy), date: `${yy}-12-31`, basis: "Годовой", months: 12 })),
    obj: 0, _odr2: true, data: {}, src: {}, elim: {}, elimOk: {}, concl: { text: "", decision: "", conditions: "", status: "Черновик" }, log: [],
    custom: {}, settings: { units: "auto", prev: false }, decl: [], bank: [], dset: { pct: 0.02, bpct: 0.1 }, cr: [], coll: [], guar: []
  };
}
function demoClient() {
  const d = S.demo, c = newClient(d.name);
  c.card.activity = d.activity; c.card.oked = [{ code: "46.21.0", name: "" }, { code: "10.61.0", name: "" }, { code: "52.10.0", name: "" }]; c.card.analyst = "Кредитный менеджер (пример)"; c.card.amount = 300000;
  c.companies = d.companies.map(x => ({ ...x }));
  c.periods = d.periods.map(p => ({ ...p }));
  c.data = JSON.parse(JSON.stringify(d.data));
  c.elim = JSON.parse(JSON.stringify(d.elim));
  for (const p of c.periods) c.elimOk[p.id] = true;
  c.fc = JSON.parse(JSON.stringify(d.fc));
  c.demo = true;
  demoDocs(c);
  return c;
}
let C = null;          // открытый клиент
const nComp = () => C.companies.length;
const comp = k => C.companies[k - 1];
const compName = k => (LANG === "kz" && comp(k) && comp(k).nameKz) || (comp(k) && comp(k).name) || `Компания ${k}`;
function touch() { C.updated = Date.now(); CACHE.clear(); saveAll(); }

/* ---------------------------------------------------------------- расчёт (повторяет формулы Excel-шаблона) */
const CACHE = new Map();
function rawComp(k, key, pid) { const v = C.data?.[k]?.[key]?.[pid]; return isNum(v) ? v : null; }
function elimVal(key, pid) {
  const e = k => N(C.elim?.[k]?.[pid]);
  if (key === "c_dup") return e("e_up") - e("e_up_open");
  if (key === "c_cogs") return e("e_rev") - e("e_rev_opex") - (e("e_up") - e("e_up_open"));
  return e(key);
}
/* компания ещё не вела деятельность в периоде (зарегистрирована позже даты отчёта) — в группе считается нулями */
function regDateIso(k) { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(C?.trust?.[k]?.regDate || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; }
const perById = pid => C.periods.find(x => x.id === pid);
function inactAuto(k, pid) { const r = regDateIso(k), p = perById(pid); return !!(r && p && p.date && r > p.date); }
function inactive(k, pid) { if (!C || nComp() < 2) return false; const v = C.inactive?.[k]?.[pid]; return v === undefined ? inactAuto(k, pid) : !!v; }
function perStartIso(p) { const d = new Date(p.date); if (!p.date || isNaN(d)) return ""; const s = new Date(Date.UTC(d.getFullYear(), d.getMonth() - (N(p.months) || 12) + 1, 1)); return s.toISOString().slice(0, 10); }
// дата регистрации внутри периода — первый (неполный) год деятельности
function partialReg(k, pid) { const r = regDateIso(k), p = perById(pid); if (!r || !p || !p.date || r > p.date) return ""; return r > perStartIso(p) ? C.trust[k].regDate : ""; }
function rawObj(obj, key, pid) {
  if (obj > 0 || nComp() === 1) return rawComp(obj > 0 ? obj : 1, key, pid);
  let s = 0;
  for (let k = 1; k <= nComp(); k++) { if (inactive(k, pid)) continue; const v = rawComp(k, key, pid); if (v === null) return null; s += v; }
  const em = S.elim_map[key];
  if (em) s -= em.reduce((a, e) => a + elimVal(e, pid), 0);
  return s;
}
const allNum = (...a) => a.every(isNum);
function sumAll(g, keys) { const v = keys.map(g); return allNum(...v) ? v.reduce((a, b) => a + b, 0) : null; }
const CALC = {
  ca: g => sumAll(g, ["cash", "stinv", "ar", "oar", "inv", "taxa", "oca"]),
  lta: g => sumAll(g, ["ppe", "intang", "ltinv", "olta"]),
  ta: g => allNum(g("ca"), g("lta")) ? g("ca") + g("lta") : g("ta_rep"),
  cl: g => sumAll(g, ["stloan", "cpltd", "ap", "adv", "taxl", "ocl"]) ?? g("cl_rep"),
  ltl: g => sumAll(g, ["ltloan", "lease", "oltl"]) ?? g("ltl_rep"),
  eq: g => sumAll(g, ["sc", "re", "oeq"]) ?? g("eq_rep"),
  tle: g => allNum(g("cl"), g("ltl"), g("eq")) ? g("cl") + g("ltl") + g("eq") : null,
  bchk: g => allNum(g("ta"), g("tle")) ? g("ta") - g("tle") : null,
  gp: g => allNum(g("rev"), g("cogs")) ? g("rev") - g("cogs") : null,
  ebit: g => allNum(g("gp"), g("selling"), g("admin"), g("ooi"), g("ooe")) ? g("gp") - g("selling") - g("admin") + g("ooi") - g("ooe") : null,
  ebt: g => allNum(g("ebit"), g("fin_inc"), g("int"), g("onoi_in"), g("onoi_out")) ? g("ebit") + g("fin_inc") - g("int") + g("onoi_in") - g("onoi_out") : null,
  ni: g => allNum(g("ebt"), g("cit")) ? g("ebt") - g("cit") : g("ni_rep"),
  ebitda: g => allNum(g("ebit"), g("da")) ? g("ebit") + g("da") : null,
  adj: g => allNum(g("ebitda"), g("nonrec")) ? g("ebitda") - g("nonrec") : null,
};
// ОДДС по стандартной форме: итоги разделов = сумма строк «в том числе» (пустые строки = 0, если в разделе есть хоть одно значение)
const cfAny = g => Object.keys(CF_CODE).some(k => LINE[k].typ === "opt" && k !== "cf150r" && isNum(g(k)));
function cfSum(g, codes) { if (!cfAny(g)) return null; return codes.reduce((a, c) => a + N(g("cf" + c)), 0); }
for (const [tot, codes] of Object.entries(S.cftot)) CALC["cf" + tot] = g => cfSum(g, codes);
CALC.cf030 = g => allNum(g("cf010"), g("cf020")) ? g("cf010") - g("cf020") : null;
CALC.cf080 = g => allNum(g("cf040"), g("cf060")) ? g("cf040") - g("cf060") : null;
CALC.cf110 = g => allNum(g("cf090"), g("cf100")) ? g("cf090") - g("cf100") : null;
CALC.cf130 = g => allNum(g("cf030"), g("cf080"), g("cf110")) ? g("cf030") + g("cf080") + g("cf110") + N(g("cf120")) : null;
CALC.cf150 = g => allNum(g("cf130"), g("cf140")) ? g("cf140") + g("cf130") : null;
function val(obj, key, pid) {
  const ck = obj + "|" + key + "|" + pid;
  if (CACHE.has(ck)) return CACHE.get(ck);
  let v;
  if (CALC[key]) { CACHE.set(ck, null); v = CALC[key](k => val(obj, k, pid)); }
  else v = rawObj(obj, key, pid);
  v = isNum(v) ? v : null;
  CACHE.set(ck, v);
  return v;
}
const objName = obj => obj === 0 ? (nComp() > 1 ? "Группа (консолидированно)" : compName(1)) : compName(obj);
const perIdx = pid => C.periods.findIndex(p => p.id === pid);
const prevPid = pid => { const i = perIdx(pid); return i > 0 ? C.periods[i - 1].id : null; };
const lastPid = () => C.periods[C.periods.length - 1]?.id;
function months(pid) { const p = C.periods[perIdx(pid)]; return p && p.months > 0 ? p.months : 12; }
function annual(pid) { const p = C.periods[perIdx(pid)]; return p && (p.basis === "Годовой" || p.basis === "LTM") ? 1 : 12 / months(pid); }

/* ---------------------------------------------------------------- коэффициенты и статусы */
const RAT = {};
for (const r of S.ratios) if (r[0] === "r") RAT[r[1]] = { key: r[1], label: r[2], formula: r[3], dir: r[4], green: r[5], red: r[6], crit: r[7], critNP: r[8], note: r[9] };
const KIND = { liq_cur: "x", liq_quick: "x", liq_abs: "x", nwc: "m", gm: "p", ebitda_m: "p", op_m: "p", net_m: "p", roa: "p", roe: "p", debt: "m", ndebt: "m",
  ebitda: "m", ebitda_ann: "m", adj_ebitda: "m", debt_ebitda: "x", ndebt_ebitda: "x", de: "x", liab_ta: "x", eq_ratio: "x", icr: "x", ebitda_icr: "x",
  dso: "d", dio: "d", dpo: "d", cycle: "d", asset_turn: "x", cfo: "m", capex_est: "m", fcf: "m", cfo_conv: "p", dscr_hist: "x", cfo_dds: "m" };
RAT.cfo_dds = { key: "cfo_dds", label: "Операционный денежный поток по ОДДС, тыс. тг", formula: "Поступления − выбытие по операционной деятельности (если ОДДС загружен)", dir: null };
const NP = "н/п";
// свои нормативы коэффициентов (хранятся в браузере, действуют для всех клиентов)
const RAT_DEF = {}; for (const k of Object.keys(RAT)) RAT_DEF[k] = { green: RAT[k].green, red: RAT[k].red, crit: RAT[k].crit };
const RATN_KEY = "finkz.ratios.v1";
let RATN = (() => { try { return JSON.parse(localStorage.getItem(RATN_KEY) || "{}"); } catch (e) { return {}; } })();
function applyRatn() { for (const k of Object.keys(RAT_DEF)) Object.assign(RAT[k], RAT_DEF[k], RATN[k] || {}); }
applyRatn();
function ratio(obj, key, pid) {
  const g = k => val(obj, k, pid), pp = prevPid(pid), gp = k => (pp ? val(obj, k, pp) : null);
  const div = (a, b) => (allNum(a, b) && b !== 0 ? a / b : null);
  const days = months(pid) * 365 / 12, A = annual(pid);
  const debt = () => sumAll(g, ["stloan", "cpltd", "ltloan", "lease"]);
  const avg = k => (allNum(g(k), gp(k)) && annual(pp) === 1 && months(pid) === 12 ? (g(k) + gp(k)) / 2 : g(k));
  const ebitdaA = () => (isNum(g("ebitda")) ? g("ebitda") * A : null);
  switch (key) {
    case "liq_cur": return div(g("ca"), g("cl"));
    case "liq_quick": return div(sumAll(g, ["cash", "stinv", "ar", "oar"]), g("cl"));
    case "liq_abs": return div(sumAll(g, ["cash", "stinv"]), g("cl"));
    case "nwc": return allNum(g("ca"), g("cl")) ? g("ca") - g("cl") : null;
    case "gm": return div(g("gp"), g("rev"));
    case "ebitda_m": return div(g("ebitda"), g("rev"));
    case "op_m": return div(g("ebit"), g("rev"));
    case "net_m": return div(g("ni"), g("rev"));
    case "roa": return isNum(g("ni")) ? div(g("ni") * A, avg("ta")) : null;
    case "roe": if (isNum(g("eq")) && g("eq") <= 0) return NP; return isNum(g("ni")) ? div(g("ni") * A, avg("eq")) : null;
    case "debt": return debt();
    case "ndebt": return allNum(debt(), g("cash"), g("stinv")) ? debt() - g("cash") - g("stinv") : null;
    case "ebitda": return g("ebitda");
    case "ebitda_ann": return ebitdaA();
    case "adj_ebitda": return g("adj");
    case "debt_ebitda": if (isNum(ebitdaA()) && ebitdaA() <= 0) return NP; return div(debt(), ebitdaA());
    case "ndebt_ebitda": { if (isNum(ebitdaA()) && ebitdaA() <= 0) return NP; const nd = ratio(obj, "ndebt", pid); return div(nd, ebitdaA()); }
    case "de": if (isNum(g("eq")) && g("eq") <= 0) return NP; return div(debt(), g("eq"));
    case "liab_ta": return allNum(g("cl"), g("ltl")) ? div(g("cl") + g("ltl"), g("ta")) : null;
    case "eq_ratio": return div(g("eq"), g("ta"));
    case "icr": return isNum(g("int")) && g("int") === 0 ? null : div(g("ebit"), g("int"));
    case "ebitda_icr": return isNum(g("int")) && g("int") === 0 ? null : div(g("ebitda"), g("int"));
    case "dso": return isNum(div(g("ar"), g("rev"))) ? g("ar") / g("rev") * days : null;
    case "dio": return isNum(div(g("inv"), g("cogs"))) ? g("inv") / g("cogs") * days : null;
    case "dpo": return isNum(div(g("ap"), g("cogs"))) ? g("ap") / g("cogs") * days : null;
    case "cycle": { const a = ratio(obj, "dso", pid), b = ratio(obj, "dio", pid), c = ratio(obj, "dpo", pid); return allNum(a, b, c) ? a + b - c : null; }
    case "asset_turn": return isNum(g("rev")) ? div(g("rev") * A, avg("ta")) : null;
    case "cfo": {
      if (!pp) return null;
      const opa = k => sumAll(k, ["ar", "oar", "inv", "taxa", "oca"]), opl = k => sumAll(k, ["ap", "adv", "taxl", "ocl"]);
      const v = [g("ni"), g("da"), opa(g), opa(gp), opl(g), opl(gp)];
      return allNum(...v) ? v[0] + v[1] - (v[2] - v[3]) + (v[4] - v[5]) : null;
    }
    case "capex_est": { if (!pp) return null; const v = [g("ppe"), g("intang"), gp("ppe"), gp("intang"), g("da")]; return allNum(...v) ? v[0] + v[1] - v[2] - v[3] + v[4] : null; }
    case "fcf": { const a = ratio(obj, "cfo", pid), b = ratio(obj, "capex_est", pid); return allNum(a, b) ? a - b : null; }
    case "cfo_conv": { const a = ratio(obj, "cfo", pid); return div(a, g("ebitda")); }
    case "dscr_hist": {
      if (months(pid) !== 12) return null;
      const ds = allNum(g("int"), gp("cpltd")) ? g("int") + gp("cpltd") : null;
      return allNum(g("ebitda"), g("cit")) ? div(g("ebitda") - g("cit"), ds) : null;
    }
    case "cfo_dds": return g("cf030");
  }
  return null;
}
const ST = { ok: "Норма", chk: "Требует проверки", risk: "Риск", crit: "Критический риск", nd: "Недостаточно данных" };
function rstatus(key, v) {
  const r = RAT[key];
  if (!r || !r.dir || r.green === null || r.green === undefined) return isNum(v) ? null : (v === NP ? "crit" : null);
  if (v === NP) return r.critNP ? "crit" : "nd";
  if (!isNum(v)) return "nd";
  const hi = r.dir === "Выше лучше";
  if (hi ? v >= r.green : v <= r.green) return "ok";
  if (hi ? v >= r.red : v <= r.red) return "chk";
  if (r.crit !== null && r.crit !== undefined && (hi ? v < r.crit : v > r.crit)) return "crit";
  return "risk";
}

/* ---------------------------------------------------------------- проверки (как лист «Сверки») */
function compChecks(k, pid) {
  const g = key => val(k, key, pid), tol = N(C.card.tol) || 1, pp = prevPid(pid);
  const abs = (a, b) => (allNum(a, b) ? (Math.abs(a - b) <= tol ? "ok" : "bad") : "nd");
  const sums = (keys) => sumAll(g, keys);
  const out = [];
  out.push(["Баланс сходится: активы = обязательства + капитал", isNum(g("bchk")) ? (Math.abs(g("bchk")) <= tol ? "ok" : "bad") : "nd", g("bchk")]);
  out.push(["Итог активов = отчётность", !isNum(g("ta_rep")) ? "na" : abs(sums(["cash", "stinv", "ar", "oar", "inv", "taxa", "oca", "ppe", "intang", "ltinv", "olta"]), g("ta_rep"))]);
  out.push(["Итог краткосрочных обязательств = отчётность", !isNum(g("cl_rep")) ? "na" : abs(sums(["stloan", "cpltd", "ap", "adv", "taxl", "ocl"]), g("cl_rep"))]);
  out.push(["Итог долгосрочных обязательств = отчётность", !isNum(g("ltl_rep")) ? "na" : abs(sums(["ltloan", "lease", "oltl"]), g("ltl_rep"))]);
  out.push(["Итог капитала = отчётность", !isNum(g("eq_rep")) ? "na" : abs(sums(["sc", "re", "oeq"]), g("eq_rep"))]);
  out.push(["Чистая прибыль: расчёт = отчётность", !isNum(g("ni_rep")) ? "na" : (allNum(g("ebt"), g("cit")) ? abs(g("ebt") - g("cit"), g("ni_rep")) : "nd")]);
  out.push([C.eqmv?.[k]?.[pid] ? "Нераспределённая прибыль: изменение = ЧП − дивиденды ± прочие движения (отчёт о капитале)" : "Нераспределённая прибыль: изменение = ЧП − дивиденды", !pp || !isNum(g("div")) ? "na" : (allNum(g("re"), val(k, "re", pp), g("ni")) ? abs(g("re") - val(k, "re", pp), g("ni") - g("div") + (C.eqmv?.[k]?.[pid] ? eqOther(k, pid) : 0)) : "nd")]);
  out.push(["ОДДС: деньги на конец (стр. 150) = деньги в балансе", !isNum(g("cf150")) ? "na" : abs(g("cf150"), g("cash")), allNum(g("cf150"), g("cash")) ? g("cf150") - g("cash") : null]);
  out.push(["ОДДС: стр. 150 по расчёту = по отчётности", !isNum(g("cf150r")) ? "na" : abs(g("cf150"), g("cf150r")), allNum(g("cf150"), g("cf150r")) ? g("cf150") - g("cf150r") : null]);
  out.push(["ОДДС: деньги на начало (стр. 140) = деньги в балансе прошлого периода", !pp || !isNum(g("cf140")) ? "na" : abs(g("cf140"), val(k, "cash", pp)), pp && allNum(g("cf140"), val(k, "cash", pp)) ? g("cf140") - val(k, "cash", pp) : null]);
  return out;
}
function elimChecks(pid) {
  const e = k => N(C.elim?.[k]?.[pid]);
  const assets = e("e_ar") + e("e_oar") + e("e_stinv") + e("e_ltinv"), le = e("e_ap") + e("e_ocl") + e("e_stloan") + e("e_ltloan") + e("e_sc") + e("e_eqo");
  const tol = N(C.card.tol) || 1;
  return [["Внутригрупповые суммы: активы = обязательства + капитал", Math.abs(assets - le) <= tol ? "ok" : "bad", assets - le],
    ["Встречность: внутригрупповая ДЗ = КЗ", Math.abs(e("e_ar") - e("e_ap")) <= tol ? "ok" : "bad", e("e_ar") - e("e_ap")],
    ["Внутригрупповые суммы подтверждены кредитным менеджером", C.elimOk?.[pid] ? "ok" : "bad"]];
}
function missingInputs(k, pid) {
  return INPUT_KEYS.filter(key => LINE[key].typ === "in" && LINE[key].block !== "cf" && rawComp(k, key, pid) === null).length;
}
