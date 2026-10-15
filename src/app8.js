"use strict";
/* ---------------------------------------------------------------- налоги и банк: хранение документов, сверка с отчётностью, страница и диалоги.
   Декларации и обороты хранятся в клиенте в тенге (как в документах); в сверке переводятся в тыс. тг. */
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
const pctFmt = v => (isNum(v) ? nf1.format(v * 100) + " %" : "");
function ensureDocs(c = C) { if (!c) return; c.decl = c.decl || []; c.bank = c.bank || []; c.dset = c.dset || { pct: 0.02, bpct: 0.1 }; }
function perMonths(p) {
  const d = new Date(p.date); if (!p.date || isNaN(d)) return [];
  let y = d.getFullYear(), m = d.getMonth() + 1; const out = [];
  for (let i = 0; i < (p.months || 12); i++) { out.unshift(`${y}-${pad2(m)}`); if (--m === 0) { m = 12; y--; } }
  return out;
}
const dmyToYm = s => (s && /^\d{2}\.\d{2}\.\d{4}$/.test(s) ? `${s.slice(6)}-${s.slice(3, 5)}` : null);
function declVal(k, p, key) {
  const win = new Set(perMonths(p)), cov = new Set(), docs = []; let sum = 0;
  const list = C.decl.filter(d => d.k === k && d.vals && isNum(d.vals[key]) && d.year).sort((a, b) => ((a.part === "Y" ? 0 : 1) - (b.part === "Y" ? 0 : 1)) || (N(b.t) - N(a.t)));  // годовые раньше, из повторных — последняя загруженная
  for (const d of list) {
    const ms = partMonths(d.part).map(m => `${d.year}-${pad2(m)}`);
    if (!ms.every(x => win.has(x)) || ms.some(x => cov.has(x))) continue;
    ms.forEach(x => cov.add(x)); sum += d.vals[key]; docs.push(d);
  }
  return docs.length ? { v: sum / 1000, cov: cov.size, need: win.size, docs } : null;
}
function bankVal(k, p) {
  const win = perMonths(p), ws = new Set(win), mset = new Set(), skipped = new Set(); let cr = 0, db = 0, n = 0;
  for (const b of C.bank.filter(b => b.k === k)) {
    const rate = b.cur === "KZT" ? 1 : isNum(b.rate) && b.rate > 0 ? b.rate : null;
    const inWin = Object.keys(b.months || {}).filter(m => ws.has(m));
    const range = b.rangeOnly && dmyToYm(b.from) === win[0] && dmyToYm(b.to) === win[win.length - 1];
    if (!inWin.length && !range) continue;
    if (rate === null) { skipped.add(b.cur); continue; }
    for (const m of inWin) { cr += N(b.months[m].cr) * rate; db += N(b.months[m].db) * rate; mset.add(m); }
    if (range) { cr += N(b.total?.cr) * rate; db += N(b.total?.db) * rate; win.forEach(m => mset.add(m)); }
    n++;
  }
  if (!n) return skipped.size ? { v: null, cov: 0, need: win.length, skipped: [...skipped] } : null;
  return { v: cr / 1000, db: db / 1000, cov: mset.size, need: win.length, accs: n, skipped: [...skipped] };
}
const TAXFIX = {
  rev: "Выясните причину: другой период, выручка не отражена в декларации или в отчётности, НДС включён в одну из сумм, корректировки после сдачи декларации. Запросите расшифровку дохода и, при необходимости, дополнительную декларацию.",
  vat: "Оборот по НДС считается без НДС; расхождения дают авансы, экспорт по нулевой ставке, необлагаемые обороты и разные даты признания. Если разница большая — запросите реестр счетов-фактур и пояснение.",
  sgd: "В СГД входят прочие доходы (курсовая разница, списание обязательств, выбытие активов, вознаграждение). Сверьте расшифровку прочих доходов с декларацией.",
  cit: "Расход по КПН в ОПиУ включает отложенный налог — сравнивайте с текущим КПН. Большая разница — повод запросить расчёт КПН и налоговые корректировки.",
  fot: "Сверьте ФОТ с ф. 200.00 за все кварталы периода и с расчётной ведомостью; учтите ИП и договоры ГПХ.",
  bank_cf: "Поступления на счета включают займы, переводы между своими счетами и возвраты, а в ОДДС — ещё и касса. Проверьте, все ли счета загружены, и исключите внутренние переводы.",
  bank_lo: "Через загруженные счета прошла меньшая часть выручки: наличные расчёты, другие банки или взаимозачёты. Запросите справки об оборотах по всем счетам.",
  bank_hi: "Поступления намного больше выручки: займы, транзитные платежи, возвраты. Запросите выписку с назначением платежей.",
};
function taxChecks(k, p) {
  ensureDocs();
  const pid = p.id, g = key => val(k, key, pid), tol = N(C.card.tol) || 1, pct = N(C.dset.pct) || 0.02, bp = N(C.dset.bpct) || 0.1, out = [];
  const cell = key => ({ k, key, pid });
  const add = (id, title, aLab, a, bLab, bo, o) => {
    if (!bo) return;
    const full = bo.cov === bo.need && isNum(bo.v);
    let st = "nd", diff = null, rel = null;
    if (isNum(a) && full) { diff = a - bo.v; rel = Math.abs(diff) / Math.max(Math.abs(bo.v), Math.abs(a), 1); st = Math.abs(diff) <= tol || rel <= o.ok ? "ok" : rel > o.risk ? (o.max || "risk") : "chk"; }
    out.push({ id, title, aLab, a, bLab, b: bo.v, cov: bo.cov, need: bo.need, full, diff, rel, st, cells: o.cells, page: o.page || "odr", fix: o.fix || TAXFIX[id], docs: bo.docs, skipped: bo.skipped });
  };
  const rv = declVal(k, p, "rev");
  add("rev", "Выручка и доход по декларации", "Выручка по ОПиУ", g("rev"), rv && rv.docs.some(d => d.form !== "100") ? "Доход по декларации (" + [...new Set(rv.docs.map(d => d.form + ".00"))].join(", ") + ")" : "Доход от реализации по ф. 100.00", rv, { ok: pct, risk: 0.1, cells: [cell("rev")] });
  const vt = declVal(k, p, "vat_turn"), vx = declVal(k, p, "vat_ex");
  if (vt) add("vat", "Выручка и оборот по НДС", "Выручка по ОПиУ", g("rev"), vx && vx.cov === vt.cov ? "Облагаемый и освобождённый оборот (ф. 300.00)" : "Облагаемый оборот (ф. 300.00)", { ...vt, v: vt.v + (vx && vx.cov === vt.cov ? vx.v : 0) }, { ok: pct * 2, risk: 0.15, cells: [cell("rev")] });
  const sg = declVal(k, p, "sgd");
  const inc = isNum(g("rev")) ? g("rev") + N(g("ooi")) + N(g("fin_inc")) + Math.max(0, N(g("fx"))) + Math.max(0, N(g("onoi"))) : null;
  add("sgd", "Все доходы и совокупный годовой доход", "Доходы по ОПиУ (выручка, прочие, финансовые)", inc, "СГД по ф. 100.00", sg, { ok: pct * 2, risk: 0.15, max: "chk", cells: [cell("rev"), cell("ooi"), cell("fin_inc")] });
  const ct = declVal(k, p, "cit");
  add("cit", "КПН по отчётности и по декларации", "Расход по КПН в ОПиУ", g("cit"), ct && ct.docs.some(d => d.form === "910") ? "Налог по ф. 910.00" : "КПН по декларации", ct, { ok: 0.05, risk: 0.3, max: "chk", cells: [cell("cit")] });
  const ft = declVal(k, p, "fot");
  if (ft) add("fot", "ФОТ и доходы работников", "ФОТ (справочно в ОПиУ)", g("fot"), "Доходы работников по декларации", ft, { ok: pct * 2, risk: 0.15, max: "chk", cells: [cell("fot")] });
  const bk = bankVal(k, p);
  if (bk) {
    const inflow = isNum(g("cf010")) ? g("cf010") + N(g("cf040")) + N(g("cf090")) : null;
    if (isNum(inflow)) add("bank_cf", "Поступления на счета и ОДДС", "Поступления по ОДДС (все разделы)", inflow, "Поступления по справкам банков", bk, { ok: bp, risk: 0.25, cells: [cell("cf010")], page: "cf" });
    const year = +(p.date || "").slice(0, 4), vat = comp(k)?.vat === "Да" ? vatRate(year) : 0, r0 = g("rev");
    if (isNum(r0) && r0 > 0) {
      const full = bk.cov === bk.need && isNum(bk.v), base = r0 * (1 + vat), share = full ? bk.v / base : null;
      const st = !full ? "nd" : share < 0.5 ? "risk" : share < 0.8 || share > 2 ? "chk" : "ok";
      out.push({ id: "bank_rev", title: "Поступления на счета и выручка", aLab: vat ? `Выручка с НДС ${Math.round(vat * 100)} %` : "Выручка (без НДС — не плательщик)", a: base, bLab: "Поступления по справкам банков", b: bk.v, cov: bk.cov, need: bk.need, full, diff: full ? bk.v - base : null, rel: share, share: true, st,
        cells: [cell("rev")], page: "odr", fix: share !== null && share > 2 ? TAXFIX.bank_hi : TAXFIX.bank_lo, skipped: bk.skipped });
    }
  }
  return out;
}
function taxProblems(add) {
  if (!C) return; ensureDocs();
  if (!C.decl.length && !C.bank.length) return;
  for (let k = 1; k <= nComp(); k++) for (const p of C.periods) for (const c of taxChecks(k, p)) {
    const where = `${compName(k)}, ${p.label}`;
    if (c.st === "chk" || c.st === "risk") {
      const det = c.share ? `поступления ${fmt(c.b)} — ${pctFmt(c.rel)} от выручки с НДС ${fmt(c.a)}` : `${c.aLab}: ${fmt(c.a)}; ${c.bLab}: ${fmt(c.b)}; разница ${fmt(c.diff)} (${pctFmt(c.rel)})`;
      add(c.st, "decl", `${where}: ${c.title.toLowerCase()} — расхождение`, det, c.fix, c.cells);
    } else if (c.st === "nd" && c.cov < c.need && c.cov > 0) add("nd", "decl", `${where}: ${c.title.toLowerCase()} — данные не за весь период`, `загружено ${c.cov} из ${c.need} мес.`, "Загрузите декларации или справки за остальные месяцы периода — тогда сверка выполнится.");
    if (c.skipped?.length) add("nd", "decl", `${where}: валютные счета не учтены`, c.skipped.join(", "), "Откройте справку и укажите курс к тенге — тогда обороты войдут в сверку.");
  }
}

/* ---------- страница */
function pageDecl() {
  ensureDocs();
  const k = COMP_TAB > nComp() ? 1 : COMP_TAB, pers = C.periods;
  const decl = C.decl.filter(d => d.k === k), bank = C.bank.filter(b => b.k === k);
  let h = `<div class="pagehead"><div class="lead"><h1>Налоги и банк</h1><p>Налоговые декларации (100.00, 910.00, 300.00, 200.00) и справки банков об оборотах в PDF. Цифры сверяются с ОПиУ и ОДДС; расхождения подсвечиваются здесь и в формах. Файлы читаются в этом браузере и никуда не отправляются.</p></div>
    <div class="toolbar"><button class="btn primary" data-act="pdfdlg">Загрузить PDF</button><button class="btn" data-act="decladd">Декларация вручную</button><button class="btn" data-act="bankadd">Обороты вручную</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="decl">${bannerHTML("decl")}</div>`;
  const checks = pers.map(p => taxChecks(k, p));
  const ids = []; for (const cs of checks) for (const c of cs) if (!ids.includes(c.id)) ids.push(c.id);
  if (!decl.length && !bank.length) h += `<div class="empty"><h2>Документы не загружены</h2><p class="muted">Загрузите PDF деклараций и справок об оборотах — или введите суммы вручную, если документ отсканирован.</p><button class="btn primary" data-act="pdfdlg">Загрузить PDF</button></div>`;
  else {
    h += `<section class="panel"><h2>Сверка с отчётностью — ${esc(compName(k))}</h2><p class="hint">Тыс. тг. Расхождение: <span class="st ok">в допуске</span> <span class="st chk">проверить</span> <span class="st risk">существенное</span>. Сверка выполняется, когда документы покрывают весь период.</p>`;
    if (!ids.length) h += `<p class="muted">Для периодов анализа нет подходящих документов: проверьте год и часть периода в загруженных декларациях и месяцы в справках.</p>`;
    else {
      h += `<div class="tablewrap" style="max-height:none"><table class="data rmap tax"><thead><tr><th class="lab">Показатель</th>${pers.map(p => `<th>${esc(p.label)}</th>`).join("")}</tr></thead><tbody>`;
      for (const id of ids) {
        const row = i => checks.map(cs => cs.find(c => c.id === id));
        const any = row().find(Boolean);
        h += `<tr class="sec"><td class="lab" colspan="${pers.length + 1}">${esc(any.title)}</td></tr>`;
        h += `<tr><td class="lab">${esc(any.aLab)}</td>${row().map(c => `<td>${c ? fmt(c.a) : ""}</td>`).join("")}</tr>`;
        h += `<tr><td class="lab">${esc(any.bLab)}</td>${row().map(c => `<td>${c ? fmt(c.b) + (c.cov < c.need ? `<span class="pertitle">${c.cov} из ${c.need} мес.</span>` : "") : ""}</td>`).join("")}</tr>`;
        h += `<tr><td class="lab">${any.share ? "Доля поступлений в выручке с НДС" : "Расхождение (разница, %)"}</td>${row().map(c => {
          if (!c) return "<td></td>";
          if (c.st === "nd") return `<td class="v nd"><span class="val">${c.cov < c.need ? "неполный период" : "нет данных"}</span></td>`;
          const txt = c.share ? pctFmt(c.rel) : `${fmt(Math.round(c.diff))} · ${pctFmt(c.rel)}`;
          return `<td class="v ${c.st}" title="${esc(c.st === "ok" ? "В допуске" : c.fix)}"><span class="val">${txt}</span></td>`;
        }).join("")}</tr>`;
      }
      h += `</tbody></table></div>`;
    }
    h += `<div class="grid2 tight" style="margin-top:12px;max-width:640px"><label class="f"><span>Допуск расхождений с декларациями, %</span><input class="inp num" data-dset="pct" value="${esc(fmt(N(C.dset.pct) * 100, "m1"))}"></label>
      <label class="f"><span>Допуск для банковских оборотов, %</span><input class="inp num" data-dset="bpct" value="${esc(fmt(N(C.dset.bpct) * 100, "m1"))}"></label></div></section>`;
  }
  // декларации
  if (decl.length) {
    const ks = Object.keys(DocParse.KEYS).filter(key => decl.some(d => d.vals && isNum(d.vals[key])));
    const sorted = decl.slice().sort((a, b) => (a.year - b.year) || String(a.part).localeCompare(String(b.part)) || String(a.form).localeCompare(String(b.form)));
    h += `<section class="panel"><h2>Декларации (${decl.length})</h2><p class="hint">Суммы — в тенге, как в декларациях.</p><div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Форма</th><th>Период</th>${ks.map(key => `<th>${esc(DocParse.KEYS[key].t)}</th>`).join("")}<th></th></tr></thead><tbody>
      ${sorted.map(d => `<tr><td class="lab">${esc(d.formName || d.form)}<span class="formula">${esc(d.file || "введена вручную")}</span></td><td>${esc((d.year || "год?") + ", " + (PARTS[d.part] || d.part))}</td>${ks.map(key => `<td>${d.vals && isNum(d.vals[key]) ? fmt(d.vals[key]) : ""}</td>`).join("")}
        <td style="white-space:nowrap"><button class="btn ghost" data-decledit="${d.id}">Открыть</button><button class="btn ghost danger" data-decldel="${d.id}" title="Удалить" aria-label="Удалить">×</button></td></tr>`).join("")}
      </tbody></table></div></section>`;
  }
  // банк
  if (bank.length) {
    h += `<section class="panel"><h2>Справки банков (${bank.length} ${bank.length === 1 ? "счёт" : bank.length < 5 ? "счёта" : "счетов"})</h2><p class="hint">Суммы — в тенге; валютные счета пересчитываются по курсу, указанному в справке.</p><div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Банк</th><th style="text-align:left">Счёт</th><th>Валюта</th><th>Месяцев</th><th>Поступления</th><th>Списания</th><th></th></tr></thead><tbody>
      ${bank.map(b => { const ms = Object.values(b.months || {}); const cr = b.rangeOnly ? N(b.total?.cr) : ms.reduce((a, o) => a + N(o.cr), 0), db = b.rangeOnly ? N(b.total?.db) : ms.reduce((a, o) => a + N(o.db), 0);
        return `<tr><td class="lab">${esc(b.bank || "—")}<span class="formula">${esc(b.file || "введено вручную")}</span></td><td style="text-align:left">${esc(b.acc || "—")}</td><td>${esc(b.cur)}${b.cur !== "KZT" ? (isNum(b.rate) ? ` · курс ${fmt(b.rate, "m1")}` : ' · <span class="st chk">нет курса</span>') : ""}</td><td>${b.rangeOnly ? esc(`${b.from || "?"} – ${b.to || "?"}`) : ms.length}</td><td>${fmt(cr)}</td><td>${fmt(db)}</td>
          <td style="white-space:nowrap"><button class="btn ghost" data-bankedit="${b.id}">Открыть</button><button class="btn ghost danger" data-bankdel="${b.id}" title="Удалить" aria-label="Удалить">×</button></td></tr>`; }).join("")}
      </tbody></table></div>`;
    const months = [...new Set(bank.flatMap(b => Object.keys(b.months || {})))].sort();
    if (months.length) {
      const sum = (m, f) => bank.reduce((a, b) => { const r = b.cur === "KZT" ? 1 : isNum(b.rate) ? b.rate : 0; return a + N(b.months?.[m]?.[f]) * r; }, 0);
      h += `<h3 style="margin-top:16px">Обороты по месяцам, тыс. тг (все счета в тенге)</h3><div class="tablewrap"><table class="data"><thead><tr><th class="lab">Месяц</th><th>Поступления</th><th>Списания</th><th>Чистый поток</th></tr></thead><tbody>
        ${months.map(m => { const cr = sum(m, "cr") / 1000, db = sum(m, "db") / 1000; return `<tr><td class="lab">${ymLabel(m)}</td><td>${fmt(cr)}</td><td>${fmt(db)}</td><td class="${cr - db < 0 ? "neg" : ""}">${fmt(cr - db)}</td></tr>`; }).join("")}</tbody></table></div>`;
    }
    h += `</section>`;
  }
  return h;
}
function taxConclHTML() {
  if (!C) return ""; ensureDocs();
  if (!C.decl.length && !C.bank.length) return "";
  const items = [];
  for (let k = 1; k <= nComp(); k++) for (const p of C.periods) for (const c of taxChecks(k, p)) if (c.st === "chk" || c.st === "risk")
    items.push(`${compName(k)}, ${p.label}: ${c.title.toLowerCase()} — ${c.share ? `поступления на счета составили ${pctFmt(c.rel)} выручки с НДС` : `${c.aLab.toLowerCase()} ${fmt(c.a)}, ${c.bLab.toLowerCase()} ${fmt(c.b)}, разница ${fmt(c.diff)} тыс. тг (${pctFmt(c.rel)})`}`);
  return `<h2 style="margin-top:14px">Сверка с налоговыми декларациями и банковскими оборотами</h2>` + (items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>Существенных расхождений не выявлено (по загруженным документам).</p>`);
}

/* ---------- загрузка PDF */
function compByBin(bin) {
  if (!bin) return 0;
  const i = C.companies.findIndex(x => String(x.bin || "").replace(/\D/g, "") === bin);
  if (i >= 0) return i + 1;
  return String(C.card.bin || "").replace(/\D/g, "") === bin ? 1 : 0;
}
async function importPdfFiles(files, kDef) {
  ensureDocs();
  const rep = [];
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name)) { rep.push({ file: file.name, err: "это не PDF" }); continue; }
    let r;
    try { toast("Читаю " + file.name + "…"); r = await DocParse.read(await file.arrayBuffer()); }
    catch (e) { rep.push({ file: file.name, err: /паролем/.test(e.message) ? e.message + " — снимите пароль или введите суммы вручную" : "не удалось прочитать PDF: " + e.message }); continue; }
    if (r.pdf.noText) { rep.push({ file: file.name, err: "в PDF нет текста — это скан или картинка. Введите суммы вручную (кнопки «Декларация вручную» / «Обороты вручную»)" }); continue; }
    let kind = r.kind;
    if (!kind) {
      kind = await dialog("Что это за документ?", `<p>Не удалось уверенно определить тип документа <b>${esc(file.name)}</b>.</p>`, [{ t: "Пропустить", v: null }, { t: "Справка банка", v: "bank" }, { t: "Декларация", primary: true, v: "decl" }]);
      if (!kind) { rep.push({ file: file.name, err: "пропущено" }); continue; }
      if (kind === "decl") r.decl = DocParse.parseDecl(r.pdf); else r.bank = DocParse.parseBank(r.pdf);
    }
    if (kind === "decl") {
      const d = r.decl, keys = DocParse.pickKeys(d, DMAP), vals = {};
      for (const [key, code] of Object.entries(keys)) { const l = d.lines.find(x => x.code === code); if (l && l.vals.length) vals[key] = l.vals[0]; }
      const doc = { id: uid(), k: compByBin(d.bin) || kDef, file: file.name, form: d.form, formName: d.formName, year: d.year, part: d.part, bin: d.bin, lines: d.lines, vals, src: keys, t: Date.now() };
      const saved = await declEditor(doc, true, d.bin && compByBin(d.bin) ? "Компания определена по БИН " + d.bin : "");
      rep.push(saved ? { file: file.name, ok: `${saved.formName}, ${saved.year}, ${PARTS[saved.part]}: строк ${d.lines.length}` } : { file: file.name, err: "не сохранено" });
    } else {
      const b = r.bank;
      if (!b.accounts.length) { rep.push({ file: file.name, err: "не найдена таблица оборотов (месяцы и колонки дебет/кредит или поступления/списания). Введите обороты вручную" }); continue; }
      let n = 0;
      for (let i = 0; i < b.accounts.length; i++) {
        const a = b.accounts[i];
        const doc = { id: uid(), k: compByBin(b.bin) || kDef, file: file.name, bank: b.bank, acc: a.acc, cur: a.cur || "KZT", rate: null, months: a.months, total: a.total, rangeOnly: !!a.rangeOnly, from: b.period?.from || "", to: b.period?.to || "", t: Date.now() };
        const saved = await bankEditor(doc, true, b.accounts.length > 1 ? `Счёт ${i + 1} из ${b.accounts.length}` : "");
        if (saved) n++;
      }
      rep.push(n ? { file: file.name, ok: `${b.bank || "банк"}: счетов ${n}` } : { file: file.name, err: "не сохранено" });
    }
  }
  for (const x of rep) C.log.unshift({ t: new Date().toISOString(), file: x.file, comp: "", per: "", kind: "PDF", note: x.ok || "", err: x.err || "" });
  C.log = C.log.slice(0, 200);
  touch();
  return rep;
}
async function pdfDialog() {
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${COMP_TAB === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `<p class="muted">Налоговые декларации и справки банков об оборотах в PDF — можно сразу несколько файлов. Нужен «текстовый» PDF (из кабинета налогоплательщика или интернет-банка); для сканов суммы вводятся вручную. Файлы читаются здесь же, в браузере, и никуда не отправляются.</p>
    <label class="f" style="margin:12px 0"><span>Компания (если в документе нет БИН из карточки)</span><select class="inp" id="pComp">${compsOpts}</select></label>
    <label class="drop" id="pDrop"><input type="file" id="pFiles" multiple accept=".pdf,application/pdf" style="display:none"><span id="pTxt">Перетащите PDF сюда или нажмите, чтобы выбрать</span></label>`;
  let files = [];
  setTimeout(() => {
    const inp = $("#pFiles"), drop = $("#pDrop"), set = fl => { files = Array.from(fl); $("#pTxt").textContent = files.map(f => f.name).join(", ") || "Файлы не выбраны"; };
    inp.onchange = () => set(inp.files);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); set(e.dataTransfer.files); };
  });
  const k = await dialog("Загрузить PDF: декларации и справки банков", body, [{ t: "Отменить", v: null }, { t: "Загрузить", primary: true, v: () => +$("#pComp").value }]);
  if (!k || !files.length) { if (k) toast("Файлы не выбраны"); return; }
  await runPdfImport(files, k);
}
async function runPdfImport(files, k) {
  const rep = await importPdfFiles(files, k);
  PAGE = "decl"; render();
  await dialog("Результат загрузки PDF", rep.map(r => `<div class="logline"><b>${esc(r.file)}</b>: ${r.err ? stChip("crit", "не загружено") + " " + esc(r.err) : stChip("ok", "загружено") + " " + esc(r.ok)}</div>`).join(""), [{ t: "Готово", primary: true, v: true }]);
}

/* ---------- редактор декларации */
function declKeysHTML(doc) {
  const keys = Object.keys(DocParse.KEYS).filter(key => !DocParse.FORMS[doc.form] || DocParse.KEYS[key].forms.includes(doc.form));
  const lineOpt = (l, sel) => `<option value="${esc(l.code)}"${sel ? " selected" : ""}>${esc(l.code)} — ${esc(l.label.slice(0, 70))}${l.vals.length ? " · " + fmt(l.vals[0]) : ""}</option>`;
  return `<table class="data form dk"><thead><tr><th class="lab">Показатель для сверки</th><th style="text-align:left">Строка декларации</th><th>Сумма, тенге</th></tr></thead><tbody>
    ${keys.map(key => `<tr><td class="lab">${esc(DocParse.KEYS[key].t)}</td>
      <td>${doc.lines.length ? `<select class="inp" data-dkcode="${key}"><option value="">— не использовать / вручную</option>${doc.lines.map(l => lineOpt(l, doc.src?.[key] === l.code)).join("")}</select>` : '<span class="small muted">вручную</span>'}</td>
      <td class="cell"><input class="inp num" data-dkval="${key}" value="${esc(isNum(doc.vals?.[key]) ? fmt(doc.vals[key]) : "")}"></td></tr>`).join("")}</tbody></table>`;
}
async function declEditor(doc, isNew, note) {
  ensureDocs();
  const formOpts = Object.entries(DocParse.FORMS).map(([f, x]) => `<option value="${f}"${doc.form === f ? " selected" : ""}>${esc(x.name)}</option>`).join("") + (doc.form && !DocParse.FORMS[doc.form] ? `<option value="${esc(doc.form)}" selected>${esc(doc.formName || doc.form)}</option>` : "");
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${doc.k === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `${note ? `<p class="small muted">${esc(note)}</p>` : ""}${doc.file ? `<p class="small muted">Файл: ${esc(doc.file)}${doc.lines?.length ? ` · распознано строк: ${doc.lines.length}` : ""}</p>` : ""}
    <div class="grid2" style="margin:8px 0 12px"><label class="f"><span>Компания</span><select class="inp" id="dComp">${compsOpts}</select></label>
      <label class="f"><span>Форма</span><select class="inp" id="dForm">${formOpts}</select></label>
      <label class="f"><span>Год</span><input class="inp" id="dYear" inputmode="numeric" value="${esc(doc.year || "")}"></label>
      <label class="f"><span>Налоговый период</span><select class="inp" id="dPart">${Object.entries(PARTS).map(([v, t]) => `<option value="${v}"${doc.part === v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div>
    <p class="hint">Проверьте, что сумма взята из нужной строки. Выбор строки запоминается для этой формы и подставится в следующий раз.</p>
    <div id="dKeys">${declKeysHTML(doc)}</div>
    ${doc.lines?.length ? `<details style="margin-top:12px"><summary>Все распознанные строки (${doc.lines.length})</summary><div class="tablewrap" style="max-height:300px"><table class="data"><thead><tr><th class="lab">Код</th><th style="text-align:left">Наименование</th><th>Сумма</th></tr></thead><tbody>${doc.lines.map(l => `<tr><td class="lab">${esc(l.code)}</td><td style="text-align:left;white-space:normal">${esc(l.label)}</td><td>${l.vals.map(v => fmt(v)).join("; ")}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`;
  setTimeout(() => {
    const B = $("#dlgB"); $("#dlg").classList.add("wide");
    B.onchange = e => {
      const t = e.target;
      if (t.id === "dForm") { doc.form = t.value; doc.formName = DocParse.FORMS[t.value]?.name || doc.formName; $("#dKeys").innerHTML = declKeysHTML(doc); }
      if (t.dataset.dkcode !== undefined) { const l = doc.lines.find(x => x.code === t.value); const inp = B.querySelector(`[data-dkval="${t.dataset.dkcode}"]`); if (inp) inp.value = l && l.vals.length ? fmt(l.vals[0]) : ""; }
    };
  });
  const res = await dialog(isNew ? "Декларация: проверьте и сохраните" : "Декларация", body, [{ t: "Отменить", v: null }, { t: "Сохранить", primary: true, v: d => {
    const o = { k: +d.querySelector("#dComp").value, form: d.querySelector("#dForm").value, year: parseInt(d.querySelector("#dYear").value, 10) || null, part: d.querySelector("#dPart").value, vals: {}, src: {} };
    d.querySelectorAll("[data-dkval]").forEach(inp => { const v = parseNum(inp.value); if (v !== null) o.vals[inp.dataset.dkval] = v; });
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
  return `<table class="data form bk"><thead><tr><th class="lab">Месяц</th><th>Поступления (кредит)</th><th>Списания (дебет)</th><th></th></tr></thead><tbody>
    ${ms.map(m => `<tr><td class="lab"><input class="inp" type="month" data-bm="${m}" value="${m}"></td><td class="cell"><input class="inp num" data-bcr="${m}" value="${esc(m2(doc.months[m].cr))}"></td><td class="cell"><input class="inp num" data-bdb="${m}" value="${esc(m2(doc.months[m].db))}"></td><td><button class="btn ghost danger" data-bmdel="${m}" type="button">×</button></td></tr>`).join("")}
    <tr class="calc"><td class="lab">Итого по месяцам</td><td id="bSumCr"></td><td id="bSumDb"></td><td></td></tr>
    ${doc.total ? `<tr><td class="lab">Итого по справке</td><td>${m2(doc.total.cr)}</td><td>${m2(doc.total.db)}</td><td></td></tr>` : ""}</tbody></table>
    <p style="margin-top:8px"><button class="btn" data-bmadd type="button">Добавить месяц</button></p>`;
}
function bankReadRows(B, doc) {
  const months = {};
  B.querySelectorAll("[data-bm]").forEach(inp => {
    const old = inp.dataset.bm, m = inp.value || old;
    const cr = parseNum(B.querySelector(`[data-bcr="${old}"]`).value), db = parseNum(B.querySelector(`[data-bdb="${old}"]`).value);
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
      <label class="f"><span>Поступления, в валюте счёта</span><input class="inp num" id="bTcr" value="${esc(m2(doc.total?.cr))}"></label><label class="f"><span>Списания, в валюте счёта</span><input class="inp num" id="bTdb" value="${esc(m2(doc.total?.db))}"></label></div>`
      : `<p class="hint">Суммы — в валюте счёта, как в справке. Поступления — обороты по кредиту счёта, списания — по дебету.</p><div id="bRows">${bankRowsHTML(doc)}</div>`}`;
  const sums = () => { const B = $("#dlgB"); if (!B || doc.rangeOnly) return; const ms = bankReadRows(B, doc); let cr = 0, db = 0; for (const o of Object.values(ms)) { cr += o.cr; db += o.db; }
    const a = $("#bSumCr"), b = $("#bSumDb"); if (a) a.textContent = m2(cr); if (b) b.textContent = m2(db);
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
    if (doc.rangeOnly) { o.from = d.querySelector("#bFrom").value.trim(); o.to = d.querySelector("#bTo").value.trim(); o.total = { cr: parseNum(d.querySelector("#bTcr").value), db: parseNum(d.querySelector("#bTdb").value) }; }
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

/* ---------- события страницы */
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t || !C) return;
  const d = t.dataset;
  if (d.act === "pdfdlg") { pdfDialog(); return; }
  if (d.act === "decladd") {
    ensureDocs(); const L = C.periods[C.periods.length - 1];
    const doc = { id: uid(), k: COMP_TAB > nComp() ? 1 : COMP_TAB, file: "", form: comp(COMP_TAB)?.regime === "Упрощённая декларация" ? "910" : "100", year: +(L?.date || "").slice(0, 4) || null, part: "Y", lines: [], vals: {}, src: {}, t: Date.now() };
    if (doc.form === "910") doc.part = "H1";
    doc.formName = DocParse.FORMS[doc.form].name;
    if (await declEditor(doc, true)) { PAGE = "decl"; render(); }
    return;
  }
  if (d.act === "bankadd") {
    ensureDocs(); const L = C.periods[C.periods.length - 1], months = {};
    for (const m of L ? perMonths(L) : []) months[m] = { cr: null, db: null };
    const doc = { id: uid(), k: COMP_TAB > nComp() ? 1 : COMP_TAB, file: "", bank: "", acc: "", cur: "KZT", rate: null, months, total: null, rangeOnly: false, from: "", to: "", t: Date.now() };
    if (await bankEditor(doc, true)) { PAGE = "decl"; render(); }
    return;
  }
  if (d.decledit) { const doc = C.decl.find(x => x.id === d.decledit); if (doc && await declEditor(doc, false)) render(); return; }
  if (d.bankedit) { const doc = C.bank.find(x => x.id === d.bankedit); if (doc && await bankEditor(doc, false)) render(); return; }
  if (d.decldel) { if (await dialog("Удалить декларацию?", "<p>Декларация будет удалена из клиента; сверка пересчитается.</p>", [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }])) { C.decl = C.decl.filter(x => x.id !== d.decldel); touch(); render(); } return; }
  if (d.bankdel) { if (await dialog("Удалить справку?", "<p>Обороты по этому счёту будут удалены из клиента; сверка пересчитается.</p>", [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }])) { C.bank = C.bank.filter(x => x.id !== d.bankdel); touch(); render(); } return; }
});
document.addEventListener("change", e => {
  const t = e.target; if (!C || t.dataset.dset === undefined) return;
  const v = parseNum(t.value); if (v === null || v < 0) { toast("Укажите процент, например 2"); return; }
  ensureDocs(); C.dset[t.dataset.dset] = v / 100; touch(); render();
});

/* ---------- пример: декларации и обороты для демо-клиента */
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
  if (isNum(r1)) {
    const months = {}; const ms = perMonths(L), seas = [0.6, 0.6, 0.8, 1, 1.1, 1.1, 1.2, 1.4, 1.5, 1.2, 0.8, 0.7];
    const tot = seas.reduce((a, b) => a + b, 0);
    ms.forEach((m, i) => { const cr = r1 * 1.16 * 0.92 * seas[i] / tot * 1000; months[m] = { cr: Math.round(cr * 100) / 100, db: Math.round(cr * 0.97 * 100) / 100 }; });
    c.bank.push({ id: uid(), k: 1, file: "пример", bank: "АО «Пример Банк»", acc: "KZ000000000000000001", cur: "KZT", rate: null, months, total: null, rangeOnly: false, from: "", to: "", t: Date.now() });
  }
}
