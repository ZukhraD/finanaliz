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
  return `<div class="pagehead"><div class="lead"><h1>Благонадёжность</h1><p>Проверка компании по официальным реестрам и сервисам проверки контрагентов. Загрузите отчёт из «Параграфа» (PRG.Tekser) или аналогичного сервиса в PDF, HTML или Excel — сайт найдёт в нём факторы риска и предложит отметки. Отчёт читается в этом браузере и никуда не отправляется. Кнопка «Подтянуть по БИН» сама загружает открытую страницу компании на ba.prg.kz (наружу уходит только БИН) и заполняет регистрационные данные и проверки КГД, госзакупок и Минюста.</p></div>
    <div class="toolbar"><button class="btn" data-binlookup="${k - 1}">Подтянуть по БИН</button><button class="btn ghost" data-act="afmcheck">Сверить с перечнем АФМ</button><button class="btn primary" data-act="trustdlg">Загрузить отчёт</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="trust">${bannerHTML("trust")}</div>
  <section class="panel"><h2>${esc(compName(k))}</h2>
    <div class="chips" style="margin-bottom:12px">${stChip(s.crit ? "crit" : "ok", "Стоп-факторы: " + s.crit)} ${stChip(s.risk ? "risk" : "ok", "Риски: " + s.risk)} ${stChip(s.chk ? "chk" : "ok", "Проверить: " + s.chk)} ${stChip(s.na ? "nd" : "ok", "Не проверено: " + s.na)}</div>
    <div class="grid2" style="max-width:900px"><label class="f"><span>Дата регистрации</span><input class="inp" data-trustf="regDate" value="${esc(t.regDate || "")}" placeholder="дд.мм.гггг"></label>
      <label class="f"><span>Руководитель</span><input class="inp" data-trustf="director" value="${esc(t.director || "")}"></label>
      <label class="f"><span>Юридический адрес</span><input class="inp" data-trustf="${LANG === "kz" ? "addressKz" : "address"}" value="${esc(LANG === "kz" ? (t.addressKz || t.address || "") : (t.address || ""))}"></label>
      <label class="f"><span>Дата проверки</span><input class="inp" type="date" data-trustf="date" value="${esc(t.date || "")}"></label>
      <label class="f"><span>Источник</span><input class="inp" data-trustf="source" value="${esc(t.source || (t.src?.length ? t.src[t.src.length - 1].file : ""))}" placeholder="Параграф, КГД, egov…"></label></div>
    ${t.prg ? `<p class="small" style="margin-top:10px">По данным <a href="${esc(t.prg.url)}" target="_blank" rel="noopener noreferrer">Параграфа</a> на ${esc(t.prg.date.split("-").reverse().join("."))}: ${[t.prg.krp && "КРП " + t.prg.krp, t.prg.vat && "плательщик НДС — " + t.prg.vat.toLowerCase(), t.prg.regime && "режим — " + t.prg.regime.toLowerCase(), isNum(t.prg.debt) && "налоговая задолженность " + fmt(t.prg.debt / 1000) + " тыс. тг", t.prg.taxes?.length && "налоговые отчисления, тыс. тг: " + t.prg.taxes.map(z => z.y + " — " + fmt(z.v / 1000)).join(", ")].filter(Boolean).map(esc).join("; ")}.</p>` : ""}
    ${isNum(s.age) ? `<p class="hint" style="margin-top:8px">На рынке ${nf1.format(s.age)} ${s.age < 5 ? "года" : "лет"}.</p>` : ""}
    <div class="tablewrap" style="max-height:none;margin-top:12px"><table class="data trust"><thead><tr><th class="lab">Проверка</th><th>Уровень</th><th>Результат</th><th style="text-align:left">Комментарий / найдено в отчёте</th></tr></thead><tbody>
    ${TRUST.map(([id, title, sev]) => { const it = t.items[id]; return `<tr class="${it.st === "yes" ? "hit-" + sev : ""}"><td class="lab">${esc(title)}</td><td>${stChip(sev, sev === "crit" ? "стоп-фактор" : sev === "risk" ? "риск" : "проверить")}</td><td>${opt(id, it.st)}</td><td class="cell"><input class="inp" data-trustnote="${id}" value="${esc(tr(it.note || ""))}" style="text-align:left"></td></tr>`; }).join("")}
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

/* ---------- «Подтянуть по БИН»: единственный сетевой запрос сайта.
   Наружу уходит только БИН и только по нажатию; ответ показывается до применения. */
function binDate(s) {
  s = String(s || "").trim(); let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[3]}.${m[2]}.${m[1]}`;
  if ((m = /^(\d{2})[.\/](\d{2})[.\/](\d{4})/.exec(s))) return `${m[1]}.${m[2]}.${m[3]}`;
  return s;
}
/* ---------- «Подтянуть по БИН»: без сетевых запросов.
   Пользователь находит компанию на stat.gov.kz (или egov, «Параграф»), копирует текст результата, сайт его разбирает здесь. */
const BIN_PAGE = "https://stat.gov.kz/ru/cabinet/juridical/by/bin/";
function binNorm(j) {
  const o = j && (j.obj || j.data || j.result || j);
  if (!o || typeof o !== "object") return null;
  const pk = (...ks) => { for (const k of ks) if (o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim(); return ""; };
  const name = pk("name", "nameRu", "fullName"); if (!name) return null;
  let sec = o.secondOkeds ?? o.secondOked ?? ""; if (Array.isArray(sec)) sec = sec.join(",");
  return { bin: pk("bin", "BIN"), name, regDate: pk("registerDate", "regDate", "registrationDate"), okedCode: pk("okedCode", "oked"), okedName: pk("okedName"),
    secondOkeds: String(sec || "").split(/[,;\s]+/).filter(Boolean), krp: pk("krpName"), kse: pk("kseName"), kfs: pk("kfsName"),
    address: pk("katoAddress", "address", "legalAddress"), director: pk("fio", "director", "head"), ip: o.ip === true || o.ip === "true" };
}
const BIN_LABELS = [
  ["bin", /^(бин|иин|бин\s*\/\s*иин)(?![а-яё])/i],
  ["name", /^(полное\s+|краткое\s+)?(наименование|название)(?!\s+(крп|кфс|ксэ|кэд|окэд|вида|сектор|населен|района|области|банка))(\s+(юридического\s+лица|организации|на\s+русском\s+языке|компании))?/i],
  ["regDate", /^дата\s+(первичной\s+|государственной\s+)?(гос\.?\s*)?регистрации/i],
  ["second", /^(вторичн\S*|дополнительн\S*)\s+(код\S*\s+)?(окэд|вид\S*)/i],
  ["oked", /^((основн\S*|первичн\S*)\s+)?(код\s+)?окэд|^(основной\s+)?вид\s+(экономической\s+)?деятельност/i],
  ["director", /^(фио\s+)?(первого\s+)?руководител|^(фамилия.{0,30}руководител)|^директор(?![а-яё])/i],
  ["address", /^(юридический\s+адрес|адрес(\s+местонахождения)?|местонахождени|место\s+нахождения)/i],
  ["krp", /^(наименование\s+)?крп|^размерност/i],
  ["kfs", /^(наименование\s+)?кфс|^форма\s+собственност/i],
];
function binParseText(txt) {
  const t = String(txt || "").trim(); if (!t) return null;
  if (t.includes("{")) { try { const d = binNorm(JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1))); if (d) return d; } catch (e) { /* дальше как текст */ } }
  const L = t.split(/\r?\n/).map(x => x.replace(/ /g, " ").replace(/[ ]{2,}/g, " ").trim()).filter(Boolean);
  const lab = s => BIN_LABELS.find(([, re]) => re.test(s));
  const out = {};
  for (let i = 0; i < L.length; i++) {
    const hit = lab(L[i]); if (!hit) continue;
    const [id, re] = hit; if (out[id]) continue;
    let v = L[i].replace(re, "").replace(/^[а-яёА-ЯЁ]*/u, "").replace(/^[^\wа-яёА-ЯЁ«"(]*/u, "").replace(/^(компании|организации)\s*[:\-–]?\s*/i, "").trim();
    if (!v && L[i + 1] && !lab(L[i + 1])) v = L[i + 1];
    if (v) out[id] = v;
  }
  const date = s => { const m = /(\d{2})[.\/](\d{2})[.\/](\d{4})|(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? (m[1] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[6]}.${m[5]}.${m[4]}`) : ""; };
  const codes = s => (String(s || "").match(/\b\d{2}\.?\d{2}\.?\d?\b|\b\d{5}\b/g) || []).map(okedDigits).filter(c => c.length >= 4);
  const ok = codes(out.oked), binM = /\b(\d{12})\b/.exec(out.bin || t);
  const d = { bin: binM ? binM[1] : "", name: out.name || "", regDate: date(out.regDate), okedCode: ok[0] || "", okedName: (out.oked || "").replace(/^[\d.\s\-–:]+/, "").trim(), secondOkeds: codes(out.second),
    krp: out.krp || "", kse: "", kfs: out.kfs || "", address: out.address || "", director: out.director || "", ip: /индивидуальн\S*\s+предприниматель/i.test(t) && !/тоо|товариществ|акционерн/i.test(t.slice(0, 300)) };
  return d.name || d.regDate || d.okedCode || d.director ? d : null;
}
/* ---------- «Подтянуть по БИН» автоматически: открытая страница компании на ba.prg.kz через сервер сайта (api/prg.js) */
const PRG_RULES = [
  [/ограничена\s+выписка\s+эсф/, ["violator"], "ограничена выписка ЭСФ"],
  [/перерегистрация\s+которых\s+признана\s+недействительной/, ["fake"], "перерегистрация признана недействительной"],
  [/регистрация\s+которых\s+признана\s+недействительной/, ["fake"], "регистрация признана недействительной"],
  [/лжепредприят/, ["fake"], "лжепредприятие"],
  [/имеющих\s+налоговую\s+задолженность/, ["taxdebt"], "в списке должников по налогам КГД"],
  [/банкрот/, ["bankrupt"], "банкрот"],
  [/отсутствующих\s+по\s+юридическому\s+адресу/, ["address"], "отсутствует по юридическому адресу"],
  [/бездействующ/, ["inactive"], "бездействующий налогоплательщик"],
  [/недобросовестн\S*\s+участник/, ["procure"], "недобросовестный участник госзакупок"],
  [/реестр\S*\s+должник/, ["erd", "travel"], "единый реестр должников / ограничение выезда"],
  [/нарушител\S*\s+налогов/, ["violator"], "нарушитель налогового законодательства"],
  [/(террор|экстремизм|распространени\S*\s+оружия)/, ["terror"], "перечень лиц, связанных с терроризмом"],
  [/степен\S*\s+риска/, ["riskdeg"], "степень риска КГД"],
  [/(ликвидац|реорганизац)/, ["status"], "ликвидация / реорганизация"],
];
function prgParse(j) {
  const L = (j.lines || []).map(s => String(s).trim()), low = s => s.toLowerCase().replace(/ё/g, "е");
  const at = re => L.findIndex(l => re.test(l));
  const next = re => { const i = at(re); return i >= 0 ? (L[i + 1] || "") : ""; };
  const date = s => (/(\d{2}\.\d{2}\.\d{4})/.exec(s || "") || [])[1] || "";
  const ruName = (() => { const i = at(/^название\s+организации$/i); const r = i >= 0 ? L.slice(i + 1, i + 8).find(l => /^рус\s+/i.test(l)) : ""; return r ? r.replace(/^рус\s+/i, "") : ""; })();
  const kzName = (() => { const i = at(/^название\s+организации$/i); const r = i >= 0 ? L.slice(i + 1, i + 8).find(l => /^қаз\s+/i.test(l)) : ""; return r ? r.replace(/^қаз\s+/i, "") : ""; })();
  const p = { name: ruName || j.h1 || "", nameKz: kzName, url: j.url };
  p.regDate = date(next(/^первичная\s+регистрация$/i)) || date(next(/^дата\s+(первичной\s+)?регистрации$/i));
  p.director = next(/^руководитель(\s+компании)?$/i).replace(/^(рус|қаз)\s+/i, "");
  p.krp = next(/^крп$/i); p.kse = next(/^ксе$/i); p.kfs = next(/^кфс$/i);
  const okList = (() => { const i = at(/^основной\s+окэд$/i); if (i < 0) return []; const r = []; for (let n = i + 1; n < Math.min(L.length, i + 6) && !/^проверено/i.test(L[n]); n++) if (/^(рус\s+|қаз\s+)?\d{5}/i.test(L[n])) r.push(L[n].replace(/^(рус|қаз)\s+/i, "")); return r; })();
  const ok = okList.find(l => !KZ_LET.test(l)) || okList[0] || "", mo = /^(\d{5})\s*(.*)$/.exec(ok);
  p.okedCode = mo ? mo[1] : ""; p.okedName = mo ? mo[2] : "";
  p.secondOkeds = []; { const i = at(/^вторичн\S*\s+окэд$/i); if (i >= 0) for (let n = i + 1; n < L.length && /^\d{5}(\s|$)/.test(L[n]); n++) p.secondOkeds.push(L[n].slice(0, 5)); }
  { const i = at(/^юридический\s+адрес$/i); if (i >= 0) { p.address = (L.slice(i + 1, i + 4).find(l => /^рус\s/i.test(l)) || L[i + 1] || "").replace(/^рус\s+/i, ""); const kz = L.slice(i + 1, i + 12).find(l => /^қаз\s/i.test(l)); p.addressKz = kz ? kz.replace(/^қаз\s+/i, "") : ""; } }
  p.vat = next(/^плательщик\s+ндс$/i); p.regime = next(/^вид\s+налогового\s+режима$/i);
  p.taxes = []; { const i = at(/^сумма\s+налоговых\s+отчислений$/i); if (i >= 0) for (let n = i + 1; n < Math.min(L.length, i + 80) && !/^(показать|история)/i.test(L[n]); n++) { const y = /^(\d{4})\s*г\.?$/.exec(L[n]); if (y) { const v = parseNum((L[n + 1] || "").replace(/[₸\s]/g, "").replace(",", ".")); if (isNum(v)) p.taxes.push({ y: +y[1], v }); } } }
  p.debt = null; p.debtFull = null;
  { const i = at(/^всего\s+задолженностей/i); let src = "";
    if (i >= 0) for (let n = i + 1; n < Math.min(L.length, i + 40) && !/^благонадежность\s+предприятия$/i.test(L[n]); n++) {
      const m = /^(-?[\d\s]+[.,]\d{2})\s*₸$/.exec(L[n]);
      if (!m) { if (!/^дата\s+сверки/i.test(L[n])) src = L[n]; continue; }
      const v = +m[1].replace(/\s/g, "").replace(",", ".");
      p.debt = Math.max(p.debt ?? 0, v);
      if (/сведени\S*\s+об\s+отсутствии/i.test(src)) p.debtFull = Math.max(p.debtFull ?? 0, v);
    } }
  // массовость: блок «Смежные предприятия» — «С похожим адресом N», «По ФИО руководителя N»
  { const z = L.find(l => /похожим\s+адресом\s+\d+|по\s+фио\s+руководителя\s+\d+/i.test(l)) || "";
    const a = /похожим\s+адресом\s+(\d+)/i.exec(z), d = /по\s+фио\s+руководителя\s+(\d+)/i.exec(z);
    p.sameAddr = a ? +a[1] : (z ? 0 : null); p.sameDir = d ? +d[1] : (z ? 0 : null); }
  // благонадёжность: «Список налогоплательщиков, … Нет» + «Проверено: дата»
  const items = {}, hits = [];
  const s0 = L.findIndex((l, n) => /^благонадежность\s+предприятия$/i.test(low(l)) && /нарушени/i.test(L[n + 1] || ""));
  const s1 = L.findIndex((l, n) => n > s0 && /^смежные\s+предприятия$/i.test(l));
  for (let n = s0 >= 0 ? s0 + 1 : 0; n < (s1 > 0 ? s1 : L.length); n++) {
    const t = low(L[n]); if (/^проверено/.test(t) || t.length < 6) continue;
    const r = PRG_RULES.find(([re]) => re.test(t)); if (!r) continue;
    let v = (/(?:^|\s)(да|нет|есть|не\s+числится|числится)$/.exec(t) || [])[1];
    if (!v && /^(да|нет|есть)$/i.test(L[n + 1] || "")) v = low(L[n + 1]);
    if (!v) continue;
    const st = /^(нет|не\s+числится)$/.test(v) ? "no" : "yes", chk = date(L[n + 1]) || date(L[n + 2]);
    for (const id of r[1]) if (!items[id] || st === "yes") items[id] = { st, note: (st === "yes" ? "ВЫЯВЛЕНО: " + r[2] : "нет") + " (Параграф" + (chk ? ", проверено " + chk : "") + ")" };
    if (st === "yes") hits.push(r[2]);
  }
  if (isNum(p.debt) && p.debt > 0) { items.taxdebt = { st: "yes", note: `ВЫЯВЛЕНО: налоговая задолженность ${nf0.format(p.debt)} тг (Параграф)` }; hits.push(`налоговая задолженность ${nf0.format(p.debt)} тг`); }
  else if (isNum(p.debt) && !items.taxdebt) items.taxdebt = { st: "no", note: "задолженность 0 тг (Параграф)" };
  // пенсионные и социальные: «Сведения об отсутствии (наличии) задолженности» КГД включают ОПВ, СО и ОСМС
  if (isNum(p.debtFull)) {
    if (p.debtFull > 0) { items.pension = { st: "yes", note: `ВЫЯВЛЕНО: задолженность ${nf0.format(p.debtFull)} тг по сведениям КГД (налоги и/или ОПВ, СО, ОСМС) — уточните разбивку` }; hits.push(`задолженность по сведениям КГД ${nf0.format(p.debtFull)} тг (в т.ч. возможно ОПВ/СО/ОСМС)`); }
    else items.pension = { st: "no", note: "нет: по сведениям КГД задолженности по налогам, ОПВ, СО и ОСМС нет (Параграф)" };
  }
  // массовый адрес / руководитель
  if (isNum(p.sameAddr) || isNum(p.sameDir)) {
    const c = TCFG(), ma = isNum(p.sameAddr) && p.sameAddr > c.addr, md = isNum(p.sameDir) && p.sameDir > c.dir;
    const txt = `по похожему адресу ${p.sameAddr ?? "—"} компаний (порог ${c.addr}), у руководителя ${p.sameDir ?? "—"} (порог ${c.dir})`;
    items.mass = ma || md ? { st: "yes", note: "ВЫЯВЛЕНО: " + txt + " (Параграф)" } : { st: "no", note: "нет: " + txt + " (Параграф)" };
    if (ma || md) hits.push((ma ? "массовый адрес" : "") + (ma && md ? ", " : "") + (md ? "массовый руководитель" : "") + ` (${txt})`);
  }
  // ликвидация, реорганизация
  if (!items.status || items.status.st !== "yes") {
    const aboutI = at(/^о\s+компании\s/i), endTop = (() => { let n = -1; L.forEach((l, j) => { if (/^смежные\s+предприятия$/i.test(l)) n = j; }); return n > 0 ? n : L.length; })();
    const zone = L.slice(0, endTop).concat(aboutI >= 0 ? L.slice(aboutI, aboutI + 4) : []).filter(l => !/^(\d{5}\s|окэд:|основной\s+окэд|вторичн)/i.test(l));
    const STRE = /(ликвидирован|стади\S*\s+ликвидац|процесс\S*\s+ликвидац|ликвидационн|реорганизован|стади\S*\s+реорганизац|прекратил\S*\s+деятельност|деятельност\S*\s+прекращен|снят\S*\s+с\s+(регистрационного\s+)?(учет|регистрац)|исключен\S*\s+из\s+реестр|недействующ)/i;
    const hit = zone.find(l => STRE.test(l));
    if (hit) { items.status = { st: "yes", note: "ВЫЯВЛЕНО: " + hit.slice(0, 120) + " (Параграф)" }; hits.push("ликвидация / реорганизация: " + hit.slice(0, 80)); }
    else if (p.regDate && p.director) items.status = { st: "no", note: "нет: признаков ликвидации или реорганизации на странице Параграфа нет" };
  }
  p.items = items; p.hits = [...new Set(hits)];
  return p;
}
async function binLookup(i) {
  const x = C.companies[i]; if (!x) return;
  const bin = String(x.bin || (i === 0 ? C.card.bin : "") || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(bin)) { toast("Сначала укажите БИН/ИИН из 12 цифр"); return; }
  if (location.protocol === "file:") return binPaste(i, bin, "в файле, открытом с компьютера, сайт не выходит в интернет — откройте сайт по ссылке");
  toast("Проверяю БИН " + bin + " на ba.prg.kz…");
  let j = null, r;
  try { r = await fetch("/api/prg?bin=" + bin, { headers: { accept: "application/json" }, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" }); try { j = await r.json(); } catch (e) { /* ниже */ } }
  catch (e) { return binPaste(i, bin, "нет связи с сервером сайта"); }
  if (!j || !j.ok) {
    if (r.status === 404) { await dialog("Компания не найдена", `<p>${esc(j?.error || "На ba.prg.kz нет компании с таким БИН")}: <b>${esc(bin)}</b>. Проверьте БИН в карточке.</p>`, [{ t: "Закрыть", primary: true, v: true }]); return; }
    return binPaste(i, bin, j?.error || "сервер ответил " + r.status);
  }
  const p = prgParse(j), k = i + 1; ensureTrust(); const t = C.trust[k], done = [];
  if (!p.name && !p.regDate && !p.director) return binPaste(i, bin, "страница ba.prg.kz загрузилась, но данные на ней не распознаны");
  if (p.name) { if (!x.name) { x.name = p.name; done.push("наименование"); } if (i === 0 && !C.card.name) C.card.name = p.name;
    const f = /^(ТОО|АО|ИП)(?![А-ЯЁа-яё])/.exec(p.name.replace(/^["«]/, "")); if (f && S.lists.form.includes(f[1]) && x.form !== f[1]) { x.form = f[1]; done.push("форма " + f[1]); } }
  if (p.regDate) { t.regDate = p.regDate; done.push("дата регистрации"); }
  if (p.director) { t.director = p.director; done.push("руководитель"); }
  if (p.address) { t.address = p.address; done.push("адрес"); }
  if (p.addressKz) t.addressKz = p.addressKz;
  if (p.nameKz) x.nameKz = p.nameKz;
  if (/^(да|нет)$/i.test(p.vat)) { x.vat = /^да$/i.test(p.vat) ? "Да" : "Нет"; done.push("плательщик НДС"); }
  if (p.regime) { const rg = /общеустанов/i.test(p.regime) ? "Общеустановленный" : /упрощ/i.test(p.regime) ? "Упрощённая декларация" : "Иной специальный режим"; if (S.lists.regime.includes(rg)) { x.regime = rg; done.push("налоговый режим"); } }
  if (i === 0 && p.okedCode) { const codes = [p.okedCode, ...p.secondOkeds].slice(0, MAX_OKED); C.card.oked = codes.map((c, n) => ({ code: okedFmt(okedDigits(c)), name: (() => { const a = n === 0 ? p.okedName : "", b = okedLookup(c)?.name || "", d = OKED_DIV[okedDigits(c).slice(0, 2)] || ""; return [a, b].find(z => z && !KZ_LET.test(z)) || (KZ_LET.test(a + b) ? d : a || b) || ""; })() })); done.push("ОКЭД"); }
  for (const [id, it] of Object.entries(p.items)) t.items[id] = it;
  const afm = afmCheck(k, p.name); if (afm) { t.items.terror = afm; if (afm.st === "yes") p.hits.push(afm.note.replace(/^ВЫЯВЛЕНО:\s*/, "")); }
  t.prg = { url: p.url, date: isoToday(), krp: p.krp, kse: p.kse, kfs: p.kfs, vat: p.vat, regime: p.regime, taxes: p.taxes, debt: p.debt };
  t.date = isoToday(); t.source = "Параграф (ba.prg.kz)"; t.src = (t.src || []).concat({ file: "ba.prg.kz", t: Date.now() });
  const nChk = Object.keys(p.items).length;
  C.log.unshift({ t: new Date().toISOString(), file: "ba.prg.kz", comp: compName(k), per: "", kind: "БИН", note: `заполнено: ${done.join(", ") || "—"}; проверок благонадёжности: ${nChk}${p.hits.length ? "; выявлено: " + p.hits.join("; ") : ""}` });
  touch(); render();
  const taxes = p.taxes.length ? `<p class="small">Налоговые отчисления: ${p.taxes.map(z => `${z.y}: ${fmt(z.v / 1000)}`).join("; ") + " (тыс. тг)"}.</p>` : "";
  await dialog(p.hits.length ? "Данные по БИН загружены — есть риски" : "Данные по БИН загружены",
    `<p><b>${esc((LANG === "kz" && p.nameKz) || p.name || x.name)}</b> · БИН ${esc(bin)}</p>
    ${p.hits.length ? `<p style="color:#b42318"><b>Выявлено:</b> ${esc(p.hits.join("; "))}.</p>` : `<p style="color:#067647"><b>Нарушений не выявлено</b> по ${nChk} проверкам Параграфа.</p>`}
    <p class="small">Заполнено: ${esc(done.join(", ") || "—")}. ${p.krp ? "Размерность: " + esc(p.krp) + "." : ""}</p>${taxes}
    <p class="small muted">Источник: <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">страница компании на ba.prg.kz</a>. ${afm ? "" : "Перечень АФМ не загружен — пункт о терроризме и санкциях не проверен (загрузите его на странице «Настройка загрузки»). "}Суды, история изменений и степень риска КГД в автоматическую проверку не входят.</p>`,
    [{ t: "Открыть «Благонадёжность»", v: "trust" }, { t: "Готово", primary: true, v: true }]).then(v => { if (v === "trust") { PAGE = "trust"; COMP_TAB = k; render(); } });
}
async function binPaste(i, bin, why) {
  const x = C.companies[i]; if (!x) return;
  const body = `${why ? `<p class="small" style="color:var(--risk,#b42318)">Автоматически не получилось: ${esc(why)}. Можно вставить текст вручную.</p>` : ""}<ol style="margin:0 0 10px 18px;padding:0">
      <li>Откройте <a href="${BIN_PAGE}" target="_blank" rel="noopener noreferrer">поиск юрлиц на stat.gov.kz</a> (новая вкладка) и найдите компанию по БИН <b>${esc(bin)}</b> <button class="btn ghost" type="button" id="binCopy" style="padding:2px 8px">скопировать БИН</button></li>
      <li>На странице с результатом выделите всё (Ctrl+A) и скопируйте (Ctrl+C).</li>
      <li>Вставьте сюда (Ctrl+V) и нажмите «Разобрать».</li></ol>
    <textarea class="inp" id="binPaste" rows="9" style="width:100%;font-size:12px" placeholder="Сюда вставьте текст со страницы результата: наименование, дата регистрации, ОКЭД, руководитель, адрес…"></textarea>
    <p class="small muted" style="margin-top:6px">Подойдёт текст и с других открытых источников (egov, «Параграф»). Сайт сам никуда не обращается — текст разбирается в этом браузере.</p>`;
  setTimeout(() => { const b = $("#binCopy"); if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(bin); toast("БИН скопирован"); } catch (e) { toast("Не удалось скопировать — выделите БИН вручную"); } }; });
  const txt = await dialog("Регистрационные данные по БИН", body, [{ t: "Отменить", v: null }, { t: "Разобрать", primary: true, v: d => d.querySelector("#binPaste").value }]);
  if (!txt || !txt.trim()) { if (txt !== null && txt !== undefined) toast("Текст не вставлен"); return; }
  const pd = binParseText(txt);
  if (!pd) { await dialog("Не удалось разобрать", `<p>В тексте не нашлось наименования, даты регистрации, ОКЭД или руководителя.</p><p class="small muted">Скопируйте всю страницу с результатом поиска (Ctrl+A, Ctrl+C) или заполните поля в карточке и на странице «Благонадёжность» вручную.</p>`, [{ t: "Закрыть", primary: true, v: true }]); return; }
  if (pd.bin && pd.bin !== bin && !await dialog("БИН не совпадает", `<p>В тексте БИН <b>${esc(pd.bin)}</b>, а у компании в карточке — <b>${esc(bin)}</b>. Всё равно показать данные?</p>`, [{ t: "Отменить", v: false }, { t: "Показать", primary: true, v: true }])) return;
  const j = { source: "текст из открытого источника (stat.gov.kz)", data: pd };
  const d = j.data, k = i + 1; ensureTrust(); const t = C.trust[k];
  const okeds = [d.okedCode, ...(d.secondOkeds || [])].map(okedDigits).filter(s => s.length >= 2);
  const okedTxt = okeds.map((c, n) => okedFmt(c) + (n === 0 && d.okedName ? " " + d.okedName : "")).join("; ");
  const regDate = binDate(d.regDate);
  const rows = [
    ["name", "Наименование", x.name, d.name],
    ["regDate", "Дата регистрации", t.regDate, regDate],
    ["director", "Руководитель", t.director, d.director],
    ["address", "Юридический адрес", t.address, d.address],
    ...(i === 0 ? [["oked", "ОКЭД (основной и дополнительные)", okedListText(C), okedTxt]] : []),
  ].filter(r => r[3]);
  const extra = [d.krp && "размерность: " + d.krp, d.kfs && "форма собственности: " + d.kfs, d.kse && "сектор: " + d.kse].filter(Boolean);
  const pbody = `<p class="small muted">${esc(j.source)} · БИН ${esc(d.bin || bin)}${d.ip ? " · индивидуальный предприниматель" : ""}</p>
    <div class="tablewrap" style="max-height:52vh;margin-top:8px"><table class="data trust"><thead><tr><th class="lab">Поле</th><th style="text-align:left">Сейчас в карточке</th><th style="text-align:left">Из вставленного текста</th><th>Применить</th></tr></thead><tbody>
    ${rows.map(([id, lab, cur, nw]) => `<tr><td class="lab">${esc(lab)}</td><td style="text-align:left;white-space:normal" class="small">${esc(cur || "—")}</td><td style="text-align:left;white-space:normal">${esc(nw)}</td><td><input type="checkbox" data-bapply="${id}" ${!cur || id === "regDate" || id === "director" ? "checked" : ""}></td></tr>`).join("")}
    </tbody></table></div>${extra.length ? `<p class="small muted" style="margin-top:8px">${esc(extra.join(" · "))}</p>` : ""}
    <p class="hint">Статус (действующее, ликвидация), долги и включение в реестры КГД этот источник не показывает — их проверяйте по отчёту на странице «Благонадёжность».</p>`;
  setTimeout(() => $("#dlg").classList.add("wide"));
  const ids = await dialog("Данные по БИН: проверьте и примените", pbody, [{ t: "Отменить", v: null }, { t: "Применить", primary: true, v: dd => [...dd.querySelectorAll("[data-bapply]")].filter(c => c.checked).map(c => c.dataset.bapply) }]);
  $("#dlg")?.classList.remove("wide");
  if (!ids || !ids.length) return;
  if (ids.includes("name")) { x.name = d.name; if (i === 0 && !C.card.name) C.card.name = d.name; }
  if (ids.includes("regDate")) t.regDate = regDate;
  if (ids.includes("director")) t.director = d.director;
  if (ids.includes("address")) t.address = d.address;
  if (ids.includes("oked")) C.card.oked = okeds.slice(0, MAX_OKED).map((c, n) => ({ code: okedFmt(c), name: (n === 0 && d.okedName) || okedLookup(c)?.name || "" }));
  t.reg = { source: j.source, date: isoToday() };
  C.log.unshift({ t: new Date().toISOString(), file: "текст stat.gov.kz", comp: compName(k), per: "", kind: "БИН", note: "по БИН применено: " + ids.length + " полей" });
  touch(); render(); toast("Данные по БИН применены");
}
document.addEventListener("click", e => {
  const b = e.target.closest("button[data-binlookup]"); if (!b || !C) return;
  binLookup(+b.dataset.binlookup);
});

/* ---------- пороги массовости */
const TCFG_KEY = "finkz.trustcfg.v1", TCFG_DEF = { addr: 10, dir: 5 };
function TCFG() { try { return Object.assign({}, TCFG_DEF, JSON.parse(localStorage.getItem(TCFG_KEY) || "{}")); } catch (e) { return { ...TCFG_DEF }; } }
function trustNormsPanel() {
  const c = TCFG();
  return `<section class="panel" style="margin-top:16px"><h2>Пороги благонадёжности</h2><p class="hint">По данным Параграфа («Смежные предприятия»): если компаний с похожим адресом или у того же руководителя больше порога, пункт «Массовый адрес, руководитель» получает отметку «есть».</p>
    <div class="grid2" style="max-width:640px"><label class="f"><span>Компаний по похожему адресу, больше</span><input class="inp" data-tcfg="addr" inputmode="numeric" value="${c.addr}"></label>
    <label class="f"><span>Компаний у руководителя, больше</span><input class="inp" data-tcfg="dir" inputmode="numeric" value="${c.dir}"></label></div></section>`;
}
document.addEventListener("change", e => {
  const t = e.target; if (t.dataset.tcfg === undefined) return;
  const v = parseNum(t.value); if (v === null || v < 0) { toast("Укажите целое число"); return; }
  const c = TCFG(); c[t.dataset.tcfg] = Math.round(v); try { localStorage.setItem(TCFG_KEY, JSON.stringify(c)); } catch (err) { /* только до перезагрузки */ }
  toast("Порог сохранён — применится при следующей загрузке по БИН");
});

/* ---------- перечень АФМ (терроризм, экстремизм, ФРОМУ) и другие санкционные списки — загружается файлом, сверка в браузере */
const AFM_KEY = "finkz.afm.v1";
let AFM = (() => { try { return JSON.parse(localStorage.getItem(AFM_KEY) || "null"); } catch (e) { return null; } })();
const nmNorm = s => String(s || "").toUpperCase().replace(/Ё/g, "Е").replace(/[«»"'`“”().,;:№\-–—]/g, " ").replace(/\s+/g, " ").replace(/(^|\s)(ТОВАРИЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ|АКЦИОНЕРНОЕ ОБЩЕСТВО|ТОО|АО|ИП|ОО|ОФ|LLP|LLC|JSC)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
const fioKey = s => nmNorm(s).split(" ").filter(w => /^[A-ZА-ЯӘІҢҒҮҰҚӨҺ]{2,}$/.test(w)).slice(0, 3).sort().join(" ");
function afmParseLines(lines) {
  const ids = new Set(), names = new Set(), orgs = new Set();
  for (const raw of lines) {
    const line = String(raw || ""); if (!line.trim()) continue;
    for (const m of line.matchAll(/(?<!\d)(\d{12})(?!\d)/g)) ids.add(m[1]);
    for (const part of line.replace(/^\s*\d+[.)]\s*/, "").split(/[;|\t]/)) {
      const t = part.replace(/\(.*?\)/g, " ").replace(/\d{2}\.\d{2}\.\d{4}.*$/, "").replace(/(^|\s)(г\.?\s?р\.?|иин|бин|дата\s+рождения)(?=[\s:.]|$).*$/i, "").trim();
      const w = t.split(/[\s,]+/).filter(Boolean);
      if (/(организац|фронт|движени|джамаат|джихад|партия|государство|армия|бригад|(?:^|\s)аль[\s-]|(?:^|\s)ал-|ИГИЛ|ISIL|ISIS|компани|фонд|ТОО|LLP)/i.test(t) && t.length < 120) orgs.add(nmNorm(t));
      else if (w.length >= 2 && w.length <= 4 && w.every(x => /^[A-Za-zА-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ-]{2,}$/.test(x)) && w.filter(x => /^[A-ZА-ЯЁӘІҢҒҮҰҚӨҺ]/.test(x)).length >= 2) names.add(fioKey(t));
    }
  }
  return { ids: [...ids], names: [...names].filter(Boolean), orgs: [...orgs].filter(x => x.length > 3) };
}
async function loadAfmFiles(files) {
  let all = { ids: [], names: [], orgs: [] }; const used = [];
  for (const f of files) {
    let lines;
    if (/\.(xml|txt|csv)$/i.test(f.name)) { const txt = await f.text(); lines = txt.replace(/<[^>]+>/g, "\n").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").split(/\r?\n/); }
    else { const r = await readDoc(f); lines = r.pdf.pages.flatMap(pg => pg.lines.map(l => l.text)); }
    const z = afmParseLines(lines); all.ids.push(...z.ids); all.names.push(...z.names); all.orgs.push(...z.orgs); used.push(f.name);
  }
  all = { ids: [...new Set(all.ids)], names: [...new Set(all.names)], orgs: [...new Set(all.orgs)] };
  if (all.names.length + all.ids.length < 5) throw new Error("в файле не найдены ФИО или ИИН/БИН — это точно перечень?");
  AFM = { ...all, files: used, date: isoToday() };
  try { localStorage.setItem(AFM_KEY, JSON.stringify(AFM)); } catch (e) { throw new Error("перечень слишком большой для хранения в браузере"); }
  return AFM;
}
function afmCheck(k, nameOverride) {
  if (!AFM || !C) return null; ensureTrust();
  const x = C.companies[k - 1] || {}, t = C.trust[k], bin = String(x.bin || "").replace(/\D/g, "");
  const ids = new Set(AFM.ids), names = new Set(AFM.names), orgs = new Set(AFM.orgs || []);
  const found = [];
  if (bin && ids.has(bin)) found.push("БИН/ИИН " + bin + " есть в перечне");
  const nm = nmNorm(nameOverride || x.name); if (nm && orgs.has(nm)) found.push("наименование совпадает с организацией из перечня");
  if (t.director && fioKey(t.director).split(" ").length >= 2 && names.has(fioKey(t.director))) found.push("ФИО руководителя " + t.director + " совпадает с лицом из перечня — сверьте дату рождения и ИИН");
  if (x.form === "ИП" && x.name && fioKey(x.name).split(" ").length >= 2 && names.has(fioKey(x.name))) found.push("ФИО ИП совпадает с лицом из перечня");
  const src = `перечень АФМ от ${AFM.date.split("-").reverse().join(".")}`;
  return found.length ? { st: "yes", note: "ВЫЯВЛЕНО: " + found.join("; ") + " (" + src + ")" } : { st: "no", note: `нет: БИН${t.director ? ", ФИО руководителя" : ""} и наименование не найдены (${src})` };
}
function afmPanel() {
  return `<section class="panel"><h2>Перечень АФМ и санкционные списки</h2><p class="hint">${AFM ? `Загружен ${AFM.date.split("-").reverse().join(".")}: ${nf0.format(AFM.names.length)} ФИО, ${nf0.format(AFM.ids.length)} ИИН/БИН, ${nf0.format((AFM.orgs || []).length)} организаций (${esc(AFM.files.join(", "))}).` : "Не загружен — пункт «Терроризм, экстремизм, санкции» на странице «Благонадёжность» не проверяется."} Скачайте «Перечень организаций и физических лиц, связанных с финансированием терроризма и экстремизма» на сайте АФМ (можно добавить и другие списки, например ФРОМУ) и загрузите сюда — XML, Excel, PDF, HTML или CSV. Хранится в этом браузере, сверка идёт по БИН компании, наименованию и ФИО руководителя при каждой загрузке по БИН. Обновляйте перечень раз в месяц.</p>
    <button class="btn" data-act="afmfile">${AFM ? "Обновить перечень" : "Загрузить перечень"}</button></section>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.act === "afmfile") {
    const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = ".xml,.xlsx,.xls,.xlsm,.pdf,.html,.htm,.csv,.txt";
    inp.onchange = async () => { try { const a = await loadAfmFiles([...inp.files]); let n = 0;
      if (C) { ensureTrust(); for (let k = 1; k <= C.companies.length; k++) if (C.companies[k - 1].bin || C.trust[k].director) { const r = afmCheck(k); C.trust[k].items.terror = r; if (r.st === "yes") n++; } touch(); }
      toast(`Перечень загружен: ${nf0.format(a.names.length)} ФИО, ${nf0.format(a.ids.length)} ИИН/БИН` + (n ? ` · совпадения у ${n} компаний!` : "")); render(); } catch (err) { toast("Не удалось загрузить перечень: " + err.message); } };
    inp.click(); return;
  }
  if (b.dataset.act === "afmcheck" && C) {
    if (!AFM) { toast("Сначала загрузите перечень АФМ на странице «Настройка загрузки»"); return; }
    const k = COMP_TAB > nComp() ? 1 : COMP_TAB, r = afmCheck(k); C.trust[k].items.terror = r; touch(); render(); toast(r.st === "yes" ? "Есть совпадение с перечнем — проверьте" : "Совпадений с перечнем нет");
  }
});
