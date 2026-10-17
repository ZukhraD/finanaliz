"use strict";
/* ---------------------------------------------------------------- Прогноз по кварталам (по шаблону банка «Прогноз движения денежных средств»).
   Строки — как в шаблоне Excel: операционный, инвестиционный, финансовый денежный поток, долг, корректировка, результаты.
   База — последний период отчётности в годовом выражении; кварталы — с квартала, следующего за кварталом последней отчётности.
   Значения считаются из допущений; ячейки с пометкой ✎ можно исправить вручную (тыс. тг). Сценарий — базовый. */
const FCQ_FLOW = new Set();
// [id, название, формат/знак, тип]; тип: h — заголовок раздела, in — расчёт с правом ручной правки, c — итог, l — за 4 кв., p — %, x — коэф., s — остаток
const FCQ_ROWS = [
  ["h10", "Операционный денежный поток", "", "h"],
  ["r11", "Выручка (нетто)", "", "in"],
  ["r13", "Себестоимость (включая амортизацию, пост. и перем. расходы)", "со знаком «+»", "in"],
  ["r14", "Общехозяйственные, административные, коммерческие и прочие операционные расходы", "со знаком «+»", "in"],
  ["r15", "Издержки на реализацию", "со знаком «+»", "in"],
  ["r17", "Операционная прибыль (убыток)", "", "c"],
  ["r19", "Финансовые доходы (процентные доходы и доля в прибыли/убытке зависимых компаний)", "", "in"],
  ["r21", "за 4 кв.", "", "l:r19"],
  ["r22", "Финансовые расходы (процентные расходы)", "со знаком «+»", "in"],
  ["r24", "за 4 кв.", "", "l:r22"],
  ["r25", "Доля организации в прибыли (убытке) ассоциированных организаций и совместной деятельности", "со знаком «+»", "in"],
  ["r26", "Прочие неоперационные доходы / расходы (вкл. разовые расходы / доходы)", "«+» или «−» по сальдо потока", "in"],
  ["r28", "за 4 кв.", "", "l:r26"],
  ["r29", "Прибыль/убыток до налогообложения", "", "c"],
  ["r31", "за 4 кв.", "", "l:r29"],
  ["r32", "Расходы по налогу на прибыль", "", "in"],
  ["r33", "Чистая прибыль (убыток)", "", "c"],
  ["r34", "Амортизация", "со знаком «+»", "in"],
  ["r36", "за 4 кв.", "", "l:r34"],
  ["r37", "Изменение оборотного капитала", "«+» или «−» по сальдо потока", "in"],
  ["r38", "ИТОГО — Операционный денежный поток", "", "c"],
  ["h40", "Инвестиционный денежный поток", "", "h"],
  ["r41", "Капитальные затраты без учёта приобретений с учётом НДС", "приобретение основных средств «−»", "in"],
  ["r42", "Возмещение НДС по капитальным затратам", "со знаком «+»", "in"],
  ["r43", "Приобретения организаций", "приобретение дочерних организаций «−»", "in"],
  ["r44", "Прочие инвестиции, поступления от продажи активов", "прочие инвестиции «−», продажа активов «+»", "in"],
  ["r45", "ИТОГО — Инвестиционный денежный поток", "", "c"],
  ["h47", "Финансовый денежный поток", "", "h"],
  ["r48", "Погашение обязательств", "со знаком «+»", "c"],
  ["r49", "Текущих обязательств в Банк по НКЛ", "со знаком «+»", "in"],
  ["r50", "Текущих обязательств в Банк по ВКЛ", "со знаком «+»", "in"],
  ["r51", "Текущих обязательств в Банк", "со знаком «+»", "in"],
  ["r52", "Текущих обязательств в других банках по НКЛ", "со знаком «+»", "in"],
  ["r53", "Текущих обязательств в других банках по ВКЛ", "со знаком «+»", "in"],
  ["r54", "Текущих обязательств в других банках", "со знаком «+»", "in"],
  ["r55", "Изменения в привлечённых кредитах", "", "c"],
  ["r56", "Погашение обязательств по привлечённым кредитам", "со знаком «+»", "c"],
  ["r57", "Запрашиваемых обязательств в Банк по НКЛ", "со знаком «+»", "in"],
  ["r58", "Запрашиваемых обязательств в Банк по ВКЛ", "со знаком «+»", "in"],
  ["r59", "Запрашиваемых обязательств в Банк", "со знаком «+»", "in"],
  ["r60", "Других обязательств в будущем в других банках по НКЛ", "со знаком «+»", "in"],
  ["r61", "Других обязательств в будущем в других банках по ВКЛ", "со знаком «+»", "in"],
  ["r62", "Других обязательств в будущем в других банках", "со знаком «+»", "in"],
  ["r63", "Привлечение обязательств", "со знаком «+»", "c"],
  ["r64", "Запрашиваемые обязательства в Банк по НКЛ", "со знаком «+»", "in"],
  ["r65", "Запрашиваемые обязательства в Банк по ВКЛ", "со знаком «+»", "in"],
  ["r66", "Запрашиваемые обязательства в Банк", "со знаком «+»", "in"],
  ["r67", "Другие обязательства в будущем в других банках по НКЛ", "со знаком «+»", "in"],
  ["r68", "Другие обязательства в будущем в других банках по ВКЛ", "со знаком «+»", "in"],
  ["r69", "Другие обязательства в будущем в других банках", "со знаком «+»", "in"],
  ["r70", "Изменение в финансовых вложениях", "«+» или «−» по сальдо потока", "in"],
  ["r71", "Увеличение (снижение) уставного капитала (поступления от эмиссии ценных бумаг)", "увеличение «+», снижение «−»", "in"],
  ["r72", "Денежные средства, направленные на выплату дивидендов", "со знаком «−»", "in"],
  ["r73", "Прочие доходы (расходы) от финансовой деятельности", "«+» или «−» по сальдо потока", "in"],
  ["r74", "ИТОГО — Финансовый денежный поток", "", "c"],
  ["h76", "Денежный поток", "", "h"],
  ["r77", "ИТОГО — Чистый денежный поток", "", "c"],
  ["r78", "Остаток денежных средств на конец периода", "", "s"],
  ["h80", "Долг без корректировки", "", "h"],
  ["r81", "Финансовый долг на конец периода (все займы и кредиты)", "", "s"],
  ["r83", "Чистый долг (без корректировки)", "", "s"],
  ["h85", "Корректировка денежных потоков и долговой нагрузки", "", "h"],
  ["r87", "Корректировка денежного потока — привлечение, за кв.", "со знаком «+»", "in"],
  ["r88", "Корректировка денежного потока — погашение, за кв.", "со знаком «−»", "in"],
  ["r89", "ИТОГО — Чистый денежный поток за кв.", "", "c"],
  ["r90", "Остаток денежных средств на начало периода", "", "s"],
  ["r91", "Остаток денежных средств на конец периода", "", "s"],
  ["h93", "Корректировка долга", "", "h"],
  ["r94", "Финансовый долг на конец периода (все займы и кредиты) без корректировки", "", "s"],
  ["r95", "Изменение в привлечении займов и кредитов для поддержки операционной деятельности", "если необходимо привлечь кредиты", "s"],
  ["r96", "Финансовый долг с корректировкой на привлечение займов и кредитов для поддержки операционной деят.", "", "s"],
  ["r97", "Чистый долг с корректировкой на привлечение займов и кредитов для поддержки операц. деят.", "", "s"],
  ["h99", "Результаты деятельности", "", "h"],
  ["h100", "Динамика операционной деятельности", "", "h2"],
  ["r101", "Рост выручки", "% к аналогичному периоду предыдущего года (по выручке за 4 кв.)", "p"],
  ["r102", "Рост издержек", "% к аналогичному периоду предыдущего года (по издержкам за 4 кв.)", "p"],
  ["h104", "Показатели за последние 4 квартала", "", "h2"],
  ["r105", "Выручка (нетто) за 4 кв.", "", "s"],
  ["r106", "Корректировка EBITDA", "разовые расходы «+», разовые доходы «−»", "s"],
  ["r107", "EBITDA за 4 кв.", "", "s"],
  ["r108", "Издержки за 4 кв.", "", "s"],
  ["r109", "Операционная прибыль (убыток) за 4 кв.", "", "s"],
  ["h111", "Рентабельность продаж", "", "h2"],
  ["r112", "Рентабельность по EBITDA", "%", "p"],
  ["r113", "Рентабельность продаж", "%", "p"],
  ["h115", "Финансовая устойчивость", "", "h2"],
  ["r116", "Финансовый долг / EBITDA", "коэф.", "x"],
  ["r117", "Чистый долг без корректировок / EBITDA", "коэф.", "x"],
  ["r119", "Скорректированный финансовый долг / EBITDA", "коэф.", "x"],
  ["r120", "Скорректированный чистый долг / EBITDA", "коэф.", "x"],
];
for (const id of ["r11", "r13", "r14", "r15", "r17", "r19", "r22", "r25", "r26", "r29", "r32", "r33", "r34", "r37", "r38", "r41", "r42", "r43", "r44", "r45", "r48", "r49", "r50", "r51", "r52", "r53", "r54", "r55", "r56", "r57", "r58", "r59", "r60", "r61", "r62", "r63", "r64", "r65", "r66", "r67", "r68", "r69", "r70", "r71", "r72", "r73", "r74", "r77", "r87", "r88", "r89"]) FCQ_FLOW.add(id);
const LOAN_WHERE = ["Банк", "Другой банк"], LOAN_KIND = ["Кредит", "НКЛ", "ВКЛ"];
const loanCol = (where, kind) => (where === "Банк" ? { НКЛ: 0, ВКЛ: 1, Кредит: 2 } : { НКЛ: 3, ВКЛ: 4, Кредит: 5 })[kind || "Кредит"] ?? (where === "Банк" ? 2 : 5);
function fcqParams() {
  const f = fcParams();
  if (!f.q) f.q = {};
  const q = f.q;
  if (!q.lq || !q.ly) {
    const L = C.periods[C.periods.length - 1], d = (L && L.date) || "";
    const m = parseInt(d.slice(5, 7), 10), y = parseInt(d.slice(0, 4), 10);
    q.lq = q.lq || (m ? Math.ceil(m / 3) : 4); q.ly = q.ly || y || new Date().getFullYear() - 1;
  }
  q.ov = q.ov || {}; q.txt = q.txt || {}; q.view = q.view || "q";
  if (q.adj === undefined) q.adj = 1;
  return q;
}
const qLabel = (y, n) => `${n} кв. ${y}`;
function fcqCols() {
  const q = fcqParams(), Q = Math.ceil(fcHorizon() / 3), cols = [];
  for (let i = 1; i <= Q; i++) { const z = q.lq - 1 + i, n = (z % 4) + 1, y = q.ly + Math.floor(z / 4); cols.push({ i, n, y, key: y + "-" + n, h: qLabel(y, n) }); }
  return cols;
}
const FCQ_MEMO = new Map();
{ const clr = CACHE.clear.bind(CACHE); CACHE.clear = () => { clr(); FCQ_MEMO.clear(); }; }
function fcq(obj = C.obj) { const k = String(obj); if (!FCQ_MEMO.has(k)) FCQ_MEMO.set(k, fcqRaw(obj)); return FCQ_MEMO.get(k); }
function fcqRaw(obj) {
  const f = fcParams(), q = fcqParams(), L = lastPid();
  if (!L) return { err: "нет периодов" };
  const g = k => val(obj, k, L), A = annual(L);
  const need = ["rev", "cogs", "selling", "admin", "da", "cash", "ar", "inv", "ap"];
  const miss = need.filter(k => !isNum(g(k)));
  if (miss.length) return { err: "не хватает данных последнего периода: " + miss.map(k => LINE[k].label).join(", ") };
  if (!(g("rev") > 0) || !(g("cogs") > 0)) return { err: "выручка и себестоимость последнего периода должны быть больше нуля" };
  const P = {}; for (const [k, v] of Object.entries(f.scen)) P[k] = N(v[0]);
  const G = (isNum(q.vol) || isNum(q.price)) ? (1 + N(q.vol)) * (1 + N(q.price)) - 1 : P.growth;
  const rev0 = g("rev") * A, cogs0 = g("cogs") * A, sell0 = g("selling") * A, adm0 = (g("admin") + N(g("ooe")) - N(g("ooi"))) * A, da0 = g("da") * A;
  const fin0 = N(g("fin_inc")) * A, int0 = N(g("int")) * A, onoi0 = (N(g("onoi_in")) - N(g("onoi_out"))) * A, cit0 = N(g("cit")) * A;
  const ebt0 = rev0 - cogs0 - sell0 - adm0 + fin0 - int0 + onoi0;
  const gm = (rev0 - cogs0) / rev0 + P.gm_adj;
  const dso = g("ar") / rev0 * 365 + P.dso_adj, dio = g("inv") / cogs0 * 365 + P.dio_adj, dpo = g("ap") / cogs0 * 365 + P.dpo_adj;
  const seas = f.seas.map(Number), sseas = seas.reduce((a, b) => a + b, 0) || 12;
  const sq = n => (seas[3 * n - 3] + seas[3 * n - 2] + seas[3 * n - 1]) / sseas;   // доля квартала в годовой выручке
  const cols = fcqCols(), Q = cols.length, H = Q * 3;
  // кредиты: помесячно → по кварталам; колонки 0–5: Банк НКЛ/ВКЛ/кредит, другие банки НКЛ/ВКЛ/кредит
  const rep = Array.from({ length: 6 }, () => new Array(Q + 1).fill(0)), intr = new Array(Q + 1).fill(0);
  let debt0 = 0;
  const qi = t => Math.ceil(t / 3);
  for (const ln of existingLoans(obj)) {
    if (!(N(ln.bal) > 0)) continue;
    debt0 += N(ln.bal);
    const [it, pr] = amort(N(ln.bal), N(ln.rate), Math.max(1, N(ln.rem) || 1), N(ln.grace), SCH[ln.scheme] || 1, null, null, H);
    const c = loanCol(ln.where || "Другой банк", ln.kind);
    for (let t = 1; t <= H; t++) { rep[c][qi(t)] += pr[t]; intr[qi(t)] += it[t]; }
  }
  if (!f.loans || !f.loans.length) debt0 = isNum(ratio(obj, "debt", L)) ? ratio(obj, "debt", L) : debt0;
  const R = f.req, nrep = new Array(Q + 1).fill(0), ndraw = new Array(Q + 1).fill(0), rk = { НКЛ: 0, ВКЛ: 1, Кредит: 2 }[R.kind || "Кредит"] ?? 2;
  if (N(R.amt) > 0) {
    const [nI, nP] = amort(N(R.amt), N(R.rate), Math.max(1, N(R.term)), N(R.grace), SCH[R.scheme] || 1, null, Math.max(1, N(R.month)), H);
    for (let t = 1; t <= H; t++) { nrep[qi(t)] += nP[t]; intr[qi(t)] += nI[t]; }
    if (N(R.month) <= H) ndraw[qi(Math.max(1, N(R.month)))] += N(R.amt);
  }
  const proj = t => f.projects.reduce((a, p) => a + (t >= N(p.start) && t < N(p.start) + N(p.dur) ? N(p.amt) / Math.max(1, N(p.dur)) : 0), 0) * (1 + P.overrun);
  const V = {}; for (const [id] of FCQ_ROWS) V[id] = new Array(Q + 1).fill(null);
  const ov = (id, c, m) => { const o = q.ov[id]?.[c.key]; return isNum(o) ? o : m; };
  // база (последние 4 кв. = последний период в годовом выражении)
  const b = { r11: rev0, r13: cogs0, r14: adm0, r15: sell0, r19: fin0, r22: int0, r25: 0, r26: onoi0, r32: cit0, r34: da0 };
  Object.entries(b).forEach(([k, v]) => (V[k][0] = v));
  V.r17[0] = rev0 - cogs0 - adm0 - sell0; V.r29[0] = ebt0; V.r33[0] = ebt0 - cit0;
  const nwc0 = g("ar") + g("inv") - g("ap"), cash0 = g("cash") + N(g("stinv"));
  V.r78[0] = cash0; V.r81[0] = debt0; V.r83[0] = debt0 - Math.max(0, cash0); V.r91[0] = cash0; V.r94[0] = debt0; V.r95[0] = 0; V.r96[0] = debt0; V.r97[0] = V.r83[0];
  const nonrec = isNum(g("nonrec")) ? -g("nonrec") * A : 0;
  let nwcPrev = nwc0, adjDebt = 0;
  const share = (id, i) => {   // значение квартала i; i ≤ 0 — исторический квартал из базы
    if (i >= 1) return V[id][i];
    if (id === "r11" || id === "r13") { const n = (((q.lq - 1 + i) % 4) + 4) % 4 + 1; return V[id][0] * sq(n); }
    if (id === "adj") return nonrec / 4;
    return isNum(V[id][0]) ? V[id][0] / 4 : 0;
  };
  const adjQ = new Array(Q + 1).fill(0);
  const ltm = (id, i) => { let s = 0; for (let j = i - 3; j <= i; j++) s += N(id === "adj" ? (j >= 1 ? adjQ[j] : share("adj", j)) : share(id, j)); return s; };
  const cost = (i) => ["r13", "r14", "r15"].reduce((a, k) => a + N(share(k, i)), 0);
  for (const c of cols) {
    const i = c.i, ex = (3 * i + 4.5) / 12;
    const r11 = ov("r11", c, rev0 * sq(c.n) * Math.pow(1 + G, ex) * (1 + P.shock));
    const r13 = ov("r13", c, r11 * (1 - gm));
    const r14 = ov("r14", c, adm0 / 4 * Math.pow(1 + P.infl, ex)), r15 = ov("r15", c, sell0 / 4 * Math.pow(1 + P.infl, ex));
    const r17 = r11 - r13 - r14 - r15;
    const r19 = ov("r19", c, fin0 / 4), r22 = ov("r22", c, intr[i]), r25 = ov("r25", c, 0), r26 = ov("r26", c, 0);
    const r29 = r17 + r19 - r22 + r25 + r26, r32 = ov("r32", c, Math.max(0, r29) * N(f.cit)), r33 = r29 - r32;
    const r34 = ov("r34", c, da0 / 4);
    const nwc = r11 * 4 * dso / 365 + r13 * 4 * dio / 365 - r13 * 4 * dpo / 365;
    const r37 = ov("r37", c, -(nwc - nwcPrev)); nwcPrev = nwc;
    const r38 = r33 + r34 + r37;
    let capm = r11 * P.capex_pct; for (let t = 3 * i - 2; t <= 3 * i; t++) capm += proj(t);
    const r41 = ov("r41", c, -capm), r42 = ov("r42", c, 0), r43 = ov("r43", c, 0), r44 = ov("r44", c, 0), r45 = r41 + r42 + r43 + r44;
    const r49 = ov("r49", c, rep[0][i]), r50 = ov("r50", c, rep[1][i]), r51 = ov("r51", c, rep[2][i]), r52 = ov("r52", c, rep[3][i]), r53 = ov("r53", c, rep[4][i]), r54 = ov("r54", c, rep[5][i]);
    const r48 = r49 + r50 + r51 + r52 + r53 + r54;
    const r57 = ov("r57", c, rk === 0 ? nrep[i] : 0), r58 = ov("r58", c, rk === 1 ? nrep[i] : 0), r59 = ov("r59", c, rk === 2 ? nrep[i] : 0), r60 = ov("r60", c, 0), r61 = ov("r61", c, 0), r62 = ov("r62", c, 0);
    const r56 = r57 + r58 + r59 + r60 + r61 + r62;
    const r64 = ov("r64", c, rk === 0 ? ndraw[i] : 0), r65 = ov("r65", c, rk === 1 ? ndraw[i] : 0), r66 = ov("r66", c, rk === 2 ? ndraw[i] : 0), r67 = ov("r67", c, 0), r68 = ov("r68", c, 0), r69 = ov("r69", c, 0);
    const r63 = r64 + r65 + r66 + r67 + r68 + r69, r55 = r63 - r56;
    const r70 = ov("r70", c, 0), r71 = ov("r71", c, 0), r72 = ov("r72", c, 0), r73 = ov("r73", c, 0);
    const r74 = -r48 + r55 + r70 + r71 + r72 + r73, r77 = r38 + r45 + r74;
    const r78 = V.r78[i - 1] + r77, r81 = V.r81[i - 1] - r48 + r55, r83 = r81 - Math.max(0, r78);
    const pre = V.r91[i - 1] + r77;
    const r87 = ov("r87", c, q.adj ? Math.max(0, -pre) : 0), r88 = ov("r88", c, q.adj && pre > 0 ? -Math.min(adjDebt, pre) : 0);
    const r89 = r77 + r87 + r88, r90 = V.r91[i - 1], r91 = r90 + r89;
    adjDebt += r87 + r88;
    Object.assign(c, {});
    const set = { r11, r13, r14, r15, r17, r19, r22, r25, r26, r29, r32, r33, r34, r37, r38, r41, r42, r43, r44, r45, r48, r49, r50, r51, r52, r53, r54, r55, r56, r57, r58, r59, r60, r61, r62, r63, r64, r65, r66, r67, r68, r69, r70, r71, r72, r73, r74, r77, r78, r81, r83, r87, r88, r89, r90, r91,
      r94: r81, r95: adjDebt, r96: r81 + adjDebt };
    set.r97 = set.r96 - Math.max(0, r91);
    for (const [k, v] of Object.entries(set)) V[k][i] = v;
    adjQ[i] = 0;
  }
  // показатели за 4 квартала (база — годовые значения последнего периода)
  for (let i = 0; i <= Q; i++) {
    const L4 = id => (i === 0 ? N(V[id][0]) : ltm(id, i));
    for (const [id, src] of [["r21", "r19"], ["r24", "r22"], ["r28", "r26"], ["r31", "r29"], ["r36", "r34"]]) V[id][i] = L4(src);
    V.r105[i] = L4("r11"); V.r108[i] = i === 0 ? cogs0 + adm0 + sell0 : ltm("r13", i) + ltm("r14", i) + ltm("r15", i);
    V.r109[i] = V.r105[i] - V.r108[i];
    const ovA = i >= 1 ? q.ov.r106?.[cols[i - 1].key] : undefined;
    V.r106[i] = isNum(ovA) ? ovA : (i === 0 ? nonrec : ltm("adj", i));
    V.r107[i] = V.r109[i] + L4("r34") + V.r106[i];
    const prevL = (id, fn) => (i - 4 >= 1 ? fn(i - 4) : i === 0 ? null : fn(i - 4));
    const r4 = prevL("r11", j => ltm("r11", j)), c4 = prevL("c", j => (j >= 1 ? ltm("r13", j) + ltm("r14", j) + ltm("r15", j) : cost(j) + cost(j - 1) + cost(j - 2) + cost(j - 3)));
    V.r101[i] = i > 0 && r4 > 0 ? V.r105[i] / r4 - 1 : null;
    V.r102[i] = i > 0 && c4 > 0 ? V.r108[i] / c4 - 1 : null;
    const e = V.r107[i], dv = x => (e > 0 && isNum(x) ? x / e : null);
    V.r112[i] = V.r105[i] ? e / V.r105[i] : null; V.r113[i] = V.r105[i] ? V.r109[i] / V.r105[i] : null;
    V.r116[i] = dv(V.r81[i]); V.r117[i] = dv(V.r83[i]); V.r119[i] = dv(V.r96[i]); V.r120[i] = dv(V.r97[i]);
  }
  const o = { V, cols, Q, G, base: { rev0, debt0, cash0 } };
  o.minCash = Math.min(...cols.map(c => V.r78[c.i])); o.adjMax = Math.max(0, ...cols.map(c => V.r95[c.i]));
  o.maxDE = Math.max(...cols.map(c => V.r116[c.i]).filter(isNum), -Infinity);
  return o;
}
// нарастающим итогом с начала календарного года (для потоков)
function fcqView(o, id, i) {
  const q = fcqParams(), v = o.V[id][i];
  if (q.view !== "ytd" || i === 0 || !FCQ_FLOW.has(id)) return v;
  let s = 0; for (let j = i; j >= 1; j--) { s += N(o.V[id][j]); if (o.cols[j - 1].n === 1) break; }
  return s;
}
function fcqTable(o) {
  const q = fcqParams(), ro = q.view === "ytd";
  const head = `<tr><th class="lab">Тыс. тг</th><th>База<span class="pertitle">последние 4 кв.</span></th>${o.cols.map(c => `<th>${c.n} кв.<span class="pertitle">${c.y}</span></th>`).join("")}</tr>`;
  const body = FCQ_ROWS.map(([id, lab, note, typ]) => {
    if (typ === "h" || typ === "h2") return `<tr class="sec"><td class="lab" colspan="${o.Q + 2}">${esc(lab)}</td></tr>`;
    const kind = typ === "p" ? "p" : typ === "x" ? "x" : "m";
    const cls = typ === "c" ? "calc" : typ.startsWith("l") ? "sub" : "";
    const cell = i => {
      const v = fcqView(o, id, i), n = isNum(v) && v < 0 ? "neg" : "";
      if (i > 0 && (typ === "in" || id === "r106") && !ro) {
        const c = o.cols[i - 1], hasOv = isNum(q.ov[id]?.[c.key]);
        return `<td class="cell fcq${hasOv ? " ovr" : ""}"><input data-fcq="${id}|${c.key}" value="${esc(fmt(v))}" title="${hasOv ? "Введено вручную; очистите поле, чтобы вернуть расчёт" : "Расчёт; можно исправить вручную"}"></td>`;
      }
      return `<td class="${n}">${fmt(v, kind)}</td>`;
    };
    return `<tr class="${cls}"><td class="lab"${note ? ` title="${esc(note)}"` : ""}>${esc(lab)}${note ? `<span class="small muted fnote"> · ${esc(note)}</span>` : ""}</td>${[0, ...o.cols.map(c => c.i)].map(cell).join("")}</tr>`;
  }).join("");
  return `<div class="tablewrap fcqwrap"><table class="data fcq"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
function pageFc() {
  const f = fcParams(), q = fcqParams(), pers = C.periods, o = fcq();
  const loans = f.loans || [];
  const years = []; for (let y = (q.ly || 2025) - 3; y <= (q.ly || 2025) + 1; y++) years.push(y);
  let h = `<div class="pagehead"><div class="lead"><h1>Прогноз</h1></div>
    <div class="toolbar">${objSelect()}<button class="btn" data-act="fcqxls">Выгрузить в Excel</button></div></div><div id="probBanner" data-page="fc">${bannerHTML("fc")}</div>
  <section class="panel"><h2>Квартал последней отчётности</h2><div class="grid2 tight" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <label class="f"><span>Квартал</span><select class="inp" data-fcqp="lq">${[1, 2, 3, 4].map(n => `<option value="${n}"${q.lq == n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="f"><span>Год</span><select class="inp" data-fcqp="ly">${years.map(y => `<option value="${y}"${q.ly == y ? " selected" : ""}>${y}</option>`).join("")}</select></label>
    <label class="f"><span>Показывать потоки</span><select class="inp" data-fcqp="view"><option value="q"${q.view !== "ytd" ? " selected" : ""}>за квартал</option><option value="ytd"${q.view === "ytd" ? " selected" : ""}>нарастающим итогом с начала года</option></select></label>
    <label class="f"><span>Горизонт прогноза</span><select class="inp" data-fc="horizon" data-numsel>${[[0, `По сроку кредита (${fcHorizon() / 3} кв.)`], [24, "8 кв. (2 года)"], [36, "12 кв. (3 года)"], [48, "16 кв. (4 года)"], [60, "20 кв. (5 лет)"], [72, "24 кв. (6 лет)"], [84, "28 кв. (7 лет)"]].map(([v, t]) => `<option value="${v}"${N(f.horizon) == v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div>
    <label class="chk" style="margin-top:10px;display:block"><input type="checkbox" data-fcqp="adj" ${q.adj ? "checked" : ""}> Корректировка: при отрицательном остатке денег автоматически привлекать кредит на покрытие разрыва и гасить его из свободных денег</label>
    <p class="hint" style="margin-top:8px">Информация формируется автоматически из отчётности и допущений ниже. Ячейки прогноза можно исправить вручную (жёлтые — исправленные); очистите ячейку, чтобы вернуть расчёт. Погашения и привлечения разнесены по видам: НКЛ — невозобновляемая кредитная линия, ВКЛ — возобновляемая, без пометки — кредит.</p></section>`;
  h += `<section class="panel"><h2>Прогноз движения денежных средств по кварталам</h2><div id="fcqOut">${o.err ? `<div class="prob nd"><span class="st nd">Нет данных</span><div><b>Прогноз не построен</b><p class="fix">${esc(o.err)}. Заполните эти строки на страницах «Баланс» и «ОПиУ».</p></div></div>` : fcqTable(o)}</div></section>`;
  // обоснование и динамика объёмов
  const tx = (k, l) => `<label class="f" style="margin-top:10px"><span>${l}</span><textarea class="inp" data-fcqt="${k}" style="min-height:60px">${esc(q.txt[k] || "")}</textarea></label>`;
  const pin = (k, v) => `<input class="inp num" data-fcqp="${k}" data-pct value="${esc(isNum(v) ? fmt(v * 100, "m1") : "")}">`;
  h += `<section class="panel"><h2>Обоснование выбора предполагаемого сценария прогноза движения денежных средств</h2>
    ${tx("growth", "Обоснование темпа роста выручки:")}${tx("cost", "Обоснование темпа роста себестоимости:")}${tx("fin", "Обоснование источников финансирования (вкл. объяснение любых корректировок)")}${tx("prev", "Комментарий по фактическому выполнению предыдущего бизнес-плана заёмщика")}
    <h3 style="margin-top:16px">Заложенная динамика объёмов реализации</h3>
    <div class="tablewrap" style="max-height:none"><table class="data fc"><thead><tr><th class="lab">Операционный денежный поток</th><th>Значение, %</th><th class="lab">Формат</th></tr></thead><tbody>
      <tr><td class="lab">Средний прирост объёмов продаж в натуральном выражении</td><td class="cell">${pin("vol", q.vol)}</td><td class="lab small muted">% средний прирост к предыдущему периоду (году)</td></tr>
      <tr><td class="lab">Средний прирост цен продаж</td><td class="cell">${pin("price", q.price)}</td><td class="lab small muted">% средний прирост к предыдущему периоду (году)</td></tr>
      <tr class="calc"><td class="lab">Средний прирост продаж в стоимостном выражении</td><td>${o.err ? "" : fmt(o.G, "p")}</td><td class="lab small muted">(1 + объём) × (1 + цена) − 1; пусто — «Рост выручки» из допущений</td></tr></tbody></table></div></section>`;
  // допущения (общие с расчётом DSCR)
  h += `<section class="panel"><h2>Допущения</h2><p class="hint">Объект — ${esc(objName(C.obj))}. Квартальный прогноз строится по базовому сценарию; стрессовый — для проверки обслуживания долга (DSCR) ниже. Проценты — в %.</p>
    <div class="fcgrid"><div><div class="tablewrap" style="max-height:none"><table class="data fc"><thead><tr><th class="lab">Допущение</th><th>База</th><th>Стресс</th></tr></thead><tbody>
    ${Object.keys(FC_LAB).map(k => `<tr><td class="lab">${FC_LAB[k]}</td><td class="cell">${fcIn(`scen.${k}.0`, f.scen[k][0], FC_PCT.has(k))}</td><td class="cell">${fcIn(`scen.${k}.1`, f.scen[k][1], FC_PCT.has(k))}</td></tr>`).join("")}
    <tr><td class="lab">Ставка КПН, %</td><td class="cell">${fcIn("cit", f.cit, true)}</td><td></td></tr>
    </tbody></table></div></div>
    <div><h3>Запрашиваемый кредит (в Банке)</h3><div class="grid2 tight">
      <label class="f"><span>Сумма, тыс. тг</span>${fcIn("req.amt", f.req.amt)}</label><label class="f"><span>Месяц выдачи (от начала прогноза)</span>${fcIn("req.month", f.req.month)}</label>
      <label class="f"><span>Срок, мес.</span>${fcIn("req.term", f.req.term)}</label><label class="f"><span>Льготный период по ОД, мес.</span>${fcIn("req.grace", f.req.grace)}</label>
      <label class="f"><span>Ставка, %</span>${fcIn("req.rate", f.req.rate, true)}</label>
      <label class="f"><span>Схема погашения</span><select class="inp" data-fc="req.scheme">${opts(Object.keys(SCH), f.req.scheme)}</select></label>
      <label class="f"><span>Вид</span><select class="inp" data-fc="req.kind">${opts(LOAN_KIND, f.req.kind || (C.card.product === "Кредитная линия" ? "НКЛ" : "Кредит"))}</select></label></div>
      <h3 style="margin-top:16px">Сезонность выручки (1 = средний месяц) <button class="btn ghost" data-act="seasbank" title="По чистым кредитовым оборотам из выписок за последние 12–24 месяца">Из банковских оборотов</button></h3><div class="seas">${["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"].map((m, i) => `<label class="f"><span>${m}</span>${fcIn(`seas.${i}`, f.seas[i])}</label>`).join("")}</div>
    </div></div>
    <h3 style="margin-top:18px">Действующие кредиты</h3>
    ${loans.length ? "" : `<p class="hint" style="margin-top:4px">Реестр пуст — долг из баланса (${fmt(ratio(C.obj, "debt", lastPid()))} тыс. тг) гасится равными долями как кредит в других банках: ставка ${fcIn("aggRate", f.aggRate, true).replace('class="inp num"', 'class="inp num inl"')} %, срок ${fcIn("aggTerm", f.aggTerm).replace('class="inp num"', 'class="inp num inl"')} мес. Для точности добавьте кредиты по справкам банков.</p>`}
    ${loans.length ? `<div class="tablewrap" style="max-height:none"><table class="data fc loans"><thead><tr><th class="lab">Кредитор</th><th>Где</th><th>Вид</th><th>Остаток, тыс. тг</th><th>Ставка, %</th><th>Осталось, мес.</th><th>Льгота, мес.</th><th>Схема</th><th></th></tr></thead><tbody>
      ${loans.map((l, i) => `<tr><td class="cell"><input class="inp" data-fc="loans.${i}.name" value="${esc(l.name || "")}" style="text-align:left"></td><td class="cell"><select class="inp" data-fc="loans.${i}.where">${opts(LOAN_WHERE, l.where || "Другой банк")}</select></td><td class="cell"><select class="inp" data-fc="loans.${i}.kind">${opts(LOAN_KIND, l.kind || "Кредит")}</select></td><td class="cell">${fcIn(`loans.${i}.bal`, l.bal)}</td><td class="cell">${fcIn(`loans.${i}.rate`, l.rate, true)}</td><td class="cell">${fcIn(`loans.${i}.rem`, l.rem)}</td><td class="cell">${fcIn(`loans.${i}.grace`, l.grace)}</td><td class="cell"><select class="inp" data-fc="loans.${i}.scheme">${opts(Object.keys(SCH), l.scheme)}</select></td><td><button class="btn ghost danger" data-delloan="${i}">Удалить</button></td></tr>`).join("")}
      </tbody></table></div>` : ""}
    <p style="margin-top:8px"><button class="btn" data-act="addloan">Добавить кредит</button></p>
    <h3 style="margin-top:18px">Инвестиционные проекты</h3>
    ${(f.projects || []).length ? `<div class="tablewrap" style="max-height:none"><table class="data fc"><thead><tr><th class="lab">Проект</th><th>Сумма, тыс. тг</th><th>Начало, мес.</th><th>Длительность, мес.</th><th>Собств. средства, %</th><th></th></tr></thead><tbody>
      ${f.projects.map((p, i) => `<tr><td class="cell"><input class="inp" data-fc="projects.${i}.name" value="${esc(p.name || "")}" style="text-align:left"></td><td class="cell">${fcIn(`projects.${i}.amt`, p.amt)}</td><td class="cell">${fcIn(`projects.${i}.start`, p.start)}</td><td class="cell">${fcIn(`projects.${i}.dur`, p.dur)}</td><td class="cell">${fcIn(`projects.${i}.own`, p.own, true)}</td><td><button class="btn ghost danger" data-delproj="${i}">Удалить</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="hint">Проектов нет — в прогнозе только поддерживающие капвложения.</p>`}
    <p style="margin-top:8px"><button class="btn" data-act="addproj">Добавить проект</button></p></section>
  <section class="panel"><h2>Обслуживание долга: база и стресс</h2><p class="hint">Помесячный расчёт по тем же допущениям: хватает ли денежного потока на погашение действующих кредитов и запрашиваемого.</p><div id="fcOut">${fcOutHTML()}</div></section>`;
  return h;
}
// годовые итоги квартального прогноза — для заключения и ИИ-отчёта
function fcqYears(o) {
  const out = [];
  for (let y = 0; y * 4 < o.Q; y++) {
    const cs = o.cols.slice(y * 4, y * 4 + 4), last = cs[cs.length - 1], s = id => cs.reduce((a, c) => a + N(o.V[id][c.i]), 0);
    out.push({ h: `${cs[0].h} — ${last.h}`, rev: s("r11"), op: s("r17"), ni: s("r33"), cfo: s("r38"), cfi: s("r45"), cff: s("r74"), ncf: s("r77"), cash: o.V.r78[last.i], debt: o.V.r81[last.i], ebitda: o.V.r107[last.i], de: o.V.r116[last.i], adj: o.V.r95[last.i] });
  }
  return out;
}
function fcqExport() {
  const o = fcq(); if (o.err) { toast("Прогноз не построен: " + o.err); return; }
  const q = fcqParams(), nm = objName(C.obj);
  const rows = [[{ v: tr("Прогноз движения денежных средств по кварталам"), s: 7 }], [tr("Квартал последней отчётности"), `${q.lq} кв. ${q.ly}`], [tr("Объект"), nm], [tr("Суммы — тыс. тг. Потоки — ") + tr(q.view === "ytd" ? "нарастающим итогом с начала года" : "за квартал")], [],
    [{ v: tr("Показатель"), s: 1 }, { v: tr("Формат"), s: 1 }, { v: tr("База (последние 4 кв.)"), s: 1 }, ...o.cols.map(c => ({ v: tr(c.h), s: 1 }))]];
  for (const [id, lab, note, typ] of FCQ_ROWS) {
    if (typ === "h" || typ === "h2") { rows.push([{ v: tr(lab), s: 6 }]); continue; }
    const st = typ === "p" ? 3 : typ === "x" ? 8 : typ === "c" ? 4 : 2;
    rows.push([tr(lab), tr(note || (typ === "p" ? "%" : typ === "x" ? "коэф." : "тыс. тг")), ...[0, ...o.cols.map(c => c.i)].map(i => { const v = fcqView(o, id, i); return isNum(v) ? { v, s: st } : ""; })]);
  }
  rows.push([], [{ v: tr("Обоснование выбора предполагаемого сценария прогноза движения денежных средств"), s: 6 }]);
  for (const [k, l] of [["growth", "Обоснование темпа роста выручки:"], ["cost", "Обоснование темпа роста себестоимости:"], ["fin", "Обоснование источников финансирования (вкл. объяснение любых корректировок)"], ["prev", "Комментарий по фактическому выполнению предыдущего бизнес-плана заёмщика"]]) rows.push([tr(l), q.txt[k] || ""]);
  rows.push([], [{ v: tr("Заложенная динамика объёмов реализации"), s: 6 }],
    [tr("Средний прирост объёмов продаж в натуральном выражении"), isNum(q.vol) ? { v: q.vol, s: 3 } : ""], [tr("Средний прирост цен продаж"), isNum(q.price) ? { v: q.price, s: 3 } : ""], [tr("Средний прирост продаж в стоимостном выражении"), { v: o.G, s: 3 }]);
  const bin = xlsxBuild([{ name: tr("Прогноз"), rows, widths: [62, 26, 16, ...o.cols.map(() => 13)], freeze: 6 }]);
  download(`Прогноз_${safeName(nm)}.xlsx`, bin, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  toast("Прогноз сохранён в «Загрузки»");
}
document.addEventListener("click", e => { const b = e.target.closest("button[data-act=fcqxls]"); if (b && C) fcqExport(); });
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset; if (!C) return;
  if (d.fcq) {
    const [id, key] = d.fcq.split("|"), q = fcqParams(), raw = t.value.trim();
    q.ov[id] = q.ov[id] || {};
    if (raw === "") delete q.ov[id][key];
    else { const v = parseNum(raw); if (v === null) { toast("Не число: «" + raw + "»"); return; } q.ov[id][key] = v; }
    if (!Object.keys(q.ov[id]).length) delete q.ov[id];
    touch(); fcqRefresh(); return;
  }
  if (d.fcqp) {
    const q = fcqParams(), k = d.fcqp;
    if (k === "adj") q.adj = t.checked ? 1 : 0;
    else if (k === "view") q.view = t.value;
    else if (k === "lq" || k === "ly") q[k] = +t.value;
    else { const raw = t.value.trim(); if (raw === "") q[k] = null; else { const v = parseNum(raw); if (v === null) { toast("Не число: «" + raw + "»"); return; } q[k] = v / 100; } }
    if (k === "vol" || k === "price") { const f = fcParams(); if (isNum(q.vol) || isNum(q.price)) f.scen.growth[0] = (1 + N(q.vol)) * (1 + N(q.price)) - 1; }
    touch(); render(); return;
  }
  if (d.fcqt) { fcqParams().txt[d.fcqt] = t.value; touch(); return; }
});
function fcqRefresh() {
  const el = $("#fcqOut"); if (!el) return;
  const o = fcq(), sx = el.querySelector(".tablewrap")?.scrollLeft || 0;
  el.innerHTML = o.err ? "" : fcqTable(o);
  const w = el.querySelector(".tablewrap"); if (w) w.scrollLeft = sx;
  if (typeof paintNeg === "function") paintNeg(el);
}
