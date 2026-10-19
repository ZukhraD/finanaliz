"use strict";
/* ---------------------------------------------------------------- Автоматическое заключение: рекомендация, выводы, условия.
   Пишется по данным анализа (показатели, прогноз, обеспечение, кредитная история, благонадёжность, проблемы).
   Заполняется само, пока менеджер не правил текст; кнопка «Сформировать заново» пересобирает его. */
const pct = v => (isNum(v) ? fmt(v, "p") : "н/д"), xx = v => (isNum(v) ? fmt(v, "x") : "н/д"), mm = v => (isNum(v) ? fmt(v) + " тыс. тг" : "н/д");
const stWord = (key, v) => { const s = rstatus(key, v); return s === "ok" ? "в норме" : s === "chk" ? "требует внимания" : s === "risk" ? "в зоне риска" : s === "crit" ? "критическое значение" : ""; };
function trustAll() {
  ensureTrust(); let stop = 0, risk = 0, nd = 0;
  for (let k = 1; k <= nComp(); k++) for (const [id, , sev] of TRUST) { const st = C.trust[k]?.items?.[id]?.st; if (st === "yes") { if (sev === "crit") stop++; else risk++; } else if (st !== "no") nd++; }
  return { stop, risk, nd };
}
function crAll() { let n = 0, debt = 0, pay = 0, od = 0, maxOd = 0; for (let k = 1; k <= nComp(); k++) { const s = crSummary(k); n += s.n; debt += s.debt; pay += s.pay; od = Math.max(od, s.od); maxOd = Math.max(maxOd, s.maxOd); } return { n, debt, pay, od, maxOd }; }
function autoConclusion() {
  const obj = C.obj, L = lastPid(), P = C.periods[perIdx(L)], PP = prevPid(L), amt = N(C.card.amount);
  const v = k => val(obj, k, L), vp = k => (PP ? val(obj, k, PP) : null), r = k => ratio(obj, k, L);
  const ts = trustAll(), cr = crAll(), cc = collCover(), probs = (PROB || []).filter(p => p.sev === "crit" || p.sev === "risk");
  const T = [], cond = [];
  let dec;
  if (isOD()) {
    const R = odChecks(), ob = odBank(1), fails = R.out.filter(x => x.st === "crit"), unk = R.out.filter(x => x.st === "chk" || x.st === "nd");
    const F = odFinVals(), c2 = F.p2, fv = k => F.v(c2, k);
    T.push(`Заёмщик: ${C.card.name}${nComp() > 1 ? (obj ? ", анализ по компании " + compName(obj) : ", анализ консолидированно по группе") : ""}. Запрашивается овердрафт ${mm(amt)} (транш до ${odCfg().tranche} дней, срок линии ${odCfg().line} мес.).`);
    T.push(`Финансовое состояние на ${c2 ? c2.label : "последнюю дату"}: выручка ${mm(fv("rev"))}, чистая прибыль ${mm(fv("ni"))}, собственный капитал ${mm(fv("eq"))}${isNum(fv("eq")) && fv("eq") <= 0 ? " — отрицательный" : ""}; оборачиваемость дебиторской задолженности ${isNum(fv("dso")) ? fmt(fv("dso"), "d") + " дн." : "н/д"}.`);
    T.push(`Обороты: среднемесячный очищенный кредитовый оборот ${mm(ob.our.avg + ob.other.avg)} (в Банке ${mm(ob.our.avg)}, в других банках ${mm(ob.other.avg)}). Расчётный лимит — ${mm(ob.limit)}${amt > 0 ? (amt <= ob.limit ? ", запрос в пределах лимита" : `, запрос превышает лимит на ${mm(amt - ob.limit)}`) : ""}.`);
    T.push(fails.length ? `Не соответствует условиям продукта: ${fails.map(x => x.title.toLowerCase()).join("; ")}.` : "Несоответствий условиям продукта не выявлено.");
    if (unk.length) T.push(`Требуют проверки: ${unk.map(x => x.title.toLowerCase()).join("; ")}.`);
    T.push(`Кредитная история: действующих займов ${cr.n}, остаток ${mm(cr.debt)}, текущая просрочка ${cr.od ? cr.od + " дн." : "отсутствует"}${cr.maxOd ? `, максимальная в истории — ${cr.maxOd} дн.` : ""}. Благонадёжность: стоп-факторов ${ts.stop}, рисков ${ts.risk}${ts.nd ? `, не проверено пунктов: ${ts.nd}` : ""}.`);
    const onlyLimit = fails.length && fails.every(x => /сумма/i.test(x.title));
    dec = ts.stop > 0 || (fails.length && !onlyLimit) ? "Не рекомендовать" : !(ob.limit > 0) ? "Доработать / запросить данные" : onlyLimit ? "Рекомендовать с условиями" : unk.length ? "Доработать / запросить данные" : "Рекомендовать";
    if (onlyLimit && ob.limit > 0) cond.push(`Лимит овердрафта — не более ${mm(ob.limit)} (расчётный лимит по оборотам).`);
    if (ob.other.avg > 0) cond.push("Перевод не менее 90 % кредитовых оборотов в Банк в течение 3 месяцев с начала финансирования; период доступности по оборотам в других банках — не более 3 мес. с пересмотром лимита.");
    cond.push("Ежемесячный мониторинг очищенных кредитовых оборотов; при снижении — пропорциональный пересмотр лимита или приостановка выдачи траншей.");
    cond.push("Предоставление финансовой отчётности ежеквартально.");
  } else {
    const fb = forecast(obj, 0), fs = forecast(obj, 1), rs = riskSummary(obj);
    const g = isNum(v("rev")) && isNum(vp("rev")) && vp("rev") > 0 ? v("rev") / vp("rev") - 1 : null;
    T.push(`Заёмщик: ${C.card.name}${nComp() > 1 ? (obj ? ", анализ по компании " + compName(obj) : ", анализ консолидированно по группе") : ""}. Запрос: ${C.card.product || "кредит"} ${mm(amt)}${C.card.purpose ? ", цель — " + C.card.purpose.toLowerCase() : ""}.`);
    T.push(`Финансовое состояние (${P ? P.label : "последний период"}): выручка ${mm(v("rev"))}${isNum(g) ? ` (${g >= 0 ? "рост" : "снижение"} на ${fmt(Math.abs(g), "p")} к предыдущему периоду)` : ""}, EBITDA ${mm(r("ebitda_ann"))} (маржа ${pct(r("ebitda_m"))}), чистая прибыль ${mm(v("ni"))} (маржа ${pct(r("net_m"))}). Собственный капитал ${mm(v("eq"))}.`);
    T.push(`Ликвидность и долговая нагрузка: текущая ликвидность ${xx(r("liq_cur"))} (${stWord("liq_cur", r("liq_cur")) || "н/д"}), долг / EBITDA ${xx(r("debt_ebitda"))} (${stWord("debt_ebitda", r("debt_ebitda")) || "н/д"}), общий долг ${mm(r("debt"))}.`);
    if (!fb.err) T.push(`Прогноз${reqWC() ? " (кредит на пополнение оборотных средств — в нагрузке только проценты)" : ""}: DSCR с новым кредитом за горизонт ${fb.H} мес. — ${xx(fb.dscr_h_post)} в базовом и ${xx(fs.dscr_h_post)} в стрессовом сценарии; минимальный остаток денег с кредитом — ${mm(fb.mincash_post)}${fb.rec > 0 ? `; расчётная потребность в финансировании — ${mm(fb.rec)}` : ""}.`);
    else T.push(`Прогноз не построен: ${fb.err}.`);
    if (cc) T.push(`Обеспечение: залоговая стоимость ${mm(cc.coll)} при рыночной ${mm(cc.mk)}; покрытие запроса ${pct(cc.cover)}, LTV ${pct(cc.ltv)}.`);
    else T.push("Обеспечение не указано.");
    T.push(`Кредитная история: действующих займов ${cr.n}, остаток ${mm(cr.debt)}, платежи ${mm(cr.pay)} в месяц, текущая просрочка ${cr.od ? cr.od + " дн." : "отсутствует"}${cr.maxOd ? `, максимальная в истории — ${cr.maxOd} дн.` : ""}. Благонадёжность: стоп-факторов ${ts.stop}, рисков ${ts.risk}${ts.nd ? `, не проверено пунктов: ${ts.nd}` : ""}.`);
    if (probs.length) T.push(`Основные риски: ${probs.slice(0, 5).map(p => p.title.replace(/\.$/, "")).join("; ")}.`);
    const dscrBad = !fb.err && isNum(fb.dscr_h_post) && fb.dscr_h_post < 1, dscrLow = !fb.err && isNum(fb.dscr_h_post) && fb.dscr_h_post < 1.2;
    dec = ts.stop > 0 || dscrBad || rs.ind[0] === "crit" ? "Не рекомендовать" : rs.ind[0] === "nd" || fb.err ? "Доработать / запросить данные" : rs.ind[0] === "chk" || dscrLow || (cc && cc.cover < 1) || !cc ? "Рекомендовать с условиями" : "Рекомендовать";
    if (dec === "Не рекомендовать") T.push(`Итог: ${ts.stop ? "выявлены стоп-факторы благонадёжности" : dscrBad ? "денежного потока недостаточно для обслуживания долга с новым кредитом" : "имеются критические отклонения показателей"}; финансирование на запрашиваемых условиях не рекомендуется.`);
    else if (dec === "Доработать / запросить данные") T.push("Итог: для окончательного вывода не хватает данных — дозаполните отчётность и проверки, указанные в «Проблемах и решениях».");
    else T.push(`Итог: финансовое состояние и денежный поток позволяют обслуживать запрашиваемый кредит${dec === "Рекомендовать с условиями" ? " при соблюдении условий ниже" : ""}.`);
    const de = r("debt_ebitda");
    cond.push(`Ковенант: долг / EBITDA не выше ${isNum(de) ? fmt(Math.max(3, Math.ceil(de * 2) / 2 + 0.5), "m1") : "3,5"}×; DSCR не ниже 1,2×.`);
    if (!cc || cc.cover < 1) cond.push(`Обеспечение с покрытием не менее 100 % запрашиваемой суммы${cc ? ` (сейчас ${pct(cc.cover)})` : ""}.`);
    else cond.push("Страхование предмета залога в пользу Банка; ежегодная переоценка.");
    if (nComp() > 1) cond.push("Гарантии (поручительства) компаний группы.");
    if (N(fcParams().req.grace) > 0) cond.push(`Льготный период по основному долгу — ${fcParams().req.grace} мес.`);
    cond.push("Перевод основных оборотов в Банк; предоставление финансовой отчётности ежеквартально.");
    if (!fs.err && isNum(fs.dscr_h_post) && fs.dscr_h_post < 1) cond.push("Стрессовый сценарий не выдерживает обслуживания долга — заложить резерв ликвидности или дополнительное обеспечение.");
    if (dscrLow && !dscrBad) cond.push("Рассмотреть увеличение срока или аннуитетную схему погашения для запаса покрытия долга.");
  }
  const clean = x => x.replace(/\.\.(?!\.)/g, ".");
  return { decision: dec, text: clean(T.join("\n\n")), conditions: clean(cond.map(x => "• " + x).join("\n")) };
}
// заполнить, если менеджер ещё не правил (или текст пустой)
function ensureAutoConcl(force) {
  const c = C.concl || (C.concl = {});
  if (!force && c.text && c.manual) return false;
  if (!force && c.text && !c.auto) return false;   // старые заключения, написанные вручную, не трогаем
  const a = autoConclusion();
  Object.assign(c, { decision: a.decision, text: a.text, conditions: a.conditions, auto: true, manual: false, autoAt: Date.now() });
  return true;
}
document.addEventListener("input", e => { const d = e.target.dataset; if (d && d.concl && C && C.concl && (d.concl === "text" || d.concl === "conditions" || d.concl === "decision")) C.concl.manual = true; });
document.addEventListener("change", e => { const d = e.target.dataset; if (d && d.concl === "decision" && C && C.concl) C.concl.manual = true; });
document.addEventListener("click", async e => {
  const b = e.target.closest("button[data-act=autoconcl]"); if (!b || !C) return;
  if (C.concl?.manual && !(await dialog("Сформировать заново?", "<p>Ваши правки в выводах и условиях будут заменены новым текстом.</p>", [{ t: "Отменить", v: false }, { t: "Сформировать", primary: true, v: true }]))) return;
  ensureAutoConcl(true); touch(); render(); toast(tr("Заключение сформировано"));
});
