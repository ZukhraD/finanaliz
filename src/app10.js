"use strict";
/* ---------------------------------------------------------------- «Благонадёжность»: чек-лист проверок и разбор отчётов сервисов проверки контрагентов
   («Параграф» / PRG.Tekser и аналоги). Отчёт загружается файлом (PDF, HTML, Excel) — сайт не обращается к внешним сервисам. */
const TRUST = [
  // id, название, серьёзность при «есть», поиск строки в отчёте
  ["status", "Ликвидация, реорганизация, прекращение деятельности", "crit", /(ликвидац|реорганизац|прекращен\S*\s+деятельност|исключ\S*\s+из\s+реестр)/],
  ["bankrupt", "Банкротство, реабилитация", "crit", /(банкрот|реабилитац)/],
  ["inactive", "Бездействующий налогоплательщик", "crit", /бездействующ/],
  ["fake", "Лжепредприятие, регистрация признана недействительной", "crit", /(лжепредприят|недействительн\S*\s+(государственн\S*\s+)?регистрац)/],
  ["terror", "Перечни лиц, связанных с терроризмом и экстремизмом, санкции", "crit", /(террор|экстремизм|санкционн|санкци)/],
  ["taxdebt", "Налоговая задолженность", "risk", /(налогов\S*\s+задолж|задолж\S*\s+(по\s+)?налог|задолженност\S*\s+перед\s+бюджет)/],
  ["pension", "Задолженность по пенсионным и социальным отчислениям", "risk", /((опв|пенсион|социальн\S*\s+отчислен|осмс)\S*.{0,30}задолж|задолж\S*.{0,30}(опв|пенсион|социальн|осмс))/],
  ["violator", "Нарушитель налогового законодательства", "risk", /(нарушени\S*\s+налогов|нарушител\S*\s+налогов)/],
  ["address", "Отсутствие по юридическому адресу", "risk", /(отсутству\S*\s+по\s+(юридическ|месту\s+нахожд)|не\s+находит\S*\s+по\s+(юридическ|месту))/],
  ["erd", "Должник по исполнительным производствам (ЕРД)", "risk", /(исполнительн\S*\s+производ|реестр\S*\s+должник|(?:^|[^а-яё])ерд(?![а-яё]))/],
  ["travel", "Запрет на выезд руководителя", "risk", /(запрет\S*\s+на\s+выезд|ограничени\S*\s+(на\s+)?выезд)/],
  ["procure", "Недобросовестный участник госзакупок", "risk", /недобросовестн\S*\s+(участник|поставщик)/],
  ["riskdeg", "Высокая степень риска налогоплательщика (КГД)", "risk", /степен\S*\s+риска/],
  ["courts", "Судебные дела в качестве ответчика", "chk", /(судебн\S*\s+(дел|спор|акт|разбират)|ответчик|арбитраж)/],
  ["mass", "Массовый адрес, массовый руководитель или учредитель", "chk", /массов\S*\s+(регистрац|адрес|руковод|учредит)/],
  ["changes", "Частая смена руководителя или учредителей", "chk", /(смен\S*\s+(руковод|директор|учредит|участник)|изменени\S*\s+(в\s+составе\s+)?(руковод|учредит|участник))/],
];
const TST = { na: "не проверено", no: "нет", yes: "есть" };
function ensureTrust(c = C) { if (!c) return; c.trust = c.trust || {}; for (let k = 1; k <= c.companies.length; k++) { const t = c.trust[k] || (c.trust[k] = { items: {}, src: [] }); for (const [id] of TRUST) t.items[id] = t.items[id] || { st: "na", note: "" }; } }
const NEG = /(не\s+(числит|значит|найден|обнаруж|является|включ|состоит|выявлен|имеет|зарегистр|установлен|привлекал|участвует)|отсутству|не\s+имеется|сведени\S*\s+(нет|отсутств)|данных\s+нет|информаци\S*\s+(нет|отсутств)|не\s+найдено|(?:^|[^а-яё])нет(?![а-яё])|не\s+выявлено|^\s*-\s*$|(?:^|[^а-яё])низк)/;
const POS = /(числит|значит|найден|обнаруж|является|включен|состоит|выявлен|имеется|(?:^|[^а-яё])есть(?![а-яё])|(?:^|[^а-яё])да(?![а-яё])|(?:^|[^а-яё])высок|(?:^|[^а-яё])средн|\d[\d\s]*[.,]?\d*\s*(тг|тенге|₸)|\d+\s+(дел|производств|запис))/;
function trustScan(lines) {
  const L = lines.map(l => (l.text || "").replace(/\s+/g, " ").trim()).filter(Boolean), low = s => s.toLowerCase().replace(/ё/g, "е");
  const found = {}, info = {};
  for (let i = 0; i < L.length; i++) {
    const t = low(L[i]);
    const rd = /дата\s+(государственной\s+|первичной\s+)?регистрации\D{0,20}(\d{2}\.\d{2}\.\d{4})/.exec(t + " " + low(L[i + 1] || ""));
    if (rd && !info.regDate) info.regDate = rd[2];
    const dir = /([Рр]уководител\S*|[Дд]иректор|ДИРЕКТОР|РУКОВОДИТЕЛЬ)\s*[:\-–]?\s*([А-ЯЁӘІҢҒҮҰҚӨҺ][а-яёәіңғүұқөһ]+\s+[А-ЯЁӘІҢҒҮҰҚӨҺ][а-яёәіңғүұқөһ]+(\s+[А-ЯЁӘІҢҒҮҰҚӨҺ][а-яёәіңғүұқөһ]+)?)/.exec(L[i]);
    if (dir && !info.director) info.director = dir[2];
    // «Статус: действующее» — нет ликвидации/реорганизации
    const stm = /(^|\s)(статус|состояние)(\s+(юридического\s+лица|компании|налогоплательщика))?\s*[:\-–|]?\s*(.*)$/.exec(t);
    if (stm) { const v = (stm[5] || low(L[i + 1] || "")).trim(); if (/^(действующ|активн|зарегистрирован)/.test(v)) { if (!found.status) found.status = { st: "no", ev: L[i].slice(0, 180) }; } else if (/(ликвидац|реорганизац|прекращ|недейств|исключ|приостановл)/.test(v)) found.status = { st: "yes", ev: L[i].slice(0, 180) }; }
    for (const [id, , , re] of TRUST) {
      const m = re.exec(t); if (!m) continue;
      // признак — в остатке строки после названия или в следующей строке (таблица «показатель | значение»)
      let rest = t.slice(m.index + m[0].length).replace(/^[\s:–—\-|]+/, "");
      if (rest.length < 2 && L[i + 1]) rest = low(L[i + 1]);
      let st = null;
      if (id === "riskdeg") st = /высок/.test(rest) ? "yes" : /(средн|низк|не\s+определ)/.test(rest) ? "no" : null;
      else if (id === "status") st = /действующ|активн/.test(rest) && !/недействующ/.test(rest) ? "no" : NEG.test(rest) ? "no" : POS.test(rest) || /ликвидац|реорганизац/.test(t) && !/(дата|сведени)/.test(t.slice(0, m.index)) ? "yes" : null;
      else st = NEG.test(rest) ? "no" : POS.test(rest) ? "yes" : null;
      if (!st) continue;
      const ev = (L[i] + (rest === low(L[i + 1] || "") ? " — " + L[i + 1] : "")).slice(0, 180);
      if (!found[id] || (found[id].st === "no" && st === "yes")) found[id] = { st, ev };
    }
  }
  return { found, info };
}
function trustSummary(k) {
  ensureTrust(); const t = C.trust[k]; let crit = 0, risk = 0, chk = 0, na = 0, ok = 0;
  for (const [id, , sev] of TRUST) { const s = t.items[id].st; if (s === "na") na++; else if (s === "no") ok++; else if (sev === "crit") crit++; else if (sev === "risk") risk++; else chk++; }
  const age = t.regDate ? (Date.now() - new Date(t.regDate.split(".").reverse().join("-"))) / (365.25 * 86400000) : null;
  return { crit, risk, chk, na, ok, age, t };
}
function trustProblems(add) {
  if (!C) return; ensureTrust();
  for (let k = 1; k <= nComp(); k++) {
    const s = trustSummary(k), nm = compName(k);
    if (s.na === TRUST.length) { add("nd", "trust", `${nm}: проверка благонадёжности не проведена`, "", "Загрузите отчёт сервиса проверки контрагентов («Параграф» и т.п.) или отметьте результаты проверки вручную на странице «Благонадёжность»."); continue; }
    for (const [id, title, sev] of TRUST) {
      const it = s.t.items[id]; if (it.st !== "yes") continue;
      add(sev, "trust", `${nm}: ${title.toLowerCase()}`, it.note || "", sev === "crit" ? "Стоп-фактор: как правило, финансирование не рассматривается до устранения. Запросите документы, подтверждающие урегулирование." : sev === "risk" ? "Запросите справку об отсутствии задолженности / пояснения и документы об урегулировании; отразите в заключении." : "Уточните существо и суммы, оцените влияние на деятельность; отразите в заключении.");
    }
    if (isNum(s.age) && s.age < 1) add(s.age < 0.5 ? "risk" : "chk", "trust", `${nm}: компания зарегистрирована менее года назад`, `дата регистрации ${s.t.regDate}`, "Короткая история деятельности: оцените опыт учредителей и руководителя, источники выручки, обеспечение.");
    if (s.na && s.na < TRUST.length) add("nd", "trust", `${nm}: не проверено пунктов благонадёжности — ${s.na}`, "", "Отметьте оставшиеся пункты по данным отчёта или официальных источников (КГД, egov, реестр должников).");
  }
}
function trustConclHTML() {
  if (!C) return ""; ensureTrust();
  const rows = [];
  for (let k = 1; k <= nComp(); k++) {
    const s = trustSummary(k), bad = TRUST.filter(([id]) => s.t.items[id].st === "yes").map(([id, title]) => title + (s.t.items[id].note ? ` (${s.t.items[id].note})` : ""));
    if (s.na === TRUST.length) { rows.push(`${compName(k)}: проверка не проведена.`); continue; }
    rows.push(`${compName(k)}${s.t.regDate ? `, дата регистрации ${s.t.regDate}` : ""}: ${bad.length ? "выявлено — " + bad.join("; ") : "негативной информации не выявлено"} (проверено пунктов: ${TRUST.length - s.na} из ${TRUST.length}${s.t.src?.length ? "; источник: " + s.t.src.map(x => x.file).join(", ") : ""}).`);
  }
  return rows.length ? `<ul>${rows.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
}

/* ---------- страница */
function pageTrust() {
  ensureTrust();
  const k = COMP_TAB > nComp() ? 1 : COMP_TAB, s = trustSummary(k), t = s.t;
  const opt = (id, cur) => `<select class="inp tst ${cur}" data-trust="${id}">${Object.entries(TST).map(([v, l]) => `<option value="${v}"${cur === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  return `<div class="pagehead"><div class="lead"><h1>Благонадёжность</h1><p>Проверка компании по официальным реестрам и сервисам проверки контрагентов. Загрузите отчёт из «Параграфа» (PRG.Tekser) или аналогичного сервиса в PDF, HTML или Excel — сайт найдёт в нём факторы риска и предложит отметки. Сайт сам к сервисам не подключается: отчёт читается в этом браузере.</p></div>
    <div class="toolbar"><button class="btn primary" data-act="trustdlg">Загрузить отчёт</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="trust">${bannerHTML("trust")}</div>
  <section class="panel"><h2>${esc(compName(k))}</h2>
    <div class="chips" style="margin-bottom:12px">${stChip(s.crit ? "crit" : "ok", "Стоп-факторы: " + s.crit)} ${stChip(s.risk ? "risk" : "ok", "Риски: " + s.risk)} ${stChip(s.chk ? "chk" : "ok", "Проверить: " + s.chk)} ${stChip(s.na ? "nd" : "ok", "Не проверено: " + s.na)}</div>
    <div class="grid2" style="max-width:900px"><label class="f"><span>Дата регистрации</span><input class="inp" data-trustf="regDate" value="${esc(t.regDate || "")}" placeholder="дд.мм.гггг"></label>
      <label class="f"><span>Руководитель</span><input class="inp" data-trustf="director" value="${esc(t.director || "")}"></label>
      <label class="f"><span>Дата проверки</span><input class="inp" type="date" data-trustf="date" value="${esc(t.date || "")}"></label>
      <label class="f"><span>Источник</span><input class="inp" data-trustf="source" value="${esc(t.source || (t.src?.length ? t.src[t.src.length - 1].file : ""))}" placeholder="Параграф, КГД, egov…"></label></div>
    ${isNum(s.age) ? `<p class="hint" style="margin-top:8px">На рынке ${nf1.format(s.age)} ${s.age < 5 ? "года" : "лет"}.</p>` : ""}
    <div class="tablewrap" style="max-height:none;margin-top:12px"><table class="data trust"><thead><tr><th class="lab">Проверка</th><th>Уровень</th><th>Результат</th><th style="text-align:left">Комментарий / найдено в отчёте</th></tr></thead><tbody>
    ${TRUST.map(([id, title, sev]) => { const it = t.items[id]; return `<tr class="${it.st === "yes" ? "hit-" + sev : ""}"><td class="lab">${esc(title)}</td><td>${stChip(sev, sev === "crit" ? "стоп-фактор" : sev === "risk" ? "риск" : "проверить")}</td><td>${opt(id, it.st)}</td><td class="cell"><input class="inp" data-trustnote="${id}" value="${esc(it.note || "")}" style="text-align:left"></td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="hint" style="margin-top:10px">Официальные источники для самостоятельной проверки: КГД (задолженность, бездействующие, лжепредприятия, нарушители, банкроты, отсутствующие по адресу), egov (статус, регистрация), реестр должников (ЕРД), портал госзакупок (недобросовестные участники), перечень лиц, связанных с финансированием терроризма.</p></section>`;
}
async function trustImport(files, kDef) {
  ensureTrust(); const rep = [];
  for (const file of files) {
    let r; try { toast("Читаю " + file.name + "…"); r = await readDoc(file); } catch (e) { rep.push(file.name + ": " + e.message); continue; }
    const lines = r.pdf.pages.flatMap(p => p.lines);
    const { found, info } = trustScan(lines);
    const bin = /(?:бин|иин)\D{0,20}(\d{12})/i.exec(lines.slice(0, 80).map(l => l.text).join(" "));
    const k0 = (bin && compByBin(bin[1])) || kDef;
    const n = Object.keys(found).length;
    const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${k0 === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
    const body = `<p class="small muted">Файл: ${esc(file.name)}${bin ? " · БИН " + esc(bin[1]) : ""} · найдено пунктов: ${n} из ${TRUST.length}${info.regDate ? " · дата регистрации " + esc(info.regDate) : ""}</p>
      <label class="f" style="margin:8px 0 12px;max-width:420px"><span>Компания</span><select class="inp" id="tComp">${compsOpts}</select></label>
      <div class="tablewrap" style="max-height:52vh"><table class="data trust"><thead><tr><th class="lab">Проверка</th><th>Найдено</th><th style="text-align:left">Строка отчёта</th><th>Применить</th></tr></thead><tbody>
      ${TRUST.map(([id, title, sev]) => { const f = found[id]; return `<tr class="${f && f.st === "yes" ? "hit-" + sev : ""}"><td class="lab">${esc(title)}</td><td>${f ? stChip(f.st === "yes" ? sev : "ok", TST[f.st]) : stChip("nd", "нет в отчёте")}</td><td style="text-align:left;white-space:normal" class="small">${f ? esc(f.ev) : ""}</td><td>${f ? `<input type="checkbox" data-tapply="${id}" checked>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="hint">Отметки — подсказка по тексту отчёта. Проверьте строки, которые сайт счёл найденными; пункты, которых нет в отчёте, останутся как были.</p>`;
    setTimeout(() => $("#dlg").classList.add("wide"));
    const res = await dialog("Отчёт о благонадёжности: проверьте и примените", body, [{ t: "Отменить", v: null }, { t: "Применить", primary: true, v: d => ({ k: +d.querySelector("#tComp").value, ids: [...d.querySelectorAll("[data-tapply]")].filter(x => x.checked).map(x => x.dataset.tapply) }) }]);
    $("#dlg")?.classList.remove("wide");
    if (!res) { rep.push(file.name + ": не применено"); continue; }
    const t = C.trust[res.k];
    for (const id of res.ids) { t.items[id] = { st: found[id].st, note: found[id].st === "yes" ? found[id].ev.slice(0, 140) : "по отчёту: нет" }; }
    if (info.regDate && !t.regDate) t.regDate = info.regDate;
    if (info.director && !t.director) t.director = info.director;
    t.date = t.date || isoToday(); t.src = (t.src || []).concat({ file: file.name, t: Date.now() }); t.source = t.source || file.name;
    rep.push(`${file.name}: применено пунктов ${res.ids.length}`);
    C.log.unshift({ t: new Date().toISOString(), file: file.name, comp: compName(res.k), per: "", kind: "PDF", note: `благонадёжность: применено пунктов ${res.ids.length}` });
  }
  touch(); PAGE = "trust"; render();
  if (rep.length) await dialog("Результат", rep.map(x => `<div class="logline">${esc(x)}</div>`).join(""), [{ t: "Готово", primary: true, v: true }]);
}
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t || !C || t.dataset.act !== "trustdlg") return;
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${COMP_TAB === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `<p class="muted">Отчёт о проверке контрагента из «Параграфа» (PRG.Tekser) или другого сервиса — PDF, HTML или Excel. Файл читается в этом браузере и никуда не отправляется.</p>
    <label class="f" style="margin:12px 0"><span>Компания (если в отчёте нет БИН из карточки)</span><select class="inp" id="pComp">${compsOpts}</select></label>
    <label class="drop" id="pDrop"><input type="file" id="pFiles" multiple accept=".pdf,.html,.htm,.xlsx,.xlsm,.xls" style="display:none"><span id="pTxt">Перетащите файлы сюда или нажмите, чтобы выбрать</span></label>`;
  let files = [];
  setTimeout(() => { const inp = $("#pFiles"), drop = $("#pDrop"), set = fl => { files = Array.from(fl); $("#pTxt").textContent = files.map(f => f.name).join(", ") || "Файлы не выбраны"; };
    inp.onchange = () => set(inp.files); drop.ondragover = ev => { ev.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = () => drop.classList.remove("over"); drop.ondrop = ev => { ev.preventDefault(); drop.classList.remove("over"); set(ev.dataTransfer.files); }; });
  const k = await dialog("Загрузить отчёт о благонадёжности", body, [{ t: "Отменить", v: null }, { t: "Загрузить", primary: true, v: () => +$("#pComp").value }]);
  if (!k || !files.length) { if (k) toast("Файлы не выбраны"); return; }
  await trustImport(files, k);
});
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset; if (!C) return;
  const k = COMP_TAB > nComp() ? 1 : COMP_TAB;
  if (d.trust) { ensureTrust(); C.trust[k].items[d.trust].st = t.value; touch(); render(); return; }
  if (d.trustnote) { ensureTrust(); C.trust[k].items[d.trustnote].note = t.value; touch(); return; }
  if (d.trustf) { ensureTrust(); C.trust[k][d.trustf] = t.value.trim(); touch(); if (d.trustf === "regDate") render(); return; }
});
