"use strict";
/* ---------------------------------------------------------------- Продукт «Овердрафт»: упрощённый анализ.
   Разделы: Карточка, Благонадёжность, Баланс + ОПиУ, Банк, Кредитная история, Проблемы, Заключение (чек-лист).
   Лимит — от среднемесячных очищенных кредитовых оборотов за 6 (при сезонности 12) месяцев до месяца заявки:
   до 40 % по оборотам в Банке + до 40 % по оборотам в других банках (не более 2 банков), не более 100 млн тг при транше до 90 дней. */
const isOD = () => !!(C && C.card && C.card.product === "Овердрафт");
const OD_DEF = { line: 36, tranche: 30, avail: 11, seasonal: "Нет", zone: "Нет", agent: "Нет", appDate: "" };
function odCfg() { C.od = Object.assign({}, OD_DEF, C.od || {}); C.od.fin = C.od.fin || {}; C.od.fin.v = C.od.fin.v || {}; return C.od; }
const OD_EQ_KEY = "finkz.bankeq";
const odBankEq = () => { try { return parseNum(localStorage.getItem(OD_EQ_KEY)); } catch (e) { return null; } };   // СК Банка, млн тг
const OD_CAP = 100000;   // 100 млн тг, тыс. тг
const odYes = v => v === "Да";
const odSeasonal = () => odYes(odCfg().seasonal);
const odN = () => (odSeasonal() ? 12 : 6);

// месяц заявки и окно: N полных месяцев перед месяцем заявки
function odAppDate() { const o = odCfg(); return o.appDate || C.card.date || isoToday(); }
function odWindow() {
  const d = odAppDate(), y = +d.slice(0, 4), m = +d.slice(5, 7), n = odN(), out = [];
  for (let i = n; i >= 1; i--) { const t = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(`${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}`); }
  return out;
}
// очищенные обороты по правилам овердрафта: исключаются займы, конвертация, свои счета, возвраты, фин. помощь и займы связанных лиц,
// наличные (кроме инкассации, банкоматов Cash-in и POS), субсидии. Штрафы, вознаграждения и страховые — не исключаются.
function odCat(x, own) {
  const o = x.b.ov?.[x.i]; if (o === "inc") return null; if (o) return o;
  const c = DocParse.classify(x.t, own); if (!c) return null;
  const [cat, why] = c, p = `${x.t.purp || ""} ${x.t.op || ""}`.toLowerCase();
  if (cat === "aid") return /штраф|пени|вознагражд|процент|страхов|333/.test(why) ? null : "aid";
  if (cat === "cash") return /банкомат|atm|cash\s*-?\s*in|кэш[-\s]?ин|pos|пос[-\s]?терминал|терминал|инкасс/.test(p) ? null : "cash";
  if (cat === "grp") return /помощ|займ|заем|заём|кредит|возврат/.test(p) ? "grp" : null;
  return cat;
}
const odWhere = b => (b.where === "other" ? "other" : "our");
function odBank(k) {
  const own = ownOf(k), win = odWindow(), ws = new Set(win), tx = stmtTx(k).filter(x => x.cr && ws.has(x.m));
  const res = {};
  for (const w of ["our", "other"]) {
    const T = tx.filter(x => odWhere(x.b) === w), rows = win.map(m => ({ m, n: 0, cps: new Set(), net: 0, gross: 0 }));
    const accs = new Set(), banks = new Set(), cp = new Map();
    for (const b of C.bank.filter(b => b.k === k && b.kind === "stmt" && odWhere(b) === w)) { if (b.acc) accs.add(b.acc + (b.bank ? " (" + b.bank + ")" : "")); if (b.bank) banks.add(DocParse.clean(b.bank)); }
    for (const x of T) {
      const r = rows.find(z => z.m === x.m); r.gross += x.cr;
      if (odCat(x, own)) continue;
      const key = x.t.bin || DocParse.clean(x.t.cp) || "без названия";
      r.net += x.cr; r.n++; r.cps.add(key);
      const o = cp.get(key) || { name: x.t.cp || key, v: 0 }; o.v += x.cr; cp.set(key, o);
    }
    const net = rows.reduce((a, r) => a + r.net, 0), gross = rows.reduce((a, r) => a + r.gross, 0);
    const cps = [...cp.values()].sort((a, b) => b.v - a.v);
    // контрагент с долей > 60 %: в расчёт — не более 60 % поступлений от него
    let cut = 0; for (const o of cps) if (net > 0 && o.v / net > 0.6) cut += o.v * 0.4;
    const netAdj = net - cut, avg = netAdj / win.length / 1000;   // тыс. тг
    res[w] = { rows, net: net / 1000, gross: gross / 1000, cut: cut / 1000, netAdj: netAdj / 1000, avg, lim: 0.4 * avg, cps, accs: [...accs], banks: [...banks], has: T.length > 0, docs: C.bank.some(b => b.k === k && b.kind === "stmt" && odWhere(b) === w) };
  }
  const o = odCfg(), lim = res.our.lim + res.other.lim, capped = o.tranche == 90 ? Math.min(lim, OD_CAP) : lim;
  return { win, ...res, lim, limit: capped, capHit: o.tranche == 90 && lim > OD_CAP };
}
// опыт работы: полных месяцев от регистрации до начала месяца заявки
function odExperience(k) {
  const r = regDateIso(k); if (!r) return null;
  const d = odAppDate(), ry = +r.slice(0, 4), rm = +r.slice(5, 7), rd = +r.slice(8, 10), y = +d.slice(0, 4), m = +d.slice(5, 7);
  return (y * 12 + m) - (ry * 12 + rm) - (rd > 1 ? 1 : 0);
}
function odChecks() {
  const o = odCfg(), k = 1, B = odBank(k), win = B.win, n = win.length, amt = N(C.card.amount);
  const st = (ok, warn) => (ok === null ? "nd" : ok ? "ok" : warn ? "chk" : "crit");
  const out = [];
  const add = (grp, id, title, fact, s, fix) => out.push({ grp, id, title, fact, st: s, fix });
  // требования к заёмщику
  const needExp = odSeasonal() || o.tranche == 90 ? 12 : 6, exp = odExperience(k);
  add("b", "exp", `Опыт работы по основной деятельности не менее ${needExp} мес. (без месяца заявки)${needExp === 12 ? " — сезонность или транш до 90 дней" : ""}`,
    exp === null ? "дата регистрации неизвестна — «Подтянуть по БИН» или страница «Благонадёжность»" : `${exp} мес. (регистрация ${C.trust[k].regDate})`, st(exp === null ? null : exp >= needExp), "Укажите дату регистрации или уменьшите срок транша; при недостаточном опыте овердрафт не предоставляется.");
  const months = win.map((m, i) => ({ m, net: B.our.rows[i].net + B.other.rows[i].net, n: B.our.rows[i].n + B.other.rows[i].n, cps: new Set([...B.our.rows[i].cps, ...B.other.rows[i].cps]) }));
  const anyData = B.our.has || B.other.has;
  const avgNet = months.reduce((a, x) => a + x.net, 0) / n, zeroM = months.filter(x => x.net <= 0).length, lowM = months.filter(x => x.net > 0 && x.net < 0.3 * avgNet).length;
  add("b", "stab", `Стабильные поступления от основной деятельности за ${n} мес.`, anyData ? (zeroM ? `месяцев без поступлений: ${zeroM}` : lowM ? `месяцев с поступлениями ниже 30 % от среднего: ${lowM}` : "поступления каждый месяц") : "нет выписок за период",
    !anyData ? "nd" : zeroM ? "crit" : lowM ? "chk" : "ok", "Загрузите выписки по всем счетам за период; при сезонности укажите «Сезонный бизнес: Да» (период 12 мес.).");
  const avgN = months.reduce((a, x) => a + x.n, 0) / n, few = months.filter(x => x.n < 3), none = months.filter(x => x.n === 0).length, allow = n === 12 ? 2 : 1;
  add("b", "freq", "Частота поступлений не реже 3 раз в месяц (допускается 1 раз — в одном месяце из 6 / двух из 12 при среднем ≥ 3)",
    anyData ? `в среднем ${nf1.format(avgN)} в мес.; месяцев с менее чем 3 поступлениями: ${few.length}` : "нет выписок за период", st(anyData ? avgN >= 3 && none === 0 && few.length <= allow : null), "Проверьте, все ли выписки загружены; при редких поступлениях овердрафт не предоставляется.");
  const allCp = new Map(); for (const w of ["our", "other"]) for (const c of B[w].cps) { const x = allCp.get(c.name) || { name: c.name, v: 0 }; x.v += c.v; allCp.set(c.name, x); }
  const cpl = [...allCp.values()].sort((a, b) => b.v - a.v), tot = cpl.reduce((a, c) => a + c.v, 0), top = cpl[0] ? cpl[0].v / tot : 0;
  add("b", "cps", "Не менее 3 контрагентов; доля одного не более 60 % (иначе в расчёт берётся не более 60 % его поступлений)",
    anyData ? `контрагентов: ${cpl.length}; крупнейший — ${cpl[0]?.name || "—"} (${pctFmt(top)})` : "нет выписок за период", anyData ? (cpl.length < 3 ? "crit" : top > 0.6 ? "chk" : "ok") : "nd", "При доле > 60 % лимит уже рассчитан с ограничением; при менее 3 контрагентах овердрафт не предоставляется.");
  const cs = crSummary(k), cc = creditChecks(k);
  add("b", "credit", "Отсутствие отрицательной кредитной истории", !cs.any ? "кредитный отчёт не загружен" : cs.od > 0 ? `текущая просрочка ${cs.od} дн.` : cs.maxOd > 30 ? `в истории просрочка до ${cs.maxOd} дн.` : "просрочек нет",
    !cs.any ? "nd" : cs.od > 0 ? "crit" : cs.maxOd > 30 ? "chk" : "ok", "Загрузите отчёт ПКБ/ГКБ на странице «Кредитная история».");
  ensureTrust(); const ts = trustSummary(k);
  add("b", "trust", "Отсутствие отрицательной благонадёжности", `стоп-факторы: ${ts.crit}, риски: ${ts.risk}, не проверено: ${ts.na}`, ts.crit + ts.risk > 0 ? "crit" : ts.na === TRUST.length ? "nd" : ts.na > 0 ? "chk" : "ok", "«Подтянуть по БИН» и проверка по перечню АФМ на странице «Благонадёжность».");
  add("b", "zone", "Не относится к «красной», «чёрной» зонам проблемности", `зона: ${o.zone}`, /Красн|Чёрн|Черн/.test(o.zone) ? "crit" : "ok", "Финансирование заёмщиков красной и чёрной зон не допускается.");
  const ok2 = okedDigits(C.card.oked?.[0]?.code || ""), sec = ok2.slice(0, 2), banned = ["01", "02", "03", "41", "42", "43"].includes(sec);
  add("b", "industry", "Транш до 90 дней не допускается для «Строительства» и «Сельского, лесного и рыбного хозяйства»", ok2 ? `ОКЭД ${okedFmt(ok2)}; транш ${o.tranche} дн.` : "основной ОКЭД не указан",
    !ok2 ? (o.tranche == 90 ? "nd" : "ok") : o.tranche == 90 && banned ? "crit" : "ok", "Для этих отраслей — только транш до 30 дней.");
  // условия продукта
  add("p", "line", "Срок кредитной линии не более 36 мес.", `${N(o.line)} мес.`, N(o.line) > 0 && N(o.line) <= 36 ? "ok" : "crit", "Уменьшите срок линии до 36 мес.");
  add("p", "tranche", "Срок транша до 30 / до 90 дней", `${o.tranche} дн.`, [30, 90].includes(+o.tranche) ? "ok" : "crit", "Выберите 30 или 90 дней.");
  const otherUsed = B.other.lim > 0, maxAv = otherUsed ? 3 : 11;
  add("p", "avail", `Период доступности не более ${maxAv} мес.${otherUsed ? " (лимит учитывает обороты в других банках)" : ""}`, `${N(o.avail)} мес.`, N(o.avail) > 0 && N(o.avail) <= maxAv ? "ok" : "crit", otherUsed ? "При лимите по оборотам в других банках — не более 3 мес. с последующим пересмотром после перевода оборотов в Банк." : "Уменьшите период доступности до 11 мес.");
  if (otherUsed) add("p", "banks", "Обороты в других банках — не более 2 банков", `банков: ${B.other.banks.length || "не указаны"}`, B.other.banks.length <= 2 ? "ok" : "crit", "Учитывайте обороты не более чем в 2 других банках.");
  if (otherUsed) add("p", "transfer", "Перевод не менее 90 % оборотов в Банк в течение 3 месяцев с начала финансирования", "условие договора", "chk", "Включите условие о переводе оборотов в кредитную документацию; пересмотр лимита через 3 мес.");
  add("p", "amount", `Запрашиваемая сумма не более расчётного лимита${o.tranche == 90 ? " и 100 млн тг" : ""}`, `запрос ${isNum(C.card.amount) ? fmt(amt) : "—"}, лимит ${fmt(B.limit)} тыс. тг`, !isNum(C.card.amount) ? "nd" : amt <= B.limit + 0.5 ? "ok" : "crit", "Уменьшите сумму до расчётного лимита.");
  if (odYes(o.agent)) add("p", "agent", "Агентская деятельность (договор комиссии): поступления по комиссии исключены", "нужно пояснение бухгалтера и ручное исключение операций", "chk", "Исключите поступления по договорам комиссии в выписке («Операции» → вид операции).");
  return { out, B, months, exp, cpl };
}
function odFormat(limit) {
  const eq = odBankEq(); if (!isNum(eq) || eq <= 0) return { txt: "укажите СК Банка на «Карточке», чтобы определить формат заключения", chk: null };
  const thr = eq * 1000 * 0.002;   // тыс. тг
  return limit <= thr ? { txt: `лимит ${fmt(limit)} тыс. тг ≤ 0,2 % СК Банка (${fmt(thr)} тыс. тг): заключения КП и АР — в формате чек-листа, PD, LGD, риск-сегмент, заявка, калькулятор и УПР не требуются`, chk: true }
    : { txt: `лимит ${fmt(limit)} тыс. тг > 0,2 % СК Банка (${fmt(thr)} тыс. тг): анализ и заключения — по действующим процессам и ВНД Банка`, chk: false };
}
function odProblems(add) {
  const { out } = odChecks();
  for (const c of out) if (c.st === "crit" || c.st === "chk" || c.st === "nd") add(c.st === "nd" ? "nd" : c.st === "crit" ? "crit" : "chk", c.grp === "b" && ["stab", "freq", "cps"].includes(c.id) ? "bank" : "card", `Овердрафт: ${c.title}`, c.fact, c.fix);
  const F = odFinVals();
  for (const col of F.cols) { const v = F.v(col, "ni"), e = F.v(col, "eq"); if (isNum(v) && v < 0) add("risk", "fin", `${col.label}: чистый убыток`, fmt(v), "Рентабельность по чистой прибыли должна быть положительной — уточните причины убытка."); if (isNum(e) && e < 0) add("risk", "fin", `${col.label}: собственный капитал отрицательный`, fmt(e), "Собственный капитал должен быть положительным."); }
}
const OD_PAGES = new Set(["card", "trust", "fin", "bank", "credit", "prob", "concl", "map", "norms", "log", "bal", "odr"]);
function odFilter(list) { return list.filter(p => OD_PAGES.has(p.page) && !/^Прогноз|DSCR/.test(p.title)).map(p => (p.page === "bal" || p.page === "odr" ? { ...p, page: "fin" } : p)); }

/* ---------- «Баланс + ОПиУ»: таблица анализа сделки */
const OD_ROWS = [["ca", "Краткосрочные активы", "in"], ["dz", "в том числе дебиторская задолженность", "in", 1], ["lta", "Долгосрочные активы", "in"], ["ta", "Итого активы", "calc"], ["cl", "Краткосрочные обязательства", "in"], ["ltl", "Долгосрочные обязательства", "in"], ["eq", "Собственный капитал", "calc"], ["tp", "Итого пассивы", "calc"], ["rev", "Выручка", "in"], ["ni", "Чистая прибыль", "in"], ["npm", "Рентабельность по чистой прибыли положительная", "calc"], ["dso", "Оборачиваемость дебиторской задолженности (в днях)", "calc"], ["eqpos", "Собственный капитал положительный", "calc"]];
function odFinVals() {
  const o = odCfg(), P = C.periods, last = P[P.length - 1];
  const p2 = P.find(p => p.id === o.fin.p2) || last;
  const p1 = P.find(p => p.id === o.fin.p1) || [...P].reverse().find(p => p !== p2 && /-12-31$/.test(p.date || "")) || P[P.length - 2] || last;
  const obj = C.obj || 0, ov = (pid, key) => o.fin.v?.[pid]?.[key];
  const base = (pid, key) => { const g = kk => val(obj, kk, pid); if (key === "dz") return allNum(g("ar"), g("oar")) ? g("ar") + g("oar") : g("ar"); return g(key); };
  const v = (col, key) => {
    const pid = col.id, inp = k2 => { const x = ov(pid, k2); return isNum(x) ? x : base(pid, k2); };
    switch (key) {
      case "ta": case "tp": return allNum(inp("ca"), inp("lta")) ? inp("ca") + inp("lta") : null;
      case "eq": { const ta = v(col, "ta"); return allNum(ta, inp("cl"), inp("ltl")) ? ta - inp("cl") - inp("ltl") : null; }
      case "npm": return allNum(inp("ni"), inp("rev")) && inp("rev") ? inp("ni") / inp("rev") : null;
      case "dso": return allNum(inp("dz"), inp("rev")) && inp("rev") > 0 ? inp("dz") / (inp("rev") / ((N(col.months) || 12) * 365 / 12)) : null;
      case "eqpos": return v(col, "eq");
      default: return inp(key);
    }
  };
  return { cols: [p1, p2].filter((x, i, a) => x && a.indexOf(x) === i), v, ov, base, p1, p2 };
}
function pageFin() {
  const o = odCfg(), F = odFinVals(), P = C.periods;
  const sel = (id, cur) => `<select class="inp" data-odp="${id}">${P.map(p => `<option value="${p.id}"${p.id === cur.id ? " selected" : ""}>${esc(p.label)} · ${esc((p.date || "").split("-").reverse().join("."))}</option>`).join("")}</select>`;
  const cell = (col, key, kind) => {
    const val0 = F.v(col, key);
    if (kind === "in") { const ov = F.ov(col.id, key); return `<td class="cell${isNum(ov) ? " src" : ""}"><input class="inp num" data-odfin="${key}" data-pid="${col.id}" value="${esc(fmt(val0))}" title="${isNum(ov) ? "введено вручную; очистите поле, чтобы вернуть значение из отчётности" : "из загруженной отчётности; можно изменить"}"></td>`; }
    if (key === "npm") return `<td class="${isNum(val0) && val0 < 0 ? "neg" : ""}">${isNum(val0) ? pctFmt(val0) + (val0 > 0 ? " · да" : " · нет") : "—"}</td>`;
    if (key === "dso") return `<td>${isNum(val0) ? nf0.format(val0) : "—"}</td>`;
    if (key === "eqpos") return `<td class="${isNum(val0) && val0 < 0 ? "neg" : ""}">${isNum(val0) ? (val0 > 0 ? "да" : "нет") : "—"}</td>`;
    return `<td class="calc${isNum(val0) && val0 < 0 ? " neg" : ""}">${fmt(val0)}</td>`;
  };
  return `<div class="pagehead"><div class="lead"><h1>Баланс + ОПиУ</h1><p>Информация по анализу сделки согласно финансовой отчётности клиента, тыс. тг. Значения подставляются из загруженной отчётности (баланс, ОПиУ, Excel или PDF); жёлтые ячейки можно исправить вручную. Итоги, собственный капитал, рентабельность и оборачиваемость считаются сами.</p></div>
    <div class="toolbar"><button class="btn primary" data-act="importdlg">Загрузить отчётность</button><button class="btn ghost" data-page="bal">Баланс подробно</button><button class="btn ghost" data-page="odr">ОПиУ подробно</button></div></div>
  <div id="probBanner" data-page="fin">${bannerHTML("fin")}</div>
  <section class="panel"><div class="tablewrap" style="max-height:none"><table class="data odfin"><thead><tr><th class="lab">Наименование</th><th>${sel("p1", F.p1)}<span class="formula">последний год</span></th><th>${sel("p2", F.p2)}<span class="formula">последняя отчётная дата</span></th></tr></thead><tbody>
  ${OD_ROWS.map(([key, lab, kind, sub]) => `<tr class="${kind === "calc" ? "calc" : ""}"><td class="lab"${sub ? ' style="padding-left:26px"' : ""}>${["ta", "tp", "rev"].includes(key) ? "<b>" + esc(lab) + "</b>" : esc(lab)}${kind === "calc" ? '<span class="formula">расчёт производится автоматически</span>' : ""}</td>${F.cols.map(c => cell(c, key, kind)).join("")}${F.cols.length < 2 ? "<td></td>" : ""}</tr>`).join("")}
  </tbody></table></div><p class="hint" style="margin-top:8px">Оборачиваемость ДЗ = дебиторская задолженность / (выручка / дней в периоде). Собственный капитал = итого активы − краткосрочные − долгосрочные обязательства.</p></section>`;
}

/* ---------- «Банк»: расчёт лимита по оборотам */
function odBankPanel(k) {
  const B = odBank(1), o = odCfg(), win = B.win;
  const tab = (w, ttl) => { const X = B[w]; if (!X.docs) return `<section class="panel"><h2>${ttl}</h2><p class="hint">Выписки ${w === "our" ? "по счетам в Банке" : "по счетам в других банках"} не загружены. При загрузке отметьте «${w === "our" ? "в Банке" : "в других банках"}».</p></section>`;
    return `<section class="panel"><h2>${ttl}</h2><p class="small">Номер текущего счёта: <b>${esc(X.accs.join("; ") || "не указан")}</b>${w === "other" ? ` · банков: ${X.banks.length}` : ""}</p>
    <div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Период</th><th>Кол-во поступлений в месяц</th><th>Кол-во контрагентов в месяц</th><th>Чистый кредитовый оборот</th><th>Общий кредитовый оборот</th></tr></thead><tbody>
    ${X.rows.map(r => `<tr class="${r.n < 3 ? "warn" : ""}"><td class="lab">${ymLabel(r.m)}</td><td>${r.n}</td><td>${r.cps.size}</td><td>${fmt(r.net / 1000)}</td><td>${fmt(r.gross / 1000)}</td></tr>`).join("")}
    <tr class="calc"><td class="lab">Итого за ${win.length} мес.</td><td>${X.rows.reduce((a, r) => a + r.n, 0)}</td><td>${new Set(X.rows.flatMap(r => [...r.cps])).size}</td><td>${fmt(X.net)}</td><td>${fmt(X.gross)}</td></tr>
    ${X.cut ? `<tr><td class="lab">Ограничение 60 % по контрагенту</td><td></td><td></td><td>−${fmt(X.cut)}</td><td></td></tr>` : ""}
    <tr class="calc"><td class="lab">Среднемесячный очищенный оборот</td><td></td><td></td><td>${fmt(X.avg)}</td><td>${fmt(X.gross / win.length)}</td></tr>
    <tr class="calc"><td class="lab"><b>Лимит: 40 % среднемесячного</b></td><td></td><td></td><td><b>${fmt(X.lim)}</b></td><td></td></tr></tbody></table></div></section>`; };
  return `<section class="panel"><h2>Расчёт лимита овердрафта</h2><p class="hint">Тыс. тг. Период — ${win.length} полных мес. до месяца заявки (${esc(ymLabel(win[0]))} – ${esc(ymLabel(win[win.length - 1]))})${odSeasonal() ? ", сезонный бизнес — 12 мес." : ""}. Из поступлений исключаются кредиты и займы (в т.ч. от учредителей), конвертация, поступления с других счетов клиента, возвраты, финансовая помощь от связанных компаний, наличные (кроме инкассации, банкоматов Cash-in и POS-терминалов) и государственные субсидии.</p>
    <div class="facts sm"><div><span>По оборотам в Банке</span><b>${fmt(B.our.lim)}</b></div><div><span>По оборотам в других банках</span><b>${fmt(B.other.lim)}</b></div><div><span>Расчётный лимит${o.tranche == 90 ? " (≤ 100 млн при транше 90 дн.)" : ""}</span><b>${fmt(B.limit)}</b></div><div><span>Запрос</span><b>${fmt(C.card.amount)}</b></div><div><span>Формат заключения</span><b>${odFormat(B.limit).chk === null ? "—" : odFormat(B.limit).chk ? "чек-лист" : "полный"}</b></div></div>
    ${B.capHit ? `<p class="hint">Расчёт по оборотам ${fmt(B.lim)} тыс. тг ограничен 100 млн тг (транш до 90 дней).</p>` : ""}${B.other.lim > 0 ? `<p class="hint">Лимит по оборотам в других банках — при условии перевода не менее 90 % оборотов в Банк в течение 3 месяцев; период доступности — не более 3 мес. с пересмотром.</p>` : ""}</section>
  ${tab("our", "Обороты в Банке")}${tab("other", "Обороты в других банках")}`;
}

/* ---------- «Карточка»: условия овердрафта */
function odCardPanel() {
  const o = odCfg(), B = odBank(1), eq = odBankEq();
  const sel = (key, lab, list) => `<label class="f"><span>${lab}</span><select class="inp" data-od="${key}">${list.map(v => `<option value="${esc(v)}"${String(o[key]) === String(v) ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
  const num = (key, lab) => `<label class="f"><span>${lab}</span><input class="inp" data-od="${key}" inputmode="numeric" value="${esc(o[key] ?? "")}"></label>`;
  return `<section class="panel"><h2>Условия овердрафта</h2><p class="hint">Лимит — до 40 % среднемесячных очищенных кредитовых оборотов за ${odN()} мес. до месяца заявки по счетам в Банке и до 40 % — в других банках (не более 2 банков), не более 100 млн тг при транше до 90 дней. Расчётный лимит сейчас: <b>${fmt(B.limit)} тыс. тг</b>.</p>
    <div class="grid2">${num("line", "Срок кредитной линии, мес. (≤ 36)")}${sel("tranche", "Срок транша, дней", [30, 90])}${num("avail", "Период доступности, мес. (≤ 11; ≤ 3 по другим банкам)")}
      <label class="f"><span>Дата заявки</span><input class="inp" type="date" data-od="appDate" value="${esc(o.appDate || C.card.date || "")}"></label>
      ${sel("seasonal", "Сезонный бизнес (период 12 мес.)", ["Нет", "Да"])}${sel("zone", "Зона проблемности", ["Нет", "Жёлтая", "Красная", "Чёрная"])}${sel("agent", "Агентская деятельность (договор комиссии)", ["Нет", "Да"])}
      <label class="f"><span>СК Банка, млн тг (для порога 0,2 %)</span><input class="inp" data-odeq inputmode="numeric" value="${esc(isNum(eq) ? fmt(eq) : "")}" placeholder="для всех клиентов"></label></div></section>`;
}

/* ---------- заключение в формате чек-листа */
function odConclusionHTML(forWord) {
  ensureTrust(); ensureCredit();
  const c = C.card, o = odCfg(), R = odChecks(), B = R.B, F = odFinVals(), fm = odFormat(B.limit);
  const T = forWord ? 'style="border-collapse:collapse;font-size:10pt;width:100%" border="1" cellpadding="4"' : 'class="data"';
  const th = forWord ? ' style="border:1px solid #E5E4E2;padding:4px 8px;background:#E5E4E2"' : "";
  const mark = s => ({ ok: "✓ соответствует", chk: "⚠ требует проверки", crit: "✗ не соответствует", nd: "— нет данных" }[s]);
  let n = 0; const H2 = t => `<h2 style="margin-top:16px">${++n}. ${t}</h2>`;
  const reqT = grp => `<table ${T}><thead><tr><th${th}>№</th><th${th} style="text-align:left">Требование</th><th${th} style="text-align:left">Факт</th><th${th}>Соответствие</th></tr></thead><tbody>${R.out.filter(x => x.grp === grp).map((x, i) => `<tr><td>${i + 1}</td><td style="text-align:left">${esc(x.title)}</td><td style="text-align:left">${esc(x.fact)}</td><td>${mark(x.st)}</td></tr>`).join("")}</tbody></table>`;
  const bad = R.out.filter(x => x.st === "crit"), warn = R.out.filter(x => x.st === "chk" || x.st === "nd");
  const t = C.trust[1] || {};
  let h = `<h1>Заключение по овердрафту</h1>
  ${H2("Заёмщик")}<p><b>${esc(compName(1))}</b>${comp(1)?.bin ? ", БИН " + esc(comp(1).bin) : ""}. ${okedListText(C) ? "ОКЭД: " + esc(okedListText(C)) + ". " : ""}${t.regDate ? "Дата регистрации: " + esc(t.regDate) + (isNum(R.exp) ? ` (опыт ${R.exp} мес.)` : "") + ". " : ""}${t.director ? "Руководитель: " + esc(t.director) + "." : ""}</p>
  ${H2("Запрашиваемые условия")}<table ${T}><tbody>
    <tr><td style="text-align:left">Продукт</td><td style="text-align:left">Овердрафт (кредитная линия), транш до ${o.tranche} дней</td></tr>
    <tr><td style="text-align:left">Сумма финансирования, тыс. тг</td><td style="text-align:left">${isNum(c.amount) ? fmt(c.amount) : "не указана"}</td></tr>
    <tr><td style="text-align:left">Срок кредитной линии / период доступности</td><td style="text-align:left">${esc(o.line)} мес. / ${esc(o.avail)} мес.</td></tr>
    <tr><td style="text-align:left">Дата заявки</td><td style="text-align:left">${esc(odAppDate().split("-").reverse().join("."))}</td></tr>
    <tr><td style="text-align:left">Формат заключения</td><td style="text-align:left">${esc(fm.txt)}</td></tr></tbody></table>
  ${H2("Расчёт лимита по оборотам")}<p>Период: ${esc(ymLabel(B.win[0]))} – ${esc(ymLabel(B.win[B.win.length - 1]))} (${B.win.length} мес.). Тыс. тг.</p>
  <table ${T}><thead><tr><th${th} style="text-align:left">Показатель</th><th${th}>В Банке</th><th${th}>В других банках</th></tr></thead><tbody>
    <tr><td style="text-align:left">Счета</td><td>${esc(B.our.accs.join("; ") || "—")}</td><td>${esc(B.other.accs.join("; ") || "—")}</td></tr>
    <tr><td style="text-align:left">Общий кредитовый оборот</td><td>${fmt(B.our.gross)}</td><td>${fmt(B.other.gross)}</td></tr>
    <tr><td style="text-align:left">Очищенный кредитовый оборот</td><td>${fmt(B.our.net)}</td><td>${fmt(B.other.net)}</td></tr>
    ${B.our.cut || B.other.cut ? `<tr><td style="text-align:left">Ограничение 60 % по контрагенту</td><td>${B.our.cut ? "−" + fmt(B.our.cut) : ""}</td><td>${B.other.cut ? "−" + fmt(B.other.cut) : ""}</td></tr>` : ""}
    <tr><td style="text-align:left">Среднемесячный очищенный оборот</td><td>${fmt(B.our.avg)}</td><td>${fmt(B.other.avg)}</td></tr>
    <tr><td style="text-align:left"><b>40 % среднемесячного</b></td><td><b>${fmt(B.our.lim)}</b></td><td><b>${fmt(B.other.lim)}</b></td></tr></tbody></table>
  <p><b>Расчётный лимит овердрафта: ${fmt(B.limit)} тыс. тг</b>${B.capHit ? " (ограничен 100 млн тг)" : ""}. Запрос: ${isNum(c.amount) ? fmt(c.amount) + " тыс. тг" : "не указан"}.</p>
  <table ${T}><thead><tr><th${th} style="text-align:left">Месяц</th><th${th}>Поступлений</th><th${th}>Контрагентов</th><th${th}>Чистый оборот</th><th${th}>Общий оборот</th></tr></thead><tbody>${R.months.map((m, i) => `<tr><td style="text-align:left">${esc(ymLabel(m.m))}</td><td>${m.n}</td><td>${m.cps.size}</td><td>${fmt(m.net / 1000)}</td><td>${fmt((B.our.rows[i].gross + B.other.rows[i].gross) / 1000)}</td></tr>`).join("")}</tbody></table>
  ${H2("Требования к заёмщику")}${reqT("b")}
  ${H2("Требования к продукту")}${reqT("p")}
  ${H2("Финансовые показатели, тыс. тг")}<table ${T}><thead><tr><th${th} style="text-align:left">Наименование</th>${F.cols.map(cl => `<th${th}>${esc(cl.label)}</th>`).join("")}</tr></thead><tbody>${OD_ROWS.map(([key, lab]) => `<tr><td style="text-align:left">${esc(lab)}</td>${F.cols.map(cl => { const v = F.v(cl, key); return `<td>${key === "npm" ? (isNum(v) ? pctFmt(v) : "—") : key === "dso" ? (isNum(v) ? nf0.format(v) : "—") : key === "eqpos" ? (isNum(v) ? (v > 0 ? "да" : "нет") : "—") : fmt(v)}</td>`; }).join("")}</tr>`).join("")}</tbody></table>
  ${H2("Благонадёжность")}${typeof trustConclHTML === "function" ? trustConclHTML() : ""}
  ${H2("Кредитная история")}<p>${(() => { const s = crSummary(1); return !s.any ? "Кредитный отчёт не загружен." : `Действующих займов: ${s.n}, остаток долга ${fmt(s.debt)} тыс. тг, платежи ${fmt(s.pay)} тыс. тг в месяц; текущая просрочка — ${s.od ? s.od + " дн." : "нет"}, максимальная в истории — ${s.maxOd ? s.maxOd + " дн." : "нет"}.`; })()}</p>
  ${H2("Итог проверки")}<p>${bad.length ? `<b>Не соответствует условиям продукта:</b> ${esc(bad.map(x => x.title).join("; "))}.` : "Несоответствий условиям продукта не выявлено."}${warn.length ? ` Требует проверки / нет данных: ${esc(warn.map(x => x.title).join("; "))}.` : ""}</p>
  ${H2("Выводы кредитного менеджера")}<p>${esc(C.concl.text || "—").replace(/\n/g, "<br>")}</p>${C.concl.conditions ? `<p><b>Условия:</b> ${esc(C.concl.conditions).replace(/\n/g, "<br>")}</p>` : ""}
  ${H2("Рекомендация")}<p><b>${esc(C.concl.decision || "не указана")}</b>${isNum(c.amount) ? `, сумма ${fmt(Math.min(N(c.amount), B.limit))} тыс. тг` : ""}. Статус: ${esc(C.concl.status || "Черновик")}.</p>
  <p class="small muted">Кредитный менеджер: ${esc(c.analyst || "")} · ${esc((c.date || "").split("-").reverse().join("."))}</p>`;
  return h;
}

/* ---------- события */
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset; if (!C) return;
  if (d.od !== undefined) { const o = odCfg(); o[d.od] = ["line", "avail", "tranche"].includes(d.od) ? (parseNum(t.value) ?? t.value) : t.value; touch(); render(); return; }
  if (d.odeq !== undefined) { const v = parseNum(t.value); try { if (v === null) localStorage.removeItem(OD_EQ_KEY); else localStorage.setItem(OD_EQ_KEY, String(v)); } catch (err) { /* ignore */ } render(); return; }
  if (d.odp !== undefined) { odCfg().fin[d.odp] = t.value; touch(); render(); return; }
  if (d.odfin !== undefined) { const o = odCfg(); o.fin.v[d.pid] = o.fin.v[d.pid] || {}; const v = t.value.trim() === "" ? null : parseNum(t.value); if (v === null) delete o.fin.v[d.pid][d.odfin]; else o.fin.v[d.pid][d.odfin] = v; touch(); render(); return; }
  if (d.bwhere !== undefined) { const b = C.bank.find(x => x.id === d.bwhere); if (b) { b.where = t.value; touch(); render(); } return; }
});
