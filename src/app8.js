"use strict";
/* ---------------------------------------------------------------- «Налоги» и «Банк»: хранение документов, сверка с отчётностью, страницы и диалоги.
   Декларации, выписки и справки хранятся в клиенте в тенге (валюте счёта), как в документах; в сверке — тыс. тг. */
const DMAP_KEY = "finkz.declmap.v1";
let DMAP = (() => { try { return JSON.parse(localStorage.getItem(DMAP_KEY) || "{}"); } catch (e) { return {}; } })();
const saveDmap = () => { try { localStorage.setItem(DMAP_KEY, JSON.stringify(DMAP)); } catch (e) { /* только на сеанс */ } };
const PARTS = { Y: "год", H1: "1 полугодие", H2: "2 полугодие", Q1: "1 квартал", Q2: "2 квартал", Q3: "3 квартал", Q4: "4 квартал" };
const CURS = ["KZT", "USD", "EUR", "RUB", "CNY", "GBP", "Другая"];
const MON_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const pad2 = n => String(n).padStart(2, "0");
const ymLabel = ym => { const [y, m] = ym.split("-"); return `${MON_RU[+m - 1]} ${y}`; };
const partMonths = p => (p === "Y" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : p[0] === "H" ? [1, 2, 3, 4, 5, 6].map(m => m + (+p[1] - 1) * 6) : [1, 2, 3].map(m => m + (+p[1] - 1) * 3));
const vatRate = y => (y >= 2026 ? 0.16 : 0.12);
const m2 = v => (isNum(v) ? nf2.format(v) : "");
const K1 = v => (isNum(v) ? nf1.format(v / 1000) : "");          // тенге → тыс. тг для показа и правки
const fromK = s => { const v = parseNum(s); return v === null ? null : Math.round(v * 1000 * 100) / 100; };
const pctFmt = v => (isNum(v) ? nf1.format(v * 100) + " %" : "");
function ensureDocs(c = C) { if (!c) return; migrateOdr(c); c.decl = c.decl || []; c.bank = c.bank || []; c.dset = c.dset || { pct: 0.02, bpct: 0.1 }; c.fx = c.fx || {}; for (const b of c.bank) b.kind = b.kind || "turn"; }
function perMonths(p) {
  const d = new Date(p.date); if (!p.date || isNaN(d)) return [];
  let y = d.getFullYear(), m = d.getMonth() + 1; const out = [];
  for (let i = 0; i < (p.months || 12); i++) { out.unshift(`${y}-${pad2(m)}`); if (--m === 0) { m = 12; y--; } }
  return out;
}
const dmyToYm = s => (s && /^\d{2}\.\d{2}\.\d{4}$/.test(s) ? `${s.slice(6)}-${s.slice(3, 5)}` : null);
// вид декларации: очередная/первоначальная — основная; дополнительная — суммы в ней это разница к ранее поданной (ст. НК РК), поэтому прибавляется
const DECL_VID = { main: "Очередная / первоначальная", add: "Дополнительная", addn: "Дополнительная по уведомлению" };
const isAddDecl = d => d.vid === "add" || d.vid === "addn";
function declVal(k, p, key) {
  const win = new Set(perMonths(p)), cov = new Set(), docs = []; let sum = 0;
  const all = C.decl.filter(d => d.k === k && d.vals && isNum(d.vals[key]) && d.year);
  const list = all.filter(d => !isAddDecl(d)).sort((a, b) => ((a.part === "Y" ? 0 : 1) - (b.part === "Y" ? 0 : 1)) || (N(b.t) - N(a.t)));  // годовые раньше, из повторных основных — последняя загруженная
  const used = [];
  for (const d of list) {
    const ms = partMonths(d.part).map(m => `${d.year}-${pad2(m)}`);
    if (!ms.every(x => win.has(x)) || ms.some(x => cov.has(x))) continue;
    ms.forEach(x => cov.add(x)); sum += d.vals[key]; docs.push(d); used.push(d);
  }
  // дополнительные к уже учтённым основным (та же форма, год и налоговый период) — прибавляем разницу
  for (const d of all.filter(isAddDecl)) {
    if (!used.some(b => b.year === d.year && b.part === d.part && b.form === d.form)) continue;
    sum += d.vals[key]; docs.push(d);
  }
  return docs.length ? { v: sum / 1000, cov: cov.size, need: win.size, docs } : null;
}

/* ---------- курсы валют НБ РК (вводятся или загружаются пользователем; хранятся в браузере и в файле клиента) */
const FX_KEY = "finkz.fx.v1";
let FX = (() => { try { return JSON.parse(localStorage.getItem(FX_KEY) || "{}"); } catch (e) { return {}; } })();
const saveFx = () => { try { localStorage.setItem(FX_KEY, JSON.stringify(FX)); } catch (e) { /* только на сеанс */ } };
function fxSet(cur, key, v) {
  FX[cur] = FX[cur] || {}; C.fx = C.fx || {}; C.fx[cur] = C.fx[cur] || {};
  if (isNum(v) && v > 0) { FX[cur][key] = v; C.fx[cur][key] = v; } else { delete FX[cur][key]; delete C.fx[cur][key]; }
  saveFx();
}
// курс на дату поступления; если на дату нет — ближайший предыдущий (до 10 дней, выходные), иначе курс за месяц
function fxRateInfo(cur, iso) {
  if (!cur || cur === "KZT") return { r: 1, d: iso };
  const src = [C?.fx?.[cur], FX[cur]].filter(Boolean);
  for (const t of src) if (isNum(t[iso])) return { r: t[iso], d: iso };
  if (iso.length === 10) {
    const d = new Date(iso + "T00:00:00Z");
    for (let i = 1; i <= 10; i++) { const k = new Date(d - i * 86400000).toISOString().slice(0, 10); for (const t of src) if (isNum(t[k])) return { r: t[k], d: k }; }
    for (const t of src) if (isNum(t[iso.slice(0, 7)])) return { r: t[iso.slice(0, 7)], d: iso.slice(0, 7) };
  }
  return null;
}
const fxRate = (cur, iso) => fxRateInfo(cur, iso)?.r ?? null;
const dmy = iso => (iso.length === 7 ? ymLabel(iso) : iso.split("-").reverse().join("."));
async function loadFxFile(file) {
  let sheets;
  if (/\.csv$/i.test(file.name)) sheets = csvSheets(await file.arrayBuffer());
  else sheets = await readWorkbook(await file.arrayBuffer());
  let n = 0;
  const CODES = /^(USD|EUR|RUB|CNY|GBP|CHF|AED|TRY|KGS|UZS|JPY|BYN|UAH|AZN|GEL|AMD|INR|KRW|CAD|AUD|SEK|NOK|DKK|PLN|CZK|HUF|SGD|HKD|SAR|IRR|MYR|THB|MXN|BRL|ZAR)\b/;
  const asDate = v => { if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); return DocParse.toISO(String(v ?? "")); };
  for (const sh of sheets) {
    const rows = sh.rows || []; let hdr = null, hr = -1;
    for (let r = 0; r < Math.min(rows.length, 30) && !hdr; r++) {
      const row = rows[r] || []; const m = {};
      row.forEach((v, c) => { const x = CODES.exec(String(v ?? "").replace(/^1\s+/, "").trim().toUpperCase()); if (x) m[c] = x[1]; });
      if (Object.keys(m).length >= 1 && row.some(v => /дата|date/i.test(String(v ?? "")))) { hdr = m; hr = r; }
    }
    if (hdr) {
      for (let r = hr + 1; r < rows.length; r++) {
        const row = rows[r] || []; const d = row.map(asDate).find(Boolean); if (!d) continue;
        for (const [c, cur] of Object.entries(hdr)) { const v = typeof row[c] === "number" ? row[c] : DocParse.amt(String(row[c] ?? "")); if (isNum(v) && v > 0) { fxSet(cur, d, v); n++; } }
      }
    } else for (const row of rows) {
      // длинный формат: дата | валюта | курс
      if (!row) continue;
      const d = row.map(asDate).find(Boolean), cur = row.map(v => CODES.exec(String(v ?? "").trim().toUpperCase())?.[1]).find(Boolean);
      const v = row.filter(x => typeof x === "number" && x > 0 && x < 100000 && !(x > 30000 && x < 80000 && asDate(x))).pop();
      if (d && cur && isNum(v)) { fxSet(cur, d, v); n++; }
    }
  }
  if (!n) throw new Error("не найдены курсы (нужны колонки «Дата» и коды валют USD, EUR… или строки «дата — валюта — курс»)");
  touch();
  return n;
}
function csvSheets(buf) {
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) t = new TextDecoder("windows-1251").decode(buf);
  const lines = t.replace(/^﻿/, "").split(/\r?\n/);
  const sep = [";", "\t", ","].map(s => [s, (lines.slice(0, 20).join("\n").match(new RegExp(s === "\t" ? "\t" : "\\" + s, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = lines.map(l => { const out = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); });
  return [{ name: "CSV", rows }];
}

/* ---------- банк: операции, чистые кредитовые обороты */
const CAT_SHORT = { loan: "Кредиты, займы", conv: "Конвертация", own: "Свои средства", ret: "Возвраты", aid: "Помощь, субсидии, штрафы, %", cash: "Наличные", grp: "Компании группы" };
function ownOf(k) {
  const x = comp(k) || {}, bins = [x.bin, k === 1 ? C.card.bin : ""].map(b => String(b || "").replace(/\D/g, "")).filter(b => b.length === 12);
  const grp = C.dset?.grpEx === false ? [] : C.companies.map((y, i) => (i + 1 === k ? "" : String(y.bin || "").replace(/\D/g, ""))).filter(b => b.length === 12 && !bins.includes(b));
  return { bins, grp, names: [DocParse.clean(x.name || ""), k === 1 ? DocParse.clean(C.card.name || "") : ""].filter(n => n.length > 3) };
}
function txCat(doc, i, t, own) {
  const o = doc.ov?.[i];
  if (o === "inc") return [null, "включено вручную"];
  if (o) return [o, "исключено вручную"];
  const c = DocParse.classify(t, own);
  return c || [null, ""];
}
function txKzt(doc, t, v) {
  const cur = t.cur || doc.cur || "KZT";
  if (cur === "KZT") return v;
  if (v === t.cr && isNum(t.eq) && t.eq > 0) return t.eq;
  const r = fxRate(cur, t.d); return r ? v * r : null;
}
function monthsBetween(from, to) {
  const a = DocParse.toISO(from || ""), b = DocParse.toISO(to || ""); if (!a || !b || a > b) return [];
  const out = []; let y = +a.slice(0, 4), m = +a.slice(5, 7); const ey = +b.slice(0, 4), em = +b.slice(5, 7);
  for (let i = 0; i < 120 && (y < ey || (y === ey && m <= em)); i++) { out.push(`${y}-${pad2(m)}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
// помесячно в тенге: кредит всего, исключено по видам, чистые обороты, дебет; выписки важнее справок по тому же счёту
function bankMonths(k) {
  ensureDocs();
  const res = {}, own = ownOf(k), covered = new Set();
  const get = m => res[m] || (res[m] = { gross: 0, net: 0, db: 0, ex: {}, src: new Set(), nofx: 0 });
  // повторно загруженная выписка по тому же счёту за те же месяцы не удваивает обороты: берётся последняя
  for (const b of C.bank.filter(b => b.k === k && b.kind === "stmt").sort((a, c) => N(c.t) - N(a.t))) {
    const acc = b.acc || "?", mine = new Set([...monthsBetween(b.from, b.to), ...(b.txs || []).map(t => t.d.slice(0, 7))].filter(m => !(b.acc && covered.has(acc + "|" + m))));
    for (const m of mine) get(m).src.add("выписка");
    (b.txs || []).forEach((t, i) => {
      const m = t.d.slice(0, 7); if (!mine.has(m)) return;
      const o = get(m);
      if (t.cr) {
        const v = txKzt(b, t, t.cr); if (v === null) { o.nofx++; return; }
        o.gross += v; const [c] = txCat(b, i, t, own);
        if (c) o.ex[c] = (o.ex[c] || 0) + v; else o.net += v;
      }
      if (t.db) { const v = txKzt(b, t, t.db); if (v !== null) o.db += v; }
    });
    for (const m of mine) covered.add(acc + "|" + m);
  }
  for (const b of C.bank.filter(b => b.k === k && b.kind !== "stmt" && !b.rangeOnly)) {
    for (const [m, v] of Object.entries(b.months || {})) {
      if (covered.has((b.acc || "?") + "|" + m)) continue;
      const r = b.cur === "KZT" ? 1 : isNum(b.rate) && b.rate > 0 ? b.rate : fxRate(b.cur, m);
      const o = get(m); if (!r) { o.nofx++; continue; }
      o.src.add("справка"); o.gross += N(v.cr) * r; o.net += N(v.cr) * r; o.db += N(v.db) * r; o.turn = true;
    }
  }
  return res;
}
function bankVal(k, p) {
  const win = perMonths(p), M = bankMonths(k), mset = new Set(); let gross = 0, net = 0, db = 0, nofx = 0, turn = false, n = 0; const ex = {};
  for (const m of win) { const o = M[m]; if (!o) continue; mset.add(m); n++; gross += o.gross; net += o.net; db += o.db; nofx += o.nofx; if (o.turn) turn = true; for (const [c, v] of Object.entries(o.ex)) ex[c] = (ex[c] || 0) + v; }
  for (const b of C.bank.filter(b => b.k === k && b.rangeOnly)) {
    if (dmyToYm(b.from) !== win[0] || dmyToYm(b.to) !== win[win.length - 1]) continue;
    const r = b.cur === "KZT" ? 1 : isNum(b.rate) && b.rate > 0 ? b.rate : null; if (!r) { nofx++; continue; }
    gross += N(b.total?.cr) * r; net += N(b.total?.cr) * r; db += N(b.total?.db) * r; win.forEach(m => mset.add(m)); turn = true; n++;
  }
  if (!n) return null;
  for (const c of Object.keys(ex)) ex[c] /= 1000;
  return { v: net / 1000, gross: gross / 1000, db: db / 1000, ex, cov: mset.size, need: win.length, nofx, turn };
}

/* ---------- сверки */
const TAXFIX = {
  rev: "Выясните причину: другой период, выручка не отражена в декларации или в отчётности, НДС включён в одну из сумм, корректировки после сдачи декларации. Запросите расшифровку дохода и, при необходимости, дополнительную декларацию.",
  vat: "Оборот по НДС считается без НДС; расхождения дают авансы, экспорт по нулевой ставке, необлагаемые обороты и разные даты признания. Если разница большая — запросите реестр счетов-фактур и пояснение.",
  sgd: "В СГД входят прочие доходы (курсовая разница, списание обязательств, выбытие активов, вознаграждение). Сверьте расшифровку прочих доходов с декларацией.",
  cit: "Расход по КПН в ОПиУ включает отложенный налог — сравнивайте с текущим КПН. Большая разница — повод запросить расчёт КПН и налоговые корректировки.",
  fot: "Сверьте ФОТ с ф. 200.00 за все кварталы периода и с расчётной ведомостью; учтите ИП и договоры ГПХ.",
  bank_cf: "Сравниваются чистые кредитовые обороты и поступления от операционной деятельности по ОДДС. Разницу дают касса (наличная выручка), счета в других банках, не загруженные выписки и спорные операции — проверьте классификацию операций в выписках.",
  bank_lo: "Через счета прошла меньшая часть выручки: наличные расчёты, счета в других банках или взаимозачёты. Запросите выписки по всем счетам и расшифровку выручки по способам оплаты.",
  bank_hi: "Чистые кредитовые обороты намного больше выручки: проверьте, не остались ли в расчёте займы, транзитные платежи, возвраты и переводы между своими счетами (кнопка «Операции» у выписки).",
};
const TAX_IDS = ["rev", "vat", "sgd", "cit", "fot"], BANK_IDS = ["bank_rev", "bank_cf"];
function taxChecks(k, p) {
  ensureDocs();
  const pid = p.id, g = key => val(k, key, pid), tol = N(C.card.tol) || 1, pct = N(C.dset.pct) || 0.02, bp = N(C.dset.bpct) || 0.1, out = [];
  const cell = key => ({ k, key, pid });
  const add = (id, title, aLab, a, bLab, bo, o) => {
    if (!bo) return;
    const full = bo.cov === bo.need && isNum(bo.v) && !bo.nofx;
    let st = "nd", diff = null, rel = null;
    if (isNum(a) && full) { diff = a - bo.v; rel = Math.abs(diff) / Math.max(Math.abs(bo.v), Math.abs(a), 1); st = Math.abs(diff) <= tol || rel <= o.ok ? "ok" : rel > o.risk ? (o.max || "risk") : "chk"; }
    out.push({ id, grp: o.grp || "tax", title, aLab, a, bLab, b: bo.v, cov: bo.cov, need: bo.need, full, diff, rel, st, cells: o.cells, fix: o.fix || TAXFIX[id], docs: bo.docs, nofx: bo.nofx });
  };
  const rv = declVal(k, p, "rev");
  add("rev", "Выручка и доход по декларации", "Выручка по ОПиУ", g("rev"), rv && rv.docs.some(d => d.form !== "100") ? "Доход по декларации (" + [...new Set(rv.docs.map(d => d.form + ".00"))].join(", ") + ")" : "Доход от реализации по ф. 100.00", rv, { ok: pct, risk: 0.1, cells: [cell("rev")] });
  const vt = declVal(k, p, "vat_turn"), vx = declVal(k, p, "vat_ex");
  if (vt) add("vat", "Выручка и оборот по НДС", "Выручка по ОПиУ", g("rev"), vx && vx.cov === vt.cov ? "Облагаемый и освобождённый оборот (ф. 300.00)" : "Облагаемый оборот (ф. 300.00)", { ...vt, v: vt.v + (vx && vx.cov === vt.cov ? vx.v : 0) }, { ok: pct * 2, risk: 0.15, cells: [cell("rev")] });
  const sg = declVal(k, p, "sgd");
  const inc = isNum(g("rev")) ? g("rev") + N(g("ooi")) + N(g("fin_inc")) + N(g("onoi_in")) : null;
  add("sgd", "Все доходы и совокупный годовой доход", "Доходы по ОПиУ (выручка, прочие, финансовые)", inc, "СГД по ф. 100.00", sg, { ok: pct * 2, risk: 0.15, max: "chk", cells: [cell("rev"), cell("ooi"), cell("fin_inc")] });
  const ct = declVal(k, p, "cit");
  add("cit", "КПН по отчётности и по декларации", "Расход по КПН в ОПиУ", g("cit"), ct && ct.docs.some(d => d.form === "910") ? "Налог по ф. 910.00" : "КПН по декларации", ct, { ok: 0.05, risk: 0.3, max: "chk", cells: [cell("cit")] });
  const ft = declVal(k, p, "fot");
  if (ft) add("fot", "ФОТ и доходы работников", "ФОТ (справочно в ОПиУ)", g("fot"), "Доходы работников по декларации", ft, { ok: pct * 2, risk: 0.15, max: "chk", cells: [cell("fot")] });
  const bk = bankVal(k, p);
  if (bk) {
    const netLab = bk.turn ? "Кредитовые обороты (по справкам — без исключений)" : "Чистые кредитовые обороты";
    const year = +(p.date || "").slice(0, 4), vat = comp(k)?.vat === "Да" ? vatRate(year) : 0, r0 = g("rev");
    if (isNum(r0) && r0 > 0) {
      const full = bk.cov === bk.need && !bk.nofx, base = r0 * (1 + vat), share = full ? bk.v / base : null;
      const st = !full ? "nd" : share < 0.5 ? "risk" : share < 0.8 || share > 1.5 ? "chk" : "ok";
      out.push({ id: "bank_rev", grp: "bank", title: "Чистые кредитовые обороты и выручка", aLab: vat ? `Выручка с НДС ${Math.round(vat * 100)} %` : "Выручка (компания не плательщик НДС)", a: base, bLab: netLab, b: bk.v, cov: bk.cov, need: bk.need, full, diff: full ? bk.v - base : null, rel: share, share: true, st,
        cells: [cell("rev")], fix: share !== null && share > 1.5 ? TAXFIX.bank_hi : TAXFIX.bank_lo, nofx: bk.nofx, bk });
    }
    if (isNum(g("cf010"))) add("bank_cf", "Чистые кредитовые обороты и ОДДС", "Поступления от операционной деятельности (ОДДС, стр. 010)", g("cf010"), netLab, bk, { grp: "bank", ok: bp, risk: 0.25, cells: [cell("cf010")] });
  }
  return out;
}
function taxProblems(add) {
  if (!C) return; ensureDocs();
  if (!C.decl.length && !C.bank.length) return;
  for (let k = 1; k <= nComp(); k++) for (const p of C.periods) for (const c of taxChecks(k, p)) {
    const where = `${compName(k)}, ${p.label}`;
    if (c.st === "chk" || c.st === "risk") {
      const det = c.share ? `чистые кредитовые обороты ${fmt(c.b)} — ${pctFmt(c.rel)} от выручки с НДС ${fmt(c.a)}` : `${c.aLab}: ${fmt(c.a)}; ${c.bLab}: ${fmt(c.b)}; разница ${fmt(c.diff)} (${pctFmt(c.rel)})`;
      add(c.st, c.grp, `${where}: ${c.title.toLowerCase()} — расхождение`, det, c.fix, c.cells);
    } else if (c.st === "nd" && c.cov < c.need && c.cov > 0) add("nd", c.grp, `${where}: ${c.title.toLowerCase()} — данные не за весь период`, `загружено ${c.cov} из ${c.need} мес.`, c.grp === "bank" ? "Загрузите выписки или справки за остальные месяцы периода — тогда сверка выполнится." : "Загрузите декларации за остальные части периода — тогда сверка выполнится.");
    if (c.nofx && c.id === "bank_rev") add("chk", "bank", `${where}: нет курса НБ РК для ${c.nofx} операций в валюте`, "", "Укажите курсы на странице «Банк» (блок «Курсы НБ РК») или загрузите их файлом — тогда валютные поступления войдут в обороты.");
  }
}
function checksTable(k, ids, emptyText) {
  const pers = C.periods, checks = pers.map(p => taxChecks(k, p).filter(c => ids.includes(c.id)));
  const have = ids.filter(id => checks.some(cs => cs.some(c => c.id === id)));
  if (!have.length) return `<p class="muted">${emptyText}</p>`;
  let h = `<div class="tablewrap" style="max-height:none"><table class="data rmap tax"><thead><tr><th class="lab">Показатель</th>${pers.map(p => `<th>${esc(p.label)}</th>`).join("")}</tr></thead><tbody>`;
  for (const id of have) {
    const row = () => checks.map(cs => cs.find(c => c.id === id));
    const any = row().find(Boolean);
    h += `<tr class="sec"><td class="lab" colspan="${pers.length + 1}">${esc(any.title)}</td></tr>`;
    h += `<tr><td class="lab">${esc(any.aLab)}</td>${row().map(c => `<td>${c ? fmt(c.a) : ""}</td>`).join("")}</tr>`;
    h += `<tr><td class="lab">${esc(any.bLab)}</td>${row().map(c => `<td>${c ? fmt(c.b) + (c.cov < c.need ? `<span class="pertitle">${c.cov} из ${c.need} мес.</span>` : "") + (c.nofx ? `<span class="pertitle">без курса: ${c.nofx} оп.</span>` : "") : ""}</td>`).join("")}</tr>`;
    h += `<tr><td class="lab">${any.share ? "Доля чистых оборотов в выручке с НДС" : "Расхождение (разница, %)"}</td>${row().map(c => {
      if (!c) return "<td></td>";
      if (c.st === "nd") return `<td class="v nd"><span class="val">${c.cov < c.need ? "неполный период" : c.nofx ? "нет курса" : "нет данных"}</span></td>`;
      const txt = c.share ? pctFmt(c.rel) : `${fmt(Math.round(c.diff))} · ${pctFmt(c.rel)}`;
      return `<td class="v ${c.st}" title="${esc(c.st === "ok" ? "В допуске" : c.fix)}"><span class="val">${txt}</span></td>`;
    }).join("")}</tr>`;
  }
  return h + `</tbody></table></div>`;
}
const LEGEND = `<span class="st ok">в допуске</span> <span class="st chk">проверить</span> <span class="st risk">существенное</span>`;

/* ---------- страница «Налоги» */
function pageTax() {
  ensureDocs();
  const k = COMP_TAB > nComp() ? 1 : COMP_TAB, decl = C.decl.filter(d => d.k === k);
  let h = `<div class="pagehead"><div class="lead"><h1>Налоги</h1><p>Налоговые декларации разных форм (100.00, 910.00, 300.00, 200.00 и др.) в PDF или Excel. Суммы из деклараций сверяются с ОПиУ; расхождения подсвечиваются здесь и в форме. Файлы читаются в этом браузере и никуда не отправляются.</p></div>
    <div class="toolbar"><button class="btn primary" data-act="docdlg" data-mode="tax">Загрузить декларации</button><button class="btn" data-act="decladd">Ввести вручную</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="tax">${bannerHTML("tax")}</div>`;
  if (!decl.length) return h + `<div class="empty"><h2>Декларации не загружены</h2><p class="muted">Загрузите декларации из кабинета налогоплательщика (PDF) — или введите суммы вручную, если документ отсканирован.</p><button class="btn primary" data-act="docdlg" data-mode="tax">Загрузить декларации</button></div>`;
  h += `<section class="panel"><h2>Сверка с отчётностью — ${esc(compName(k))}</h2><p class="hint">Тыс. тг. Расхождение: ${LEGEND}. Сверка выполняется, когда декларации покрывают весь период.</p>
    ${checksTable(k, TAX_IDS, "Для периодов анализа нет подходящих деклараций: проверьте год и часть периода в загруженных декларациях.")}
    <div class="grid2 tight" style="margin-top:12px;max-width:320px"><label class="f"><span>Допуск расхождений, %</span><input class="inp num" data-dset="pct" value="${esc(fmt(N(C.dset.pct) * 100, "m1"))}"></label></div></section>`;
  const ks = Object.keys(DocParse.KEYS).filter(key => decl.some(d => d.vals && isNum(d.vals[key])));
  const sorted = decl.slice().sort((a, b) => (a.year - b.year) || String(a.part).localeCompare(String(b.part)) || String(a.form).localeCompare(String(b.form)));
  h += `<section class="panel"><h2>Декларации (${decl.length})</h2><p class="hint">Тыс. тг — суммы из деклараций переведены из тенге автоматически.</p><div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Форма</th><th>Период</th>${ks.map(key => `<th>${esc(DocParse.KEYS[key].t)}</th>`).join("")}<th></th></tr></thead><tbody>
    ${sorted.map(d => `<tr><td class="lab">${esc(d.formName || d.form)}${isAddDecl(d) ? ' <span class="tag">дополнительная</span>' : ""}<span class="formula">${esc(d.file || "введена вручную")}</span></td><td>${esc((d.year || "год?") + ", " + (PARTS[d.part] || d.part))}</td>${ks.map(key => `<td>${d.vals && isNum(d.vals[key]) ? fmt(d.vals[key] / 1000) : ""}</td>`).join("")}
      <td style="white-space:nowrap"><button class="btn ghost" data-decledit="${d.id}">Открыть</button><button class="btn ghost danger" data-decldel="${d.id}" title="Удалить" aria-label="Удалить">×</button></td></tr>`).join("")}
    </tbody></table></div></section>`;
  return h;
}

/* ---------- страница «Банк» */
function pageBank() {
  ensureDocs();
  const k = COMP_TAB > nComp() ? 1 : COMP_TAB, bank = C.bank.filter(b => b.k === k);
  let h = `<div class="pagehead"><div class="lead"><h1>Банк</h1><p>Выписки по счетам и справки об оборотах в PDF или Excel. По выпискам выделяются чистые кредитовые обороты: из поступлений исключаются кредиты и займы, конвертация, переводы собственных средств и между своими счетами, выплата вкладов (депозитов), возвраты, финансовая помощь, субсидии (кроме ГЧП), штрафы и пени, выплаты вознаграждения, страховые выплаты, взносы наличными и пополнение через банкомат или кассу (кроме инкассации и поступлений по договорам с ИП). Валюта — по курсу НБ РК на дату поступления.</p></div>
    <div class="toolbar"><button class="btn primary" data-act="docdlg" data-mode="bank">Загрузить выписки и справки</button><button class="btn" data-act="bankadd">Обороты вручную</button><button class="btn" data-act="bankxls" title="Скачать Excel: помесячные сводные по контрагентам и товарам за прошлый год и текущий год с 1 января">Импорт</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="bank">${bannerHTML("bank")}</div>${isOD() && k === 1 ? odBankPanel(k) : ""}`;
  if (!bank.length) return h + `<div class="empty"><h2>Выписки и справки не загружены</h2><p class="muted">Загрузите выписки по счетам (PDF или Excel из интернет-банка) — по ним считаются чистые кредитовые обороты. Справки об оборотах дают только общие обороты, без исключений.</p><button class="btn primary" data-act="docdlg" data-mode="bank">Загрузить выписки и справки</button></div>`;
  h += `<section class="panel"><h2>Сверка с отчётностью — ${esc(compName(k))}</h2><p class="hint">Тыс. тг. ${LEGEND}. Доля чистых оборотов в выручке с НДС: 80–150 % — норма.</p>
    ${checksTable(k, BANK_IDS, "Для периодов анализа нет оборотов: проверьте месяцы в выписках и справках или заполните выручку в ОПиУ.")}
    <div class="grid2 tight" style="margin-top:12px;max-width:420px"><label class="f"><span>Допуск сверки с ОДДС, %</span><input class="inp num" data-dset="bpct" value="${esc(fmt(N(C.dset.bpct) * 100, "m1"))}"></label></div>
    ${nComp() > 1 ? `<label style="display:block;margin-top:10px"><input type="checkbox" data-grpex ${C.dset.grpEx !== false ? "checked" : ""}> Исключать поступления от других компаний группы (по БИН из «Карточки»)</label>` : ""}</section>`;
  // помесячно
  const M = bankMonths(k), ms = Object.keys(M).sort();
  if (ms.length) {
    const cats = Object.keys(DocParse.CATS).filter(c => ms.some(m => M[m].ex[c]));
    const tot = { gross: 0, net: 0, db: 0, ex: {} };
    for (const m of ms) { tot.gross += M[m].gross; tot.net += M[m].net; tot.db += M[m].db; for (const c of cats) tot.ex[c] = (tot.ex[c] || 0) + N(M[m].ex[c]); }
    h += `<section class="panel"><h2>Кредитовые обороты по месяцам, тыс. тг</h2><p class="hint">Все счета компании в тенге. «Справка» — обороты без детализации, исключения по ним не применяются.</p>
      <div class="tablewrap"><table class="data bm"><thead><tr><th class="lab">Месяц</th><th>Кредит всего</th>${cats.length ? `<th colspan="${cats.length}" class="exh">не принимаются в расчёт</th>` : ""}<th></th><th></th></tr><tr><th class="lab"></th><th></th>${cats.map(c => `<th title="${esc(DocParse.CATS[c])}">${esc(CAT_SHORT[c])}</th>`).join("")}<th>Чистые обороты</th><th>Дебет</th></tr></thead><tbody>
      ${ms.map(m => { const o = M[m]; return `<tr><td class="lab">${ymLabel(m)}<span class="formula">${[...o.src].join(", ")}${o.nofx ? ` · без курса: ${o.nofx}` : ""}</span></td><td>${fmt(o.gross / 1000)}</td>${cats.map(c => `<td>${o.ex[c] ? fmt(o.ex[c] / 1000) : ""}</td>`).join("")}<td class="strong">${fmt(o.net / 1000)}</td><td>${fmt(o.db / 1000)}</td></tr>`; }).join("")}
      <tr class="calc"><td class="lab">Итого</td><td>${fmt(tot.gross / 1000)}</td>${cats.map(c => `<td>${fmt(tot.ex[c] / 1000)}</td>`).join("")}<td>${fmt(tot.net / 1000)}</td><td>${fmt(tot.db / 1000)}</td></tr></tbody></table></div></section>`;
  }
  // документы
  const own = ownOf(k);
  h += `<section class="panel"><h2>Документы (${bank.length})</h2><p class="hint">Тыс. тг (по валютным счетам — тыс. единиц валюты счёта).</p><div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Банк, счёт</th><th>Вид</th><th>Период</th><th>Кредит</th><th>Исключено</th><th>Чистые</th><th></th></tr></thead><tbody>
    ${bank.map(b => {
      let cr = 0, ex = 0, per, crT = 0, exT = 0;
      if (b.kind === "stmt") { (b.txs || []).forEach((t, i) => { if (!t.cr) return; const c = txCat(b, i, t, own)[0], v = txKzt(b, t, t.cr); cr += t.cr; crT += N(v); if (c) { ex += t.cr; exT += N(v); } }); per = `${b.from || b.txs?.[0]?.d || "?"} – ${b.to || b.txs?.[b.txs.length - 1]?.d || "?"}`; }
      else { const v = Object.values(b.months || {}); cr = b.rangeOnly ? N(b.total?.cr) : v.reduce((a, o) => a + N(o.cr), 0); per = b.rangeOnly ? `${b.from} – ${b.to}` : `${Object.keys(b.months || {}).length} мес.`; }
      return `<tr><td class="lab">${esc(b.bank || "банк не указан")}<select class="inp" data-bwhere="${b.id}" style="max-width:150px;margin-left:8px;padding:2px 6px;font-size:12px">${[["our", "в Банке"], ["other", "в других банках"]].map(([v, t]) => `<option value="${v}"${odWhere(b) === v ? " selected" : ""}>${t}</option>`).join("")}</select><span class="formula">${esc(b.acc || "счёт не указан")} · ${esc(b.cur)}${b.cur !== "KZT" && b.kind !== "stmt" && isNum(b.rate) ? " по " + fmt(b.rate, "m1") : ""} · ${esc(b.file || "введено вручную")}</span></td><td>${b.kind === "stmt" ? `выписка<span class="formula">${(b.txs || []).length} оп.</span>` : "справка"}</td><td>${esc(per)}</td>
        ${b.kind === "stmt" && b.cur !== "KZT" ? `<td>${fmt(cr / 1000)}<span class="formula">≈ ${fmt(crT / 1000)} тыс. тг</span></td><td>${fmt(ex / 1000)}<span class="formula">≈ ${fmt(exT / 1000)} тыс. тг</span></td><td>${fmt((cr - ex) / 1000)}<span class="formula">≈ ${fmt((crT - exT) / 1000)} тыс. тг</span></td>`
          : `<td>${fmt(cr / 1000)}</td><td>${b.kind === "stmt" ? fmt(ex / 1000) : "—"}</td><td>${fmt((b.kind === "stmt" ? cr - ex : cr) / 1000)}</td>`}
        <td style="white-space:nowrap"><button class="btn ghost" data-bankedit="${b.id}">${b.kind === "stmt" ? "Операции" : "Открыть"}</button><button class="btn ghost danger" data-bankdel="${b.id}" title="Удалить" aria-label="Удалить">×</button></td></tr>`;
    }).join("")}</tbody></table></div></section>`;
  h += bankExtraHTML(k) + fxPanel(k);
  return h;
}
function fxNeeded(k) {
  const need = new Map();
  for (const b of C.bank.filter(b => b.k === k)) {
    if (b.kind === "stmt") for (const t of b.txs || []) { const cur = t.cur || b.cur; if (cur !== "KZT" && t.cr && !(isNum(t.eq) && t.eq > 0)) need.set(cur + "|" + t.d, { cur, d: t.d, have: fxRate(cur, t.d) }); }
    else if (b.cur !== "KZT" && !isNum(b.rate)) for (const m of Object.keys(b.months || {})) need.set(b.cur + "|" + m, { cur: b.cur, d: m, have: fxRate(b.cur, m) });
  }
  return [...need.values()].sort((a, b) => (a.cur + a.d).localeCompare(b.cur + b.d));
}
function fxPanel(k) {
  const need = fxNeeded(k); if (!need.length) return "";
  const miss = need.filter(x => !isNum(x.have));
  return `<section class="panel"><h2>Курсы НБ РК</h2><p class="hint">Поступления в иностранной валюте пересчитываются в тенге по официальному курсу НБ РК на дату поступления. ${miss.length ? `Не хватает курсов: ${miss.length}.` : "Все курсы указаны."} Если на дату курса нет (выходной), берётся ближайший предыдущий; можно указать курс за месяц — формат «2024-04».
    Курсы можно загрузить файлом Excel или CSV с колонками «Дата» и кодами валют (USD, EUR…) — например, архив курсов с сайта НБ РК.</p>
    <p><button class="btn" data-act="fxfile">Загрузить курсы из файла</button></p>
    <div class="tablewrap" style="max-height:340px;margin-top:8px"><table class="data form fx"><thead><tr><th class="lab">Валюта</th><th>Дата</th><th>Курс, тенге</th></tr></thead><tbody>
    ${need.map(x => `<tr><td class="lab">${esc(x.cur)}</td><td>${esc(x.d.length === 7 ? ymLabel(x.d) : x.d.split("-").reverse().join("."))}</td><td class="cell"><input class="inp num" data-fxcur="${esc(x.cur)}" data-fxd="${esc(x.d)}" value="${esc(isNum(x.have) ? fmt(x.have, "m1").replace(/,0$/, "") : "")}" placeholder="нет курса"></td></tr>`).join("")}</tbody></table></div></section>`;
}
function taxConclHTML() {
  if (!C) return ""; ensureDocs();
  if (!C.decl.length && !C.bank.length) return "";
  const items = [], netRows = [];
  for (let k = 1; k <= nComp(); k++) for (const p of C.periods) {
    for (const c of taxChecks(k, p)) {
      if (c.id === "bank_rev" && c.full) netRows.push(`${compName(k)}, ${p.label}: кредитовые обороты ${fmt(c.bk.gross)}, исключено ${fmt(c.bk.gross - c.bk.v)}, чистые кредитовые обороты ${fmt(c.b)} тыс. тг (${pctFmt(c.rel)} выручки с НДС)`);
      if (c.st === "chk" || c.st === "risk") items.push(`${compName(k)}, ${p.label}: ${c.title.toLowerCase()} — ${c.share ? `чистые кредитовые обороты составили ${pctFmt(c.rel)} выручки с НДС` : `${c.aLab.toLowerCase()} ${fmt(c.a)}, ${c.bLab.toLowerCase()} ${fmt(c.b)}, разница ${fmt(c.diff)} тыс. тг (${pctFmt(c.rel)})`}`);
    }
  }
  return `<h2 style="margin-top:14px">Налоги и банковские обороты</h2>` + (netRows.length ? `<ul>${netRows.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "") + (items.length ? `<p>Расхождения:</p><ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>Существенных расхождений с декларациями и банковскими оборотами не выявлено (по загруженным документам).</p>`);
}

/* ---------- загрузка документов */
function compByBin(bin) {
  if (!bin) return 0;
  const i = C.companies.findIndex(x => String(x.bin || "").replace(/\D/g, "") === bin);
  if (i >= 0) return i + 1;
  return String(C.card.bin || "").replace(/\D/g, "") === bin ? 1 : 0;
}
async function readDoc(file) {
  if (/\.pdf$/i.test(file.name)) {
    const r = await DocParse.read(await file.arrayBuffer());
    if (r.pdf.noText) throw new Error("в PDF нет текста — это скан или картинка. Введите суммы вручную");
    return r;
  }
  if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) return DocParse.readSheets(await readWorkbook(await file.arrayBuffer()));
  if (/\.csv$/i.test(file.name)) return DocParse.readSheets(csvSheets(await file.arrayBuffer()));
  if (/\.(html?|mht)$/i.test(file.name)) { const pdf = htmlToLines(await file.arrayBuffer()); if (!pdf.pages[0].lines.length) throw new Error("в HTML-файле нет текста"); return DocParse.readLines(pdf); }
  throw new Error("поддерживаются PDF, HTML, Excel (.xlsx, .xlsm, .xls) и CSV");
}
async function importDocs(files, kDef, mode) {
  ensureDocs();
  const rep = [];
  for (const file of files) {
    let r;
    try { toast("Читаю " + file.name + "…"); r = await readDoc(file); }
    catch (e) { rep.push({ file: file.name, err: /паролем/.test(e.message) ? e.message + " — снимите пароль или введите суммы вручную" : e.message }); continue; }
    let kind = r.kind;
    if (!kind) {
      kind = await dialog("Что это за документ?", `<p>Не удалось уверенно определить тип документа <b>${esc(file.name)}</b>.</p>`, [{ t: "Пропустить", v: null }, { t: "Кредитный отчёт", v: "credit" }, { t: "Справка об оборотах", v: "bank" }, { t: "Выписка по счёту", v: "stmt" }, { t: "Декларация", primary: mode === "tax", v: "decl" }]);
      if (!kind) { rep.push({ file: file.name, err: "пропущено" }); continue; }
      if (kind === "decl") r.decl = DocParse.parseDecl(r.pdf); else if (kind === "credit") r.credit = DocParse.parseCredit(r.pdf); else if (kind === "stmt") r.stmt = DocParse.parseStmt(r.pdf); else r.bank = DocParse.parseBank(r.pdf);
    }
    if (kind === "credit") {
      const cr = r.credit;
      if (!cr.loans.length) { rep.push({ file: file.name, err: "в отчёте не найдено договоров (нужны поля «Кредитор», «Сумма», «Остаток»…). Добавьте кредиты вручную" }); continue; }
      const n = await creditImport(cr, compByBin(cr.bin) || kDef, file.name);
      rep.push(n ? { file: file.name, page: "credit", ok: `${cr.bureau}: договоров ${n}` } : { file: file.name, err: "не сохранено" });
      continue;
    }
    if (kind === "decl") {
      const d = r.decl, keys = DocParse.pickKeys(d, DMAP), vals = {};
      for (const [key, code] of Object.entries(keys)) { const l = d.lines.find(x => x.code === code); if (l && l.vals.length) vals[key] = l.vals[0]; }
      const doc = { id: uid(), k: compByBin(d.bin) || kDef, file: file.name, form: d.form, formName: d.formName, year: d.year, part: d.part, vid: d.vid || (/(^|[^а-яa-z])доп/i.test(file.name) ? "add" : "main"), bin: d.bin, lines: d.lines, vals, src: keys, t: Date.now() };
      const saved = await declEditor(doc, true, d.bin && compByBin(d.bin) ? "Компания определена по БИН " + d.bin : "");
      rep.push(saved ? { file: file.name, page: "tax", ok: `${saved.formName}, ${saved.year}, ${PARTS[saved.part]}: строк ${d.lines.length}` } : { file: file.name, err: "не сохранено" });
    } else if (kind === "stmt") {
      const s = r.stmt;
      if (!s.txs.length) { rep.push({ file: file.name, err: "в выписке не найдено операций (нужны колонки «Дата», «Дебет»/«Кредит» или «Сумма»)" }); continue; }
      const doc = { id: uid(), kind: "stmt", where: DOC_WHERE, k: compByBin(s.bin) || kDef, file: file.name, bank: s.bank, acc: s.acc, cur: s.cur || "KZT", from: s.from, to: s.to, txs: s.txs, ov: {}, t: Date.now() };
      const saved = await stmtEditor(doc, true, s.bin && compByBin(s.bin) ? "Компания определена по БИН " + s.bin : "");
      rep.push(saved ? { file: file.name, page: "bank", ok: `выписка ${saved.acc || ""}: операций ${s.txs.length}` } : { file: file.name, err: "не сохранено" });
    } else {
      const b = r.bank;
      if (!b.accounts.length) { rep.push({ file: file.name, err: "не найдена таблица оборотов (месяцы и колонки дебет/кредит). Введите обороты вручную" }); continue; }
      let n = 0;
      for (let i = 0; i < b.accounts.length; i++) {
        const a = b.accounts[i];
        const doc = { id: uid(), kind: "turn", where: DOC_WHERE, k: compByBin(b.bin) || kDef, file: file.name, bank: b.bank, acc: a.acc, cur: a.cur || "KZT", rate: null, months: a.months, total: a.total, rangeOnly: !!a.rangeOnly, from: b.period?.from || "", to: b.period?.to || "", t: Date.now() };
        if (await bankEditor(doc, true, b.accounts.length > 1 ? `Счёт ${i + 1} из ${b.accounts.length}` : "")) n++;
      }
      rep.push(n ? { file: file.name, page: "bank", ok: `справка ${b.bank || ""}: счетов ${n}` } : { file: file.name, err: "не сохранено" });
    }
  }
  for (const x of rep) C.log.unshift({ t: new Date().toISOString(), file: x.file, comp: "", per: "", kind: "PDF", note: x.ok || "", err: x.err || "" });
  C.log = C.log.slice(0, 200);
  touch();
  return rep;
}
let DOC_WHERE = "our";
async function docDialog(mode) {
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${COMP_TAB === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const what = mode === "credit" ? "Кредитные отчёты ПКБ или ГКБ (HTML, PDF или Excel)" : mode === "tax" ? "Налоговые декларации (PDF из кабинета налогоплательщика или Excel)" : "Выписки по счетам и справки об оборотах (PDF или Excel из интернет-банка, CSV)";
  const body = `<p class="muted">${what} — можно сразу несколько файлов. Для сканов суммы вводятся вручную. Файлы читаются здесь же, в браузере, и никуда не отправляются.</p>
    <label class="f" style="margin:12px 0"><span>Компания (если в документе нет БИН из карточки)</span><select class="inp" id="pComp">${compsOpts}</select></label>
    ${mode === "bank" ? `<div class="f" style="margin:0 0 12px"><span>Где открыт счёт (для расчёта лимита)</span><div class="chips" role="radiogroup">${[["our", "в Банке"], ["other", "в других банках"]].map(([v, t]) => `<label class="btn"><input type="radio" name="pw" value="${v}" ${(DOC_WHERE || "our") === v ? "checked" : ""}> ${t}</label>`).join("")}</div></div>` : ""}
    <label class="drop" id="pDrop"><input type="file" id="pFiles" multiple accept=".pdf,.html,.htm,.xlsx,.xlsm,.csv,.xls,application/pdf,text/html" style="display:none"><span id="pTxt">Перетащите файлы сюда или нажмите, чтобы выбрать</span></label>`;
  let files = [];
  setTimeout(() => {
    const inp = $("#pFiles"), drop = $("#pDrop"), set = fl => { files = Array.from(fl); $("#pTxt").textContent = files.map(f => f.name).join(", ") || "Файлы не выбраны"; };
    inp.onchange = () => set(inp.files);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); set(e.dataTransfer.files); };
  });
  const k = await dialog(mode === "credit" ? "Загрузить кредитный отчёт" : mode === "tax" ? "Загрузить декларации" : "Загрузить выписки и справки", body, [{ t: "Отменить", v: null }, { t: "Загрузить", primary: true, v: () => { const w = document.querySelector("input[name=pw]:checked"); if (w) DOC_WHERE = w.value; return +$("#pComp").value; } }]);
  if (!k || !files.length) { if (k) toast("Файлы не выбраны"); return; }
  await runDocImport(files, k, mode);
}
async function runDocImport(files, k, mode) {
  const rep = await importDocs(files, k, mode);
  const pages = new Set(rep.filter(r => r.page).map(r => r.page));
  PAGE = pages.size === 1 ? [...pages][0] : mode || "bank"; render();
  await dialog("Результат загрузки", rep.map(r => `<div class="logline"><b>${esc(r.file)}</b>: ${r.err ? stChip("crit", "не загружено") + " " + esc(r.err) : stChip("ok", r.page === "tax" ? "Налоги" : r.page === "credit" ? "Кредиты" : "Банк") + " " + esc(r.ok)}</div>`).join(""), [{ t: "Готово", primary: true, v: true }]);
}

/* ---------- выписка: просмотр операций и классификация */
function stmtRowsHTML(doc, own, filter, q) {
  const rows = [];
  (doc.txs || []).forEach((t, i) => {
    if (!t.cr) return;
    const [c, why] = txCat(doc, i, t, own);
    if (filter === "ex" && !c) return; if (filter === "inc" && c) return;
    if (q && !low2(`${t.cp} ${t.purp} ${t.knp} ${t.bin}`).includes(q)) return;
    rows.push(`<tr class="${c ? "ex" : ""}"><td class="lab">${esc(t.d.split("-").reverse().join("."))}</td><td style="text-align:left;white-space:normal">${esc(t.cp || "—")}${t.bin ? `<span class="formula">БИН ${esc(t.bin)}</span>` : ""}</td>
      <td style="text-align:left;white-space:normal">${esc(t.purp || t.op || "—")}${t.knp ? `<span class="formula">КНП ${esc(t.knp)}</span>` : ""}</td>${stmtFx(doc) ? fxCells(doc, t) : `<td>${K1(t.cr)}</td>`}
      <td><select class="inp" data-txcat="${i}"><option value="inc"${!c ? " selected" : ""}>В расчёте</option>${Object.entries(DocParse.CATS).map(([k2, t2]) => `<option value="${k2}"${c === k2 ? " selected" : ""} title="${esc(t2)}">Исключить: ${esc(CAT_SHORT[k2])}</option>`).join("")}</select>${why ? `<span class="formula">${esc(why)}</span>` : ""}</td></tr>`);
  });
  const cs = stmtFx(doc) ? 7 : 5;
  return rows.length ? rows.slice(0, 1500).join("") + (rows.length > 1500 ? `<tr><td colspan="${cs}" class="muted">Показаны первые 1500 операций — уточните поиск.</td></tr>` : "") : `<tr><td colspan="${cs}" class="muted">Нет операций</td></tr>`;
}
// валютная выписка: сумма в валюте, курс НБ РК на дату поступления и сумма в тенге
const stmtFx = doc => (doc.txs || []).some(t => t.cr && (t.cur || doc.cur || "KZT") !== "KZT");
function fxCells(doc, t) {
  const cur = t.cur || doc.cur || "KZT";
  if (cur === "KZT") return `<td>${K1(t.cr)}</td><td class="muted">—</td><td>${K1(t.cr)}</td>`;
  if (isNum(t.eq) && t.eq > 0) return `<td>${K1(t.cr)}<span class="formula">${esc(cur)}</span></td><td>${nf2.format(t.eq / t.cr)}<span class="formula">эквивалент из выписки</span></td><td>${K1(t.eq)}</td>`;
  const fi = fxRateInfo(cur, t.d);
  return `<td>${K1(t.cr)}<span class="formula">${esc(cur)}</span></td>
    <td class="cell"><input class="inp num fxin" data-txfx="${esc(cur)}" data-txd="${esc(t.d)}" value="${fi ? esc(nf2.format(fi.r)) : ""}" placeholder="курс"><span class="formula">${fi ? (fi.d === t.d ? "НБ РК на " + dmy(t.d) : "НБ РК на " + dmy(fi.d) + " (ближайший)") : "введите курс на " + dmy(t.d)}</span></td>
    <td class="${fi ? "" : "muted"}">${fi ? K1(t.cr * fi.r) : "нет курса"}</td>`;
}
function stmtHead(doc) {
  const cur = doc.cur && doc.cur !== "KZT" ? doc.cur : "валюта";
  return `<tr><th class="lab">Дата</th><th style="text-align:left">Отправитель</th><th style="text-align:left">Назначение платежа</th>${stmtFx(doc) ? `<th>Сумма, тыс. ${esc(cur)}</th><th>Курс НБ РК, тг</th><th>Сумма, тыс. тг</th>` : "<th>Сумма, тыс. тг</th>"}<th style="text-align:left">Вид для расчёта</th></tr>`;
}
const low2 = s => String(s || "").toLowerCase().replace(/ё/g, "е");
function stmtSummary(doc, own) {
  let cr = 0, db = 0, ex = 0, n = 0; const by = {};
  (doc.txs || []).forEach((t, i) => { db += t.db; if (!t.cr) return; n++; cr += t.cr; const [c] = txCat(doc, i, t, own); if (c) { ex += t.cr; by[c] = (by[c] || 0) + t.cr; } });
  if (stmtFx(doc)) {
    let crT = 0, exT = 0, dbT = 0, miss = 0;
    (doc.txs || []).forEach((t, i) => { if (t.db) { const v = txKzt(doc, t, t.db); if (v !== null) dbT += v; } if (!t.cr) return; const v = txKzt(doc, t, t.cr); if (v === null) { miss++; return; } crT += v; if (txCat(doc, i, t, own)[0]) exT += v; });
    return `<table class="data sumt"><thead><tr><th class="lab">Поступлений: ${n}</th><th>Кредит всего</th><th>Исключено</th><th>Чистые кредитовые обороты</th><th>Дебет всего</th></tr></thead><tbody>
      <tr><td class="lab">в валюте, тыс. ${esc(doc.cur)}</td><td>${K1(cr)}</td><td>${K1(ex)}</td><td>${K1(cr - ex)}</td><td>${K1(db)}</td></tr>
      <tr><td class="lab">по курсу НБ РК, тыс. тг</td><td>${K1(crT)}</td><td>${K1(exT)}</td><td class="strong">${K1(crT - exT)}</td><td>${K1(dbT)}</td></tr></tbody></table>
      <p class="small muted" style="margin:4px 0 0">${miss ? `<b>Нет курса для ${miss} поступлений</b> — введите курс в колонке «Курс НБ РК»; без него они не входят в обороты. ` : ""}${Object.entries(by).map(([c, v]) => `${CAT_SHORT[c]}: ${K1(v)} тыс. ${esc(doc.cur)}`).join(" · ") || "Исключений нет"}</p>`;
  }
  return `<table class="data sumt"><thead><tr><th class="lab">Поступлений</th><th>Кредит всего, тыс. ${esc(doc.cur === "KZT" ? "тг" : doc.cur)}</th><th>Исключено</th><th>Чистые кредитовые обороты</th><th>Дебет всего</th></tr></thead><tbody><tr><td class="lab">${n}</td><td>${K1(cr)}</td><td>${K1(ex)}</td><td class="strong">${K1(cr - ex)}</td><td>${K1(db)}</td></tr></tbody></table>
    <p class="small muted" style="margin:4px 0 0">${Object.entries(by).map(([c, v]) => `${CAT_SHORT[c]}: ${K1(v)}`).join(" · ") || "Исключений нет"}</p>`;
}
async function stmtEditor(doc, isNew, note) {
  ensureDocs();
  doc.ov = doc.ov || {};
  const work = { ...doc, ov: { ...doc.ov } };
  const ownFor = () => ownOf(+($("#sComp")?.value || work.k));
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${work.k === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `${note ? `<p class="small muted">${esc(note)}</p>` : ""}${work.file ? `<p class="small muted">Файл: ${esc(work.file)}${work.from ? ` · период ${esc(work.from)} – ${esc(work.to)}` : ""} · операций: ${(work.txs || []).length}</p>` : ""}
    <div class="grid2" style="margin:8px 0 12px"><label class="f"><span>Компания</span><select class="inp" id="sComp">${compsOpts}</select></label>
      <label class="f"><span>Банк</span><input class="inp" id="sBank" value="${esc(work.bank || "")}"></label>
      <label class="f"><span>Счёт (IBAN)</span><input class="inp" id="sAcc" value="${esc(work.acc || "")}"></label>
      <label class="f"><span>Валюта счёта</span><select class="inp" id="sCur">${opts(CURS, CURS.includes(work.cur) ? work.cur : "Другая")}</select></label></div>
    <div id="sSum">${stmtSummary(work, ownOf(work.k))}</div>
    <p class="hint">Поступления, которые не принимаются в расчёт чистых кредитовых оборотов, определены по назначению платежа, коду КНП и отправителю (сама компания — по БИН). Проверьте и при необходимости измените вид операции.</p>
    <div class="grid2 tight" style="margin:6px 0 8px"><label class="f"><span>Показать</span><select class="inp" id="sFilter"><option value="all">все поступления</option><option value="ex">только исключённые</option><option value="inc">только в расчёте</option></select></label><label class="f"><span>Поиск</span><input class="inp" id="sQ" placeholder="контрагент, назначение, КНП"></label></div>
    <div class="tablewrap" style="max-height:46vh"><table class="data tx"><thead>${stmtHead(work)}</thead><tbody id="sRows">${stmtRowsHTML(work, ownOf(work.k), "all", "")}</tbody></table></div>`;
  const redraw = () => { $("#sRows").innerHTML = stmtRowsHTML(work, ownFor(), $("#sFilter").value, low2($("#sQ").value.trim())); $("#sSum").innerHTML = stmtSummary(work, ownFor()); };
  setTimeout(() => {
    const B = $("#dlgB"); $("#dlg").classList.add("wide");
    B.onchange = e => {
      const t = e.target;
      if (t.dataset.txcat !== undefined) {
        const i = +t.dataset.txcat, auto = DocParse.classify(work.txs[i], ownFor());
        const autoCat = auto ? auto[0] : "inc";
        if (t.value === autoCat) delete work.ov[i]; else work.ov[i] = t.value;
        $("#sSum").innerHTML = stmtSummary(work, ownFor()); t.closest("tr").classList.toggle("ex", t.value !== "inc");
      } else if (t.dataset.txfx !== undefined) {
        const v = t.value.trim() === "" ? null : parseNum(t.value);
        if (t.value.trim() !== "" && (v === null || v <= 0)) { toast("Курс — положительное число"); return; }
        fxSet(t.dataset.txfx, t.dataset.txd, v); touch(); redraw();
      } else if (t.id === "sFilter" || t.id === "sComp") redraw();
    };
    let h; B.oninput = e => { if (e.target.id === "sQ") { clearTimeout(h); h = setTimeout(redraw, 200); } };
  });
  const res = await dialog(isNew ? "Выписка: проверьте поступления и сохраните" : "Выписка по счёту", body, [{ t: "Отменить", v: null }, { t: "Сохранить", primary: true, v: d => ({ k: +d.querySelector("#sComp").value, bank: d.querySelector("#sBank").value.trim(), acc: d.querySelector("#sAcc").value.trim(), cur: d.querySelector("#sCur").value }) }]);
  $("#dlg")?.classList.remove("wide");
  if (!res) return null;
  Object.assign(doc, res, { ov: work.ov });
  if (isNew) C.bank.push(doc);
  touch();
  return doc;
}

/* ---------- редактор декларации */
function declKeysHTML(doc) {
  const keys = Object.keys(DocParse.KEYS).filter(key => !DocParse.FORMS[doc.form] || DocParse.KEYS[key].forms.includes(doc.form));
  const lineOpt = (l, sel) => `<option value="${esc(l.code)}"${sel ? " selected" : ""}>${esc(l.code)} — ${esc(l.label.slice(0, 70))}${l.vals.length ? " · " + K1(l.vals[0]) + " тыс." : ""}</option>`;
  return `<table class="data form dk"><thead><tr><th class="lab">Показатель для сверки</th><th style="text-align:left">Строка декларации</th><th>Сумма, тыс. тг</th></tr></thead><tbody>
    ${keys.map(key => `<tr><td class="lab">${esc(DocParse.KEYS[key].t)}</td>
      <td>${doc.lines.length ? `<select class="inp" data-dkcode="${key}"><option value="">— не использовать / вручную</option>${doc.lines.map(l => lineOpt(l, doc.src?.[key] === l.code)).join("")}</select>` : '<span class="small muted">вручную</span>'}</td>
      <td class="cell"><input class="inp num" data-dkval="${key}" value="${esc(K1(doc.vals?.[key]))}"></td></tr>`).join("")}</tbody></table>`;
}
async function declEditor(doc, isNew, note) {
  ensureDocs();
  const formOpts = Object.entries(DocParse.FORMS).map(([f, x]) => `<option value="${f}"${doc.form === f ? " selected" : ""}>${esc(x.name)}</option>`).join("") + (doc.form && !DocParse.FORMS[doc.form] ? `<option value="${esc(doc.form)}" selected>${esc(doc.formName || doc.form)}</option>` : "");
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${doc.k === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `${note ? `<p class="small muted">${esc(note)}</p>` : ""}${doc.file ? `<p class="small muted">Файл: ${esc(doc.file)}${doc.lines?.length ? ` · распознано строк: ${doc.lines.length}` : ""}</p>` : ""}
    <div class="grid2" style="margin:8px 0 12px"><label class="f"><span>Компания</span><select class="inp" id="dComp">${compsOpts}</select></label>
      <label class="f"><span>Форма</span><select class="inp" id="dForm">${formOpts}</select></label>
      <label class="f"><span>Год</span><input class="inp" id="dYear" inputmode="numeric" value="${esc(doc.year || "")}"></label>
      <label class="f"><span>Налоговый период</span><select class="inp" id="dPart">${Object.entries(PARTS).map(([v, t]) => `<option value="${v}"${doc.part === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="f"><span>Вид декларации</span><select class="inp" id="dVid">${Object.entries(DECL_VID).map(([v, t]) => `<option value="${v}"${(doc.vid || "main") === v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div>
    <p class="hint">Дополнительная декларация содержит разницу к ранее поданной — её суммы прибавляются к очередной за тот же период. Суммы вводите так, как они указаны в дополнительной (со знаком «−», если уменьшение).</p>
    <p class="hint">Проверьте, что сумма взята из нужной строки. Выбор строки запоминается для этой формы и подставится в следующий раз.</p>
    <div id="dKeys">${declKeysHTML(doc)}</div>
    ${doc.lines?.length ? `<details style="margin-top:12px"><summary>Все распознанные строки (${doc.lines.length})</summary><div class="tablewrap" style="max-height:300px"><table class="data"><thead><tr><th class="lab">Код</th><th style="text-align:left">Наименование</th><th>Сумма, тыс. тг</th></tr></thead><tbody>${doc.lines.map(l => `<tr><td class="lab">${esc(l.code)}</td><td style="text-align:left;white-space:normal">${esc(l.label)}</td><td>${l.vals.map(v => K1(v)).join("; ")}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`;
  setTimeout(() => {
    const B = $("#dlgB"); $("#dlg").classList.add("wide");
    B.onchange = e => {
      const t = e.target;
      if (t.id === "dForm") { doc.form = t.value; doc.formName = DocParse.FORMS[t.value]?.name || doc.formName; $("#dKeys").innerHTML = declKeysHTML(doc); }
      if (t.dataset.dkcode !== undefined) { const l = doc.lines.find(x => x.code === t.value); const inp = B.querySelector(`[data-dkval="${t.dataset.dkcode}"]`); if (inp) inp.value = l && l.vals.length ? K1(l.vals[0]) : ""; }
    };
  });
  const res = await dialog(isNew ? "Декларация: проверьте и сохраните" : "Декларация", body, [{ t: "Отменить", v: null }, { t: "Сохранить", primary: true, v: d => {
    const o = { k: +d.querySelector("#dComp").value, form: d.querySelector("#dForm").value, year: parseInt(d.querySelector("#dYear").value, 10) || null, part: d.querySelector("#dPart").value, vid: d.querySelector("#dVid").value, vals: {}, src: {} };
    d.querySelectorAll("[data-dkval]").forEach(inp => { const key = inp.dataset.dkval, l = doc.lines?.find(x => x.code === d.querySelector(`[data-dkcode="${key}"]`)?.value), exact = [doc.vals?.[key], l?.vals?.[0]].find(x => isNum(x) && K1(x) === inp.value);
      const v = exact !== undefined ? exact : fromK(inp.value); if (v !== null) o.vals[key] = v; });
    d.querySelectorAll("[data-dkcode]").forEach(s => { o.src[s.dataset.dkcode] = s.value; });
    return o;
  } }]);
  $("#dlg")?.classList.remove("wide");
  if (!res) return null;
  if (!res.year || res.year < 2000 || res.year > 2100) { toast("Укажите год налогового периода — декларация не сохранена"); return null; }
  Object.assign(doc, res, { formName: DocParse.FORMS[res.form]?.name || doc.formName || "Форма " + res.form });
  if (doc.lines?.length) { DMAP[doc.form] = DMAP[doc.form] || {}; for (const [key, code] of Object.entries(res.src)) DMAP[doc.form][key] = code; saveDmap(); }
  if (isNew) C.decl.push(doc);
  touch();
  return doc;
}

/* ---------- редактор справки банка */
function bankRowsHTML(doc) {
  const ms = Object.keys(doc.months || {}).sort();
  return `<table class="data form bk"><thead><tr><th class="lab">Месяц</th><th>Поступления (кредит), тыс.</th><th>Списания (дебет), тыс.</th><th></th></tr></thead><tbody>
    ${ms.map(m => `<tr><td class="lab"><input class="inp" type="month" data-bm="${m}" value="${m}"></td><td class="cell"><input class="inp num" data-bcr="${m}" value="${esc(K1(doc.months[m].cr))}"></td><td class="cell"><input class="inp num" data-bdb="${m}" value="${esc(K1(doc.months[m].db))}"></td><td><button class="btn ghost danger" data-bmdel="${m}" type="button">×</button></td></tr>`).join("")}
    <tr class="calc"><td class="lab">Итого по месяцам</td><td id="bSumCr"></td><td id="bSumDb"></td><td></td></tr>
    ${doc.total ? `<tr><td class="lab">Итого по справке</td><td>${K1(doc.total.cr)}</td><td>${K1(doc.total.db)}</td><td></td></tr>` : ""}</tbody></table>
    <p style="margin-top:8px"><button class="btn" data-bmadd type="button">Добавить месяц</button></p>`;
}
function bankReadRows(B, doc) {
  const months = {};
  B.querySelectorAll("[data-bm]").forEach(inp => {
    const old = inp.dataset.bm, m = inp.value || old;
    const o0 = doc.months?.[old] || {}, keep = (sel, v0) => { const x = B.querySelector(sel).value; return x === K1(v0) ? v0 : fromK(x); };  // без правки — точная сумма из документа
    const cr = keep(`[data-bcr="${old}"]`, o0.cr), db = keep(`[data-bdb="${old}"]`, o0.db);
    if (/^\d{4}-\d{2}$/.test(m)) months[m] = { cr: N(cr) + N(months[m]?.cr), db: N(db) + N(months[m]?.db) };
  });
  return months;
}
async function bankEditor(doc, isNew, note) {
  ensureDocs();
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${doc.k === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `${note ? `<p class="small muted"><b>${esc(note)}</b></p>` : ""}${doc.file ? `<p class="small muted">Файл: ${esc(doc.file)}${doc.from ? ` · период справки ${esc(doc.from)} – ${esc(doc.to)}` : ""}</p>` : ""}
    <div class="grid2" style="margin:8px 0 12px"><label class="f"><span>Компания</span><select class="inp" id="bComp">${compsOpts}</select></label>
      <label class="f"><span>Банк</span><input class="inp" id="bBank" value="${esc(doc.bank || "")}"></label>
      <label class="f"><span>Счёт (IBAN)</span><input class="inp" id="bAcc" value="${esc(doc.acc || "")}"></label>
      <label class="f"><span>Валюта</span><select class="inp" id="bCur">${opts(CURS, CURS.includes(doc.cur) ? doc.cur : "Другая")}</select></label>
      <label class="f" id="bRateF" ${doc.cur === "KZT" ? 'style="display:none"' : ""}><span>Курс: тенге за 1 единицу валюты</span><input class="inp num" id="bRate" value="${esc(isNum(doc.rate) ? fmt(doc.rate, "m1") : "")}"></label></div>
    ${doc.rangeOnly ? `<p class="hint">В справке обороты одной суммой за период (без разбивки по месяцам).</p><div class="grid2"><label class="f"><span>С (дд.мм.гггг)</span><input class="inp" id="bFrom" value="${esc(doc.from)}"></label><label class="f"><span>По (дд.мм.гггг)</span><input class="inp" id="bTo" value="${esc(doc.to)}"></label>
      <label class="f"><span>Поступления, тыс. (в валюте счёта)</span><input class="inp num" id="bTcr" value="${esc(K1(doc.total?.cr))}"></label><label class="f"><span>Списания, тыс. (в валюте счёта)</span><input class="inp num" id="bTdb" value="${esc(K1(doc.total?.db))}"></label></div>`
      : `<p class="hint">Суммы — в тысячах (тыс. тг; по валютному счёту — тыс. единиц валюты), переведены из справки автоматически. Поступления — обороты по кредиту счёта, списания — по дебету.</p><div id="bRows">${bankRowsHTML(doc)}</div>`}`;
  const sums = () => { const B = $("#dlgB"); if (!B || doc.rangeOnly) return; const ms = bankReadRows(B, doc); let cr = 0, db = 0; for (const o of Object.values(ms)) { cr += o.cr; db += o.db; }
    const a = $("#bSumCr"), b = $("#bSumDb"); if (a) a.textContent = K1(cr); if (b) b.textContent = K1(db);
    if (doc.total && a) { a.classList.toggle("bad", isNum(doc.total.cr) && Math.abs(cr - doc.total.cr) > 1.5); b.classList.toggle("bad", isNum(doc.total.db) && Math.abs(db - doc.total.db) > 1.5); } };
  setTimeout(() => {
    const B = $("#dlgB"); $("#dlg").classList.add("wide"); sums();
    B.onchange = e => { if (e.target.id === "bCur") $("#bRateF").style.display = e.target.value === "KZT" ? "none" : ""; else sums(); };
    B.onclick = e => {
      const t = e.target;
      if (t.dataset.bmdel !== undefined) { doc.months = bankReadRows(B, doc); delete doc.months[t.dataset.bmdel]; $("#bRows").innerHTML = bankRowsHTML(doc); sums(); }
      if (t.dataset.bmadd !== undefined) {
        doc.months = bankReadRows(B, doc); const ks = Object.keys(doc.months).sort(), last = ks[ks.length - 1];
        let y, m; if (last) { [y, m] = last.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } } else { y = +(C.periods[C.periods.length - 1]?.date || "").slice(0, 4) || new Date().getFullYear(); m = 1; }
        doc.months[`${y}-${pad2(m)}`] = { cr: 0, db: 0 }; $("#bRows").innerHTML = bankRowsHTML(doc); sums();
      }
    };
  });
  const res = await dialog(isNew ? "Справка банка: проверьте и сохраните" : "Справка банка", body, [{ t: "Отменить", v: null }, { t: "Сохранить", primary: true, v: d => {
    const o = { k: +d.querySelector("#bComp").value, bank: d.querySelector("#bBank").value.trim(), acc: d.querySelector("#bAcc").value.trim(), cur: d.querySelector("#bCur").value, rate: parseNum(d.querySelector("#bRate").value) };
    if (doc.rangeOnly) { o.from = d.querySelector("#bFrom").value.trim(); o.to = d.querySelector("#bTo").value.trim(); o.total = { cr: fromK(d.querySelector("#bTcr").value), db: fromK(d.querySelector("#bTdb").value) }; }
    else o.months = bankReadRows(d.querySelector("#dlgB"), doc);
    return o;
  } }]);
  $("#dlg")?.classList.remove("wide");
  if (!res) return null;
  if (res.cur === "KZT") res.rate = null;
  Object.assign(doc, res);
  if (isNew) C.bank.push(doc);
  touch();
  return doc;
}


/* ---------- события */
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t || !C) return;
  const d = t.dataset;
  if (d.act === "docdlg") { docDialog(d.mode || "bank"); return; }
  if (d.act === "fxfile") {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm,.xls,.csv";
    inp.onchange = async () => { try { const n = await loadFxFile(inp.files[0]); toast("Загружено курсов: " + nf0.format(n)); render(); } catch (err) { toast("Не удалось загрузить курсы: " + err.message); } };
    inp.click(); return;
  }
  if (d.act === "decladd") {
    ensureDocs(); const L = C.periods[C.periods.length - 1];
    const doc = { id: uid(), k: COMP_TAB > nComp() ? 1 : COMP_TAB, file: "", form: comp(COMP_TAB)?.regime === "Упрощённая декларация" ? "910" : "100", year: +(L?.date || "").slice(0, 4) || null, part: "Y", lines: [], vals: {}, src: {}, t: Date.now() };
    if (doc.form === "910") doc.part = "H1";
    doc.formName = DocParse.FORMS[doc.form].name;
    if (await declEditor(doc, true)) { PAGE = "tax"; render(); }
    return;
  }
  if (d.act === "bankadd") {
    ensureDocs(); const L = C.periods[C.periods.length - 1], months = {};
    for (const m of L ? perMonths(L) : []) months[m] = { cr: null, db: null };
    const doc = { id: uid(), kind: "turn", k: COMP_TAB > nComp() ? 1 : COMP_TAB, file: "", bank: "", acc: "", cur: "KZT", rate: null, months, total: null, rangeOnly: false, from: "", to: "", t: Date.now() };
    if (await bankEditor(doc, true)) { PAGE = "bank"; render(); }
    return;
  }
  if (d.decledit) { const doc = C.decl.find(x => x.id === d.decledit); if (doc && await declEditor(doc, false)) render(); return; }
  if (d.bankedit) { const doc = C.bank.find(x => x.id === d.bankedit); if (doc && await (doc.kind === "stmt" ? stmtEditor(doc, false) : bankEditor(doc, false))) render(); return; }
  if (d.decldel) { if (await dialog("Удалить декларацию?", "<p>Декларация будет удалена из клиента; сверка пересчитается.</p>", [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }])) { C.decl = C.decl.filter(x => x.id !== d.decldel); touch(); render(); } return; }
  if (d.bankdel) { if (await dialog("Удалить документ?", "<p>Выписка или справка будет удалена из клиента; обороты и сверка пересчитаются.</p>", [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }])) { C.bank = C.bank.filter(x => x.id !== d.bankdel); touch(); render(); } return; }
});
document.addEventListener("change", e => {
  const t = e.target; if (!C) return;
  if (t.dataset.dset !== undefined) {
    const v = parseNum(t.value); if (v === null || v < 0) { toast("Укажите процент, например 2"); return; }
    ensureDocs(); C.dset[t.dataset.dset] = v / 100; touch(); render(); return;
  }
  if (t.dataset.fxcur !== undefined) {
    const v = t.value.trim() === "" ? null : parseNum(t.value);
    if (t.value.trim() !== "" && (v === null || v <= 0)) { toast("Курс — положительное число"); return; }
    fxSet(t.dataset.fxcur, t.dataset.fxd, v); touch(); CACHE.clear(); render(); return;
  }
});

/* ---------- пример: декларации и выписка для демо-клиента */
function demoDocs(c) {
  ensureDocs(c);
  const rv = (k, pid) => c.data?.[k]?.rev?.[pid], ct = (k, pid) => c.data?.[k]?.cit?.[pid];
  c.periods.forEach((p, pi) => {
    const y = +p.date.slice(0, 4);
    for (let k = 1; k <= c.companies.length; k++) {
      const r = rv(k, p.id); if (!isNum(r)) continue;
      // у К1 в последнем году доход по декларации меньше выручки на 6 % — пример расхождения
      const dr = k === 1 && pi === c.periods.length - 1 ? r * 0.94 : r;
      c.decl.push({ id: uid(), k, file: "пример", form: "100", formName: DocParse.FORMS["100"].name, year: y, part: "Y", lines: [], vals: { rev: Math.round(dr * 1000), sgd: Math.round((dr + N(c.data[k].ooi?.[p.id]) + N(c.data[k].fin_inc?.[p.id])) * 1000), cit: Math.round(N(ct(k, p.id)) * 1000 * 0.97) }, src: {}, t: Date.now() });
    }
  });
  const L = c.periods[c.periods.length - 1], r1 = rv(1, L.id);
  if (!isNum(r1)) return;
  const y = +L.date.slice(0, 4), seas = [0.6, 0.6, 0.8, 1, 1.1, 1.1, 1.2, 1.4, 1.5, 1.2, 0.8, 0.7], tot = seas.reduce((a, b) => a + b, 0);
  const vat = 1 + (y >= 2026 ? 0.16 : 0.12), txs = [], bin = c.companies[0].bin;
  const buyers = [["ТОО «Покупатель Альфа»", "100000000011"], ["ТОО «Покупатель Бета»", "100000000012"], ["АО «Торговая сеть»", "100000000013"]];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0"), month = r1 * 1000 * vat * 0.93 * seas[m - 1] / tot;
    buyers.forEach(([cp, b], j) => txs.push({ d: `${y}-${mm}-${String(5 + j * 8).padStart(2, "0")}`, doc: String(m * 10 + j), cp, bin: b, knp: "710", purp: `Оплата за продукцию по договору поставки №${j + 1}, в т.ч. НДС`, op: "", iik: "", db: 0, cr: Math.round(month / 3 * 100) / 100 }));
    txs.push({ d: `${y}-${mm}-25`, doc: String(m * 10 + 5), cp: "ТОО «Поставщик Зерно»", bin: "100000000021", knp: "710", purp: "Оплата за зерно по договору №7", op: "", iik: "", db: Math.round(month * 0.62 * 100) / 100, cr: 0 });
    txs.push({ d: `${y}-${mm}-10`, doc: "", cp: "АО «Пример Банк»", bin: "100000000099", knp: "421", purp: "Погашение основного долга по договору банковского займа №17", op: "", iik: "", db: 7900000, cr: 0 });
    txs.push({ d: `${y}-${mm}-10`, doc: "", cp: "АО «Пример Банк»", bin: "100000000099", knp: "423", purp: "Вознаграждение по кредиту, договор №17", op: "", iik: "", db: 4200000, cr: 0 });
    txs.push({ d: `${y}-${mm}-05`, doc: "", cp: "АО «Пример Банк»", bin: "100000000099", knp: "311", purp: "Перечисление заработной платы работникам за месяц", op: "", iik: "", db: 14500000, cr: 0 });
    txs.push({ d: `${y}-${mm}-20`, doc: "", cp: "УГД по г. Костанай", bin: "100000000088", knp: "911", purp: "КБК 101101 Корпоративный подоходный налог, НДС", op: "", iik: "", db: 9800000, cr: 0 });
  }
  const ex = [[`${y}-03-02`, "АО «Пример Банк»", "100000000099", "411", "Выдача кредита по договору банковского займа №17", 150000000],
    [`${y}-04-10`, c.companies[0].name, bin, "342", "Перевод собственных средств с текущего счета", 25000000],
    [`${y}-05-14`, "АО «Пример Банк»", "100000000099", "223", "Зачисление от продажи иностранной валюты (конвертация)", 18000000],
    [`${y}-06-03`, "ТОО «Поставщик Зерно»", "100000000021", "710", "Возврат ошибочно перечисленного платежа", 1200000],
    [`${y}-07-20`, "ГУ «Управление сельского хозяйства»", "100000000031", "119", "Субсидии на удешевление стоимости ГСМ и семян", 9000000],
    [`${y}-09-30`, "АО «Пример Банк»", "100000000099", "333", "Начисленное вознаграждение на остаток по текущему счету", 350000.5],
    [`${y}-11-12`, "Иванов И.И.", "", "331", "Взнос наличных денег на текущий счет", 4000000]];
  for (const [d, cp, b, knp, purp, cr] of ex) txs.push({ d, doc: "", cp, bin: b, knp, purp, op: "", iik: "", db: 0, cr });
  txs.sort((a, b) => a.d.localeCompare(b.d));
  // кредитный отчёт, залог и гарант для примера
  c.cr = c.cr || []; c.coll = c.coll || []; c.guar = c.guar || [];
  const dv = key => N(c.data?.[1]?.[key]?.[L.id]), debt = (dv("stloan") + dv("cpltd") + dv("ltloan") + dv("lease")) * 1000;
  if (debt > 0) {
    c.cr.push({ id: uid(), k: 1, src: "пример", auto: true, bureau: "ПКБ", date: `${y}-12-31`, creditor: "АО «Пример Банк»", type: "Кредитная линия", role: "Заемщик", status: "active", amount: Math.round(debt * 0.9), cur: "KZT", start: `${y - 2}-03-15`, end: `${y + 3}-03-15`, bal: Math.round(debt * 0.65), pay: Math.round(debt * 0.65 / 39), rate: 0.175, odDays: 0, maxOd: 0, scheme: "Дифференцированный", fc: true });
    c.cr.push({ id: uid(), k: 1, src: "пример", auto: true, bureau: "ПКБ", date: `${y}-12-31`, creditor: "АО «Второй Банк»", type: "Кредит", role: "Заемщик", status: "active", amount: Math.round(debt * 0.5), cur: "KZT", start: `${y - 1}-06-01`, end: `${y + 2}-06-01`, bal: Math.round(debt * 0.38), pay: Math.round(debt * 0.38 / 18), rate: 0.19, odDays: 0, maxOd: 12, scheme: "Аннуитет", fc: true });
    c.cr.push({ id: uid(), k: 1, src: "пример", auto: true, bureau: "ПКБ", date: `${y}-12-31`, creditor: "АО «Старый Банк»", type: "Кредит", role: "Заемщик", status: "closed", amount: 80000000, cur: "KZT", start: `${y - 6}-02-01`, end: `${y - 3}-02-01`, bal: 0, pay: 0, rate: null, odDays: 0, maxOd: 5, scheme: "Дифференцированный", fc: false });
  }
  const amt = N(c.card.amount);
  if (amt) { c.coll.push({ type: "Недвижимость", desc: "Зерносклад 5 000 т, г. Костанай (вымышл.)", owner: c.companies[0].name, market: Math.round(amt * 0.9), disc: 0.3 }); c.coll.push({ type: "Спецтехника и оборудование", desc: "Зерноуборочные комбайны, 4 ед.", owner: c.companies[1]?.name || c.companies[0].name, market: Math.round(amt * 0.8), disc: 0.5 }); }
  c.guar.push({ name: "Учредитель (вымышленный)", kind: "Учредитель (физ. лицо)", amt: amt || null, note: "личная гарантия" });
  c.bank.push({ id: uid(), kind: "stmt", k: 1, file: "пример", bank: "АО «Пример Банк»", acc: "KZ000000000000000001", cur: "KZT", from: `01.01.${y}`, to: `31.12.${y}`, txs, ov: {}, t: Date.now() });
}

/* ---------- HTML (например, кредитный отчёт ПКБ): строки таблиц и абзацы → те же «строки с ячейками», что и для PDF */
function htmlToLines(buf) {
  const u8 = new Uint8Array(buf);
  let head = new TextDecoder("latin1").decode(u8.subarray(0, 4096)), cs = (/charset\s*=\s*["']?([\w-]+)/i.exec(head) || [])[1] || "utf-8";
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) cs = "utf-8";
  let text; try { text = new TextDecoder(cs).decode(u8); } catch (e) { text = new TextDecoder("utf-8").decode(u8); }
  if (/utf-?8/i.test(cs) && text.includes("\uFFFD")) text = new TextDecoder("windows-1251").decode(u8);
  const doc = new DOMParser().parseFromString(text, "text/html");   // документ инертен: скрипты и картинки не запускаются и не грузятся
  doc.querySelectorAll("script,style,noscript,template").forEach(e => e.remove());
  const clean = s => String(s || "").replace(/[\u00A0\s]+/g, " ").trim();
  const lines = []; let y = 0;
  const push = cells => { const cs2 = cells.filter(c => c.s); if (!cs2.length) return; lines.push({ y: -(y += 12), fs: 10, cells: cs2, text: cs2.map(c => c.s).join("  "), page: 0 }); };
  const BLOCK = /^(P|DIV|H[1-6]|LI|SPAN|B|STRONG|TD|TH|LABEL|DT|DD|CAPTION)$/;
  const walk = el => {
    for (const ch of el.children) {
      if (ch.tagName === "TABLE") { for (const tr of ch.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr")) row(tr); continue; }
      if (ch.querySelector("br") && !ch.querySelector("table, p, div, li")) { for (const part of ch.innerHTML.split(/<br\s*\/?>/i)) { const d = doc.createElement("div"); d.innerHTML = part; const t = clean(d.textContent); if (t) push([{ x: 0, x2: 90, s: t, fs: 10 }]); } continue; }
      if (ch.querySelector("table, p, div, li, h1, h2, h3, h4, h5, h6") && !/^(SPAN|B|STRONG)$/.test(ch.tagName)) { walk(ch); continue; }
      if (BLOCK.test(ch.tagName) || ch.children.length === 0) { const t = clean(ch.textContent); if (t) push([{ x: 0, x2: 90, s: t, fs: 10 }]); }
      else walk(ch);
    }
  };
  const row = tr => {
    const cells = []; let col = 0; const nested = [];
    for (const td of tr.children) {
      if (!/^(TD|TH)$/.test(td.tagName)) continue;
      const span = Math.max(1, +td.getAttribute("colspan") || 1);
      const inner = td.querySelector("table");
      if (inner) nested.push(td);
      else cells.push({ x: col * 100, x2: col * 100 + 90, s: clean(td.innerText !== undefined && td.innerText ? td.innerText : td.textContent), fs: 10 });
      col += span;
    }
    push(cells);
    for (const td of nested) walk(td);
  };
  walk(doc.body || doc.documentElement);
  return { pages: [{ lines }], noText: !lines.length };
}
