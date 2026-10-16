"use strict";
/* ---------------------------------------------------------------- «Кредиты и залог»: кредитные отчёты, реестр займов, залоги, гаранты.
   Плюс аналитика выписок для «Банка»: покупатели, списания по видам, сезонность. Суммы документов — в тенге, на экране — тыс. тг. */
function ensureCredit(c = C) { if (!c) return; c.cr = c.cr || []; c.coll = c.coll || []; c.guar = c.guar || []; }
const COLL_TYPES = { "Недвижимость": 0.3, "Земельный участок": 0.4, "Транспорт": 0.4, "Спецтехника и оборудование": 0.5, "Товары в обороте (ТМЗ)": 0.5, "Деньги на депозите": 0, "Права требования": 0.5, "Гарантия банка": 0, "Гарантия физического лица": 0, "Гарантия юридического лица": 0, "Гарантия АО «ФРП «Даму»": 0, "Прочее": 0.5 };
const pledgorDefault = () => { const i = C.companies.findIndex(x => compRoles(x).includes("Залогодатель")); return compName(i >= 0 ? i + 1 : 1); };
const isoToday = () => new Date().toISOString().slice(0, 10);
function monthsLeft(end, from) {
  if (!end) return null;
  const a = new Date((from || C.card.date || isoToday()) + "T00:00:00Z"), b = new Date(end + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1) + 1);
}
const crKzt = x => (x.cur && x.cur !== "KZT" ? (fxRate(x.cur, isoToday().slice(0, 7)) || fxRate(x.cur, isoToday()) || null) : 1);
const isGuar = x => /гарант|поручит|залогодат/i.test(x.role || "") || /гаранти/i.test(x.type || "");
function crSummary(k) {
  ensureCredit();
  const act = C.cr.filter(x => x.k === k && x.status !== "closed"), own = act.filter(x => !isGuar(x)), gu = act.filter(isGuar);
  let debt = 0, pay = 0, nofx = 0; for (const x of own) { const r = crKzt(x); if (r === null) { nofx++; continue; } debt += N(x.bal) * r; pay += N(x.pay) * r; }
  const guarAmt = gu.reduce((a, x) => a + N(x.bal) * (crKzt(x) || 0), 0);
  const od = Math.max(0, ...act.map(x => N(x.odDays))), maxOd = Math.max(0, ...C.cr.filter(x => x.k === k).map(x => Math.max(N(x.maxOd), N(x.odDays))));
  return { n: own.length, debt: debt / 1000, pay: pay / 1000, guar: guarAmt / 1000, od, maxOd, nofx, any: C.cr.some(x => x.k === k) };
}
function creditChecks(k) {
  const s = crSummary(k); if (!s.any) return [];
  const L = lastPid(), out = [], bd = L ? ratio(k, "debt", L) : null;
  if (isNum(bd)) {
    const diff = s.debt - bd, rel = Math.abs(diff) / Math.max(Math.abs(bd), Math.abs(s.debt), 1);
    out.push({ id: "debt", title: "Долг по кредитному отчёту и по балансу", st: Math.abs(diff) <= (N(C.card.tol) || 1) || rel <= 0.1 ? "ok" : rel > 0.3 ? "risk" : "chk", a: bd, b: s.debt, diff, rel,
      det: `баланс (${C.periods[perIdx(L)].label}) ${fmt(bd)}, кредитный отчёт ${fmt(s.debt)}, разница ${fmt(diff)} (${pctFmt(rel)})`,
      fix: "Даты разные: баланс — на отчётную дату, кредитный отчёт — на дату формирования. Если разница большая — проверьте, все ли займы отражены в балансе (в т.ч. от участников и нефинансовых организаций), и запросите расшифровку займов.", cells: [{ k, key: "stloan", pid: L }, { k, key: "ltloan", pid: L }] });
  }
  if (s.od > 0) out.push({ id: "od", title: "Текущая просрочка по кредитам", st: s.od > 30 ? "crit" : "risk", det: `${s.od} дн.`, fix: "Выясните причину просрочки и срок погашения; запросите справку банка об отсутствии просрочки на дату решения. Текущая просрочка — как правило, стоп-фактор." });
  else if (s.maxOd > 30) out.push({ id: "maxod", title: "Просрочки в кредитной истории", st: "chk", det: `максимум ${s.maxOd} дн.`, fix: "Уточните период и причину просрочки; отразите в заключении, была ли она урегулирована." });
  if (s.guar > 0) out.push({ id: "guar", title: "Обязательства компании как гаранта", st: "chk", det: `${fmt(s.guar)} тыс. тг`, fix: "Учитывайте условные обязательства: оцените финансовое положение должников, за которых выдана гарантия." });
  return out;
}
function creditProblems(add) {
  if (!C) return; ensureCredit();
  for (let k = 1; k <= nComp(); k++) for (const c of creditChecks(k)) if (c.st !== "ok") add(c.st, "credit", `${compName(k)}: ${c.title.toLowerCase()}`, c.det, c.fix, c.cells || []);
  const cv = collCover();
  if (cv && isNum(cv.cover) && cv.cover < 1.2) add(cv.cover < 1 ? "risk" : "chk", "coll", `Обеспечение покрывает запрашиваемую сумму на ${pctFmt(cv.cover)}`, `залоговая стоимость ${fmt(cv.coll)}, запрос ${fmt(cv.amt)} тыс. тг`, "Добавьте обеспечение, уменьшите сумму или учтите гарантию фонда (например, «Даму»).");
  // концентрация покупателей
  for (let k = 1; k <= nComp(); k++) { const t = topBuyers(k); if (t && t.top1 > 0.3) add(t.top1 > 0.5 ? "risk" : "chk", "bank", `${compName(k)}: высокая зависимость от покупателя`, `${t.rows[0].name} — ${pctFmt(t.top1)} чистых поступлений (${t.label})`, "Оцените устойчивость отношений с покупателем (договор, срок, история), диверсификацию и влияние его ухода на денежный поток; учтите в стресс-сценарии."); }
}

/* ---------- залог */
function collCover() {
  ensureCredit();
  const amt = N(C.card.amount); if (!C.coll.length) return null;
  const mk = C.coll.reduce((a, x) => a + N(x.market), 0), coll = C.coll.reduce((a, x) => a + N(x.market) * (1 - N(x.disc)), 0);
  return { mk, coll, amt, cover: amt > 0 ? coll / amt : null, ltv: coll > 0 && amt > 0 ? amt / coll : null };
}

/* ---------- страница «Кредиты и залог» */
function pageCredit() {
  ensureCredit();
  const k = COMP_TAB > nComp() ? 1 : COMP_TAB, list = C.cr.filter(x => x.k === k), s = crSummary(k);
  let h = `<div class="pagehead"><div class="lead"><h1>Кредитная история</h1><p>Кредитные отчёты ПКБ и ГКБ (PDF или Excel): действующие займы, просрочки и обязательства гаранта; сверка долга с балансом и перенос займов в прогноз. Суммы — в тыс. тг.</p></div>
    <div class="toolbar"><button class="btn primary" data-act="docdlg" data-mode="credit">Загрузить кредитный отчёт</button><button class="btn" data-act="cradd">Добавить кредит вручную</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="credit">${bannerHTML("credit")}</div>`;
  if (!list.length) h += `<div class="empty"><h2>Кредитный отчёт не загружен</h2><p class="muted">Загрузите отчёт ПКБ или ГКБ по компании — или добавьте кредиты вручную по справкам банков.</p><button class="btn primary" data-act="docdlg" data-mode="credit">Загрузить кредитный отчёт</button></div>`;
  else {
    const ck = creditChecks(k);
    h += `<section class="panel"><h2>Кредитная нагрузка — ${esc(compName(k))}</h2><div class="facts">
      <div><span>Действующих займов</span><b>${s.n}</b><span>как заёмщик</span></div><div><span>Остаток долга</span><b>${fmt(s.debt)}</b><span>тыс. тг по отчёту</span></div>
      <div><span>Платежи в месяц</span><b>${fmt(s.pay)}</b><span>тыс. тг</span></div><div><span>Текущая просрочка</span><b>${s.od ? s.od + " дн." : "нет"}</b><span>максимум в истории: ${s.maxOd} дн.</span></div>
      <div><span>Обязательства гаранта</span><b>${fmt(s.guar)}</b><span>тыс. тг</span></div></div>
      ${ck.length ? `<table class="data rmap" style="max-width:900px"><tbody>${ck.map(c => `<tr><td class="lab">${esc(c.title)}<span class="formula">${esc(c.det)}</span></td><td class="v ${c.st}"><span class="val">${c.st === "ok" ? "в допуске" : c.st === "chk" ? "проверить" : c.st === "risk" ? "риск" : "критично"}</span></td></tr>`).join("")}</tbody></table>` : ""}
      ${s.nofx ? `<p class="hint">Валютные займы без курса: ${s.nofx} — укажите курс на странице «Банк».</p>` : ""}</section>`;
    const row = x => `<tr><td class="lab">${esc(x.creditor || "—")}<span class="formula">${esc([x.type, x.role, x.num].filter(Boolean).join(" · "))}${x.src ? " · " + esc(x.src) : ""}</span></td>
      <td>${fmt(N(x.amount) / 1000)}${x.cur && x.cur !== "KZT" ? " " + esc(x.cur) : ""}</td><td>${fmt(N(x.bal) / 1000)}</td>
      <td class="cell"><input class="inp num" data-cr="${x.id}" data-f="rate" data-pct value="${isNum(x.rate) ? esc(fmt(x.rate * 100, "m1")) : ""}" placeholder="—"></td>
      <td>${esc(x.end ? x.end.split("-").reverse().join(".") : "—")}<span class="formula">${isNum(monthsLeft(x.end)) ? monthsLeft(x.end) + " мес." : ""}</span></td>
      <td>${fmt(N(x.pay) / 1000)}</td><td class="${N(x.odDays) > 0 ? "v risk" : ""}">${N(x.odDays) ? x.odDays + " дн." : "—"}${N(x.maxOd) ? `<span class="formula">макс. ${x.maxOd}</span>` : ""}</td>
      <td><select class="inp" data-cr="${x.id}" data-f="scheme">${opts(Object.keys(SCH), x.scheme || "Дифференцированный")}</select></td>
      <td><label><input type="checkbox" data-cr="${x.id}" data-f="fc" ${x.fc !== false && !isGuar(x) ? "checked" : ""} ${isGuar(x) ? "disabled" : ""}></label></td>
      <td style="white-space:nowrap"><button class="btn ghost" data-credit="${x.id}">Изменить</button><button class="btn ghost danger" data-crdel="${x.id}" title="Удалить" aria-label="Удалить">×</button></td></tr>`;
    const act = list.filter(x => x.status !== "closed"), cl = list.filter(x => x.status === "closed");
    h += `<section class="panel"><div class="probs-h"><h2>Действующие договоры (${act.length})</h2><button class="btn" data-act="crtofc">Перенести в прогноз</button></div>
      <p class="hint">Ставку и схему погашения уточните по договору — в кредитных отчётах их часто нет. «В прогноз» — займы, которые попадут в реестр действующих кредитов на странице «Свод и прогноз» (обязательства гаранта не переносятся).</p>
      <div class="tablewrap" style="max-height:none"><table class="data crt"><thead><tr><th class="lab">Кредитор</th><th>Сумма</th><th>Остаток</th><th>Ставка, %</th><th>Погашение</th><th>Платёж в мес.</th><th>Просрочка</th><th>Схема</th><th>В прогноз</th><th></th></tr></thead><tbody>${act.map(row).join("") || `<tr><td colspan="10" class="muted">нет</td></tr>`}</tbody></table></div>
      ${cl.length ? `<details style="margin-top:10px"><summary>Завершённые договоры (${cl.length})</summary><div class="tablewrap" style="max-height:none"><table class="data crt"><tbody>${cl.map(row).join("")}</tbody></table></div></details>` : ""}</section>`;
  }
  return h;
}


/* ---------- страница «Залог и гаранты» */
function pageColl() {
  for (const x of C.coll || []) if (x.type === "Гарантия АО «ФРП «Даму»»") x.type = "Гарантия АО «ФРП «Даму»";
  ensureCredit();
  let h = `<div class="pagehead"><div class="lead"><h1>Залог и гаранты</h1><p>Обеспечение по запросу: залоги с дисконтами, покрытие и LTV; гаранты, созаёмщики и залогодатели. Суммы — в тыс. тг.</p></div>
    <div class="toolbar"><button class="btn primary" data-act="colladd">Добавить залог</button><button class="btn" data-act="guaradd">Добавить гаранта</button></div></div>
  <div id="probBanner" data-page="coll">${bannerHTML("coll")}</div>`;
  // залог
  const cv = collCover();
  h += `<section class="panel"><h2>Обеспечение (залог)</h2><p class="hint">Рыночная стоимость — по отчёту об оценке, тыс. тг. Дисконт подставляется по виду залога, его можно изменить. Покрытие сравнивается с запрашиваемой суммой на «Карточке» (${isNum(C.card.amount) ? fmt(C.card.amount) + " тыс. тг" : "не указана"}).</p>
    <div class="tablewrap" style="max-height:none"><datalist id="collOwners">${C.companies.map((x, j) => ({ n: compName(j + 1), r: compRoles(x) })).sort((a, b) => (b.r.includes("Залогодатель") || b.r.includes("Гарант")) - (a.r.includes("Залогодатель") || a.r.includes("Гарант"))).map(o => `<option value="${esc(o.n)}">${esc(o.r.join(", "))}</option>`).join("")}${(C.guar || []).filter(g => g.name).map(g => `<option value="${esc(g.name)}">${esc(g.kind || "")}</option>`).join("")}</datalist><table class="data coll"><thead><tr><th class="lab">Вид</th><th style="text-align:left">Описание</th><th style="text-align:left">Залогодатель</th><th>Рыночная стоимость</th><th>Дисконт, %</th><th>Залоговая стоимость</th><th></th></tr></thead><tbody>
    ${C.coll.map((x, i) => `<tr><td class="lab"><select class="inp" data-coll="${i}" data-f="type">${opts(Object.keys(COLL_TYPES), x.type)}</select></td><td class="cell"><input class="inp" data-coll="${i}" data-f="desc" value="${esc(x.desc || "")}" style="text-align:left"></td><td class="cell"><input class="inp" data-coll="${i}" data-f="owner" list="collOwners" value="${esc(x.owner || "")}" style="text-align:left" placeholder="${/^Гарантия/.test(x.type) ? "гарант" : "залогодатель"}"></td>
      <td class="cell"><input class="inp num" data-coll="${i}" data-f="market" value="${esc(fmt(x.market))}"></td><td class="cell"><input class="inp num" data-coll="${i}" data-f="disc" data-pct value="${esc(fmt(N(x.disc) * 100, "m1"))}"></td><td>${fmt(N(x.market) * (1 - N(x.disc)))}</td><td><button class="btn ghost danger" data-colldel="${i}" aria-label="Удалить">×</button></td></tr>`).join("")}
    ${cv ? `<tr class="calc"><td class="lab">Итого</td><td></td><td></td><td>${fmt(cv.mk)}</td><td></td><td>${fmt(cv.coll)}</td><td></td></tr>` : ""}</tbody></table></div>
    <p style="margin-top:8px"><button class="btn" data-act="colladd">Добавить залог</button></p>
    ${cv && isNum(cv.cover) ? `<div class="facts" style="margin-top:12px"><div><span>Покрытие запроса залогом</span><b class="${cv.cover < 1 ? "neg" : ""}">${pctFmt(cv.cover)}</b><span>залоговая стоимость / запрос</span></div><div><span>LTV</span><b>${pctFmt(cv.ltv)}</b><span>запрос / залоговая стоимость</span></div></div>` : ""}</section>`;
  // гаранты
  const gcomp = C.companies.map((x, i) => ({ x, k: i + 1 })).filter(o => compRoles(o.x).some(r => /Гарант|Залогодатель|Созаёмщик/.test(r)));
  const L = lastPid();
  h += `<section class="panel"><h2>Гаранты и созаёмщики</h2>
    ${gcomp.length ? `<div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Компания группы</th><th>Роль</th><th>Выручка</th><th>Чистая прибыль</th><th>Капитал</th><th>Долг / EBITDA</th></tr></thead><tbody>
      ${gcomp.map(o => `<tr><td class="lab">${esc(compName(o.k))}</td><td>${esc(compRoles(o.x).join(", "))}</td><td>${fmt(val(o.k, "rev", L))}</td><td class="${N(val(o.k, "ni", L)) < 0 ? "neg" : ""}">${fmt(val(o.k, "ni", L))}</td><td class="${N(val(o.k, "eq", L)) < 0 ? "neg" : ""}">${fmt(val(o.k, "eq", L))}</td><td>${fmt(ratio(o.k, "debt_ebitda", L), "x")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">В группе нет компаний с ролью «Гарант», «Залогодатель» или «Созаёмщик» (роли задаются на «Карточке», можно несколько).</p>`}
    <h3 style="margin-top:14px">Другие гаранты (физические лица, сторонние компании)</h3>
    <div class="tablewrap" style="max-height:none"><table class="data form"><thead><tr><th class="lab">№</th><th style="text-align:left">Гарант</th><th style="text-align:left">Кто это</th><th>Сумма гарантии, тыс. тг</th><th style="text-align:left">Примечание</th><th></th></tr></thead><tbody>
    ${C.guar.map((x, i) => `<tr><td class="lab">${i + 1}</td><td class="cell"><input class="inp" data-guar="${i}" data-f="name" value="${esc(x.name || "")}" style="text-align:left"></td><td class="cell"><select class="inp" data-guar="${i}" data-f="kind">${opts(["Учредитель (физ. лицо)", "Физическое лицо", "Юридическое лицо", "Фонд (Даму и др.)"], x.kind)}</select></td><td class="cell"><input class="inp num" data-guar="${i}" data-f="amt" value="${esc(fmt(x.amt))}"></td><td class="cell"><input class="inp" data-guar="${i}" data-f="note" value="${esc(x.note || "")}" style="text-align:left"></td><td><button class="btn ghost danger" data-guardel="${i}" aria-label="Удалить">×</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">нет</td></tr>`}</tbody></table></div>
    <p style="margin-top:8px"><button class="btn" data-act="guaradd">Добавить гаранта</button></p></section>`;
  return h;
}

/* ---------- загрузка и правка кредитов */
async function creditImport(cr, k, file) {
  ensureCredit();
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${k === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `<p class="small muted">${esc(cr.bureau)}${cr.date ? ", отчёт на " + esc(cr.date.split("-").reverse().join(".")) : ""}${cr.bin ? ", БИН " + esc(cr.bin) : ""} · договоров: ${cr.loans.length}</p>
    <label class="f" style="margin:8px 0 12px;max-width:420px"><span>Компания</span><select class="inp" id="cComp">${compsOpts}</select></label>
    <div class="tablewrap" style="max-height:52vh"><table class="data"><thead><tr><th class="lab">Кредитор</th><th>Статус</th><th>Сумма, тыс.</th><th>Остаток, тыс.</th><th>Ставка</th><th>Окончание</th><th>Платёж, тыс.</th><th>Просрочка</th><th>Загрузить</th></tr></thead><tbody>
    ${cr.loans.map((x, i) => `<tr><td class="lab">${esc(x.creditor || "—")}<span class="formula">${esc([x.type, x.role].filter(Boolean).join(" · "))}</span></td><td>${x.status === "closed" ? "завершён" : "действует"}</td><td>${K1(x.amount)}${x.cur !== "KZT" ? " " + esc(x.cur) : ""}</td><td>${K1(x.bal)}</td><td>${isNum(x.rate) ? pctFmt(x.rate) : "—"}</td><td>${esc(x.end ? x.end.split("-").reverse().join(".") : "—")}</td><td>${K1(x.pay)}</td><td>${N(x.odDays) ? x.odDays + " дн." : "—"}${N(x.maxOd) ? `<span class="formula">макс. ${x.maxOd}</span>` : ""}</td><td><input type="checkbox" data-crimp="${i}" checked></td></tr>`).join("")}</tbody></table></div>
    <p class="hint">Повторная загрузка отчёта по той же компании заменит ранее загруженные договоры из кредитного отчёта (добавленные вручную останутся).</p>`;
  setTimeout(() => $("#dlg").classList.add("wide"));
  const res = await dialog("Кредитный отчёт: проверьте и сохраните", body, [{ t: "Отменить", v: null }, { t: "Сохранить", primary: true, v: d => ({ k: +d.querySelector("#cComp").value, pick: [...d.querySelectorAll("[data-crimp]")].filter(x => x.checked).map(x => +x.dataset.crimp) }) }]);
  $("#dlg")?.classList.remove("wide");
  if (!res) return 0;
  C.cr = C.cr.filter(x => !(x.k === res.k && x.auto));
  for (const i of res.pick) C.cr.push({ id: uid(), k: res.k, src: file, auto: true, bureau: cr.bureau, date: cr.date, scheme: "Дифференцированный", fc: true, ...cr.loans[i] });
  touch();
  return res.pick.length;
}
async function creditEditor(x, isNew) {
  const f = (key, lab, val, attrs = "") => `<label class="f"><span>${lab}</span><input class="inp" data-ce="${key}" value="${esc(val ?? "")}" ${attrs}></label>`;
  const compsOpts = C.companies.map((y, i) => `<option value="${i + 1}"${x.k === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(y.name || "без названия")}</option>`).join("");
  const body = `<div class="grid2"><label class="f"><span>Компания</span><select class="inp" data-ce="k">${compsOpts}</select></label>${f("creditor", "Кредитор", x.creditor)}${f("type", "Вид финансирования", x.type)}
    <label class="f"><span>Роль</span><select class="inp" data-ce="role">${opts(["Заемщик", "Созаемщик", "Гарант", "Залогодатель"], x.role || "Заемщик")}</select></label>
    <label class="f"><span>Статус</span><select class="inp" data-ce="status">${[["active", "действует"], ["closed", "завершён"]].map(([v, t]) => `<option value="${v}"${x.status === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    ${f("amount", "Сумма договора, тыс. тг", K1(x.amount), 'inputmode="decimal"')}${f("bal", "Остаток долга, тыс. тг", K1(x.bal), 'inputmode="decimal"')}${f("pay", "Платёж в месяц, тыс. тг", K1(x.pay), 'inputmode="decimal"')}
    ${f("rate", "Ставка, % годовых", isNum(x.rate) ? fmt(x.rate * 100, "m1") : "")}<label class="f"><span>Дата выдачи</span><input class="inp" type="date" data-ce="start" value="${esc(x.start || "")}"></label><label class="f"><span>Дата погашения</span><input class="inp" type="date" data-ce="end" value="${esc(x.end || "")}"></label>
    ${f("odDays", "Текущая просрочка, дней", x.odDays)}${f("maxOd", "Максимальная просрочка, дней", x.maxOd)}<label class="f"><span>Валюта</span><select class="inp" data-ce="cur">${opts(CURS, x.cur || "KZT")}</select></label></div>`;
  const res = await dialog(isNew ? "Новый кредит" : "Кредит", body, [{ t: "Отменить", v: null }, { t: "Сохранить", primary: true, v: d => { const o = {}; d.querySelectorAll("[data-ce]").forEach(e => (o[e.dataset.ce] = e.value)); return o; } }]);
  if (!res) return null;
  const keep = (v, old) => (v === K1(old) ? old : fromK(v));
  Object.assign(x, { k: +res.k, creditor: res.creditor.trim(), type: res.type.trim(), role: res.role, status: res.status, cur: res.cur, start: res.start, end: res.end,
    amount: keep(res.amount, x.amount), bal: keep(res.bal, x.bal), pay: keep(res.pay, x.pay), rate: parseNum(res.rate) === null ? null : parseNum(res.rate) / 100, odDays: parseNum(res.odDays), maxOd: parseNum(res.maxOd) });
  if (isNew) C.cr.push(x);
  touch();
  return x;
}
function creditToForecast() {
  ensureCredit();
  const ks = C.obj > 0 ? [C.obj] : C.companies.map((_, i) => i + 1);
  const f = fcParams(), loans = [];
  for (const x of C.cr) {
    if (!ks.includes(x.k) || x.status === "closed" || isGuar(x) || x.fc === false) continue;
    const r = crKzt(x); if (r === null || !N(x.bal)) continue;
    loans.push({ name: `${x.creditor || "кредит"}${ks.length > 1 ? " (" + compName(x.k) + ")" : ""}`, bal: Math.round(N(x.bal) * r / 100) / 10, rate: isNum(x.rate) ? x.rate : f.aggRate, rem: Math.max(1, monthsLeft(x.end) || f.aggTerm), scheme: x.scheme || "Дифференцированный", grace: 0 });
  }
  return loans;
}

/* ---------- аналитика выписок для «Банка» */
function stmtTx(k) {   // все операции выписок компании в тенге, без повторов по счёту и месяцу
  const out = [], seen = new Set(), own = ownOf(k);
  for (const b of C.bank.filter(b => b.k === k && b.kind === "stmt").sort((a, c) => N(c.t) - N(a.t))) {
    const acc = b.acc || "?", mine = new Set((b.txs || []).map(t => t.d.slice(0, 7)).filter(m => !(b.acc && seen.has(acc + "|" + m))));
    (b.txs || []).forEach((t, i) => {
      const m = t.d.slice(0, 7); if (!mine.has(m)) return;
      const cr = t.cr ? txKzt(b, t, t.cr) : 0, db = t.db ? txKzt(b, t, t.db) : 0;
      out.push({ t, m, cr: N(cr), db: N(db), cat: t.cr ? txCat(b, i, t, own)[0] : null, dcat: t.db ? DocParse.classifyDebit(t, own) : null, b, i });
    });
    for (const m of mine) seen.add(acc + "|" + m);
  }
  return out;
}
function bankPeriod(k) {  // последний период анализа, по которому есть выписки
  const tx = stmtTx(k); if (!tx.length) return null;
  const ms = new Set(tx.map(x => x.m));
  for (let i = C.periods.length - 1; i >= 0; i--) { const w = perMonths(C.periods[i]); const n = w.filter(m => ms.has(m)).length; if (n) return { p: C.periods[i], win: new Set(w), cov: n, need: w.length, tx }; }
  const all = [...ms].sort(); return { p: null, win: new Set(all), cov: all.length, need: all.length, tx };
}
function topBuyers(k) {
  const bp = bankPeriod(k); if (!bp) return null;
  const by = new Map(); let tot = 0;
  for (const x of bp.tx) { if (!bp.win.has(x.m) || !x.cr || x.cat) continue; const key = x.t.bin || DocParse.clean(x.t.cp) || "без названия"; const o = by.get(key) || { name: x.t.cp || key, bin: x.t.bin, v: 0, n: 0 }; o.v += x.cr; o.n++; by.set(key, o); tot += x.cr; }
  if (!tot) return null;
  const rows = [...by.values()].sort((a, b) => b.v - a.v);
  return { rows: rows.slice(0, 10), tot, top1: rows[0].v / tot, top5: rows.slice(0, 5).reduce((a, o) => a + o.v, 0) / tot, n: rows.length, label: bp.p ? bp.p.label : "все выписки", cov: bp.cov, need: bp.need };
}
function topSuppliers(k) {
  const bp = bankPeriod(k); if (!bp) return null;
  const by = new Map(); let tot = 0;
  for (const x of bp.tx) { if (!bp.win.has(x.m) || !x.db || x.dcat !== "sup") continue; const key = x.t.bin || DocParse.clean(x.t.cp) || "без названия"; const o = by.get(key) || { name: x.t.cp || key, bin: x.t.bin, v: 0, n: 0 }; o.v += x.db; o.n++; by.set(key, o); tot += x.db; }
  if (!tot) return null;
  return { rows: [...by.values()].sort((a, b) => b.v - a.v).slice(0, 10), tot };
}
function bankExtraHTML(k) {
  const bp = bankPeriod(k); if (!bp) return "";
  const tb = topBuyers(k), ts = topSuppliers(k);
  const lab = bp.p ? `${bp.p.label}${bp.cov < bp.need ? ` (выписки за ${bp.cov} из ${bp.need} мес.)` : ""}` : "все выписки";
  const tbl = (t, total, what) => `<div class="tablewrap" style="max-height:none"><table class="data top"><thead><tr><th class="lab">${what}</th><th>Сумма, тыс. тг</th><th>Доля</th><th>Операций</th></tr></thead><tbody>
    ${t.rows.map((o, i) => `<tr><td class="lab">${i + 1}. ${esc(o.name)}${o.bin ? `<span class="formula">БИН ${esc(o.bin)}</span>` : ""}</td><td>${fmt(o.v / 1000)}</td><td class="${i === 0 && o.v / total > 0.3 ? (o.v / total > 0.5 ? "v risk" : "v chk") : ""}">${pctFmt(o.v / total)}</td><td>${o.n}</td></tr>`).join("")}</tbody></table></div>`;
  // списания по видам по периодам
  const pers = C.periods, wins = pers.map(p => new Set(perMonths(p)));
  const sums = pers.map((p, i) => { const o = {}; for (const x of bp.tx) if (x.db && wins[i].has(x.m)) o[x.dcat] = (o[x.dcat] || 0) + x.db; return o; });
  const dk = Object.keys(DocParse.DCATS).filter(c => sums.some(o => o[c]));
  const cs = crSummary(k);
  let h = `<section class="panel"><h2>Покупатели и поставщики — ${esc(lab)}</h2><p class="hint">По выпискам: покупатели — по чистым кредитовым оборотам (без исключённых поступлений), поставщики — по списаниям «поставщикам и прочие». Доля крупнейшего покупателя выше 30 % — зависимость, выше 50 % — риск.</p>`;
  if (tb) h += `<div class="facts" style="margin-bottom:10px"><div><span>Крупнейший покупатель</span><b>${pctFmt(tb.top1)}</b><span>${esc(tb.rows[0].name)}</span></div><div><span>Пять крупнейших</span><b>${pctFmt(tb.top5)}</b><span>чистых поступлений</span></div><div><span>Всего покупателей</span><b>${tb.n}</b><span>с поступлениями</span></div></div>`;
  h += `<div class="fcgrid">${tb ? `<div><h3>Топ-10 покупателей</h3>${tbl(tb, tb.tot, "Покупатель")}</div>` : ""}${ts ? `<div><h3>Топ-10 поставщиков</h3>${tbl(ts, ts.tot, "Поставщик")}</div>` : ""}</div></section>`;
  if (dk.length) h += `<section class="panel"><h2>Списания по видам, тыс. тг</h2><p class="hint">По назначению платежа и КНП. Помогает сверить фактические платежи по кредитам с кредитным отчётом, налоги — с декларациями, зарплату — с ФОТ.</p>
    <div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Вид списания</th>${pers.map(p => `<th>${esc(p.label)}</th>`).join("")}</tr></thead><tbody>
    ${dk.map(c => `<tr><td class="lab">${esc(DocParse.DCATS[c])}</td>${sums.map(o => `<td>${o[c] ? fmt(o[c] / 1000) : ""}</td>`).join("")}</tr>`).join("")}
    ${cs.any && cs.pay ? `<tr class="sec"><td class="lab" colspan="${pers.length + 1}">Для сравнения</td></tr><tr><td class="lab">Платежи по кредитам по кредитному отчёту (в мес. × 12, на дату отчёта)</td>${pers.map((p, i) => `<td>${i === pers.length - 1 ? fmt(cs.pay * 12) : ""}</td>`).join("")}</tr>` : ""}
    <tr><td class="lab">ФОТ по ОПиУ</td>${pers.map(p => `<td>${fmt(val(k, "fot", p.id))}</td>`).join("")}</tr></tbody></table></div></section>`;
  return h;
}
// сезонность выручки по чистым кредитовым оборотам (среднее по годам, среднее = 1)
function bankSeasonality() {
  const ks = C.obj > 0 ? [C.obj] : C.companies.map((_, i) => i + 1), byM = {};
  for (const k of ks) for (const [m, o] of Object.entries(bankMonths(k))) byM[m] = (byM[m] || 0) + o.net;
  const ms = Object.keys(byM).filter(m => byM[m] > 0).sort();
  if (ms.length < 12) return null;
  const last = ms.slice(-24), acc = new Array(12).fill(0), cnt = new Array(12).fill(0);
  for (const m of last) { const i = +m.slice(5, 7) - 1; acc[i] += byM[m]; cnt[i]++; }
  if (cnt.some(c => !c)) return null;
  const avg = acc.map((v, i) => v / cnt[i]), mean = avg.reduce((a, b) => a + b, 0) / 12;
  return avg.map(v => Math.round(v / mean * 100) / 100);
}

/* ---------- события */
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t || !C) return;
  const d = t.dataset;
  if (d.act === "cradd") { ensureCredit(); const x = { id: uid(), k: COMP_TAB > nComp() ? 1 : COMP_TAB, src: "вручную", status: "active", role: "Заемщик", cur: "KZT", scheme: "Дифференцированный", fc: true }; if (await creditEditor(x, true)) { PAGE = "credit"; render(); } return; }
  if (d.credit) { const x = C.cr.find(y => y.id === d.credit); if (x && await creditEditor(x, false)) render(); return; }
  if (d.crdel) { if (await dialog("Удалить кредит?", "<p>Договор будет удалён из реестра клиента.</p>", [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }])) { C.cr = C.cr.filter(x => x.id !== d.crdel); touch(); render(); } return; }
  if (d.act === "crtofc") {
    const loans = creditToForecast();
    if (!loans.length) { toast("Нет действующих займов для прогноза"); return; }
    const ok = await dialog("Перенести займы в прогноз?", `<p>Реестр действующих кредитов на странице «Свод и прогноз» для объекта «${esc(objName(C.obj))}» будет заменён: ${loans.length} займ(ов), остаток ${fmt(loans.reduce((a, l) => a + l.bal, 0))} тыс. тг.</p><p class="small muted">Срок — по дате погашения, ставка — по договору (если не указана — средняя из допущений прогноза).</p>`, [{ t: "Отменить", v: false }, { t: "Перенести", primary: true, v: true }]);
    if (ok) { fcParams().loans = loans; touch(); toast("Займы перенесены в прогноз"); render(); }
    return;
  }
  if (d.act === "colladd") { ensureCredit(); C.coll.push({ type: "Недвижимость", desc: "", owner: pledgorDefault(), market: null, disc: COLL_TYPES["Недвижимость"] }); touch(); render(); return; }
  if (d.colldel !== undefined) { C.coll.splice(+d.colldel, 1); touch(); render(); return; }
  if (d.act === "guaradd") { ensureCredit(); C.guar.push({ name: "", kind: "Учредитель (физ. лицо)", amt: null, note: "" }); touch(); render(); return; }
  if (d.guardel !== undefined) { C.guar.splice(+d.guardel, 1); touch(); render(); return; }
  if (d.act === "seasbank") { const s = bankSeasonality(); if (!s) { toast("Нужны выписки минимум за 12 месяцев подряд"); return; } fcParams().seas = s; touch(); render(); toast("Сезонность взята из банковских оборотов"); return; }
});
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset; if (!C) return;
  if (d.cr) {
    const x = C.cr.find(y => y.id === d.cr); if (!x) return;
    if (d.f === "fc") x.fc = t.checked; else if (d.f === "scheme") x.scheme = t.value;
    else if (d.f === "rate") { const v = parseNum(t.value); x.rate = v === null ? null : v / 100; }
    touch(); return;
  }
  if (d.coll !== undefined) {
    const x = C.coll[+d.coll]; if (!x) return;
    if (d.f === "type") { x.type = t.value; x.disc = COLL_TYPES[t.value] ?? x.disc; }
    else if (d.f === "market") x.market = parseNum(t.value);
    else if (d.f === "disc") { const v = parseNum(t.value); x.disc = v === null ? 0 : Math.min(1, Math.max(0, v / 100)); }
    else x[d.f] = t.value;
    touch(); if (d.f !== "desc" && d.f !== "owner") render(); return;
  }
  if (d.guar !== undefined) { const x = C.guar[+d.guar]; if (!x) return; x[d.f] = d.f === "amt" ? parseNum(t.value) : t.value; touch(); return; }
  if (d.grpex !== undefined) { C.dset.grpEx = t.checked; touch(); render(); }
});

/* ---------------------------------------------------------------- заключение: структура кредитного комитета */
const CHART_CSS = `text{font-family:Verdana,Arial;font-size:10px;fill:#666}.grid{stroke:#EFEEEC}.zero{stroke:#272727;stroke-width:.8}.buf{stroke:#FFB020;stroke-dasharray:5 4;stroke-width:1.4}.b{fill:none;stroke:#023DFF;stroke-width:2.4}.s{fill:none;stroke:#00BB00;stroke-width:2.4}.br{fill:#023DFF}.bg{fill:#00BB00}.lg{font-size:11px;fill:#272727}`;
function revChart(obj) {
  const pers = C.periods, W = 520, H = 220, pl = 70, pr = 10, pt = 24, pb = 26;
  const rv = pers.map(p => val(obj, "rev", p.id)), eb = pers.map(p => ratio(obj, "ebitda_ann", p.id) === NP ? null : val(obj, "ebitda", p.id));
  const all = [...rv, ...eb].filter(isNum); if (!all.length) return "";
  const mx = Math.max(...all, 1), mn = Math.min(0, ...all), y = v => pt + (mx - v) / (mx - mn) * (H - pt - pb);
  const gw = (W - pl - pr) / pers.length, bw = Math.min(46, gw * 0.32);
  const ticks = [mn, (mn + mx) / 2, mx];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart" role="img" aria-label="Выручка и EBITDA">
    ${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("")}
    ${pers.map((p, i) => { const x0 = pl + gw * i + gw / 2; return `${isNum(rv[i]) ? `<rect x="${x0 - bw - 2}" y="${y(Math.max(rv[i], 0))}" width="${bw}" height="${Math.abs(y(rv[i]) - y(0))}" class="br"/>` : ""}${isNum(eb[i]) ? `<rect x="${x0 + 2}" y="${y(Math.max(eb[i], 0))}" width="${bw}" height="${Math.abs(y(eb[i]) - y(0))}" class="bg"/>` : ""}<text x="${x0}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>`; }).join("")}
    <rect x="${pl}" y="6" width="10" height="10" class="br"/><text x="${pl + 14}" y="15" class="lg">Выручка</text><rect x="${pl + 90}" y="6" width="10" height="10" class="bg"/><text x="${pl + 104}" y="15" class="lg">EBITDA, тыс. тг</text></svg>`;
}
function autoFinText(obj) {
  const L = lastPid(), P = prevPid(L), pl = C.periods[perIdx(L)]?.label, pp = P ? C.periods[perIdx(P)]?.label : null, out = [];
  const r = val(obj, "rev", L), r0 = P ? val(obj, "rev", P) : null;
  if (isNum(r)) out.push(`Выручка за ${pl} — ${fmt(r)} тыс. тг${isNum(r0) && r0 > 0 ? ` (${r >= r0 ? "+" : "−"}${nf1.format(Math.abs(r / r0 - 1) * 100)} % к ${pp})` : ""}.`);
  const e = val(obj, "ebitda", L), ni = val(obj, "ni", L);
  if (isNum(e)) out.push(`EBITDA — ${fmt(e)} тыс. тг (маржа ${fmt(ratio(obj, "ebitda_m", L), "p")}), чистая ${N(ni) < 0 ? "убыток" : "прибыль"} — ${fmt(Math.abs(N(ni)))} тыс. тг.`);
  const st = k => { const s = rstatus(k, ratio(obj, k, L)); return s ? ST[s].toLowerCase() : "н/д"; };
  const de = ratio(obj, "debt_ebitda", L), lq = ratio(obj, "liq_cur", L), eqr = ratio(obj, "eq_ratio", L);
  out.push(`Долговая нагрузка: общий долг ${fmt(ratio(obj, "debt", L))} тыс. тг, долг / EBITDA — ${de === NP ? "не применимо (EBITDA ≤ 0)" : fmt(de, "x")} (${st("debt_ebitda")}).`);
  out.push(`Ликвидность: текущая — ${fmt(lq, "x")} (${st("liq_cur")}); доля собственного капитала — ${fmt(eqr, "x")} (${st("eq_ratio")}).`);
  return out;
}
function conclusionHTML(forWord, imgs) {
  ensureDocs(); ensureCredit();
  const obj = C.obj, L = lastPid(), P = prevPid(L), pers = C.periods, rs = riskSummary(obj), c = C.card;
  const T = forWord ? 'style="border-collapse:collapse;font-size:10pt;width:100%" border="1" cellpadding="4"' : 'class="data"';
  const th = forWord ? ' style="border:1px solid #E5E4E2;padding:4px 8px;background:#E5E4E2"' : "";
  const row = (lab, key, kind, isR) => { const f = p => (p ? (isR ? ratio(obj, key, p) : val(obj, key, p)) : null); const a = f(P), b = f(L);
    return `<tr><td style="text-align:left">${lab}</td><td>${fmt(a, kind)}</td><td>${fmt(b, kind)}</td><td style="text-align:left">${isR ? (ST[rstatus(key, b)] || "") : ""}</td></tr>`; };
  const img = (id, svg) => (forWord ? (imgs && imgs[id] ? `<p><img src="${id}.png" width="520"></p>` : "") : svg ? `<div class="conchart">${svg}</div>` : "");
  let n = 0; const H2 = t => `<h2 style="margin-top:16px">${++n}. ${t}</h2>`;
  // 1. заёмщик
  let h = `<h1>Заключение по финансовому анализу</h1>
  ${H2("Заёмщик и запрос")}<p><b>${esc(c.name)}</b>${c.bin ? ", БИН " + esc(c.bin) : ""}. ${esc(c.activity || "")}${c.region ? " Регион: " + esc(c.region) + "." : ""}</p>${okedListText(C) ? `<p>ОКЭД: ${esc(okedListText(C))}</p>` : ""}${(() => { if (nComp() < 2) return ""; const r = []; for (let k = 1; k <= nComp(); k++) { const ina = C.periods.filter(p => inactive(k, p.id)), pr = C.periods.filter(p => partialReg(k, p.id)); if (ina.length || pr.length) r.push(`${compName(k)}${C.trust?.[k]?.regDate ? " (зарегистрировано " + C.trust[k].regDate + ")" : ""}: ${ina.length ? "за " + ina.map(p => p.label).join(", ") + " деятельности не было, в группу не входит" : ""}${ina.length && pr.length ? "; " : ""}${pr.length ? "период " + pr.map(p => p.label).join(", ") + " неполный" : ""}.`); } return r.length ? `<p>${esc(r.join(" "))}</p>` : ""; })()}
  <p>Запрос: ${esc(c.product || "")}, ${isNum(c.amount) ? fmt(c.amount) + " тыс. тг" : "сумма не указана"}; цель — ${esc((c.purpose || "").toLowerCase())}. Объект анализа: ${esc(objName(obj))}; периоды: ${esc(pers.map(p => p.label).join(", "))}.</p>`;
  if (nComp() > 1) h += `<table ${T}><thead><tr><th${th} style="text-align:left">Компания</th><th${th}>БИН</th><th${th}>Роль</th><th${th}>Форма</th><th${th}>Режим</th></tr></thead><tbody>${C.companies.map((x, i) => `<tr><td style="text-align:left">${esc(compName(i + 1))}</td><td>${esc(x.bin || "")}</td><td>${esc(compRoles(x).join(", "))}</td><td>${esc(x.form)}</td><td>${esc(x.regime)}</td></tr>`).join("")}</tbody></table>`;
  h += `${H2("Благонадёжность")}${trustConclHTML() || "<p>Проверка не проведена.</p>"}`;
  // 2. финансы
  h += `${H2("Финансовое положение")}<ul>${autoFinText(obj).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  <table ${T}><thead><tr><th${th} style="text-align:left">Показатель</th><th${th}>${esc(pers[perIdx(P)]?.label || "")}</th><th${th}>${esc(pers[perIdx(L)]?.label || "")}</th><th${th}>Оценка</th></tr></thead><tbody>
    ${row("Выручка, тыс. тг", "rev", "m")}${row("EBITDA (годовая), тыс. тг", "ebitda_ann", "m", true)}${row("Чистая прибыль, тыс. тг", "ni", "m")}
    ${row("Итого активы, тыс. тг", "ta", "m")}${row("Капитал, тыс. тг", "eq", "m")}${row("Общий долг, тыс. тг", "debt", "m", true)}
    ${row("Текущая ликвидность", "liq_cur", "x", true)}${row("Долг / EBITDA", "debt_ebitda", "x", true)}${row("Коэффициент автономии", "eq_ratio", "x", true)}
    ${row("Покрытие процентов (EBIT)", "icr", "x", true)}${row("Денежный цикл, дней", "cycle", "d", true)}${row("DSCR (история)", "dscr_hist", "x", true)}</tbody></table>${img("rev", revChart(obj))}`;
  // 3. налоги и банк
  const tx = taxConclHTML().replace(/^<h2[^>]*>[^<]*<\/h2>/, "");
  const conc = []; for (let k = 1; k <= nComp(); k++) { const t = topBuyers(k); if (t) conc.push(`${compName(k)}: крупнейший покупатель — ${t.rows[0].name} (${pctFmt(t.top1)} чистых поступлений), пять крупнейших — ${pctFmt(t.top5)} (${t.label}).`); }
  h += `${H2("Налоги и банковские обороты")}${tx || "<p>Декларации и выписки не загружены.</p>"}${conc.length ? `<p>Концентрация покупателей:</p><ul>${conc.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
  // 4. кредитная история
  const ci = []; for (let k = 1; k <= nComp(); k++) { const s = crSummary(k); if (!s.any) continue; ci.push(`${compName(k)}: действующих займов ${s.n}, остаток ${fmt(s.debt)} тыс. тг, платежи ${fmt(s.pay)} тыс. тг в месяц; текущая просрочка — ${s.od ? s.od + " дн." : "нет"}, максимальная в истории — ${s.maxOd} дн${s.guar ? `.; обязательства гаранта — ${fmt(s.guar)} тыс. тг` : ""}.`); }
  h += `${H2("Кредитная история")}${ci.length ? `<ul>${ci.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>Кредитный отчёт не загружен.</p>"}`;
  // 5. прогноз
  const b = forecast(obj, 0), s = forecast(obj, 1);
  if (b.err) h += `${H2("Прогноз и обслуживание долга")}<p>Прогноз не построен: ${esc(b.err)}.</p>`;
  else h += `${H2("Прогноз и обслуживание долга")}<p>Горизонт ${b.H} мес. DSCR с новым кредитом: база — ${fmt(b.dscr_h_post, "x")}, стресс — ${fmt(s.dscr_h_post, "x")}; минимальный годовой DSCR (база) — ${fmt(b.dscr_year_min, "x")}. Минимальный остаток денег с кредитом: база — ${fmt(b.mincash_post)}, стресс — ${fmt(s.mincash_post)} тыс. тг. Расчётная потребность в финансировании — ${fmt(b.rec)} тыс. тг${isNum(c.amount) ? ` при запросе ${fmt(c.amount)} тыс. тг` : ""}.</p>${img("cash", typeof cashChart === "function" ? cashChart(b, s).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="230" ') : "")}`;
  // 6. обеспечение
  const cv = collCover();
  h += `${H2("Обеспечение и гаранты")}`;
  if (cv) h += `<table ${T}><thead><tr><th${th} style="text-align:left">Залог</th><th${th}>Рыночная, тыс. тг</th><th${th}>Дисконт</th><th${th}>Залоговая, тыс. тг</th></tr></thead><tbody>${C.coll.map(x => `<tr><td style="text-align:left">${esc(x.type)}${x.desc ? ": " + esc(x.desc) : ""}${x.owner ? " (" + esc(x.owner) + ")" : ""}</td><td>${fmt(x.market)}</td><td>${pctFmt(x.disc)}</td><td>${fmt(N(x.market) * (1 - N(x.disc)))}</td></tr>`).join("")}</tbody></table>
    <p>Залоговая стоимость — ${fmt(cv.coll)} тыс. тг${isNum(cv.cover) ? `, покрытие запроса — ${pctFmt(cv.cover)}, LTV — ${pctFmt(cv.ltv)}` : ""}.</p>`;
  else h += `<p>Обеспечение не указано.</p>`;
  const gs = C.companies.map((x, i) => { const r = compRoles(x).filter(z => /Гарант|Созаёмщик|Залогодатель/.test(z)); return r.length ? `${compName(i + 1)} (${r.join(", ").toLowerCase()})` : null; }).filter(Boolean).concat(C.guar.filter(g => g.name).map(g => `${g.name} (${(g.kind || "").toLowerCase()}${isNum(g.amt) ? ", " + fmt(g.amt) + " тыс. тг" : ""})`));
  if (gs.length) h += `<p>Гаранты и созаёмщики: ${esc(gs.join("; "))}.</p>`;
  // 7. риски
  const risks = PROB.filter(p => p.sev === "crit" || p.sev === "risk").slice(0, 14);
  h += `${H2("Риски")}<p>Автоиндикатор: <b>${esc(rs.ind[1])}</b>. Показателей в норме: ${rs.cnt.ok}, требуют проверки: ${rs.cnt.chk}, в зоне риска: ${rs.cnt.risk}, критических: ${rs.cnt.crit}; расхождений в сверках: ${rs.disc}.</p>
    ${risks.length ? `<ul>${risks.map(p => `<li><b>${p.sev === "crit" ? "Критично" : "Риск"}:</b> ${esc(p.title)}${p.detail ? " — " + esc(p.detail) : ""}</li>`).join("")}</ul>` : "<p>Существенных рисков не выявлено.</p>"}`;
  // 8–9. выводы и рекомендация
  h += `${H2("Выводы кредитного менеджера")}<p class="concl-text">${esc(C.concl.text || "—")}</p>
  ${H2("Рекомендация")}<p><b>${esc(C.concl.decision || "не выбрана")}</b></p>${C.concl.conditions ? `<p class="concl-text">${esc(C.concl.conditions)}</p>` : ""}
  <p class="small muted" style="margin-top:18px">Кредитный менеджер: ${esc(c.analyst || "—")}. Дата: ${esc(c.date || "")}. Статус: ${esc(C.concl.status)}. Суммы — в тыс. тг. Автоиндикатор не заменяет решение кредитного менеджера.</p>`;
  return h;
}
async function svgPng(svg) {
  const src = svg.replace(/<svg([^>]*)>/, `<svg$1><style>${CHART_CSS}</style>`);
  const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
  try {
    const im = new Image(); im.src = url; await im.decode();
    const cv = document.createElement("canvas"); cv.width = im.naturalWidth * 2 || 1040; cv.height = im.naturalHeight * 2 || 460;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png").split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}
async function exportWord() {
  const obj = C.obj, imgs = {};
  if (!isOD()) try { const r = revChart(obj); if (r) imgs.rev = await svgPng(r); } catch (e) { /* без графика */ }
  if (!isOD()) try { const b = forecast(obj, 0), s = forecast(obj, 1); if (!b.err) imgs.cash = await svgPng(cashChart(b, s).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="230" ')); } catch (e) { /* без графика */ }
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:Roboto,Calibri,Arial;font-size:11pt;color:#272727}h1,h2{font-family:'Futura PT','Century Gothic',Arial;color:#272727}h1{font-size:16pt;border-bottom:3pt solid #023DFF;padding-bottom:4pt}h2{font-size:13pt;color:#023DFF}.small,.muted{font-family:Verdana;font-size:8pt;color:#666}td,th{border:1px solid #E5E4E2;padding:3px 6px;text-align:right}</style></head><body>${trHTML(isOD() ? odConclusionHTML(true) : conclusionHTML(true, imgs))}</body></html>`;
  // MHTML: Word открывает документ вместе с картинками
  const B = "----=_FinKZ_" + uid(), enc = s => b64(new TextEncoder().encode(s)).replace(/.{76}/g, "$&\r\n");
  let mht = `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${B}"; type="text/html"\r\n\r\n--${B}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///C:/zakl/zakl.htm\r\n\r\n${enc(html)}\r\n`;
  for (const [id, data] of Object.entries(imgs)) mht += `--${B}\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///C:/zakl/${id}.png\r\n\r\n${data.replace(/.{76}/g, "$&\r\n")}\r\n`;
  mht += `--${B}--\r\n`;
  download(`Заключение_${safeName(C.card.name)}.doc`, mht, "application/msword");
}
