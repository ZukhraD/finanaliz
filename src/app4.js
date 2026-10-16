"use strict";
/* ---------------------------------------------------------------- прогноз ДДС: база и стресс (та же логика, что в Excel-шаблоне / refmodel) */
const SCH = { "Дифференцированный": 1, "Аннуитет": 2, "В конце срока": 3 };
function fcParams() {
  if (!C.fc) C.fc = JSON.parse(JSON.stringify(S.fc_default));
  if (C.fc.req.amt === null || C.fc.req.amt === undefined) C.fc.req.amt = isNum(C.card.amount) ? C.card.amount : 0;
  return C.fc;
}
function amort(V, rate, remx, grace, code, payIn, drawMonth, H = 24) {
  const i = rate / 12, n = Math.max(1, remx - grace);
  const A = i === 0 ? V / n : V * i / (1 - Math.pow(1 + i, -n));
  const I = new Array(H + 1).fill(0), P = new Array(H + 1).fill(0);
  let B = drawMonth ? 0 : V;
  for (let t = 1; t <= H; t++) {
    const k = drawMonth ? t - drawMonth : t, op = B, it = op * i;
    let p;
    if (op <= 0.001) p = 0;
    else if (k >= remx) p = op;
    else if (k <= grace) p = 0;
    else if (code === 3) p = 0;
    else if (code === 2) p = Math.min(op, Math.max(0, A - it));
    else p = Math.min(op, payIn > 0 ? payIn : V / n);
    I[t] += it; P[t] += p;
    B = op - p + (drawMonth && t === drawMonth ? V : 0);
  }
  return [I, P];
}
function existingLoans(obj) {
  const f = fcParams();
  if (f.loans && f.loans.length) return f.loans;
  const L = lastPid(), d = ratio(obj, "debt", L);
  return isNum(d) && d > 0 ? [{ name: "Долг по балансу (агрегат)", bal: d, rate: f.aggRate, rem: f.aggTerm, scheme: "Дифференцированный", grace: 0, agg: true }] : [];
}
// горизонт: по сроку запрашиваемого кредита (месяц выдачи + срок), от 24 до 84 мес., кратно году; можно задать вручную
function fcHorizon() {
  const f = fcParams();
  if (N(f.horizon) >= 24) return Math.min(84, N(f.horizon));
  const end = N(f.req.amt) > 0 ? Math.max(1, N(f.req.month)) + Math.max(1, N(f.req.term)) - 1 : 24;
  return Math.max(24, Math.min(84, Math.ceil(end / 12) * 12));
}
// прогноз считается один раз на изменение данных (сбрасывается вместе с кэшем расчётов)
const FC_MEMO = new Map();
{ const clr = CACHE.clear.bind(CACHE); CACHE.clear = () => { clr(); FC_MEMO.clear(); }; }
function forecast(obj, s, Hset) {
  const mk = obj + "|" + s + "|" + (Hset ?? "");
  if (!FC_MEMO.has(mk)) FC_MEMO.set(mk, forecastRaw(obj, s, Hset));
  return FC_MEMO.get(mk);
}
function forecastRaw(obj, s, Hset) {
  const f = fcParams(), L = lastPid(), H = Hset || fcHorizon();
  if (!L) return { err: "нет периодов" };
  const g = k => val(obj, k, L), A = annual(L);
  const need = ["rev", "cogs", "selling", "admin", "da", "cash", "stinv", "ar", "inv", "ap"];
  const miss = need.filter(k => !isNum(g(k)));
  if (miss.length) return { err: "не хватает данных последнего периода: " + miss.map(k => LINE[k].label).join(", ") };
  if (!(g("rev") > 0) || !(g("cogs") > 0)) return { err: "выручка и себестоимость последнего периода должны быть больше нуля" };
  const P = {}; for (const [k, v] of Object.entries(f.scen)) P[k] = N(v[s]);
  const rev0 = g("rev") * A, cogs0 = g("cogs") * A, opex0 = (g("selling") + g("admin")) * A, da0 = g("da") * A;
  const gmH = (rev0 - cogs0) / rev0, gm = gmH + P.gm_adj;
  const dso = g("ar") / rev0 * 365 + P.dso_adj, dio = g("inv") / cogs0 * 365 + P.dio_adj, dpo = g("ap") / cogs0 * 365 + P.dpo_adj;
  const seas = f.seas.map(Number), sseas = seas.reduce((a, b) => a + b, 0) || 12;
  const lastMonth = parseInt((C.periods[perIdx(L)].date || "").slice(5, 7), 10) || 12;
  const cal = t => ((((lastMonth - 1 + t) % 12) + 12) % 12) + 1;
  const I = new Array(H + 1).fill(0), PR = new Array(H + 1).fill(0);
  for (const ln of existingLoans(obj)) {
    if (!(N(ln.bal) > 0)) continue;
    const [it, pr] = amort(N(ln.bal), N(ln.rate) + P.rshock, Math.max(1, N(ln.rem) || 1), N(ln.grace), SCH[ln.scheme] || 1, null, null, H);
    for (let t = 0; t <= H; t++) { I[t] += it[t]; PR[t] += pr[t]; }
  }
  const R = f.req, [nI, nP] = N(R.amt) > 0 ? amort(N(R.amt), N(R.rate) + P.rshock, Math.max(1, N(R.term)), N(R.grace), SCH[R.scheme] || 1, null, Math.max(1, N(R.month)), H) : [new Array(H + 1).fill(0), new Array(H + 1).fill(0)];
  const icapex = t => f.projects.reduce((a, p) => a + (t >= N(p.start) && t < N(p.start) + N(p.dur) ? N(p.amt) / Math.max(1, N(p.dur)) : 0), 0) * (1 + P.overrun);
  const dpm = 365 / 12, rows = [], revs = [], cogss = [];
  let cashPre = g("cash") + g("stinv"), cashPost = cashPre, nbal = 0, nwcPrev = g("ar") + g("inv") - g("ap");
  const nwcOpen = nwcPrev;
  const histRev = m => rev0 / 12 * seas[cal(m) - 1] * 12 / sseas;
  for (let t = 1; t <= H; t++) {
    const rev = rev0 / 12 * Math.pow(1 + P.growth, (t + 5.5) / 12) * seas[cal(t) - 1] * (1 + P.shock);
    const cogs = rev * (1 - gm), opex = opex0 / 12 * Math.pow(1 + P.infl, (t + 5.5) / 12);
    const ebit = rev - cogs - opex, da = da0 / 12, ebitda = ebit + da;
    const ebt = ebit - I[t], cit = Math.max(0, ebt) * N(f.cit);
    revs.push(rev); cogss.push(cogs);
    const rv = [t - 2, t - 1, t].map(m => (m >= 1 ? revs[m - 1] : histRev(m)));
    const cg = [t - 2, t - 1, t].map(m => (m >= 1 ? cogss[m - 1] : histRev(m) * (1 - gmH)));
    const avr = rv.reduce((a, b) => a + b, 0) / 3, avc = cg.reduce((a, b) => a + b, 0) / 3;
    const nwc = avr * dso / dpm + avc * dio / dpm - avc * dpo / dpm, dn = nwc - nwcPrev;
    const cfo = ebitda - cit - dn, mc = rev * P.capex_pct, cfads = cfo - mc, ds = I[t] + PR[t], ic = icapex(t);
    const cfPre = cfads - ds - ic; cashPre += cfPre;
    const draw = t === N(R.month) ? N(R.amt) : 0;
    cashPost = cashPost + cfPre + draw - nP[t] - nI[t]; nbal = nbal + draw - nP[t];
    const dsAll = ds + nP[t] + nI[t];
    rows.push({ t, cal: cal(t), rev, ebitda, cit, dn, cfo, mc, cfads, ds, ic, cfPre, cashPre, draw, nprin: nP[t], nint: nI[t], cashPost, nbal, dsAll,
      dscr: ds > 0 ? cfads / ds : null, dscrAll: dsAll > 0 ? cfads / dsAll : null, nwc });
    nwcPrev = nwc;
  }
  const sum = k => rows.reduce((a, r) => a + r[k], 0), y1 = rows.slice(0, 12);
  const o = { rows };
  o.rev_total = sum("rev"); o.ebitda_total = sum("ebitda"); o.ebitda_y1 = y1.reduce((a, r) => a + r.ebitda, 0); o.cfads_total = sum("cfads"); o.ds_total = sum("ds"); o.ds_all_total = sum("dsAll");
  o.dscr_h_pre = o.ds_total > 0 ? o.cfads_total / o.ds_total : null;
  o.dscr_h_post = o.ds_all_total > 0 ? o.cfads_total / o.ds_all_total : null;
  const y1ds = y1.reduce((a, r) => a + r.dsAll, 0); o.dscr_y1_post = y1ds > 0 ? y1.reduce((a, r) => a + r.cfads, 0) / y1ds : null;
  o.mincash_pre = Math.min(...rows.map(r => r.cashPre)); o.mincash_post = Math.min(...rows.map(r => r.cashPost));
  o.gap_max = Math.max(...rows.map(r => Math.max(0, P.buffer - r.cashPre)));
  o.months_below = rows.filter(r => r.cashPost < P.buffer).length;
  o.nwc_open = nwcOpen; o.nwc_peak = Math.max(...rows.map(r => r.nwc)); o.nwc_need = Math.max(0, o.nwc_peak - nwcOpen);
  o.inv_total = f.projects.reduce((a, p) => a + N(p.amt), 0) * (1 + P.overrun);
  o.inv_need = f.projects.reduce((a, p) => a + N(p.amt) * (1 - N(p.own)), 0) * (1 + P.overrun);
  o.rec = o.gap_max > 0 ? Math.ceil(o.gap_max * (1 + N(f.reserve)) / 1000) * 1000 : 0;
  const da = rows.map(r => r.dscrAll).filter(isNum); o.dscr_min_post = da.length ? Math.min(...da) : null;
  o.buffer = P.buffer; o.H = H;
  // годовые итоги (год 1, 2, …): DSCR по годам
  o.years = [];
  for (let y = 0; y * 12 < H; y++) {
    const rr = rows.slice(y * 12, y * 12 + 12), cf = rr.reduce((a, r) => a + r.cfads, 0), dsa = rr.reduce((a, r) => a + r.dsAll, 0);
    o.years.push({ y: y + 1, cfads: cf, dsAll: dsa, dscr: dsa > 0 ? cf / dsa : null, cashEnd: rr[rr.length - 1].cashPost });
  }
  const yd = o.years.map(y => y.dscr).filter(isNum); o.dscr_year_min = yd.length ? Math.min(...yd) : null;
  return o;
}

/* ---------------------------------------------------------------- проблемы и решения */
const RAT_FIX = {
  liq_cur: "Краткосрочные обязательства велики относительно оборотных активов. Проверьте, нет ли долгосрочного долга, учтённого как краткосрочный; обсудите рефинансирование в долгосрочный кредит; проверьте качество ДЗ и запасов (просрочка, неликвид).",
  liq_quick: "Без запасов ликвидности мало. Запросите расшифровку ДЗ по срокам и оборачиваемость запасов; оцените, можно ли ускорить инкассацию.",
  liq_abs: "Мало денег относительно краткосрочных долгов. Смотрите вместе с лимитами овердрафта и графиком платежей; при запросе — предусмотрите буфер ликвидности.",
  nwc: "Отрицательный оборотный капитал: краткосрочные обязательства финансируют долгосрочные активы. Запросите пояснение (отсрочки поставщиков, авансы покупателей) и график погашения.",
  ebitda_m: "Низкая операционная маржа. Сравните с отраслью; выясните причину (цены, себестоимость, разовые расходы) — разовые статьи внесите в строку «разовые», чтобы увидеть скорректированную EBITDA.",
  op_m: "Операционный убыток или низкая маржа: проверьте разовые расходы и динамику себестоимости.",
  net_m: "Убыток или низкая чистая маржа: проверьте финансовые расходы, курсовые разницы и прочие расходы.",
  roa: "Низкая отдача активов: проверьте неработающие активы (незавершённое строительство, инвестиции, долгосрочная ДЗ).",
  roe: "Капитал отрицательный или отдача низкая. При отрицательном капитале — запросите план докапитализации или субординацию займов учредителя.",
  debt_ebitda: "Высокая долговая нагрузка. Варианты: уменьшить сумму запроса, удлинить срок, учесть погашения из графика, потребовать дополнительное обеспечение; проверьте, не занижена ли EBITDA разовыми расходами.",
  ndebt_ebitda: "Высокая чистая долговая нагрузка — см. рекомендации по «Долг / EBITDA».",
  de: "Долг превышает капитал. Рассмотрите ковенант по максимальному D/E, докапитализацию или субординацию займов участников.",
  liab_ta: "Активы почти полностью профинансированы обязательствами. Проверьте капитал (знак непокрытого убытка) и обязательства перед связанными сторонами.",
  eq_ratio: "Низкая доля собственного капитала: оцените возможность докапитализации; займы учредителя можно учитывать как квазикапитал при субординации.",
  icr: "Операционной прибыли мало для уплаты процентов. Рассмотрите льготный период, снижение ставки, меньшую сумму или более длинный срок.",
  ebitda_icr: "EBITDA едва покрывает проценты — см. рекомендации по покрытию процентов.",
  dscr_hist: "Исторически денежного потока не хватало на обслуживание долга. Проверьте фактические погашения (график, справки банков) и разовые факторы.",
};
function problems() {
  const out = [], tol = N(C.card.tol) || 1, pers = C.periods;
  const add = (sev, page, title, detail, fix, cells) => out.push({ sev, page, title, detail, fix, cells: cells || [] });
  // периоды
  pers.forEach((p, i) => {
    const m = parseInt((p.date || "").slice(5, 7), 10), d = new Date(p.date);
    if (!p.date || isNaN(d)) add("chk", "card", `Период «${p.label}»: не указана дата отчёта`, "", "Укажите дату отчёта на «Карточке» (последний день периода).");
    else {
      if (i > 0 && pers[i - 1].date && p.date <= pers[i - 1].date) add("risk", "card", `Периоды не по возрастанию: «${pers[i - 1].label}» → «${p.label}»`, "", "Расположите периоды от старого к новому (удалите и добавьте заново или поправьте даты).");
      if ((p.basis === "Годовой" || p.basis === "LTM") && p.months !== 12) add("chk", "card", `Период «${p.label}»: годовая основа, но ${p.months} мес.`, "", "Для годового периода и LTM укажите 12 месяцев.");
      if (p.basis === "Нарастающим итогом" && m && p.months !== m) add("chk", "card", `Период «${p.label}»: нарастающим итогом, месяцев ${p.months}, а дата — ${m}-й месяц`, "", `Укажите ${m} мес. (с начала года до даты отчёта).`);
    }
  });
  for (let k = 1; k <= nComp(); k++) {
    const nm = compName(k);
    pers.forEach((p, i) => {
      const pid = p.id, g = key => val(k, key, pid);
      if (inactive(k, pid)) return;
      const pr = nComp() > 1 ? partialReg(k, pid) : "";
      if (pr) add("chk", "card", `${nm}, ${p.label}: неполный период деятельности`, `зарегистрирована ${pr}`, "Компания работала не весь период: обороты и прибыль за него ниже годовых. Учитывайте это при сравнении с другими периодами и в прогнозе.");
      for (const blk of ["bal", "odr"]) {
        const miss = INPUT_KEYS.filter(key => LINE[key].typ === "in" && LINE[key].block === blk && rawComp(k, key, pid) === null);
        if (miss.length && miss.length < INPUT_KEYS.filter(key => LINE[key].typ === "in" && LINE[key].block === blk).length)
          add("chk", blk, `${nm}, ${p.label}: в ${blk === "bal" ? "балансе" : "ОПиУ"} не заполнено строк: ${miss.length}`, miss.slice(0, 6).map(x => LINE[x].label).join("; ") + (miss.length > 6 ? "…" : ""),
            "Введите значения или загрузите форму. Если статьи у компании нет — поставьте 0 (пусто означает «нет данных», расчёты не строятся).", miss.map(key => ({ k, key, pid })));
        else if (miss.length) add("nd", blk, `${nm}, ${p.label}: ${blk === "bal" ? "баланс" : "ОПиУ"} не заполнен`, "", "Загрузите форму из Excel или введите вручную.");
      }
      if (isNum(g("bchk")) && Math.abs(g("bchk")) > tol) {
        const d = g("bchk"), cand = INPUT_KEYS.filter(key => LINE[key].block === "bal" && isNum(rawComp(k, key, pid)) && rawComp(k, key, pid) !== 0 && (Math.abs(Math.abs(rawComp(k, key, pid)) - Math.abs(d)) <= tol || Math.abs(2 * Math.abs(rawComp(k, key, pid)) - Math.abs(d)) <= tol));
        let fix = `Активы ${d > 0 ? "больше" : "меньше"} пассивов на ${fmt(Math.abs(d))}. Сверьте итоги с формой: «Итого активов / обязательств / капитала — по отчётности» покажут, в каком разделе ошибка.`;
        if (cand.length) fix += " Разница совпадает со строкой: " + cand.map(x => `«${LINE[x].label}»`).join(", ") + " — возможно, она пропущена, учтена дважды или с неверным знаком.";
        if (isNum(rawComp(k, "re", pid)) && Math.abs(2 * rawComp(k, "re", pid) + d) <= tol) fix += " Похоже, непокрытый убыток введён без минуса.";
        add("crit", "bal", `${nm}, ${p.label}: баланс не сходится`, `Разница ${fmt(d)}`, fix, [{ k, key: "bchk", pid }, ...cand.map(key => ({ k, key, pid }))]);
      }
      for (const [rep, keys, lab] of [["ta_rep", ["cash", "stinv", "ar", "oar", "inv", "taxa", "oca", "ppe", "intang", "ltinv", "olta"], "активов"], ["cl_rep", ["stloan", "cpltd", "ap", "adv", "taxl", "ocl"], "краткосрочных обязательств"], ["ltl_rep", ["ltloan", "lease", "oltl"], "долгосрочных обязательств"], ["eq_rep", ["sc", "re", "oeq"], "капитала"]]) {
        const s = sumAll(g, keys);
        if (isNum(g(rep)) && isNum(s) && Math.abs(s - g(rep)) > tol)
          add("risk", "bal", `${nm}, ${p.label}: итог ${lab} не совпадает с отчётностью`, `По статьям ${fmt(s)}, в отчётности ${fmt(g(rep))}, разница ${fmt(s - g(rep))}`, "Сверьте статьи раздела с формой; при загрузке из файла проверьте «Настройку загрузки» — какие коды попадают в этот раздел.", [{ k, key: rep, pid }]);
      }
      if (isNum(g("ni_rep")) && allNum(g("ebt"), g("cit")) && Math.abs(g("ebt") - g("cit") - g("ni_rep")) > tol)
        add("risk", "odr", `${nm}, ${p.label}: чистая прибыль не совпадает с отчётностью`, `Расчёт ${fmt(g("ebt") - g("cit"))}, отчётность ${fmt(g("ni_rep"))}`, "Проверьте прочие доходы/расходы, курсовые разницы и КПН (расход по КПН вводится положительным числом); прекращённая деятельность в расчёт не входит.", [{ k, key: "ni_rep", pid }, { k, key: "cit", pid }]);
      const pp = i > 0 ? pers[i - 1].id : null;
      if (pp && isNum(g("div")) && allNum(g("re"), val(k, "re", pp), g("ni"))) {
        const eo = eqOther(k, pid), e = C.eqmv?.[k]?.[pid];
        const d = (g("re") - val(k, "re", pp)) - (g("ni") - g("div")) - (eo || 0);
        if (Math.abs(d) > tol) add("chk", "bal", `${nm}, ${p.label}: изменение нераспределённой прибыли не объясняется ${e ? "прибылью, дивидендами и отчётом об изменениях в капитале" : "прибылью и дивидендами"}`, `Разница ${fmt(d)}`,
          e ? `По отчёту о капитале учтены: дивиденды ${fmt(e.div)}, корректировки ${fmt(e.adj)}, резервы ${fmt(e.res)}, прочее ${fmt(e.oth)}${isNum(e.ni) && Math.abs(e.ni - g("ni")) > tol ? `; прибыль в отчёте о капитале ${fmt(e.ni)}, в ОПиУ ${fmt(g("ni"))}` : ""}. Сверьте сальдо нераспределённой прибыли в балансе и в отчёте о капитале.` : "Уточните прочие движения капитала (корректировки прошлых лет, переводы в резервы) и сумму дивидендов — или загрузите отчёт об изменениях в капитале вместе с формами: сайт учтёт его сам.", [{ k, key: "re", pid }, { k, key: "div", pid }]);
      }
      for (const key of ["cash", "ar", "inv", "rev", "cogs", "ppe", "ap"]) { const v = rawComp(k, key, pid); if (isNum(v) && v < 0) add("risk", LINE[key].block, `${nm}, ${p.label}: отрицательное значение «${LINE[key].label}»`, fmt(v), "Эта статья не может быть отрицательной. Проверьте знак; расходы вводятся положительными числами.", [{ k, key, pid }]); }
      if (pp) for (const key of ["rev", "ta"]) {
        const a = val(k, key, pid), b = val(k, key, pp);
        if (allNum(a, b) && a > 0 && b > 0 && (a / b > 300 || b / a > 300))
          add("crit", key === "rev" ? "odr" : "bal", `${nm}: «${LINE[key].label}» отличается в ${fmt(Math.max(a / b, b / a), "d")} раз между «${pers[i - 1].label}» и «${p.label}»`, "", "Похоже, один из периодов загружен в тенге, а другой — в тыс. тенге. Загрузите форму повторно и выберите «тенге» в вопросе о единицах.", [{ k, key, pid }]);
      }
      // ОДДС
      if (i === pers.length - 1 && !isNum(g("cf150")) && isNum(g("rev")))
        add("nd", "cf", `${nm}, ${p.label}: ОДДС не загружен`, "", "Загрузите отчёт о движении денежных средств: без него фактический операционный поток, капвложения и погашения кредитов не проверяются, а DSCR опирается только на расчёт по балансу.");
      if (isNum(g("cf150")) && isNum(g("cash")) && Math.abs(g("cf150") - g("cash")) > tol)
        add("risk", "cf", `${nm}, ${p.label}: деньги на конец по ОДДС не равны деньгам в балансе`, `ОДДС ${fmt(g("cf150"))}, баланс ${fmt(g("cash"))}`, "Проверьте строку 140 (начало периода), влияние курсов (120) и полноту строк «в том числе»; при загрузке — единицы файла.", [{ k, key: "cf150", pid }, { k, key: "cf140", pid }]);
      if (isNum(g("cf150r")) && isNum(g("cf150")) && Math.abs(g("cf150") - g("cf150r")) > tol)
        add("risk", "cf", `${nm}, ${p.label}: в ОДДС итоги не сходятся со строками`, `Расчёт стр. 150 ${fmt(g("cf150"))}, в отчётности ${fmt(g("cf150r"))}`, "Не хватает части строк «в том числе» или выплаты показаны с разными знаками. Сверьте разделы с формой.", [{ k, key: "cf150r", pid }]);
      if (pp && isNum(g("cf140")) && isNum(val(k, "cash", pp)) && Math.abs(g("cf140") - val(k, "cash", pp)) > tol)
        add("chk", "cf", `${nm}, ${p.label}: деньги на начало по ОДДС не равны деньгам в балансе за «${pers[i - 1].label}»`, `ОДДС ${fmt(g("cf140"))}, баланс ${fmt(val(k, "cash", pp))}`, "Для нарастающего итога строка 140 — на начало года; иначе проверьте единицы и период.", [{ k, key: "cf140", pid }]);
    });
  }
  // налоговые декларации и банковские обороты
  taxProblems(add);
  creditProblems(add);
  trustProblems(add);
  // консолидация
  if (nComp() > 1) pers.forEach(p => {
    for (const [lab, st, d] of elimChecks(p.id)) if (st === "bad") add(lab.includes("подтвержд") ? "chk" : "risk", "elim", `Свод группы, ${p.label}: ${lab.toLowerCase()}`, isNum(d) ? `Разница ${fmt(d)}` : "",
      lab.includes("подтвержд") ? "Проверьте суммы внутригрупповых операций по актам сверки и отметьте период как подтверждённый." : lab.includes("Встречность") ? "ДЗ одной компании группы перед другой должна равняться КЗ второй: запросите акты сверки взаиморасчётов." : "Каждая исключаемая сумма актива должна иметь пару в обязательствах или капитале (займы выданные ↔ полученные, инвестиции ↔ уставный капитал).");
  });
  // коэффициенты последнего периода
  const L = lastPid();
  if (L) for (const key of Object.keys(RAT)) {
    const v = ratio(C.obj, key, L), s = rstatus(key, v);
    if (s === "crit" || s === "risk") add(s, "an", `${RAT[key].label}: ${v === NP ? NP : fmt(v, KIND[key])} — ${ST[s].toLowerCase()}`, `${objName(C.obj)}, ${C.periods[perIdx(L)].label}`, RAT_FIX[key] || "Разберите причину и отразите её в выводах заключения.");
  }
  // прогноз
  const fb = forecast(C.obj, 0), fs = forecast(C.obj, 1);
  if (fb.err) add("nd", "elim", "Прогноз не построен", fb.err, "Заполните указанные строки последнего периода.");
  else {
    for (const [o, nm] of [[fb, "база"], [fs, "стресс"]]) {
      if (isNum(o.dscr_h_post) && o.dscr_h_post < 1) add("crit", "elim", `Прогноз (${nm}): денежного потока не хватает на обслуживание долга с новым кредитом`, `DSCR за горизонт ${fmt(o.dscr_h_post, "x")}`, "Варианты: уменьшить сумму, удлинить срок, дать льготный период по основному долгу, перейти на аннуитет; проверить допущения роста и маржи.");
      else if (isNum(o.dscr_h_post) && o.dscr_h_post < 1.2) add("risk", "elim", `Прогноз (${nm}): запас покрытия долга мал`, `DSCR за горизонт ${fmt(o.dscr_h_post, "x")}`, "Рассмотрите больший срок или льготный период; заложите ковенант по DSCR ≥ 1,2.");
      if (o.months_below > 0) add(nm === "база" ? "risk" : "chk", "elim", `Прогноз (${nm}): остаток денег ниже минимального в ${o.months_below} мес.`, `Минимум с кредитом ${fmt(o.mincash_post)} при буфере ${fmt(o.buffer)}`, o.rec > 0 ? `Потребность в финансировании — ${fmt(o.rec)} тыс. тг (с резервом). Сравните с запросом; сдвиньте месяц выдачи на период дефицита.` : "Сдвиньте выдачу на месяц дефицита или снизьте инвестиции.");
    }
    const amt = N(fcParams().req.amt);
    if (amt > 0 && fb.rec > 0 && amt < fb.rec) add("risk", "elim", "Запрос меньше потребности по базовому прогнозу", `Запрос ${fmt(amt)}, потребность ${fmt(fb.rec)}`, "Увеличьте сумму или сократите инвестиции/оборотный капитал в допущениях — иначе в прогнозе остаётся дефицит.");
    if (amt > 0 && fb.rec === 0 && fb.inv_need === 0 && fb.nwc_need === 0) add("chk", "elim", "Потребность в финансировании по прогнозу не подтверждается", `Запрос ${fmt(amt)}`, "Обоснуйте цель: добавьте инвестпроект или рост оборотного капитала в допущения, либо уменьшите сумму.");
  }
  if (isOD()) { const keep = odFilter(out); out.length = 0; out.push(...keep); odProblems(add); }
  const rank = { crit: 0, risk: 1, chk: 2, nd: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}
let PROB = [];
function badCells() { const m = new Map(); for (const p of PROB) for (const c of p.cells) { const id = c.k + "|" + c.key + "|" + c.pid; if (!m.has(id)) m.set(id, p); } return m; }
