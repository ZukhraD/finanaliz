"use strict";
/* ---------------------------------------------------------------- интерфейс */
const $ = (s, el = document) => el.querySelector(s);
let PAGE = "card", COMP_TAB = 1, AN_TAB = "rat", FC_TAB = 0;
const SEV = { crit: "Критично", risk: "Риск", chk: "Проверить", nd: "Нет данных" };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600); }
function paintSaved() { const el = $("#saved"); if (el && lastSaved) el.textContent = "Сохранено в этом браузере, " + dTime(lastSaved); }
const opts = (list, cur) => list.map(x => `<option value="${esc(x)}"${String(x) === String(cur) ? " selected" : ""}>${esc(x)}</option>`).join("");
const stChip = (s, txt) => `<span class="st ${s}">${esc(txt ?? ST[s] ?? "")}</span>`;
const CHK_TXT = { ok: ["ok", "ОК"], bad: ["crit", "Расхождение"], nd: ["nd", "нет данных"], na: ["nd", "—"] };

function render() {
  if (LOCK.on && !LOCK.key) return renderLock();
  if (!C) return renderClients();
  PROB = problems();
  const steps = [["card", "Карточка"], ["trust", "Благонадёжность"], ["bal", "Баланс"], ["odr", "ОПиУ"], ["cf", "ДДС"], ["tax", "Налоги"], ["bank", "Банк"], ["credit", "Кредитная история"], ["coll", "Залог и гаранты"], ["cons", "Свод и прогноз"], ["an", "Анализ"], ["prob", "Проблемы"], ["concl", "Заключение"]];
  if (isOD()) steps.splice(0, steps.length, ["card", "Карточка"], ["trust", "Благонадёжность"], ["fin", "Баланс + ОПиУ"], ["bank", "Банк"], ["credit", "Кредитная история"], ["prob", "Проблемы"], ["concl", "Заключение"]);
  if (!steps.some(st => st[0] === PAGE) && PAGE !== "map" && PAGE !== "log" && PAGE !== "norms" && !(isOD() && (PAGE === "bal" || PAGE === "odr"))) PAGE = "card";
  document.body.innerHTML = `
  <div class="app">
    <nav class="rail" aria-label="Разделы">
      <div class="brand">Финансовый анализ<small>компании и группы РК · локально</small>${langSwitch()}</div>
      <button class="back" data-act="clients">← К списку клиентов</button>
      <div class="client"><b>${esc(C.card.name)}</b><span class="small">${nComp()} комп. · ${C.periods.length} пер.</span></div>
      <ol class="steps">${steps.map(([id, t]) => `<li class="num"><button data-page="${id}" ${PAGE === id ? 'aria-current="page"' : ""}>${t}<span class="pdot" data-pdot="${id}"></span></button></li>`).join("")}</ol>
      <ul class="steps"><li><button data-page="map" ${PAGE === "map" ? 'aria-current="page"' : ""}>Настройка загрузки</button></li><li><button data-page="norms" ${PAGE === "norms" ? 'aria-current="page"' : ""}>Нормативы</button></li><li><button data-page="log" ${PAGE === "log" ? 'aria-current="page"' : ""}>Журнал</button></li></ul>
      <div class="foot"><button data-act="export">Сохранить файл клиента</button><span id="saved" class="saved"></span><p class="copy">© 2026 Создан ОФКК Костанай</p></div>
    </nav>
    <main class="main" id="main">${PAGES[PAGE]()}</main>
  </div><div id="toast" class="toast" role="status"></div>${DIALOG}`;
  paintSaved(); paintProblemMarks();
}
function pageProblems(page) { return PROB.filter(p => p.page === page || (page === "cons" && p.page === "elim")); }
function paintProblemMarks() {
  const rank = { crit: 0, risk: 1, chk: 2, nd: 3 };
  document.querySelectorAll("[data-pdot]").forEach(el => {
    const id = el.dataset.pdot;
    const list = id === "prob" ? PROB.filter(p => p.sev !== "nd") : pageProblems(id).filter(p => p.sev !== "nd");
    if (!list.length) { el.className = "pdot"; el.textContent = ""; return; }
    const worst = list.reduce((a, p) => (rank[p.sev] < rank[a] ? p.sev : a), "chk");
    el.className = "pdot " + worst; el.textContent = list.length; el.title = list.length + " — " + SEV[worst].toLowerCase();
  });
  BAD = badCells();
  document.querySelectorAll("td.cell input[data-key]").forEach(inp => markCell(inp, inp.dataset.k + "|" + inp.dataset.key + "|" + inp.dataset.pid));
  document.querySelectorAll("[data-v]").forEach(td => markCell(td, td.dataset.v));
  const b = $("#probBanner"); if (b) b.innerHTML = bannerHTML(b.dataset.page);
}
let BAD = new Map();
function markCell(el, id) {
  const p = BAD.get(id);
  el.classList.toggle("bad", !!p); el.classList.toggle("bad-crit", !!p && p.sev === "crit");
  if (p) el.title = p.title + (p.detail ? " — " + p.detail : "") + "\nЧто сделать: " + p.fix; else if (el.dataset.src) el.title = el.dataset.src; else el.removeAttribute("title");
}
function bannerHTML(page) {
  const list = pageProblems(page).filter(p => !COMP_FILTER || !p.title.startsWith("К") );
  if (!list.length) return "";
  const shown = list.slice(0, 4);
  return `<div class="probs"><div class="probs-h"><b>${list.length === 1 ? "Требует внимания" : "Требуют внимания: " + list.length}</b><button class="btn ghost" data-page="prob">Все проблемы и решения</button></div>
    ${shown.map(probItem).join("")}${list.length > shown.length ? `<p class="small muted">и ещё ${list.length - shown.length} — на странице «Проблемы и решения».</p>` : ""}</div>`;
}
const COMP_FILTER = false;
function probItem(p) {
  return `<div class="prob ${p.sev}"><span class="st ${p.sev}">${SEV[p.sev]}</span><div><b>${esc(p.title)}</b>${p.detail ? `<span class="small muted"> · ${esc(p.detail)}</span>` : ""}<p class="fix">${esc(p.fix)}</p></div></div>`;
}
const DIALOG = `<dialog id="dlg"><div class="dh"><h2 id="dlgT"></h2></div><div class="db" id="dlgB"></div><div class="df" id="dlgF"></div></dialog>`;

/* ---------- клиенты */
function renderClients() {
  const list = CLIENTS.slice().sort((a, b) => b.updated - a.updated);
  const last = list[0];
  const okedOf = c => (c.card.oked && c.card.oked[0] && c.card.oked[0].code ? "ОКЭД " + c.card.oked[0].code + (c.card.oked[0].name ? " · " + okedNameL(c.card.oked[0].code, c.card.oked[0].name) : "") : (c.card.activity || ""));
  const stOf = c => { const s = c.concl?.status || "Черновик"; return s === "Утверждено" ? ["ok", s] : s === "На проверке" ? ["chk", s] : ["nd", s]; };
  const done = list.filter(c => c.concl?.status === "Утверждено").length;
  const when = d => dDayMonth(d);
  const rows = list.map(c => `<li class="crow" data-q="${esc((c.card.name + " " + okedOf(c) + " " + (c.card.bin || "")).toLowerCase())}">
      <div class="cmain"><b>${esc(c.card.name)}</b>${c.demo ? ' <span class="tag">пример</span>' : ""}<span class="cmeta">${esc(okedOf(c))}</span></div>
      <div class="cfacts"><span><i>Компаний</i>${c.companies.length}</span><span><i>Периоды</i>${esc(c.periods.map(p => p.label).join(", "))}</span><span><i>Изменён</i>${esc(when(c.updated))}</span></div>
      <div class="cstat">${stChip(...stOf(c))}</div>
      <div class="cact"><button class="btn primary" data-open="${c.id}">Открыть</button><button class="btn ghost" data-exp="${c.id}" title="Сохранить файл клиента">Файл</button><button class="btn ghost danger" data-del="${c.id}">Удалить</button></div></li>`).join("");
  document.body.innerHTML = `<div class="home">
    <header class="hbar"><div class="mark" aria-hidden="true"><span></span></div><b>Финансовый анализ</b><span class="hnote">работает без интернета · данные остаются на этом компьютере${LOCK.on ? " · защищено ПИН-кодом" : ""}</span>
      <span class="hsec">${langSwitch()}${cryptoOk() ? (LOCK.on ? `<button class="btn ghost" data-act="lock">Заблокировать</button><button class="btn ghost" data-act="pinset">Сменить ПИН</button><button class="btn ghost" data-act="pinoff">Снять ПИН</button>` : `<button class="btn ghost" data-act="pinset">Защитить ПИН-кодом</button>`) : ""}</span></header>
    ${(() => { const n = list.filter(c => !c.demo && (!c.saved || c.saved < c.updated)).length; return n ? `<div class="hwarn"><b>${n === 1 ? "1 клиент изменён" : n + " клиентов изменены"} после последнего сохранения в файл.</b> Данные хранятся только в этом браузере — если очистить его, они пропадут. <button class="btn primary" data-act="backup">Сохранить всех клиентов в файл</button></div>` : ""; })()}
    <section class="hero">
      <div class="hblue">
        <h1>Финансовый анализ компаний и групп Казахстана</h1>
        <p>Отчётность из Excel, декларации, выписки и кредитные отчёты из PDF; чистые кредитовые обороты, сверки, коэффициенты, залог, прогноз денежного потока до 84 месяцев, проблемы с подсказками и заключение в Word. Все суммы — в тыс. тг.</p>
        <div class="hbtn"><button class="btn lime" data-act="new">Новый клиент</button><button class="btn wline" data-act="import">Открыть файл клиента</button>${list.length ? `<button class="btn wline" data-act="backup">Сохранить всех в файл</button>` : ""}</div>
      </div>
      <div class="hside">
        <div class="hgraph"><span class="k">${list.length}</span><span class="l">${list.length === 1 ? "клиент в работе" : "клиентов в базе"}</span>
          <div class="hsplit"><span><b>${done}</b> утверждено</span><span><b>${list.length - done}</b> в работе</span></div></div>
        <div class="hplat"><b>${last ? "Последний клиент" : "Посмотреть, как это работает"}</b><span>${last ? esc(last.card.name) + " · " + esc(when(last.updated)) : "Вымышленная группа из трёх компаний с готовыми данными за три года"}</span>
          ${last ? `<button class="btn primary" data-open="${last.id}">Продолжить</button>` : `<button class="btn primary" data-act="demo">Открыть пример</button>`}</div>
      </div>
    </section>
    <section class="clist">
      <div class="chead"><h2>Клиенты</h2>${list.length > 3 ? `<input class="inp search" id="q" placeholder="Поиск по названию, БИН или ОКЭД" aria-label="Поиск клиента">` : ""}${list.length && !list.some(c => c.demo) ? `<button class="btn ghost" data-act="demo">Открыть пример «Тест-Агро»</button>` : ""}</div>
      ${list.length ? `<ul class="crows">${rows}</ul>` : `<div class="empty"><h2>Пока нет ни одного клиента</h2><p class="muted">Создайте клиента или откройте пример, чтобы посмотреть, как всё устроено.</p><button class="btn primary" data-act="new">Новый клиент</button></div>`}
    </section>
    <footer class="hfoot"><span>© 2026 Создан ОФКК Костанай</span><span>Резервная копия клиента — кнопка «Файл»; открыть на другом компьютере — «Открыть файл клиента».</span></footer>
  </div><div id="toast" class="toast" role="status"></div>${DIALOG}`;
  const q = $("#q");
  if (q) q.oninput = () => { const v = q.value.trim().toLowerCase(); document.querySelectorAll(".crow").forEach(li => (li.style.display = !v || li.dataset.q.includes(v) ? "" : "none")); };
}

/* ---------- карточка */
function pageCard() {
  const c = C.card;
  const f = (key, lab, type = "text") => `<label class="f"><span>${lab}</span><input class="inp" data-card="${key}" type="${type}" value="${esc(c[key] ?? "")}"></label>`;
  const sel = (key, lab, list) => `<label class="f"><span>${lab}</span><select class="inp" data-card="${key}">${opts(list, c[key])}</select></label>`;
  const comps = C.companies.map((x, i) => `<tr><td class="lab">К${i + 1}</td>
      <td><input class="inp" data-comp="${i}" data-f="${LANG === "kz" ? "nameKz" : "name"}" value="${esc(LANG === "kz" ? (x.nameKz || x.name) : x.name)}" placeholder="Название"></td>
      <td><div class="binrow"><input class="inp" data-comp="${i}" data-f="bin" value="${esc(x.bin)}" placeholder="12 цифр" inputmode="numeric"><button class="btn ghost" data-binlookup="${i}" title="Загрузить данные компании с ba.prg.kz: регистрация, ОКЭД, руководитель, НДС, проверки благонадёжности (отправляется только БИН)">По БИН</button></div></td>
      <td><div class="roles">${S.lists.role.map(r => `<label><input type="checkbox" data-role="${i}" value="${esc(r)}" ${compRoles(x).includes(r) ? "checked" : ""}>${esc(r)}</label>`).join("")}</div></td>
      <td><select class="inp" data-comp="${i}" data-f="form">${opts(S.lists.form, x.form)}</select></td>
      <td><select class="inp" data-comp="${i}" data-f="vat">${opts(["Да", "Нет"], x.vat)}</select></td>
      <td><select class="inp" data-comp="${i}" data-f="regime">${opts(S.lists.regime, x.regime)}</select></td>
      <td>${nComp() > 1 ? `<button class="btn ghost danger" data-delcomp="${i}" aria-label="Удалить компанию">Удалить</button>` : ""}</td></tr>`).join("");
  const pers = C.periods.map((p, i) => `<tr><td class="lab">${i + 1}${i === C.periods.length - 1 ? " <span class='small muted'>последний</span>" : ""}</td>
      <td><input class="inp" data-per="${i}" data-f="label" value="${esc(p.label)}"></td>
      <td><input class="inp" data-per="${i}" data-f="year" inputmode="numeric" value="${esc((p.date || "").slice(0, 4))}" style="max-width:80px"></td>
      <td><select class="inp" data-per="${i}" data-f="q">${[["", "год"], ["Q1", "1 квартал"], ["Q2", "2 квартал"], ["Q3", "3 квартал"], ["Q4", "4 квартал"]].map(([v, t]) => `<option value="${v}"${(perQ(p) || "") === v ? " selected" : ""}>${t}</option>`).join("")}</select></td>
      <td><input class="inp" data-per="${i}" data-f="date" type="date" value="${esc(p.date)}"></td>
      <td><select class="inp" data-per="${i}" data-f="basis">${opts(S.lists.rep, p.basis)}</select></td>
      <td><input class="inp" data-per="${i}" data-f="months" type="number" min="1" max="12" value="${esc(p.months)}"></td>
      ${nComp() > 1 ? `<td><div class="roles">${C.companies.map((x, j) => { const k = j + 1, on = inactive(k, p.id), au = C.inactive?.[k]?.[p.id] === undefined && inactAuto(k, p.id); return `<label title="${esc(compName(k))}${au ? " — по дате регистрации " + esc(C.trust[k].regDate) : ""}"><input type="checkbox" data-inact="${k}" data-pid="${p.id}" ${on ? "checked" : ""}>К${k}${au ? " (авто)" : ""}</label>`; }).join("")}</div></td>` : ""}
      <td>${C.periods.length > 2 ? `<button class="btn ghost danger" data-delper="${i}">Удалить</button>` : ""}</td></tr>`).join("");
  return `<div class="pagehead"><div class="lead"><h1>Карточка клиента</h1><p>Клиент, состав группы и отчётные периоды. Периоды идут от старого к новому; у всех компаний группы они одинаковые.</p></div></div>
  <section class="panel"><h2>Клиент и запрос</h2><div class="grid2">
    ${f("name", "Клиент / группа")}${f("bin", "БИН основной компании")}${f("activity", "Описание деятельности (свободно)")}${f("region", "Регион")}
    ${f("analyst", "Кредитный менеджер")}${f("date", "Дата анализа", "date")}${sel("purpose", "Цель финансирования", S.lists.fpurpose)}${sel("product", "Продукт", S.lists.product)}
    <label class="f"><span>Запрашиваемая сумма, тыс. тг</span><input class="inp" data-card="amount" data-num value="${esc(fmt(c.amount))}"></label>
    <label class="f"><span>Допуск сверок, тыс. тг</span><input class="inp" data-card="tol" data-num value="${esc(fmt(c.tol))}"></label>
  </div></section>
  ${isOD() ? odCardPanel() : ""}
  ${okedPanel()}
  <section class="panel"><h2>Компании (${nComp()} из ${MAX_COMP})</h2><p class="hint">Для группы анализ строится по сумме компаний за вычетом внутригрупповых операций. БИН нужен, чтобы находить внутригрупповые операции. Кнопка «По БИН» сама загружает данные компании с ba.prg.kz (Параграф) — наружу уходит только БИН.</p>
    <div class="tablewrap" style="max-height:none"><table class="data form"><thead><tr><th class="lab">№</th><th style="text-align:left">Название</th><th style="text-align:left">БИН / ИИН</th><th style="text-align:left">Роль</th><th style="text-align:left">Форма</th><th style="text-align:left">Плательщик НДС</th><th style="text-align:left">Налоговый режим</th><th></th></tr></thead><tbody>${comps}</tbody></table></div>
    ${nComp() < MAX_COMP ? `<p style="margin-top:10px"><button class="btn" data-act="addcomp">Добавить компанию</button></p>` : ""}</section>
  <section class="panel"><h2>Отчётные периоды (${C.periods.length} из ${MAX_PER})</h2><p class="hint">Выберите год и квартал — дата, число месяцев и название подставятся сами. Для квартала основа «Нарастающим итогом» означает отчётность с начала года (3, 6, 9 мес.), «Отдельный период» — только за этот квартал. Обороты пересчитываются в годовые как ×12/месяцев.${nComp() > 1 ? " «Не было деятельности» — компания ещё не существовала или не работала: за этот период она входит в группу нулями и не требует отчётности. Отметка ставится сама, если дата регистрации (из «Подтянуть по БИН» или «Благонадёжности») позже даты отчёта; её можно снять или поставить вручную." : ""}</p>
    <div class="tablewrap" style="max-height:none"><table class="data form"><thead><tr><th class="lab">№</th><th style="text-align:left">Название</th><th style="text-align:left">Год</th><th style="text-align:left">Период</th><th style="text-align:left">Дата отчёта</th><th style="text-align:left">Основа</th><th style="text-align:left">Месяцев</th>${nComp() > 1 ? '<th style="text-align:left">Не было деятельности</th>' : ""}<th></th></tr></thead><tbody>${pers}</tbody></table></div>
    ${C.periods.length < MAX_PER ? `<p style="margin-top:10px"><button class="btn" data-act="addper">Добавить следующий год</button> <button class="btn" data-act="addq">Добавить квартал</button> <button class="btn ghost" data-act="addperfirst">Добавить более ранний</button></p>` : ""}</section>`;
}

/* ---------- ОКЭД на карточке */
function okedHint(code) {
  const d = okedDigits(code); if (!d) return "";
  const r = okedLookup(d);
  if (!r) return "код не найден";
  if (r.divOnly && d.length > 2) return "показано название раздела " + d.slice(0, 2) + " — для точного названия загрузите справочник ОКЭД";
  return r.exact ? "по справочнику" : "по справочнику (ближайший уровень " + okedFmt(d.slice(0, r.level)) + ")";
}
function okedPanel() {
  if (!C.card.oked || !C.card.oked.length) C.card.oked = [{ code: "", name: "" }];
  const n = Object.keys(OKED).length;
  const rows = C.card.oked.map((o, i) => {
    const lk = okedLookup(o.code)?.name, nm0 = o.manual ? o.name : (lk && !(KZ_LET.test(lk) && o.name && !KZ_LET.test(o.name)) ? lk : o.name || lk || ""), nm = o.manual ? nm0 : okedNameL(o.code, nm0);
    return `<tr><td class="lab">${i === 0 ? "Основной" : "Доп. " + i}</td>
      <td><input class="inp" data-oked="${i}" data-f="code" value="${esc(o.code)}" placeholder="например, 46.90.0" inputmode="numeric" style="max-width:150px"></td>
      <td><input class="inp" data-oked="${i}" data-f="name" value="${esc(nm)}" placeholder="наименование подставится по коду"><span class="small muted" data-okedhint="${i}">${esc(okedHint(o.code))}</span></td>
      <td>${C.card.oked.length > 1 ? `<button class="btn ghost danger" data-deloked="${i}">Удалить</button>` : ""}</td></tr>`;
  }).join("");
  return `<section class="panel"><h2>Виды деятельности (ОКЭД)</h2><p class="hint">До ${MAX_OKED} кодов на клиента; первый — основной. Наименование подставляется по коду, его можно поправить вручную. ${n ? `Справочник ОКЭД загружен: ${nf0.format(n)} кодов.${okedKz() ? " <b>Наименования в справочнике на казахском — загрузите его заново на странице «Настройка загрузки», будут взяты русские.</b>" : ""}` : "Сейчас встроены только разделы (первые 2 цифры). Чтобы подтягивались точные наименования, один раз загрузите справочник ОКЭД на странице «Настройка загрузки»."}</p>
    <div class="tablewrap" style="max-height:none"><table class="data form oked"><thead><tr><th class="lab">Вид</th><th style="text-align:left">Код ОКЭД</th><th style="text-align:left">Наименование</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${C.card.oked.length < MAX_OKED ? `<p style="margin-top:10px"><button class="btn" data-act="addoked">Добавить код ОКЭД</button></p>` : ""}</section>`;
}

/* ---------- отчётность компании */
function linesTable(obj, blocks, editable) {
  const pers = C.periods;
  let h = `<div class="tablewrap"><table class="data"><thead><tr><th class="lab">Показатель, тыс. тг</th>${pers.map(p => `<th>${esc(p.label)}<span class="pertitle">${esc(p.basis === "Годовой" ? "год" : p.basis.toLowerCase())}${p.months !== 12 ? ", " + p.months + " мес." : ""}</span></th>`).join("")}</tr></thead><tbody>`;
  for (const b of blocks) for (const [typ, key, label] of LINES[b]) {
    if (!key) { h += `<tr class="sec"><td class="lab" colspan="${pers.length + 1}">${esc(label)}</td></tr>`; continue; }
    const code = "";
    const sub = /^в т\.ч\./.test(label) || (CF_CODE[key] && typ === "opt" && !["cf120", "cf140", "cf150r"].includes(key)) ? " sub" : "";
    h += `<tr class="${typ === "calc" ? "calc" : ""}${sub}"><td class="lab">${code}${esc(label)}${typ === "opt" && !CF_CODE[key] ? ' <span class="small muted">(необяз.)</span>' : ""}</td>`;
    for (const p of pers) {
      if (typ !== "calc" && editable) {
        const v = rawComp(obj, key, p.id), src = C.src?.[obj]?.[key]?.[p.id];
        h += `<td class="cell${typ === "opt" ? " opt" : ""}"><input data-k="${obj}" data-key="${key}" data-pid="${p.id}" value="${esc(fmt(v))}" class="${src ? "imp" : ""}" ${src ? `data-src="${esc("Загружено: " + src.form + ", " + src.file + " — " + src.status)}"` : ""} aria-label="${esc(label + ", " + p.label)}"></td>`;
      } else {
        const v = val(obj, key, p.id);
        h += `<td class="${isNum(v) && v < 0 ? "neg" : ""}" data-v="${obj}|${key}|${p.id}">${fmt(v)}</td>`;
      }
    }
    h += "</tr>";
  }
  return h + "</tbody></table></div>";
}
function compTabs() {
  if (COMP_TAB > nComp()) COMP_TAB = 1;
  return nComp() > 1 ? `<div class="tabs" role="tablist">${C.companies.map((x, i) => `<button role="tab" aria-selected="${COMP_TAB === i + 1}" data-ctab="${i + 1}">К${i + 1} · ${esc(x.name || "без названия")}</button>`).join("")}</div>` : "";
}
const FORM_INTRO = {
  bal: ["Бухгалтерский баланс", "Ввод — голубые ячейки. Пусто — данных нет; 0 — значение действительно нулевое. Непокрытый убыток — со знаком минус. Итоги «по отчётности» нужны для автоматической сверки."],
  odr: ["Отчёт о прибылях и убытках", "Расходы — положительными числами. Износ, разовые статьи, дивиденды и ФОТ — из расшифровок (в форме их нет)."],
  cf: ["Отчёт о движении денежных средств", "Стандартная форма МФ РК (приложение 3 к приказу №404, прямой метод). Выплаты — положительными числами; итоги разделов, чистые потоки и остаток денег на конец периода считаются сами."],
};
function pageForm(block) {
  const k = COMP_TAB > nComp() ? 1 : COMP_TAB;
  const [ttl, intro] = FORM_INTRO[block];
  return `<div class="pagehead"><div class="lead"><h1>${ttl}</h1><p>${intro}</p></div>
    <div class="toolbar"><button class="btn primary" data-act="importdlg">Загрузить формы из Excel</button><button class="btn ghost danger" data-act="clearform" data-block="${block}">Очистить данные</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="${block}">${bannerHTML(block)}</div>
  ${(() => { const ina = C.periods.filter(p => inactive(k, p.id)); return ina.length ? `<p class="hint" style="margin:0 0 10px">${esc(compName(k))}: нет деятельности в периодах ${ina.map(p => "«" + esc(p.label) + "»").join(", ")} — заполнять не нужно, в группе считается нулями (отметка — на «Карточке»).</p>` : ""; })()}
  ${linesTable(k, [block], true)}`;
}
const FC_PCT = new Set(["growth", "shock", "gm_adj", "infl", "capex_pct", "overrun", "rshock"]);
const FC_LAB = { growth: "Рост выручки, % в год", shock: "Шок выручки, %", gm_adj: "Изменение валовой маржи, п.п.", infl: "Рост операционных расходов, % в год",
  dso_adj: "Изменение оборачиваемости ДЗ, дней", dio_adj: "Изменение оборачиваемости запасов, дней", dpo_adj: "Изменение оборачиваемости КЗ, дней",
  capex_pct: "Поддерживающие капвложения, % выручки", overrun: "Удорожание инвестпроектов, %", rshock: "Рост ставок по кредитам, п.п.", buffer: "Минимальный остаток денег, тыс. тг" };
const fcIn = (path, v, pct) => `<input class="inp num" data-fc="${path}" ${pct ? "data-pct" : ""} value="${esc(isNum(v) ? fmt(pct ? v * 100 : v, pct ? "m1" : "m") : (v ?? ""))}">`;
function pageCons() {
  const pers = C.periods, f = fcParams();
  let h = `<div class="pagehead"><div class="lead"><h1>${nComp() > 1 ? "Свод группы и прогноз" : "Прогноз"}</h1><p>${nComp() > 1 ? "Группа = сумма компаний за вычетом внутригрупповых операций. Ниже сразу строится прогноз денежного потока на 24 месяца: базовый и стрессовый." : "Прогноз денежного потока на 24 месяца: базовый и стрессовый."}</p></div>
    <div class="toolbar">${objSelect()}</div></div><div id="probBanner" data-page="cons">${bannerHTML("cons")}</div>`;
  if (nComp() > 1) {
    h += `<section class="panel"><h2>Внутригрупповые операции</h2><p class="hint">Тыс. тг. Пусто — таких операций нет. Упрощения: владение 100%, без гудвилла и налогового эффекта.</p>
    <div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Статья</th>${pers.map(p => `<th>${esc(p.label)}</th>`).join("")}</tr></thead><tbody>`;
    for (const [typ, key, label] of S.elim) {
      if (!key) { h += `<tr class="sec"><td class="lab" colspan="${pers.length + 1}">${esc(label.replace(/^БАЛАНС: /, "Баланс: ").replace(/^ОДР: /, "ОПиУ: "))}</td></tr>`; continue; }
      h += `<tr><td class="lab">${esc(label)}</td>${pers.map(p => `<td class="cell opt"><input data-elim="${key}" data-pid="${p.id}" value="${esc(fmt(C.elim?.[key]?.[p.id]))}"></td>`).join("")}</tr>`;
    }
    const ck = pers.map(p => elimChecks(p.id));
    h += `<tr class="sec"><td class="lab" colspan="${pers.length + 1}">Контроль</td></tr>`;
    for (let i = 0; i < 2; i++) h += `<tr><td class="lab">${ck[0][i][0]}</td>${ck.map(c => `<td>${stChip(...CHK_TXT[c[i][1]])}</td>`).join("")}</tr>`;
    h += `<tr><td class="lab">Подтверждено кредитным менеджером</td>${pers.map(p => `<td><label><input type="checkbox" data-elimok="${p.id}" ${C.elimOk?.[p.id] ? "checked" : ""}> да</label></td>`).join("")}</tr></tbody></table></div></section>`;
    h += `<section class="panel"><h2>Консолидированные показатели группы</h2><div class="tablewrap" style="max-height:none"><table class="data"><thead><tr><th class="lab">Показатель, тыс. тг</th>${pers.map(p => `<th>${esc(p.label)}</th>`).join("")}</tr></thead><tbody>
      ${[["rev", "Выручка"], ["ebitda", "EBITDA"], ["ni", "Чистая прибыль"], ["ta", "Итого активы"], ["eq", "Капитал"], ["bchk", "Контроль: активы − пассивы"]].map(([k, l]) => `<tr><td class="lab">${l}</td>${pers.map(p => { const v = val(0, k, p.id); return `<td class="${isNum(v) && v < 0 ? "neg" : ""}">${fmt(v)}</td>`; }).join("")}</tr>`).join("")}
      <tr><td class="lab">Общий долг</td>${pers.map(p => `<td>${fmt(ratio(0, "debt", p.id))}</td>`).join("")}</tr></tbody></table></div></section>`;
  }
  // прогноз: допущения
  const loans = f.loans || [];
  h += `<section class="panel"><h2>Прогноз: допущения</h2><p class="hint">Объект — ${esc(objName(C.obj))}; база прогноза — последний период «${esc(pers[pers.length - 1]?.label || "")}» (обороты в годовом выражении). Проценты — в %.</p>
    <div class="fcgrid"><div><div class="tablewrap" style="max-height:none"><table class="data fc"><thead><tr><th class="lab">Допущение</th><th>База</th><th>Стресс</th></tr></thead><tbody>
    ${Object.keys(FC_LAB).map(k => `<tr><td class="lab">${FC_LAB[k]}</td><td class="cell">${fcIn(`scen.${k}.0`, f.scen[k][0], FC_PCT.has(k))}</td><td class="cell">${fcIn(`scen.${k}.1`, f.scen[k][1], FC_PCT.has(k))}</td></tr>`).join("")}
    </tbody></table></div></div>
    <div><h3>Запрашиваемый кредит</h3><div class="grid2 tight">
      <label class="f"><span>Сумма, тыс. тг</span>${fcIn("req.amt", f.req.amt)}</label><label class="f"><span>Месяц выдачи (1–24)</span>${fcIn("req.month", f.req.month)}</label>
      <label class="f"><span>Срок, мес.</span>${fcIn("req.term", f.req.term)}</label><label class="f"><span>Льготный период по ОД, мес.</span>${fcIn("req.grace", f.req.grace)}</label>
      <label class="f"><span>Ставка, %</span>${fcIn("req.rate", f.req.rate, true)}</label>
      <label class="f"><span>Схема погашения</span><select class="inp" data-fc="req.scheme">${opts(Object.keys(SCH), f.req.scheme)}</select></label>
      <label class="f"><span>Горизонт прогноза</span><select class="inp" data-fc="horizon" data-numsel>${[[0, `По сроку кредита (${fcHorizon()} мес.)`], [24, "24 мес."], [36, "36 мес."], [48, "48 мес."], [60, "60 мес."], [72, "72 мес."], [84, "84 мес."]].map(([v, t]) => `<option value="${v}"${N(f.horizon) == v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div>
      <h3 style="margin-top:16px">Сезонность выручки (1 = средний месяц) <button class="btn ghost" data-act="seasbank" title="По чистым кредитовым оборотам из выписок за последние 12–24 месяца">Из банковских оборотов</button></h3><div class="seas">${["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"].map((m, i) => `<label class="f"><span>${m}</span>${fcIn(`seas.${i}`, f.seas[i])}</label>`).join("")}</div>
    </div></div>
    <h3 style="margin-top:18px">Действующие кредиты</h3>
    ${loans.length ? "" : `<p class="hint" style="margin-top:4px">Реестр пуст — долг из баланса (${fmt(ratio(C.obj, "debt", lastPid()))} тыс. тг) гасится равными долями: ставка ${fcIn("aggRate", f.aggRate, true).replace('class="inp num"', 'class="inp num inl"')} %, срок ${fcIn("aggTerm", f.aggTerm).replace('class="inp num"', 'class="inp num inl"')} мес. Для точности добавьте кредиты по справкам банков.</p>`}
    ${loans.length ? `<div class="tablewrap" style="max-height:none"><table class="data fc"><thead><tr><th class="lab">Кредитор</th><th>Остаток, тыс. тг</th><th>Ставка, %</th><th>Осталось, мес.</th><th>Льгота, мес.</th><th>Схема</th><th></th></tr></thead><tbody>
      ${loans.map((l, i) => `<tr><td class="cell"><input class="inp" data-fc="loans.${i}.name" value="${esc(l.name || "")}" style="text-align:left"></td><td class="cell">${fcIn(`loans.${i}.bal`, l.bal)}</td><td class="cell">${fcIn(`loans.${i}.rate`, l.rate, true)}</td><td class="cell">${fcIn(`loans.${i}.rem`, l.rem)}</td><td class="cell">${fcIn(`loans.${i}.grace`, l.grace)}</td><td class="cell"><select class="inp" data-fc="loans.${i}.scheme">${opts(Object.keys(SCH), l.scheme)}</select></td><td><button class="btn ghost danger" data-delloan="${i}">Удалить</button></td></tr>`).join("")}
      </tbody></table></div>` : ""}
    <p style="margin-top:8px"><button class="btn" data-act="addloan">Добавить кредит</button></p>
    <h3 style="margin-top:18px">Инвестиционные проекты</h3>
    ${(f.projects || []).length ? `<div class="tablewrap" style="max-height:none"><table class="data fc"><thead><tr><th class="lab">Проект</th><th>Сумма, тыс. тг</th><th>Начало, мес.</th><th>Длительность, мес.</th><th>Собств. средства, %</th><th></th></tr></thead><tbody>
      ${f.projects.map((p, i) => `<tr><td class="cell"><input class="inp" data-fc="projects.${i}.name" value="${esc(p.name || "")}" style="text-align:left"></td><td class="cell">${fcIn(`projects.${i}.amt`, p.amt)}</td><td class="cell">${fcIn(`projects.${i}.start`, p.start)}</td><td class="cell">${fcIn(`projects.${i}.dur`, p.dur)}</td><td class="cell">${fcIn(`projects.${i}.own`, p.own, true)}</td><td><button class="btn ghost danger" data-delproj="${i}">Удалить</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="hint">Проектов нет — в прогнозе только поддерживающие капвложения.</p>`}
    <p style="margin-top:8px"><button class="btn" data-act="addproj">Добавить проект</button></p></section>
  <section class="panel"><h2>Прогноз: результаты</h2><div id="fcOut">${fcOutHTML()}</div></section>`;
  return h;
}
function fcOutHTML() {
  const b = forecast(C.obj, 0), s = forecast(C.obj, 1);
  if (b.err) return `<div class="prob nd"><span class="st nd">Нет данных</span><div><b>Прогноз не построен</b><p class="fix">${esc(b.err)}. Заполните эти строки на страницах «Баланс» и «ОПиУ».</p></div></div>`;
  const row = (lab, k, kind, bad) => `<tr><td class="lab">${lab}</td>${[b, s].map(o => { const v = o[k]; const st = bad ? bad(v) : ""; return `<td class="${st}">${fmt(v, kind)}</td>`; }).join("")}</tr>`;
  const dscr = v => (!isNum(v) ? "" : v < 1 ? "v crit" : v < 1.2 ? "v chk" : "v ok");
  const neg = v => (isNum(v) && v < 0 ? "v crit" : "");
  const sum = `<div class="tablewrap" style="max-height:none"><table class="data rmap"><thead><tr><th class="lab">Итог за ${b.H} мес.</th><th>База</th><th>Стресс</th></tr></thead><tbody>
    ${row("Выручка, тыс. тг", "rev_total", "m")}${row("EBITDA, тыс. тг", "ebitda_total", "m")}${row("Денежный поток для обслуживания долга (CFADS)", "cfads_total", "m")}
    ${row("Обслуживание долга без нового кредита", "ds_total", "m")}${row("Обслуживание долга с новым кредитом", "ds_all_total", "m")}
    ${row("DSCR без нового кредита", "dscr_h_pre", "x", dscr)}${row("DSCR с новым кредитом", "dscr_h_post", "x", dscr)}${row("DSCR первого года с кредитом", "dscr_y1_post", "x", dscr)}
    ${row("Минимальный DSCR месяца", "dscr_min_post", "x")}${row("Минимальный годовой DSCR", "dscr_year_min", "x", dscr)}${row("Минимум денег без кредита", "mincash_pre", "m", neg)}${row("Минимум денег с кредитом", "mincash_post", "m", neg)}
    ${row("Месяцев ниже минимального остатка (с кредитом)", "months_below", "d", v => (v > 0 ? "v chk" : "v ok"))}
    ${row("Максимальный дефицит без кредита", "gap_max", "m")}${row("Потребность в финансировании (с резервом)", "rec", "m")}
    ${row("Рост оборотного капитала (пик)", "nwc_need", "m")}${row("Инвестиции, заёмная часть", "inv_need", "m")}</tbody></table></div>`;
  const o = FC_TAB ? s : b;
  // колонки: первые 24 месяца помесячно, дальше — по годам
  const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const cols = o.rows.slice(0, 24).map(r => ({ h: String(r.t), sub: MON[r.cal - 1], rows: [r] }));
  for (let y = 2; y * 12 < o.H; y++) { const rr = o.rows.slice(y * 12, y * 12 + 12); cols.push({ h: `Год ${y + 1}`, sub: `мес. ${y * 12 + 1}–${y * 12 + rr.length}`, rows: rr, year: true }); }
  const STOCK = new Set(["cashPre", "cashPost"]);
  const cell = (c, k) => {
    if (k === "dscrAll") { const cf = c.rows.reduce((a, r) => a + r.cfads, 0), ds = c.rows.reduce((a, r) => a + r.dsAll, 0); return ds > 0 ? cf / ds : null; }
    return STOCK.has(k) ? c.rows[c.rows.length - 1][k] : c.rows.reduce((a, r) => a + r[k], 0);
  };
  const lowIn = (c, k) => STOCK.has(k) && c.rows.some(r => r[k] < o.buffer);
  const monthly = `<div class="tabs" role="tablist" style="margin-top:18px"><button role="tab" aria-selected="${!FC_TAB}" data-fctab="0">База</button><button role="tab" aria-selected="${!!FC_TAB}" data-fctab="1">Стресс</button></div>
    <p class="hint">Первые 24 месяца — помесячно, дальше — по годам (суммы за год; деньги — на конец года, подсвечены, если в течение года опускались ниже минимума).</p>
    <div class="tablewrap"><table class="data"><thead><tr><th class="lab">Тыс. тг</th>${cols.map(c => `<th class="${c.year ? "yr" : ""}">${c.h}<span class="pertitle">${c.sub}</span></th>`).join("")}</tr></thead><tbody>
    ${[["rev", "Выручка"], ["ebitda", "EBITDA"], ["cit", "КПН"], ["dn", "Прирост оборотного капитала"], ["cfo", "Операционный поток"], ["mc", "Поддерживающие капвложения"], ["cfads", "CFADS"], ["ds", "Обслуживание действующего долга"], ["ic", "Инвестпроекты"], ["cashPre", "Деньги на конец без кредита"], ["draw", "Выдача кредита"], ["nprin", "Погашение нового кредита"], ["nint", "Проценты по новому кредиту"], ["cashPost", "Деньги на конец с кредитом"], ["dscrAll", "DSCR с кредитом"]]
      .map(([k, l]) => `<tr class="${k === "cashPost" || k === "cfads" ? "calc" : ""}"><td class="lab">${l}</td>${cols.map(c => { const v = cell(c, k); const cls = (lowIn(c, k) ? "low" : isNum(v) && v < 0 ? "neg" : "") + (c.year ? " yr" : ""); return `<td class="${cls}">${fmt(v, k === "dscrAll" ? "x" : "m")}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>`;
  return `<div class="fcres"><div>${sum}</div><div><h3>Остаток денег по месяцам (${b.H} мес.), тыс. тг</h3>${cashChart(b, s)}<div class="legend"><span><i class="ln b"></i>база с кредитом</span><span><i class="ln s"></i>стресс с кредитом</span><span><i class="ln buf"></i>минимальный остаток</span></div></div></div>${monthly}`;
}
function cashChart(b, s) {
  const W = 520, H = 230, pl = 64, pr = 10, pt = 10, pb = 26;
  const all = b.rows.map(r => r.cashPost).concat(s.rows.map(r => r.cashPost), [b.buffer, 0]);
  let mn = Math.min(...all), mx = Math.max(...all); if (mx === mn) mx = mn + 1;
  const x = t => pl + (t - 1) / Math.max(1, b.H - 1) * (W - pl - pr), y = v => pt + (mx - v) / (mx - mn) * (H - pt - pb);
  const path = rows => rows.map((r, i) => `${i ? "L" : "M"}${x(r.t).toFixed(1)},${y(r.cashPost).toFixed(1)}`).join("");
  const ticks = [mn, (mn + mx) / 2, mx];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Остаток денег по месяцам">
    ${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("")}
    ${mn < 0 ? `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="zero"/>` : ""}
    <line x1="${pl}" x2="${W - pr}" y1="${y(b.buffer)}" y2="${y(b.buffer)}" class="buf"/>
    ${(b.H > 24 ? Array.from({ length: b.H / 12 + 1 }, (_, i) => Math.max(1, i * 12)) : [1, 6, 12, 18, 24]).map(t => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t}</text>`).join("")}
    <path d="${path(s.rows)}" class="s"/><path d="${path(b.rows)}" class="b"/></svg>`;
}
function objSelect() {
  const o = [`<option value="0"${C.obj === 0 ? " selected" : ""}>${esc(objName(0))}</option>`];
  if (nComp() > 1) C.companies.forEach((x, i) => o.push(`<option value="${i + 1}"${C.obj === i + 1 ? " selected" : ""}>${esc(compName(i + 1))}</option>`));
  return `<label class="f" style="min-width:260px"><span>Объект анализа</span><select class="inp" data-act="obj">${o.join("")}</select></label>`;
}
function spark(vals) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => isNum(v));
  if (pts.length < 2) return "";
  const xs = vals.length - 1 || 1, mn = Math.min(...pts.map(p => p[1])), mx = Math.max(...pts.map(p => p[1])), rg = mx - mn || 1;
  const P = pts.map(([i, v]) => `${(i / xs * 72 + 4).toFixed(1)},${(22 - (v - mn) / rg * 16).toFixed(1)}`);
  const last = P[P.length - 1].split(",");
  return `<svg width="80" height="26" viewBox="0 0 80 26" aria-hidden="true"><polyline points="${P.join(" ")}" fill="none" stroke="#023DFF" stroke-width="1.6"/><circle cx="${last[0]}" cy="${last[1]}" r="2.4" fill="#00BB00"/></svg>`;
}
function pageAn() {
  const obj = C.obj, pers = C.periods, L = lastPid();
  const fact = (lab, v, kind, sub) => `<div><span>${lab}</span><b>${isNum(v) ? fmt(v, kind) : (v === NP ? NP : "н/д")}</b><span>${sub || ""}</span></div>`;
  const facts = `<div class="facts">
    ${fact("Выручка", val(obj, "rev", L), "m", esc(pers[pers.length - 1]?.label))}
    ${fact("EBITDA, годовая", ratio(obj, "ebitda_ann", L), "m", "маржа " + fmt(ratio(obj, "ebitda_m", L), "p"))}
    ${fact("Чистая прибыль", val(obj, "ni", L), "m", "маржа " + fmt(ratio(obj, "net_m", L), "p"))}
    ${fact("Общий долг", ratio(obj, "debt", L), "m", "чистый " + fmt(ratio(obj, "ndebt", L)))}
    ${fact("Долг / EBITDA", ratio(obj, "debt_ebitda", L), "x", ST[rstatus("debt_ebitda", ratio(obj, "debt_ebitda", L))] || "")}
    ${fact("Текущая ликвидность", ratio(obj, "liq_cur", L), "x", ST[rstatus("liq_cur", ratio(obj, "liq_cur", L))] || "")}</div>`;
  const tabs = [["rat", "Коэффициенты"], ["bal", "Баланс"], ["odr", "ОПиУ"], ["cf", "ДДС"]].map(([id, t]) => `<button role="tab" aria-selected="${AN_TAB === id}" data-antab="${id}">${t}</button>`).join("");
  let body;
  if (AN_TAB === "rat") {
    body = `<div class="tablewrap"><table class="data rmap"><thead><tr><th class="lab">Показатель</th>${pers.map(p => `<th>${esc(p.label)}</th>`).join("")}<th>Динамика</th><th style="text-align:left">Оценка</th></tr></thead><tbody>`;
    for (const r of S.ratios.concat([["r", "cfo_dds"]])) {
      if (r[0] === "sec") { if (r[2].startsWith("ПРОМЕЖУТОЧНЫЕ")) continue; body += `<tr class="sec"><td class="lab" colspan="${pers.length + 3}">${esc(r[2].charAt(0) + r[2].slice(1).toLowerCase())}</td></tr>`; continue; }
      const key = r[1], R = RAT[key], vs = pers.map(p => ratio(obj, key, p.id));
      if (key === "cfo_dds" && !vs.some(isNum)) continue;
      const kind = KIND[key] || "m";
      body += `<tr><td class="lab" title="${esc(R.note || "")}">${esc(R.label)}<span class="formula">${esc(R.formula)}</span></td>`;
      vs.forEach(v => { const s = rstatus(key, v); body += `<td class="v ${s || ""}"><span class="val">${v === NP ? NP : isNum(v) ? fmt(v, kind) : "н/д"}</span></td>`; });
      const sl = rstatus(key, vs[vs.length - 1]);
      body += `<td class="trend">${spark(vs.map(v => (isNum(v) ? v : null)))}</td><td style="text-align:left">${sl ? stChip(sl) : ""}</td></tr>`;
    }
    body += `</tbody></table></div><div class="legend">${["ok", "chk", "risk", "crit", "nd"].map(s => stChip(s)).join("")}<span>Пороги — ориентиры из Excel-шаблона, не нормативы. Наведите на название, чтобы увидеть ограничения применимости.</span></div>`;
  } else body = linesTable(obj, [AN_TAB], false);
  return `<div class="pagehead"><div class="lead"><h1>Анализ</h1><p>${nComp() > 1 && obj === 0 ? "Группа: сумма компаний за вычетом внутригрупповых операций. Если у какой-то компании строка не заполнена, строка группы остаётся пустой." : "Показатели выбранной компании."}</p></div>
    <div class="toolbar">${objSelect()}</div></div>${facts}<div class="tabs" role="tablist">${tabs}</div>${body}`;
}

/* ---------- сверки */
function discrepancies() {
  let n = 0;
  for (let k = 1; k <= nComp(); k++) for (const p of C.periods) n += compChecks(k, p.id).filter(c => c[1] === "bad").length;
  if (nComp() > 1) for (const p of C.periods) n += elimChecks(p.id).filter(c => c[1] === "bad").length;
  return n;
}
function pageProb() {
  const pers = C.periods;
  const groups = [["card", "Карточка"], ["trust", "Благонадёжность"], ["bal", "Баланс"], ["odr", "ОПиУ"], ["cf", "ДДС"], ["tax", "Налоги"], ["bank", "Банк"], ["credit", "Кредитная история"], ["coll", "Залог и гаранты"], ["cons", "Свод группы и прогноз"], ["an", "Анализ"]];
  const cnt = s => PROB.filter(p => p.sev === s).length;
  let h = `<div class="pagehead"><div class="lead"><h1>Проблемы и решения</h1><p>Всё, что мешает выводу: ошибки и пропуски в данных, расхождения, зоны риска и дефициты в прогнозе — с подсказкой, что делать. Ячейки с проблемами подсвечены на страницах форм.</p></div></div>
    <div class="chips" style="margin-bottom:14px">${["crit", "risk", "chk", "nd"].map(s => `<span class="st ${s}">${SEV[s]}: ${cnt(s)}</span>`).join("")}</div>`;
  if (!PROB.length) h += `<div class="empty"><h2>Проблем не найдено</h2><p class="muted">Данные заполнены, сверки сходятся, показатели вне зон риска.</p></div>`;
  for (const [id, t] of groups) {
    const list = PROB.filter(p => p.page === id || (id === "cons" && p.page === "elim"));
    if (!list.length) continue;
    h += `<section class="panel"><div class="probs-h"><h2>${t}</h2><button class="btn ghost" data-page="${id}">Перейти</button></div>${list.map(probItem).join("")}</section>`;
  }
  h += `<section class="panel"><h2>Сверки по компаниям</h2>`;
  for (let k = 1; k <= nComp(); k++) {
    const rows = pers.map(p => compChecks(k, p.id));
    h += `<h3 style="margin:12px 0 6px">${esc(compName(k))}</h3><div class="tablewrap" style="max-height:none"><table class="data chk"><thead><tr><th class="lab">Проверка</th>${pers.map(p => `<th>${esc(p.label)}</th>`).join("")}</tr></thead><tbody>`;
    rows[0].forEach((c, i) => { h += `<tr><td class="lab">${esc(c[0])}</td>${rows.map(r => `<td title="${isNum(r[i][2]) ? "разница " + fmt(r[i][2]) : ""}">${stChip(...CHK_TXT[r[i][1]])}</td>`).join("")}</tr>`; });
    h += `</tbody></table></div>`;
  }
  return h + "</section>";
}
function riskSummary(obj) {
  const L = lastPid(), cnt = { ok: 0, chk: 0, risk: 0, crit: 0, nd: 0 };
  for (const key of Object.keys(RAT)) { const s = rstatus(key, ratio(obj, key, L)); if (s) cnt[s]++; }
  let disc = discrepancies();
  if ((C.decl || []).length || (C.bank || []).length) for (let k = 1; k <= nComp(); k++) disc += taxChecks(k, C.periods[perIdx(L)] || C.periods[0]).filter(c => c.st === "risk").length;
  let miss = 0; for (let k = 1; k <= nComp(); k++) miss += missingInputs(k, L);
  const ind = miss > 0 ? ["nd", "Недостаточно данных"] : cnt.crit > 0 ? ["crit", "Критический риск"] : (cnt.risk > 0 || cnt.chk >= 3 || disc > 0) ? ["chk", "Умеренный риск — требует проверки"] : ["ok", "Приемлемый риск"];
  return { cnt, disc, miss, ind };
}
function pageConcl() {
  const rs = riskSummary(C.obj);
  return `<div class="pagehead"><div class="lead"><h1>Заключение</h1><p>Цифры и оценки подставляются автоматически из анализа; выводы и рекомендацию пишет кредитный менеджер.</p></div>
    <div class="toolbar">${objSelect()}<button class="btn primary" data-act="word">Скачать в Word</button><button class="btn" data-act="print">Печать / PDF</button></div></div>
  <section class="panel noprint"><h2>Оценка и решение</h2><p class="hint">Автоиндикатор: ${stChip(rs.ind[0], rs.ind[1])}</p><div class="grid2">
    <label class="f"><span>Рекомендация</span><select class="inp" data-concl="decision"><option value=""></option>${opts(S.lists.decision, C.concl.decision)}</select></label>
    <label class="f"><span>Статус</span><select class="inp" data-concl="status">${opts(["Черновик", "На проверке", "Утверждено"], C.concl.status)}</select></label></div>
    <label class="f" style="margin-top:12px"><span>Выводы кредитного менеджера</span><textarea class="inp" data-concl="text">${esc(C.concl.text)}</textarea></label>
    <label class="f" style="margin-top:12px"><span>Условия / ковенанты</span><textarea class="inp" data-concl="conditions" style="min-height:70px">${esc(C.concl.conditions)}</textarea></label></section>
  <section class="panel" id="conclDoc">${isOD() ? odConclusionHTML(false) : conclusionHTML(false)}</section>`;
}

/* ---------- настройка загрузки и журнал */
function pageMap() {
  const st = C.settings;
  const rows = S.mapping.map(m => `<tr><td class="lab">${esc({ B: "Баланс", P: "ОПиУ", C: "ОДДС" }[m[0]])}: ${esc(LINE[m[1]]?.label || m[1])}</td><td style="text-align:left">${esc(m[2] || "—")}</td><td style="text-align:left">${esc(m[3] || "—")}</td><td style="text-align:left">${esc(m[6] || "—")}</td>
    <td class="cell opt"><input data-custom="${m[1]}" value="${esc(C.custom?.[m[1]] || "")}" style="text-align:left" placeholder="коды через запятую"></td></tr>`).join("");
  return `<div class="pagehead"><div class="lead"><h1>Настройка загрузки форм</h1><p>Какая строка формы попадает в какую строку анализатора. Полная форма, форма МСБ и форма НСФО (малый бизнес) распознаются автоматически. Для нестандартной формы заполните колонку «Свой вариант» и выберите её ниже.</p></div></div>
  <section class="panel"><div class="grid2">
    <label class="f"><span>Единицы в файлах форм</span><span class="small muted" style="font-weight:400">выбираются в окне загрузки: «тыс. тг» или «тг»</span></label>
    <label class="f"><span>Вариант формы</span><select class="inp" data-set="variant">${[[0, "Определять автоматически"], [1, "Полная форма (приказ №404)"], [2, "Форма МСБ"], [4, "Форма НСФО (малый бизнес)"], [3, "Свой вариант"]].map(([v, t]) => `<option value="${v}"${(st.variant || 0) == v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <label class="f"><span>Предыдущий период из второй колонки формы</span><select class="inp" data-set="prev"><option value="0"${!st.prev ? " selected" : ""}>Не загружать</option><option value="1"${st.prev ? " selected" : ""}>Загружать, если ячейки пусты</option></select></label></div>
    <p class="hint" style="margin-top:12px">Анализатор считает в тыс. тг. Единицы файлов отчётности вы указываете в окне загрузки: «тыс. тг» — суммы сохраняются как есть, «тг» — делятся на 1000. Декларации, выписки и справки банков всегда в тенге и переводятся в тыс. тг автоматически. Если выбор не похож на цифры в файле (тиыны при «тыс. тг», слишком маленькие суммы при «тг»), в результате загрузки будет предупреждение.</p>
    <p class="hint">Синтаксис кодов: 010 — как в форме; *011 — по модулю; -025 — вычесть по модулю; !200 — вычесть со знаком; #текст — строка «в том числе» без кода, название которой содержит текст. Коды 010 и 10 — одно и то же.</p></section>
  <section class="panel"><h2>Справочник ОКЭД</h2><p class="hint">${Object.keys(OKED).length ? `Загружен: ${nf0.format(Object.keys(OKED).length)} кодов. Хранится в этом браузере и действует для всех клиентов.${okedKz() ? " <b>Сейчас наименования на казахском — загрузите файл заново: сайт возьмёт колонку на русском.</b>" : ""}` : "Не загружен — по коду подставляется только название раздела (2 знака)."} Загрузите классификатор ОКЭД в Excel (.xlsx или .xls), например с сайта Бюро национальной статистики: колонки кода и наименования найдутся сами.</p>
    <button class="btn" data-act="okedfile">${Object.keys(OKED).length ? "Обновить справочник ОКЭД" : "Загрузить справочник ОКЭД"}</button></section>
  ${afmPanel()}
  <div class="tablewrap"><table class="data"><thead><tr><th class="lab">Строка анализатора</th><th style="text-align:left">Полная форма</th><th style="text-align:left">Форма МСБ</th><th style="text-align:left">НСФО (малый бизнес)</th><th style="text-align:left">Свой вариант</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function pageLog() {
  const rows = C.log.map(r => `<tr><td class="lab" style="min-width:150px">${dDateTime(r.t)}</td><td style="text-align:left">${esc(r.file)}${r.sheet ? " / " + esc(r.sheet) : ""}</td><td style="text-align:left">${esc([r.comp, r.per].filter(Boolean).join(", "))}</td>
    <td style="text-align:left;white-space:normal">${r.err ? stChip("crit", "ошибка") + " " + esc(r.err) : r.kind === "PDF" ? stChip("ok", "PDF") + " " + esc(r.note || "") : `${stChip("ok", SRC_TXT[r.kind])} ${r.n} строк; ${esc(r.prof)}; ${esc(r.units)}${r.over ? "; перезаписано " + r.over : ""}${r.miss?.length ? "; нет кодов: " + esc(r.miss.join(", ")) : ""}`}</td></tr>`).join("");
  const pl = pid => C.periods.find(p => p.id === pid)?.label || "?";
  const ed = (C.edits || []).map(r => `<tr><td class="lab" style="min-width:150px">${dDateTime(r.t)}</td><td style="text-align:left">${esc(compName(r.k))}, ${esc(pl(r.pid))}</td><td style="text-align:left;white-space:normal">${esc(LINE[r.key]?.label || r.key)}</td><td>${r.old === null ? "пусто" : fmt(r.old)}</td><td>${r.v === null ? "пусто" : fmt(r.v)}</td><td style="text-align:left">${r.src ? "загружено из " + esc(r.src) : "ввод вручную"}</td></tr>`).join("");
  return `<div class="pagehead"><div class="lead"><h1>Журнал</h1><p>Загрузки файлов и ручные изменения цифр в формах — для проверки и отчёта.</p></div></div>
  <section class="panel"><h2>Ручные изменения (${(C.edits || []).length})</h2>${ed ? `<div class="tablewrap"><table class="data"><thead><tr><th class="lab">Когда</th><th style="text-align:left">Компания, период</th><th style="text-align:left">Строка</th><th>Было</th><th>Стало</th><th style="text-align:left">Источник значения</th></tr></thead><tbody>${ed}</tbody></table></div>` : `<p class="muted">Изменений вручную пока не было.</p>`}</section>
  <section class="panel"><h2>Загрузки</h2>${rows ? `<div class="tablewrap"><table class="data"><thead><tr><th class="lab">Когда</th><th style="text-align:left">Файл</th><th style="text-align:left">Куда</th><th style="text-align:left">Результат</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Загрузок пока не было.</p>`}</section>`;
}
function pageNorms() {
  const keys = Object.keys(RAT).filter(k => RAT[k].dir && RAT_DEF[k] && RAT_DEF[k].green !== null && RAT_DEF[k].green !== undefined);
  const kd = k => KIND[k] === "p" ? "p" : KIND[k] === "d" ? "d" : "x";
  const show = (k, v) => (v === null || v === undefined ? "" : kd(k) === "p" ? nf1.format(v * 100) : kd(k) === "d" ? nf0.format(v) : nf2.format(v));
  const unit = k => (kd(k) === "p" ? "%" : kd(k) === "d" ? "дней" : "×");
  return `<div class="pagehead"><div class="lead"><h1>Нормативы коэффициентов</h1><p>Пороги, по которым коэффициенты окрашиваются: «норма» (не хуже зелёного порога), «требует проверки» (до красного), «риск» и «критический риск». Свои значения действуют для всех клиентов в этом браузере. Пустая ячейка — значение по умолчанию.</p></div>
    <div class="toolbar"><button class="btn ghost" data-act="normsreset">Вернуть все по умолчанию</button></div></div>
  <div class="tablewrap"><table class="data norms"><thead><tr><th class="lab">Коэффициент</th><th>Направление</th><th>Норма (зелёный)</th><th>Проверка (красный)</th><th>Критично</th><th>Ед.</th></tr></thead><tbody>
  ${keys.map(k => { const o = RATN[k] || {}, d = RAT_DEF[k]; const cell = f => `<td class="cell"><input class="inp num" data-norm="${k}" data-f="${f}" value="${esc(o[f] !== undefined ? show(k, o[f]) : "")}" placeholder="${esc(show(k, d[f]))}"></td>`;
    return `<tr><td class="lab">${esc(RAT[k].label)}<span class="formula">${esc(RAT[k].formula || "")}</span></td><td>${esc(RAT[k].dir)}</td>${cell("green")}${cell("red")}${d.crit === null || d.crit === undefined ? "<td></td>" : cell("crit")}<td>${unit(k)}</td></tr>`; }).join("")}</tbody></table></div>${trustNormsPanel()}`;
}
const PAGES = { fin: pageFin, card: pageCard, bal: () => pageForm("bal"), odr: () => pageForm("odr"), cf: () => pageForm("cf"), tax: pageTax, bank: pageBank, credit: pageCredit, coll: pageColl, trust: pageTrust, cons: pageCons, an: pageAn, prob: pageProb, concl: pageConcl, map: pageMap, log: pageLog, norms: pageNorms };

/* ---------- диалоги */
function dialog(title, body, buttons) {
  return new Promise(res => {
    const d = $("#dlg"); $("#dlgT").textContent = title; $("#dlgB").innerHTML = body;
    $("#dlgF").innerHTML = buttons.map((b, i) => `<button class="btn ${b.primary ? "primary" : ""}" data-i="${i}">${esc(b.t)}</button>`).join("");
    $("#dlgF").onclick = e => { const i = e.target.dataset.i; if (i === undefined) return; const v = buttons[+i].v; const out = typeof v === "function" ? v(d) : v; d.close(); res(out); };
    d.onclose = () => { if (!d.open) res(undefined); };   // событие закрытия предыдущего окна приходит позже — его пропускаем
    d.showModal();
  });
}
async function askUnits(fname, mx, guess) {
  const body = `<p>Анализатор считает в тыс. тенге. В шапке форм часто написано «тысяч тенге», а цифры на самом деле в тенге.</p>
    ${mx ? `<p>Наибольшее число в файле <b>${esc(fname)}</b>: <b>${fmt(mx)}</b>.</p>` : `<p>Файлы: <b>${esc(fname)}</b>.</p>`}
    <div class="chips" role="radiogroup">${[["t", "тенге — разделить на 1000"], ["k", "тыс. тенге — как есть"], ["m", "млн тенге — умножить на 1000"]].map(([v, t]) => `<label class="btn"><input type="radio" name="u" value="${v}" ${v === guess ? "checked" : ""}> ${t}</label>`).join("")}</div>`;
  const v = await dialog("В каких единицах цифры?", body, [{ t: "Отменить", v: null }, { t: "Загрузить", primary: true, v: d => d.querySelector("input[name=u]:checked")?.value }]);
  return v ? { t: 0.001, k: 1, m: 1000 }[v] : 0;
}
const UNITS_LAST = () => { try { return localStorage.getItem("finkz.units.last") || ""; } catch (e) { return ""; } };
async function importDialog() {
  const persOpts = C.periods.map((p, i) => `<option value="${p.id}"${i === C.periods.length - 1 ? " selected" : ""}>${esc(p.label)}</option>`).join("");
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${COMP_TAB === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `<p class="muted">Баланс, ОПиУ, ОДДС и расшифровки в Excel (.xlsx, .xlsm, .xls) или PDF с текстом — можно сразу несколько файлов одной компании за один период. Из расшифровок берутся износ и амортизация, разовые доходы и расходы, дивиденды и ФОТ. Файлы читаются здесь же, в браузере, и никуда не отправляются.</p>
    <div class="grid2" style="margin:12px 0"><label class="f"><span>Компания</span><select class="inp" id="iComp">${compsOpts}</select></label><label class="f"><span>Период</span><select class="inp" id="iPer">${persOpts}</select></label></div>
    <div class="f" style="margin:4px 0 12px"><span>В каких единицах суммы в файлах отчётности?</span>
      <div class="chips" role="radiogroup" id="iUnits">${[["k", "тыс. тг — сохранить как есть"], ["t", "тг — перевести в тыс. тг"]].map(([v, t]) => `<label class="btn"><input type="radio" name="iu" value="${v}" ${UNITS_LAST() === v ? "checked" : ""}> ${t}</label>`).join("")}</div></div>
    <p class="small muted" style="margin-top:6px">PDF деклараций, выписок и справок банков тоже можно перетащить сюда — они попадут на страницы «Налоги» и «Банк»; их суммы в тенге и переводятся в тыс. тг автоматически.</p>
    <label class="drop" id="iDrop"><input type="file" id="iFiles" multiple accept=".xlsx,.xlsm,.xls,.pdf" style="display:none"><span id="iTxt">Перетащите файлы сюда или нажмите, чтобы выбрать</span></label>`;
  let files = [];
  setTimeout(() => {
    const inp = $("#iFiles"), drop = $("#iDrop"), set = fl => { files = Array.from(fl); $("#iTxt").textContent = files.map(f => f.name).join(", ") || "Файлы не выбраны"; };
    inp.onchange = () => set(inp.files);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); set(e.dataTransfer.files); };
  });
  const sel = await dialog("Загрузить формы отчётности", body, [{ t: "Отменить", v: null }, { t: "Загрузить", primary: true, v: () => ({ k: +$("#iComp").value, pid: $("#iPer").value, u: document.querySelector("input[name=iu]:checked")?.value || "" }) }]);
  if (!sel || !files.length) { if (sel) toast("Файлы не выбраны"); return; }
  // PDF: декларации, выписки, справки и кредитные отчёты — на «Налоги»/«Банк»/«Кредитная история»; остальные — как формы отчётности
  let pdfs = files.filter(f => /\.pdf$/i.test(f.name)); files = files.filter(f => !/\.pdf$/i.test(f.name));
  for (const f of pdfs.slice()) {
    try { const r = await DocParse.read(await f.arrayBuffer()); if (!r.kind && !r.pdf.noText) { const sh = pdfToSheets(r.pdf); if (sh.some(x => ["B", "P", "C", "X"].includes(detectKind(x)))) { files.push(f); pdfs = pdfs.filter(x => x !== f); } } else if (!r.kind && r.pdf.noText) { files.push(f); pdfs = pdfs.filter(x => x !== f); } } catch (e) { /* разберётся ниже */ }
  }
  if (pdfs.length && !files.length) return runDocImport(pdfs, sel.k);
  if (!sel.u) { const f = await askUnits(files.map(f => f.name).join(", "), 0, ""); if (!f) return; sel.u = f === 0.001 ? "t" : f === 1000 ? "m" : "k"; }
  try { localStorage.setItem("finkz.units.last", sel.u); } catch (e) { /* не важно */ }
  let rep = await importFiles(files, sel.k, sel.pid, askUnits, sel.u);
  // расшифровки: износ, разовые статьи, дивиденды, ФОТ — из листов без кодов строк
  const { found, stat } = await decodeFiles(files, sel.k, sel.pid, { k: 1, t: 0.001, m: 1000 }[sel.u] || 1);
  for (const f of files) if (!found.some(x => x.file === f.name) && !rep.some(r => r.eq && r.file === f.name)) rep.push({ file: f.name, dec: true, none: true, n: 0, rows: stat[f.name]?.rows || 0 });
  if (found.length) {
    const decFiles = new Set(found.map(f => f.file));
    rep = rep.filter(r => !(r.err && decFiles.has(r.file) && !r.sheet));
    const n = await decodeReview(found, sel.k, sel.pid);
    rep.push(...[...decFiles].map(f => ({ file: f, dec: true, n: n ? found.filter(x => x.file === f).length : 0 })));
  }
  if (pdfs.length) { await importDocs(pdfs, sel.k); toast("PDF загружены — см. страницы «Налоги» и «Банк»"); }
  COMP_TAB = sel.k; if (!["bal", "odr", "cf"].includes(PAGE)) PAGE = "bal"; render();
  const lines = rep.map(r => r.eq ? `<div class="logline"><b>${esc(r.file)}</b> / ${esc(r.sheet)}: ${stChip("ok", "Изменения в капитале")} ${esc(r.text)}</div>` : r.dec && r.none ? `<div class="logline small muted"><b>${esc(r.file)}</b>: расшифровки — подходящих строк не найдено${r.rows ? ` (просмотрено строк без кодов: ${r.rows})` : " (строк без кодов нет)"}. Износ, разовые статьи, дивиденды и ФОТ можно ввести вручную на странице «ОПиУ».</div>` : r.dec ? `<div class="logline"><b>${esc(r.file)}</b>: ${r.n ? stChip("ok", "Расшифровка") + " найдено строк: " + r.n + ", записано в ОПиУ" : stChip("nd", "Расшифровка") + " не записано"}</div>` : `<div class="logline"><b>${esc(r.file)}</b>${r.sheet ? " / " + esc(r.sheet) : ""}: ${r.err ? stChip("crit", "не загружено") + " " + esc(r.err) : `${stChip("ok", SRC_TXT[r.kind])} ${r.n} строк, ${esc(r.prof)}, ${esc(r.units)}${r.over ? `, перезаписано ${r.over}` : ""}${r.miss.length ? `<details class="small muted" style="margin-top:4px"><summary>Строк из шаблона нет в файле: ${r.miss.length} — это нормально, если таких строк в форме нет</summary>Коды: ${esc(r.miss.join(", "))}. Если строка в форме есть, но не загрузилась — проверьте «Настройку загрузки».</details>` : ""}`}</div>`).join("");
  await dialog("Результат загрузки", lines + `<p class="small muted" style="margin-top:10px">Загруженные значения отмечены полосой слева; проверьте их и страницу «Сверки».</p>`, [{ t: "Готово", primary: true, v: true }]);
}

/* ---------- события */
document.addEventListener("click", async e => {
  const t = e.target.closest("button, [data-act]"); if (!t) return;
  const d = t.dataset;
  if (d.page) { PAGE = d.page; render(); window.scrollTo(0, 0); return; }
  if (d.ctab) { COMP_TAB = +d.ctab; render(); return; }
  if (d.antab) { AN_TAB = d.antab; render(); return; }
  if (d.fctab !== undefined) { FC_TAB = +d.fctab; $("#fcOut").innerHTML = fcOutHTML(); return; }
  if (d.delloan !== undefined) { fcParams().loans.splice(+d.delloan, 1); touch(); render(); return; }
  if (d.deloked !== undefined) { C.card.oked.splice(+d.deloked, 1); touch(); render(); return; }
  if (d.delproj !== undefined) { fcParams().projects.splice(+d.delproj, 1); touch(); render(); return; }
  if (d.open) { C = CLIENTS.find(c => c.id === d.open); ensureDocs(C); ensureCredit(C); CACHE.clear(); PAGE = "card"; render(); return; }
  if (d.exp) { const c = CLIENTS.find(c => c.id === d.exp); c.saved = Date.now(); download(fileName(c), JSON.stringify(c, null, 1), "application/json"); saveAll(true); render(); return; }
  if (d.del) { const c = CLIENTS.find(c => c.id === d.del); if (await dialog("Удалить клиента?", `<p>«${esc(c.card.name)}» будет удалён из этого браузера. Если нужна копия — сначала сохраните файл клиента.</p>`, [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }])) { CLIENTS = CLIENTS.filter(x => x !== c); saveAll(true); render(); } return; }
  if (d.delcomp !== undefined) { const i = +d.delcomp; C.companies.splice(i, 1); const nd = {}; Object.keys(C.data).forEach(k => { const n = +k; if (n < i + 1) nd[n] = C.data[k]; else if (n > i + 1) nd[n - 1] = C.data[k]; }); C.data = nd; if (C.obj > nComp()) C.obj = 0; touch(); render(); return; }
  if (d.delper !== undefined) { C.periods.splice(+d.delper, 1); touch(); render(); return; }
  switch (d.act) {
    case "clients": C = null; render(); break;
    case "new": { const c = newClient(); CLIENTS.push(c); C = c; PAGE = "card"; saveAll(true); render(); break; }
    case "demo": { const c = demoClient(); CLIENTS.push(c); C = c; PAGE = "an"; saveAll(true); render(); break; }
    case "export": C.saved = Date.now(); download(fileName(C), JSON.stringify(C, null, 1), "application/json"); saveAll(true); toast("Файл клиента сохранён в «Загрузки»"); break;
    case "import": { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json"; inp.onchange = async () => { try {
      const o = JSON.parse(await inp.files[0].text());
      if (o && o.type === "finkz-backup" && Array.isArray(o.clients)) {   // резервная копия всех клиентов
        let n = 0; for (const c of o.clients) { if (!c.card || !c.periods) continue; c.saved = Date.now(); const ex = CLIENTS.findIndex(x => x.id === c.id); if (ex >= 0) CLIENTS[ex] = c; else CLIENTS.push(c); n++; }
        saveAll(true); C = null; render(); toast("Восстановлено клиентов: " + n); return;
      }
      const c = o; if (!c.card || !c.periods) throw new Error("это не файл клиента"); c.saved = Date.now(); const ex = CLIENTS.findIndex(x => x.id === c.id); if (ex >= 0) CLIENTS[ex] = c; else CLIENTS.push(c); saveAll(true); C = c; ensureDocs(C); ensureCredit(C); CACHE.clear(); render(); toast("Клиент открыт из файла"); } catch (err) { toast("Не удалось открыть: " + err.message); } }; inp.click(); break; }
    case "backup": { const t = Date.now(); for (const c of CLIENTS) c.saved = t; download(`Финанализ_все_клиенты_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ type: "finkz-backup", created: new Date().toISOString(), clients: CLIENTS }, null, 1), "application/json"); saveAll(true); render(); toast("Все клиенты сохранены в «Загрузки». Файл не зашифрован — храните его в надёжном месте."); break; }
    case "lock": lockNow(); break;
    case "clearform": {
      const block = d.block, k = COMP_TAB > nComp() ? 1 : COMP_TAB, ttl = FORM_INTRO[block][0];
      const body = `<p>Удалить введённые и загруженные значения формы «${esc(ttl)}»${nComp() > 1 ? ` компании <b>${esc(compName(k))}</b>` : ""}.</p>
        <label class="f" style="margin-top:10px;max-width:320px"><span>Период</span><select class="inp" id="clrPer"><option value="">все периоды</option>${C.periods.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join("")}</select></label>
        <p class="small muted" style="margin-top:10px">Нельзя отменить. Если нужна копия — сначала сохраните файл клиента.</p>`;
      const per = await dialog("Очистить данные формы?", body, [{ t: "Отменить", v: null }, { t: "Очистить", primary: true, v: dd => ({ pid: dd.querySelector("#clrPer").value }) }]);
      if (!per) break;
      const keys = INPUT_KEYS.filter(key => LINE[key].block === block); let n = 0;
      for (const key of keys) for (const p of C.periods) {
        if (per.pid && p.id !== per.pid) continue;
        if (C.data?.[k]?.[key] && C.data[k][key][p.id] !== undefined && C.data[k][key][p.id] !== null) { delete C.data[k][key][p.id]; n++; }
        if (C.src?.[k]?.[key]) delete C.src[k][key][p.id];
      }
      C.log.unshift({ t: new Date().toISOString(), file: "—", comp: compName(k), per: per.pid ? C.periods.find(p => p.id === per.pid)?.label : "все периоды", kind: "PDF", note: `очищена форма «${ttl}»: удалено значений ${n}` });
      touch(); render(); toast(`Удалено значений: ${n}`); break;
    }
    case "normsreset": if (await dialog("Вернуть нормативы по умолчанию?", "<p>Все свои пороги будут удалены.</p>", [{ t: "Отменить", v: false }, { t: "Вернуть", primary: true, v: true }])) { RATN = {}; try { localStorage.removeItem(RATN_KEY); } catch (e) { /* — */ } applyRatn(); CACHE.clear(); render(); } break;
    case "pinset": pinDialog(); break;
    case "pinoff": { if (await dialog("Снять ПИН-код?", "<p>Данные в браузере будут храниться без шифрования.</p>", [{ t: "Отменить", v: false }, { t: "Снять", primary: true, v: true }])) { removePin(); render(); toast("ПИН-код снят"); } break; }
    case "addcomp": C.companies.push({ name: "", bin: "", role: S.lists.role[0], form: S.lists.form[0], vat: "Да", regime: S.lists.regime[0] }); touch(); render(); break;
    case "addper": { const l = C.periods[C.periods.length - 1], y = parseInt(l?.date?.slice(0, 4) || new Date().getFullYear(), 10) + 1; C.periods.push({ id: uid(), label: String(y), date: `${y}-12-31`, basis: "Годовой", months: 12 }); touch(); render(); break; }
    case "addq": {
      const l = C.periods[C.periods.length - 1], lq = l ? perQ(l) : "";
      let y = +(l?.date || "").slice(0, 4) || new Date().getFullYear(), q = 1;
      if (lq) { q = +lq[1] + 1; if (q > 4) { q = 1; y++; } } else y++;
      const p = { id: uid(), label: "", date: "", basis: l && lq ? l.basis : "Нарастающим итогом", months: 3 };
      setPeriod(p, y, "Q" + q); C.periods.push(p); touch(); render(); break;
    }
    case "addperfirst": { const f = C.periods[0], y = parseInt(f?.date?.slice(0, 4) || new Date().getFullYear(), 10) - 1; C.periods.unshift({ id: uid(), label: String(y), date: `${y}-12-31`, basis: "Годовой", months: 12 }); touch(); render(); break; }
    case "importdlg": importDialog(); break;
    case "addoked": if (C.card.oked.length < MAX_OKED) C.card.oked.push({ code: "", name: "" }); touch(); render(); break;
    case "okedfile": { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm,.xls"; inp.onchange = async () => { try { const n = await loadOkedFile(inp.files[0]); if (C && C.card.oked) { for (const o of C.card.oked) if (!o.manual && o.code && (!o.name || KZ_LET.test(o.name))) o.name = okedLookup(o.code)?.name || o.name; touch(); } toast("Справочник ОКЭД загружен: " + nf0.format(n) + " кодов"); render(); } catch (err) { toast("Не удалось загрузить справочник: " + err.message); } }; inp.click(); break; }
    case "addloan": { const f = fcParams(); f.loans = f.loans || []; if (!f.loans.length) { const d = ratio(C.obj, "debt", lastPid()); if (isNum(d) && d > 0) f.loans.push({ name: "Долг по балансу", bal: d, rate: f.aggRate, rem: f.aggTerm, scheme: "Дифференцированный", grace: 0 }); else f.loans.push({ name: "", bal: 0, rate: 0.16, rem: 36, scheme: "Дифференцированный", grace: 0 }); } else f.loans.push({ name: "", bal: 0, rate: 0.16, rem: 36, scheme: "Дифференцированный", grace: 0 }); touch(); render(); break; }
    case "addproj": { const f = fcParams(); f.projects = f.projects || []; f.projects.push({ name: "", amt: 0, start: 3, dur: 3, own: 0.3 }); touch(); render(); break; }
    case "word": exportWord(); break;
    case "print": window.print(); break;
  }
});
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset;
  if (!C) return;
  if (d.key) {
    const v = parseNum(t.value);
    if (t.value.trim() !== "" && v === null) { toast("Не число: «" + t.value + "» — значение не сохранено"); t.value = fmt(rawComp(+d.k, d.key, d.pid)); return; }
    C.data[d.k] = C.data[d.k] || {}; C.data[d.k][d.key] = C.data[d.k][d.key] || {};
    const old = C.data[d.k][d.key][d.pid];
    if ((old ?? null) !== (v ?? null)) { C.edits = C.edits || []; C.edits.unshift({ t: new Date().toISOString(), k: +d.k, key: d.key, pid: d.pid, old: old ?? null, v, src: C.src?.[d.k]?.[d.key]?.[d.pid]?.file || "" }); C.edits = C.edits.slice(0, 500); }
    C.data[d.k][d.key][d.pid] = v;
    if (C.src?.[d.k]?.[d.key]?.[d.pid]) C.src[d.k][d.key][d.pid].status = "Изменено вручную";
    t.value = fmt(v); touch(); refreshCalc(); return;
  }
  if (d.elim) { const v = parseNum(t.value); C.elim[d.elim] = C.elim[d.elim] || {}; C.elim[d.elim][d.pid] = v; t.value = fmt(v); touch(); refreshCalc(); return; }
  if (d.fc) {
    const path = d.fc.split("."), f = fcParams(); let o = f; for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    const last = path[path.length - 1];
    if (d.numsel !== undefined) { o[last] = +t.value; touch(); render(); return; }
    if (t.tagName === "SELECT" || last === "name") o[last] = t.value;
    else { let v = parseNum(t.value); if (v === null) { toast("Не число: «" + t.value + "»"); return; } if (d.pct !== undefined) v = v / 100; o[last] = v; t.value = fmt(d.pct !== undefined ? v * 100 : v, d.pct !== undefined ? "m1" : "m"); }
    touch(); refreshCalc(); return;
  }
  if (d.elimok) { C.elimOk[d.elimok] = t.checked; touch(); refreshCalc(); return; }
  if (d.oked !== undefined) {
    const o = C.card.oked[+d.oked];
    if (d.f === "code") {
      const dg = okedDigits(t.value); o.code = dg ? okedFmt(dg) : ""; t.value = o.code; o.manual = false;
      const r = okedLookup(o.code); o.name = r ? r.name : "";
      const nm = document.querySelector(`input[data-oked="${d.oked}"][data-f="name"]`); if (nm) nm.value = o.name;
      const h = document.querySelector(`[data-okedhint="${d.oked}"]`); if (h) h.textContent = okedHint(o.code);
    } else { o.name = t.value; o.manual = true; }
    touch(); return;
  }
  if (d.card) { C.card[d.card] = d.num !== undefined ? parseNum(t.value) : t.value; touch(); if (d.card === "name" || d.card === "product" || (isOD() && (d.card === "amount" || d.card === "date"))) render(); return; }
  if (d.comp !== undefined) { C.companies[+d.comp][d.f] = t.value; touch(); return; }
  if (d.inact !== undefined) { C.inactive = C.inactive || {}; const k = +d.inact; C.inactive[k] = C.inactive[k] || {}; C.inactive[k][d.pid] = t.checked; touch(); render(); return; }
  if (d.role !== undefined) {
    const x = C.companies[+d.role], set = new Set(compRoles(x));
    if (t.checked) set.add(t.value); else set.delete(t.value);
    if (!set.size) { set.add(t.value); t.checked = true; toast("У компании должна быть хотя бы одна роль"); }
    x.roles = S.lists.role.filter(r => set.has(r)); x.role = x.roles.join(", "); touch(); return;
  }
  if (d.per !== undefined) {
    const p = C.periods[+d.per];
    if (d.f === "q" || d.f === "year") {
      const y = d.f === "year" ? parseInt(t.value, 10) : +(p.date || "").slice(0, 4) || new Date().getFullYear();
      if (!(y > 1990 && y < 2100)) { toast("Укажите год, например 2025"); t.value = (p.date || "").slice(0, 4); return; }
      setPeriod(p, y, d.f === "q" ? t.value : perQ(p) || "");
      touch(); render(); return;
    }
    p[d.f] = d.f === "months" ? Math.max(1, Math.min(12, parseInt(t.value, 10) || 12)) : t.value;
    if (d.f === "basis" && perQ(p)) setPeriod(p, +p.date.slice(0, 4), perQ(p));
    touch(); if (d.f === "basis") render(); return;
  }
  if (d.act === "obj") { C.obj = +t.value; touch(); render(); return; }
  if (d.concl) { C.concl[d.concl] = t.value; touch(); const doc = $("#conclDoc"); if (doc) doc.innerHTML = conclusionHTML(false); return; }
  if (d.set) { C.settings[d.set] = d.set === "units" ? t.value : +t.value; touch(); return; }
  if (d.custom) { C.custom[d.custom] = t.value.trim(); touch(); return; }
  if (d.norm) {
    const k = d.norm, kind = KIND[k], raw = t.value.trim(); RATN[k] = RATN[k] || {};
    if (raw === "") delete RATN[k][d.f]; else { let v = parseNum(raw); if (v === null) { toast("Не число: «" + raw + "»"); return; } if (kind === "p") v = v / 100; RATN[k][d.f] = v; }
    if (!Object.keys(RATN[k]).length) delete RATN[k];
    try { localStorage.setItem(RATN_KEY, JSON.stringify(RATN)); } catch (e) { /* на сеанс */ }
    applyRatn(); CACHE.clear(); PROB = problems(); paintProblemMarks(); return;
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.matches("td.cell input")) { e.preventDefault(); const td = e.target.closest("td"), tr = td.parentElement, idx = Array.from(tr.children).indexOf(td); let n = tr.nextElementSibling; while (n && !n.children[idx]?.querySelector("input")) n = n.nextElementSibling; e.target.blur(); n?.children[idx].querySelector("input").focus(); }
});
function refreshCalc() {
  document.querySelectorAll("[data-v]").forEach(td => {
    const [o, key, pid] = td.dataset.v.split("|"); const v = val(+o, key, pid);
    td.textContent = fmt(v); td.classList.toggle("neg", isNum(v) && v < 0);
  });
  PROB = problems(); paintProblemMarks();
  const out = $("#fcOut"); if (out) out.innerHTML = fcOutHTML();
  const hz = document.querySelector('select[data-fc="horizon"] option[value="0"]'); if (hz) hz.textContent = `По сроку кредита (${fcHorizon()} мес.)`;
}
const safeName = s => String(s || "клиент").replace(/[\\/:*?"<>|«»]/g, "").trim().slice(0, 60) || "клиент";
const fileName = c => `Клиент_${safeName(c.card.name)}_${new Date().toISOString().slice(0, 10)}.json`;
window.addEventListener("beforeunload", () => saveAll(true));
document.addEventListener("visibilitychange", () => { if (document.hidden) saveAll(true); });

/* ---------- блокировка ПИН-кодом */
function renderLock(msg) {
  document.body.innerHTML = `<div class="lockscr"><div class="lockbox"><div class="mark" aria-hidden="true"><span></span></div><h1>Финансовый анализ</h1><p class="muted">Данные клиентов в этом браузере защищены ПИН-кодом.</p>
    <form id="lockF"><input class="inp" id="pinIn" type="password" inputmode="numeric" autocomplete="current-password" placeholder="ПИН-код" aria-label="ПИН-код"><button class="btn primary" type="submit">Открыть</button></form>
    <p class="lockmsg" id="lockMsg">${esc(msg || "")}</p><button class="btn ghost" data-act="pinforgot">Забыли ПИН?</button><p class="copy">© 2026 Создан ОФКК Костанай</p></div></div><div id="toast" class="toast" role="status"></div>${DIALOG}`;
  const f = $("#lockF"), inp = $("#pinIn"); inp.focus();
  f.onsubmit = async e => { e.preventDefault(); $("#lockMsg").textContent = "Проверяю…"; try { await unlockPin(inp.value); C = null; armAutoLock(); render(); } catch (err) { $("#lockMsg").textContent = "Неверный ПИН-код"; inp.value = ""; inp.focus(); } };
}
async function lockNow() {
  if (!LOCK.on) return;
  clearTimeout(saveTimer); if (LOCK.key) { try { localStorage.setItem(STORE_ENC, await encStore()); } catch (e) { /* последняя версия уже сохранена */ } }
  LOCK.key = null; CLIENTS = []; C = null; CACHE.clear(); renderLock("Заблокировано");
}
async function pinDialog() {
  if (!cryptoOk()) { toast("Браузер не поддерживает шифрование"); return; }
  const body = `<p>ПИН-код шифрует данные клиентов в этом браузере. Без него открыть их нельзя — <b>восстановить забытый ПИН невозможно</b>, поэтому держите резервную копию в файле.</p>
    <div class="grid2" style="margin-top:10px"><label class="f"><span>Новый ПИН (не меньше 4 знаков)</span><input class="inp" id="p1" type="password" inputmode="numeric" autocomplete="new-password"></label><label class="f"><span>Повторите ПИН</span><input class="inp" id="p2" type="password" inputmode="numeric" autocomplete="new-password"></label></div>
    <label class="f" style="margin-top:10px;max-width:300px"><span>Блокировать при бездействии</span><select class="inp" id="pAuto">${[[5, "через 5 минут"], [15, "через 15 минут"], [30, "через 30 минут"], [60, "через 1 час"], [0, "не блокировать"]].map(([v, t]) => `<option value="${v}"${autoLockMin() == v ? " selected" : ""}>${t}</option>`).join("")}</select></label>`;
  const r = await dialog(LOCK.on ? "Сменить ПИН-код" : "Защитить ПИН-кодом", body, [{ t: "Отменить", v: null }, { t: "Сохранить", primary: true, v: d => ({ a: d.querySelector("#p1").value, b: d.querySelector("#p2").value, auto: +d.querySelector("#pAuto").value }) }]);
  if (!r) return;
  if (r.a.length < 4) { toast("ПИН — не меньше 4 знаков"); return; }
  if (r.a !== r.b) { toast("ПИН-коды не совпадают"); return; }
  try { localStorage.setItem("finkz.autolock", String(r.auto)); await setPin(r.a); armAutoLock(); render(); toast("Данные защищены ПИН-кодом"); } catch (e) { toast("Не удалось включить защиту: " + e.message); }
}
const autoLockMin = () => { try { const v = localStorage.getItem("finkz.autolock"); return v === null ? 15 : +v; } catch (e) { return 15; } };
let autoT = null;
function armAutoLock() { clearTimeout(autoT); const m = autoLockMin(); if (LOCK.on && LOCK.key && m > 0) autoT = setTimeout(lockNow, m * 60000); }
for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, () => { if (LOCK.on && LOCK.key) armAutoLock(); }, { passive: true });
document.addEventListener("click", async e => {
  if (!e.target.closest("[data-act=pinforgot]")) return;
  const ok = await dialog("Забыли ПИН-код?", "<p>Восстановить ПИН невозможно — данные зашифрованы. Можно удалить все данные в этом браузере и начать заново, а клиентов восстановить из файлов («Открыть файл клиента»).</p>", [{ t: "Отменить", v: false }, { t: "Удалить все данные", primary: true, v: true }]);
  if (ok) { localStorage.removeItem(STORE_ENC); localStorage.removeItem(STORE); LOCK.on = false; LOCK.key = null; CLIENTS = []; C = null; render(); toast("Данные удалены"); }
});
render();

/* ---------- периоды: год и квартал */
function perQ(p) {   // квартал, если дата — конец квартала и период не годовой
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(p.date || ""); if (!m) return "";
  const ends = { "03-31": 1, "06-30": 2, "09-30": 3, "12-31": 4 }, q = ends[m[1] + "-" + m[2]];
  if (!q) return "";
  if (p.basis === "Годовой" || p.basis === "LTM") return "";
  return "Q" + q;
}
function setPeriod(p, y, q) {
  if (!q) { p.date = `${y}-12-31`; if (p.basis !== "LTM") p.basis = "Годовой"; p.months = 12; p.label = String(y); return; }
  const n = +q[1], end = ["03-31", "06-30", "09-30", "12-31"][n - 1];
  p.date = `${y}-${end}`;
  if (p.basis === "Годовой" || p.basis === "LTM" || !p.basis) p.basis = "Нарастающим итогом";
  const sep = p.basis === "Отдельный период";
  p.months = sep ? 3 : 3 * n;
  p.label = sep ? `${n} кв. ${y}` : n === 4 ? `12 мес. ${y}` : `${3 * n} мес. ${y}`;
}

// роли компании (можно несколько): заёмщик и залогодатель, гарант и залогодатель и т.д.
function compRoles(x) { if (Array.isArray(x.roles) && x.roles.length) return x.roles; return String(x.role || "").split(/\s*,\s*/).filter(Boolean); }
