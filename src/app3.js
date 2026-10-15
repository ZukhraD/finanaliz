"use strict";
/* ---------------------------------------------------------------- интерфейс */
const $ = (s, el = document) => el.querySelector(s);
let PAGE = "card", COMP_TAB = 1, AN_TAB = "rat", FC_TAB = 0;
const SEV = { crit: "Критично", risk: "Риск", chk: "Проверить", nd: "Нет данных" };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600); }
function paintSaved() { const el = $("#saved"); if (el && lastSaved) el.textContent = "Сохранено в этом браузере, " + lastSaved.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
const opts = (list, cur) => list.map(x => `<option${String(x) === String(cur) ? " selected" : ""}>${esc(x)}</option>`).join("");
const stChip = (s, txt) => `<span class="st ${s}">${esc(txt ?? ST[s] ?? "")}</span>`;
const CHK_TXT = { ok: ["ok", "ОК"], bad: ["crit", "Расхождение"], nd: ["nd", "нет данных"], na: ["nd", "—"] };

function render() {
  if (!C) return renderClients();
  PROB = problems();
  const steps = [["card", "Карточка"], ["bal", "Баланс"], ["odr", "ОПиУ"], ["cf", "ДДС"], ["cons", "Свод и прогноз"], ["an", "Анализ"], ["prob", "Проблемы"], ["concl", "Заключение"]];
  if (!steps.some(st => st[0] === PAGE) && PAGE !== "map" && PAGE !== "log") PAGE = "card";
  document.body.innerHTML = `
  <div class="app">
    <nav class="rail" aria-label="Разделы">
      <div class="brand">Финансовый анализ<small>компании и группы РК · локально</small></div>
      <button class="back" data-act="clients">← К списку клиентов</button>
      <div class="client"><b>${esc(C.card.name)}</b><span class="small">${nComp()} комп. · ${C.periods.length} пер.</span></div>
      <ol class="steps">${steps.map(([id, t]) => `<li class="num"><button data-page="${id}" ${PAGE === id ? 'aria-current="page"' : ""}>${t}<span class="pdot" data-pdot="${id}"></span></button></li>`).join("")}</ol>
      <ul class="steps"><li><button data-page="map" ${PAGE === "map" ? 'aria-current="page"' : ""}>Настройка загрузки</button></li><li><button data-page="log" ${PAGE === "log" ? 'aria-current="page"' : ""}>Журнал загрузок</button></li></ul>
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
  const okedOf = c => (c.card.oked && c.card.oked[0] && c.card.oked[0].code ? "ОКЭД " + c.card.oked[0].code + (c.card.oked[0].name ? " · " + c.card.oked[0].name : "") : (c.card.activity || ""));
  const stOf = c => { const s = c.concl?.status || "Черновик"; return s === "Утверждено" ? ["ok", s] : s === "На проверке" ? ["chk", s] : ["nd", s]; };
  const done = list.filter(c => c.concl?.status === "Утверждено").length;
  const when = d => new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const rows = list.map(c => `<li class="crow" data-q="${esc((c.card.name + " " + okedOf(c) + " " + (c.card.bin || "")).toLowerCase())}">
      <div class="cmain"><b>${esc(c.card.name)}</b>${c.demo ? ' <span class="tag">пример</span>' : ""}<span class="cmeta">${esc(okedOf(c))}</span></div>
      <div class="cfacts"><span><i>Компаний</i>${c.companies.length}</span><span><i>Периоды</i>${esc(c.periods.map(p => p.label).join(", "))}</span><span><i>Изменён</i>${esc(when(c.updated))}</span></div>
      <div class="cstat">${stChip(...stOf(c))}</div>
      <div class="cact"><button class="btn primary" data-open="${c.id}">Открыть</button><button class="btn ghost" data-exp="${c.id}" title="Сохранить файл клиента">Файл</button><button class="btn ghost danger" data-del="${c.id}">Удалить</button></div></li>`).join("");
  document.body.innerHTML = `<div class="home">
    <header class="hbar"><div class="mark" aria-hidden="true"><span></span></div><b>Финансовый анализ</b><span class="hnote">работает без интернета · данные остаются на этом компьютере</span></header>
    <section class="hero">
      <div class="hblue">
        <h1>Финансовый анализ компаний и групп Казахстана</h1>
        <p>Баланс, ОПиУ и ДДС — из Excel или вручную, свод группы, коэффициенты, прогноз денежного потока до 84 месяцев, проблемы с подсказками и заключение в Word.</p>
        <div class="hbtn"><button class="btn lime" data-act="new">Новый клиент</button><button class="btn wline" data-act="import">Открыть файл клиента</button></div>
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
      <td><input class="inp" data-comp="${i}" data-f="name" value="${esc(x.name)}" placeholder="Название"></td>
      <td><input class="inp" data-comp="${i}" data-f="bin" value="${esc(x.bin)}" placeholder="12 цифр" inputmode="numeric"></td>
      <td><select class="inp" data-comp="${i}" data-f="role">${opts(S.lists.role, x.role)}</select></td>
      <td><select class="inp" data-comp="${i}" data-f="form">${opts(S.lists.form, x.form)}</select></td>
      <td><select class="inp" data-comp="${i}" data-f="vat">${opts(["Да", "Нет"], x.vat)}</select></td>
      <td><select class="inp" data-comp="${i}" data-f="regime">${opts(S.lists.regime, x.regime)}</select></td>
      <td>${nComp() > 1 ? `<button class="btn ghost danger" data-delcomp="${i}" aria-label="Удалить компанию">Удалить</button>` : ""}</td></tr>`).join("");
  const pers = C.periods.map((p, i) => `<tr><td class="lab">${i + 1}${i === C.periods.length - 1 ? " <span class='small muted'>последний</span>" : ""}</td>
      <td><input class="inp" data-per="${i}" data-f="label" value="${esc(p.label)}"></td>
      <td><input class="inp" data-per="${i}" data-f="date" type="date" value="${esc(p.date)}"></td>
      <td><select class="inp" data-per="${i}" data-f="basis">${opts(S.lists.rep, p.basis)}</select></td>
      <td><input class="inp" data-per="${i}" data-f="months" type="number" min="1" max="12" value="${esc(p.months)}"></td>
      <td>${C.periods.length > 2 ? `<button class="btn ghost danger" data-delper="${i}">Удалить</button>` : ""}</td></tr>`).join("");
  return `<div class="pagehead"><div class="lead"><h1>Карточка клиента</h1><p>Клиент, состав группы и отчётные периоды. Периоды идут от старого к новому; у всех компаний группы они одинаковые.</p></div></div>
  <section class="panel"><h2>Клиент и запрос</h2><div class="grid2">
    ${f("name", "Клиент / группа")}${f("bin", "БИН основной компании")}${f("activity", "Описание деятельности (свободно)")}${f("region", "Регион")}
    ${f("analyst", "Аналитик")}${f("date", "Дата анализа", "date")}${sel("purpose", "Цель финансирования", S.lists.fpurpose)}${sel("product", "Продукт", S.lists.product)}
    <label class="f"><span>Запрашиваемая сумма, тыс. тг</span><input class="inp" data-card="amount" data-num value="${esc(fmt(c.amount))}"></label>
    <label class="f"><span>Допуск сверок, тыс. тг</span><input class="inp" data-card="tol" data-num value="${esc(fmt(c.tol))}"></label>
  </div></section>
  ${okedPanel()}
  <section class="panel"><h2>Компании (${nComp()} из ${MAX_COMP})</h2><p class="hint">Для группы анализ строится по сумме компаний за вычетом внутригрупповых операций. БИН нужен, чтобы находить внутригрупповые операции.</p>
    <div class="tablewrap" style="max-height:none"><table class="data form"><thead><tr><th class="lab">№</th><th style="text-align:left">Название</th><th style="text-align:left">БИН / ИИН</th><th style="text-align:left">Роль</th><th style="text-align:left">Форма</th><th style="text-align:left">Плательщик НДС</th><th style="text-align:left">Налоговый режим</th><th></th></tr></thead><tbody>${comps}</tbody></table></div>
    ${nComp() < MAX_COMP ? `<p style="margin-top:10px"><button class="btn" data-act="addcomp">Добавить компанию</button></p>` : ""}</section>
  <section class="panel"><h2>Отчётные периоды (${C.periods.length} из ${MAX_PER})</h2><p class="hint">«Нарастающим итогом» — укажите число месяцев с начала года (3, 6, 9). Обороты пересчитываются в годовые как ×12/месяцев.</p>
    <div class="tablewrap" style="max-height:none"><table class="data form"><thead><tr><th class="lab">№</th><th style="text-align:left">Название</th><th style="text-align:left">Дата отчёта</th><th style="text-align:left">Основа</th><th style="text-align:left">Месяцев</th><th></th></tr></thead><tbody>${pers}</tbody></table></div>
    ${C.periods.length < MAX_PER ? `<p style="margin-top:10px"><button class="btn" data-act="addper">Добавить следующий период</button> <button class="btn ghost" data-act="addperfirst">Добавить более ранний</button></p>` : ""}</section>`;
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
    const nm = o.manual ? o.name : (okedLookup(o.code)?.name || o.name || "");
    return `<tr><td class="lab">${i === 0 ? "Основной" : "Доп. " + i}</td>
      <td><input class="inp" data-oked="${i}" data-f="code" value="${esc(o.code)}" placeholder="например, 46.90.0" inputmode="numeric" style="max-width:150px"></td>
      <td><input class="inp" data-oked="${i}" data-f="name" value="${esc(nm)}" placeholder="наименование подставится по коду"><span class="small muted" data-okedhint="${i}">${esc(okedHint(o.code))}</span></td>
      <td>${C.card.oked.length > 1 ? `<button class="btn ghost danger" data-deloked="${i}">Удалить</button>` : ""}</td></tr>`;
  }).join("");
  return `<section class="panel"><h2>Виды деятельности (ОКЭД)</h2><p class="hint">До ${MAX_OKED} кодов на клиента; первый — основной. Наименование подставляется по коду, его можно поправить вручную. ${n ? `Справочник ОКЭД загружен: ${nf0.format(n)} кодов.` : "Сейчас встроены только разделы (первые 2 цифры). Чтобы подтягивались точные наименования, один раз загрузите справочник ОКЭД на странице «Настройка загрузки»."}</p>
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
    <div class="toolbar"><button class="btn primary" data-act="importdlg">Загрузить формы из Excel</button></div></div>
  ${compTabs()}<div id="probBanner" data-page="${block}">${bannerHTML(block)}</div>
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
    h += `<tr><td class="lab">Подтверждено аналитиком</td>${pers.map(p => `<td><label><input type="checkbox" data-elimok="${p.id}" ${C.elimOk?.[p.id] ? "checked" : ""}> да</label></td>`).join("")}</tr></tbody></table></div></section>`;
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
      <h3 style="margin-top:16px">Сезонность выручки (1 = средний месяц)</h3><div class="seas">${["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"].map((m, i) => `<label class="f"><span>${m}</span>${fcIn(`seas.${i}`, f.seas[i])}</label>`).join("")}</div>
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
  const groups = [["card", "Карточка"], ["bal", "Баланс"], ["odr", "ОПиУ"], ["cf", "ДДС"], ["cons", "Свод группы и прогноз"], ["an", "Анализ"]];
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
  const disc = discrepancies();
  let miss = 0; for (let k = 1; k <= nComp(); k++) miss += missingInputs(k, L);
  const ind = miss > 0 ? ["nd", "Недостаточно данных"] : cnt.crit > 0 ? ["crit", "Критический риск"] : (cnt.risk > 0 || cnt.chk >= 3 || disc > 0) ? ["chk", "Умеренный риск — требует проверки"] : ["ok", "Приемлемый риск"];
  return { cnt, disc, miss, ind };
}
function conclusionHTML(forWord) {
  const obj = C.obj, L = lastPid(), P = prevPid(L), pers = C.periods, rs = riskSummary(obj);
  const row = (lab, key, kind, isR) => { const f = p => (p ? (isR ? ratio(obj, key, p) : val(obj, key, p)) : null); const a = f(P), b = f(L);
    return `<tr><td style="text-align:left">${lab}</td><td>${fmt(a, kind)}</td><td>${fmt(b, kind)}</td><td style="text-align:left">${isR ? (ST[rstatus(key, b)] || "") : ""}</td></tr>`; };
  const th = forWord ? ' style="border:1px solid #E5E4E2;padding:4px 8px;background:#E5E4E2"' : "";
  const tbl = `<table class="data" ${forWord ? 'style="border-collapse:collapse;font-size:10pt" border="1" cellpadding="4"' : ""}><thead><tr><th${th} style="text-align:left">Показатель</th><th${th}>${esc(pers[perIdx(P)]?.label || "")}</th><th${th}>${esc(pers[perIdx(L)]?.label || "")}</th><th${th}>Оценка</th></tr></thead><tbody>
    ${row("Выручка, тыс. тг", "rev", "m")}${row("EBITDA (годовая), тыс. тг", "ebitda_ann", "m", true)}${row("Чистая прибыль, тыс. тг", "ni", "m")}
    ${row("Итого активы, тыс. тг", "ta", "m")}${row("Капитал, тыс. тг", "eq", "m")}${row("Общий долг, тыс. тг", "debt", "m", true)}
    ${row("Текущая ликвидность", "liq_cur", "x", true)}${row("Долг / EBITDA", "debt_ebitda", "x", true)}${row("Коэффициент автономии", "eq_ratio", "x", true)}
    ${row("Покрытие процентов (EBIT)", "icr", "x", true)}${row("Денежный цикл, дней", "cycle", "d", true)}${row("DSCR (история)", "dscr_hist", "x", true)}</tbody></table>`;
  const flagged = Object.keys(RAT).filter(k => ["risk", "crit"].includes(rstatus(k, ratio(obj, k, L)))).map(k => `${RAT[k].label}: ${fmt(ratio(obj, k, L), KIND[k])} — ${ST[rstatus(k, ratio(obj, k, L))].toLowerCase()}`);
  const c = C.card;
  return `<h1>Заключение по финансовому анализу</h1>
  <p><b>${esc(c.name)}</b>${c.bin ? ", БИН " + esc(c.bin) : ""}. ${esc(c.activity || "")}</p>${okedListText(C) ? `<p>ОКЭД: ${esc(okedListText(C))}</p>` : ""}
  <p>Объект анализа: ${esc(objName(obj))}. Периоды: ${esc(pers.map(p => p.label).join(", "))}. Запрос: ${esc(c.product || "")}, ${isNum(c.amount) ? fmt(c.amount) + " тыс. тг" : "сумма не указана"}; цель — ${esc((c.purpose || "").toLowerCase())}.</p>
  <h2 style="margin-top:14px">Ключевые показатели</h2>${tbl}
  <h2 style="margin-top:14px">Оценка риска (автоиндикатор)</h2>
  <p><b>${esc(rs.ind[1])}</b>. Показателей в норме: ${rs.cnt.ok}, требуют проверки: ${rs.cnt.chk}, в зоне риска: ${rs.cnt.risk}, критических: ${rs.cnt.crit}. Расхождений в сверках: ${rs.disc}. Незаполненных обязательных строк в последнем периоде: ${rs.miss}.</p>
  ${flagged.length ? `<p>Обратить внимание:</p><ul>${flagged.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  <h2 style="margin-top:14px">Выводы аналитика</h2><p class="concl-text">${esc(C.concl.text || "—")}</p>
  <h2 style="margin-top:14px">Рекомендация</h2><p><b>${esc(C.concl.decision || "не выбрана")}</b></p>${C.concl.conditions ? `<p class="concl-text">${esc(C.concl.conditions)}</p>` : ""}
  <p class="small muted" style="margin-top:18px">Аналитик: ${esc(c.analyst || "—")}. Дата: ${esc(c.date || "")}. Статус: ${esc(C.concl.status)}. Автоиндикатор не заменяет решение аналитика.</p>`;
}
function pageConcl() {
  const rs = riskSummary(C.obj);
  return `<div class="pagehead"><div class="lead"><h1>Заключение</h1><p>Цифры и оценки подставляются автоматически из анализа; выводы и рекомендацию пишет аналитик.</p></div>
    <div class="toolbar">${objSelect()}<button class="btn primary" data-act="word">Скачать в Word</button><button class="btn" data-act="print">Печать / PDF</button></div></div>
  <section class="panel noprint"><h2>Оценка и решение</h2><p class="hint">Автоиндикатор: ${stChip(rs.ind[0], rs.ind[1])}</p><div class="grid2">
    <label class="f"><span>Рекомендация</span><select class="inp" data-concl="decision"><option value=""></option>${opts(S.lists.decision, C.concl.decision)}</select></label>
    <label class="f"><span>Статус</span><select class="inp" data-concl="status">${opts(["Черновик", "На проверке", "Утверждено"], C.concl.status)}</select></label></div>
    <label class="f" style="margin-top:12px"><span>Выводы аналитика</span><textarea class="inp" data-concl="text">${esc(C.concl.text)}</textarea></label>
    <label class="f" style="margin-top:12px"><span>Условия / ковенанты</span><textarea class="inp" data-concl="conditions" style="min-height:70px">${esc(C.concl.conditions)}</textarea></label></section>
  <section class="panel" id="conclDoc">${conclusionHTML(false)}</section>`;
}

/* ---------- настройка загрузки и журнал */
function pageMap() {
  const st = C.settings;
  const rows = S.mapping.map(m => `<tr><td class="lab">${esc({ B: "Баланс", P: "ОПиУ", C: "ОДДС" }[m[0]])}: ${esc(LINE[m[1]]?.label || m[1])}</td><td style="text-align:left">${esc(m[2] || "—")}</td><td style="text-align:left">${esc(m[3] || "—")}</td>
    <td class="cell opt"><input data-custom="${m[1]}" value="${esc(C.custom?.[m[1]] || "")}" style="text-align:left" placeholder="коды через запятую"></td></tr>`).join("");
  return `<div class="pagehead"><div class="lead"><h1>Настройка загрузки форм</h1><p>Какая строка формы попадает в какую строку анализатора. Полная форма и форма МСБ распознаются автоматически. Для нестандартной формы заполните колонку «Свой вариант» и выберите её ниже.</p></div></div>
  <section class="panel"><div class="grid2">
    <label class="f"><span>Единицы в файлах форм</span><select class="inp" data-set="units">${[["auto", "Определять автоматически и переводить в тыс. тг"], ["ask", "Спрашивать при каждой загрузке"], ["t", "Всегда тенге"], ["k", "Всегда тыс. тенге"], ["m", "Всегда млн тенге"]].map(([v, t]) => `<option value="${v}"${st.units === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <label class="f"><span>Вариант формы</span><select class="inp" data-set="variant">${[[0, "Определять автоматически"], [1, "Полная форма (приказ №404)"], [2, "Форма МСБ"], [3, "Свой вариант"]].map(([v, t]) => `<option value="${v}"${(st.variant || 0) == v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <label class="f"><span>Предыдущий период из второй колонки формы</span><select class="inp" data-set="prev"><option value="0"${!st.prev ? " selected" : ""}>Не загружать</option><option value="1"${st.prev ? " selected" : ""}>Загружать, если ячейки пусты</option></select></label></div>
    <p class="hint" style="margin-top:12px">Анализатор считает в тыс. тг. При автоматическом режиме единицы файла определяются по масштабу других периодов компании или по величине чисел, и значения сразу приводятся к тыс. тг; в журнале видно, что было сделано.</p>
    <p class="hint">Синтаксис кодов: 010 — как в форме; *011 — по модулю; -025 — вычесть по модулю; !200 — вычесть со знаком; #текст — строка «в том числе» без кода, название которой содержит текст. Коды 010 и 10 — одно и то же.</p></section>
  <section class="panel"><h2>Справочник ОКЭД</h2><p class="hint">${Object.keys(OKED).length ? `Загружен: ${nf0.format(Object.keys(OKED).length)} кодов. Хранится в этом браузере и действует для всех клиентов.` : "Не загружен — по коду подставляется только название раздела (2 знака)."} Загрузите классификатор ОКЭД в Excel (.xlsx), например с сайта Бюро национальной статистики: колонки кода и наименования найдутся сами.</p>
    <button class="btn" data-act="okedfile">${Object.keys(OKED).length ? "Обновить справочник ОКЭД" : "Загрузить справочник ОКЭД"}</button></section>
  <div class="tablewrap"><table class="data"><thead><tr><th class="lab">Строка анализатора</th><th style="text-align:left">Полная форма</th><th style="text-align:left">Форма МСБ</th><th style="text-align:left">Свой вариант</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function pageLog() {
  const rows = C.log.map(r => `<tr><td class="lab" style="min-width:150px">${new Date(r.t).toLocaleString("ru-RU")}</td><td style="text-align:left">${esc(r.file)}${r.sheet ? " / " + esc(r.sheet) : ""}</td><td style="text-align:left">${esc(r.comp || "")}, ${esc(r.per || "")}</td>
    <td style="text-align:left;white-space:normal">${r.err ? stChip("crit", "ошибка") + " " + esc(r.err) : `${stChip("ok", SRC_TXT[r.kind])} ${r.n} строк; ${esc(r.prof)}; ${esc(r.units)}${r.over ? "; перезаписано " + r.over : ""}${r.miss?.length ? "; нет кодов: " + esc(r.miss.join(", ")) : ""}`}</td></tr>`).join("");
  return `<div class="pagehead"><div class="lead"><h1>Журнал загрузок</h1><p>Что, когда и из какого файла загружено.</p></div></div>
  ${rows ? `<div class="tablewrap"><table class="data"><thead><tr><th class="lab">Когда</th><th style="text-align:left">Файл</th><th style="text-align:left">Куда</th><th style="text-align:left">Результат</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><h2>Загрузок пока не было</h2><p class="muted">Формы загружаются на странице «Отчётность».</p></div>`}`;
}
const PAGES = { card: pageCard, bal: () => pageForm("bal"), odr: () => pageForm("odr"), cf: () => pageForm("cf"), cons: pageCons, an: pageAn, prob: pageProb, concl: pageConcl, map: pageMap, log: pageLog };

/* ---------- диалоги */
function dialog(title, body, buttons) {
  return new Promise(res => {
    const d = $("#dlg"); $("#dlgT").textContent = title; $("#dlgB").innerHTML = body;
    $("#dlgF").innerHTML = buttons.map((b, i) => `<button class="btn ${b.primary ? "primary" : ""}" data-i="${i}">${esc(b.t)}</button>`).join("");
    $("#dlgF").onclick = e => { const i = e.target.dataset.i; if (i === undefined) return; const v = buttons[+i].v; const out = typeof v === "function" ? v(d) : v; d.close(); res(out); };
    d.onclose = () => res(undefined);
    d.showModal();
  });
}
async function askUnits(fname, mx, guess) {
  const body = `<p>Анализатор считает в тыс. тенге. В шапке форм часто написано «тысяч тенге», а цифры на самом деле в тенге.</p>
    <p>Наибольшее число в файле <b>${esc(fname)}</b>: <b>${fmt(mx)}</b>.</p>
    <div class="chips" role="radiogroup">${[["t", "тенге — разделить на 1000"], ["k", "тыс. тенге — как есть"], ["m", "млн тенге — умножить на 1000"]].map(([v, t]) => `<label class="btn"><input type="radio" name="u" value="${v}" ${v === guess ? "checked" : ""}> ${t}</label>`).join("")}</div>`;
  const v = await dialog("В каких единицах цифры?", body, [{ t: "Отменить", v: null }, { t: "Загрузить", primary: true, v: d => d.querySelector("input[name=u]:checked")?.value }]);
  return v ? { t: 0.001, k: 1, m: 1000 }[v] : 0;
}
async function importDialog() {
  const persOpts = C.periods.map((p, i) => `<option value="${p.id}"${i === C.periods.length - 1 ? " selected" : ""}>${esc(p.label)}</option>`).join("");
  const compsOpts = C.companies.map((x, i) => `<option value="${i + 1}"${COMP_TAB === i + 1 ? " selected" : ""}>К${i + 1} · ${esc(x.name || "без названия")}</option>`).join("");
  const body = `<p class="muted">Баланс, ОПиУ и ОДДС в Excel (.xlsx, .xlsm) — можно сразу несколько файлов одной компании за один период. Файлы читаются здесь же, в браузере, и никуда не отправляются.</p>
    <div class="grid2" style="margin:12px 0"><label class="f"><span>Компания</span><select class="inp" id="iComp">${compsOpts}</select></label><label class="f"><span>Период</span><select class="inp" id="iPer">${persOpts}</select></label></div>
    <label class="drop" id="iDrop"><input type="file" id="iFiles" multiple accept=".xlsx,.xlsm" style="display:none"><span id="iTxt">Перетащите файлы сюда или нажмите, чтобы выбрать</span></label>`;
  let files = [];
  setTimeout(() => {
    const inp = $("#iFiles"), drop = $("#iDrop"), set = fl => { files = Array.from(fl); $("#iTxt").textContent = files.map(f => f.name).join(", ") || "Файлы не выбраны"; };
    inp.onchange = () => set(inp.files);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); set(e.dataTransfer.files); };
  });
  const sel = await dialog("Загрузить формы отчётности", body, [{ t: "Отменить", v: null }, { t: "Загрузить", primary: true, v: () => ({ k: +$("#iComp").value, pid: $("#iPer").value }) }]);
  if (!sel || !files.length) { if (sel) toast("Файлы не выбраны"); return; }
  const rep = await importFiles(files, sel.k, sel.pid, askUnits);
  COMP_TAB = sel.k; if (!["bal", "odr", "cf"].includes(PAGE)) PAGE = "bal"; render();
  const lines = rep.map(r => `<div class="logline"><b>${esc(r.file)}</b>${r.sheet ? " / " + esc(r.sheet) : ""}: ${r.err ? stChip("crit", "не загружено") + " " + esc(r.err) : `${stChip("ok", SRC_TXT[r.kind])} ${r.n} строк, ${esc(r.prof)}, ${esc(r.units)}${r.over ? `, перезаписано ${r.over}` : ""}${r.miss.length ? `<br><span class="small muted">В файле нет кодов: ${esc(r.miss.join(", "))}</span>` : ""}`}</div>`).join("");
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
  if (d.open) { C = CLIENTS.find(c => c.id === d.open); CACHE.clear(); PAGE = "card"; render(); return; }
  if (d.exp) { const c = CLIENTS.find(c => c.id === d.exp); download(fileName(c), JSON.stringify(c, null, 1), "application/json"); return; }
  if (d.del) { const c = CLIENTS.find(c => c.id === d.del); if (await dialog("Удалить клиента?", `<p>«${esc(c.card.name)}» будет удалён из этого браузера. Если нужна копия — сначала сохраните файл клиента.</p>`, [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }])) { CLIENTS = CLIENTS.filter(x => x !== c); saveAll(true); render(); } return; }
  if (d.delcomp !== undefined) { const i = +d.delcomp; C.companies.splice(i, 1); const nd = {}; Object.keys(C.data).forEach(k => { const n = +k; if (n < i + 1) nd[n] = C.data[k]; else if (n > i + 1) nd[n - 1] = C.data[k]; }); C.data = nd; if (C.obj > nComp()) C.obj = 0; touch(); render(); return; }
  if (d.delper !== undefined) { C.periods.splice(+d.delper, 1); touch(); render(); return; }
  switch (d.act) {
    case "clients": C = null; render(); break;
    case "new": { const c = newClient(); CLIENTS.push(c); C = c; PAGE = "card"; saveAll(true); render(); break; }
    case "demo": { const c = demoClient(); CLIENTS.push(c); C = c; PAGE = "an"; saveAll(true); render(); break; }
    case "export": download(fileName(C), JSON.stringify(C, null, 1), "application/json"); toast("Файл клиента сохранён в «Загрузки»"); break;
    case "import": { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json"; inp.onchange = async () => { try { const c = JSON.parse(await inp.files[0].text()); if (!c.card || !c.periods) throw new Error("это не файл клиента"); const ex = CLIENTS.findIndex(x => x.id === c.id); if (ex >= 0) CLIENTS[ex] = c; else CLIENTS.push(c); saveAll(true); C = c; CACHE.clear(); render(); toast("Клиент открыт из файла"); } catch (err) { toast("Не удалось открыть: " + err.message); } }; inp.click(); break; }
    case "addcomp": C.companies.push({ name: "", bin: "", role: S.lists.role[0], form: S.lists.form[0], vat: "Да", regime: S.lists.regime[0] }); touch(); render(); break;
    case "addper": { const l = C.periods[C.periods.length - 1], y = parseInt(l?.date?.slice(0, 4) || new Date().getFullYear(), 10) + 1; C.periods.push({ id: uid(), label: String(y), date: `${y}-12-31`, basis: "Годовой", months: 12 }); touch(); render(); break; }
    case "addperfirst": { const f = C.periods[0], y = parseInt(f?.date?.slice(0, 4) || new Date().getFullYear(), 10) - 1; C.periods.unshift({ id: uid(), label: String(y), date: `${y}-12-31`, basis: "Годовой", months: 12 }); touch(); render(); break; }
    case "importdlg": importDialog(); break;
    case "addoked": if (C.card.oked.length < MAX_OKED) C.card.oked.push({ code: "", name: "" }); touch(); render(); break;
    case "okedfile": { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm"; inp.onchange = async () => { try { const n = await loadOkedFile(inp.files[0]); toast("Справочник ОКЭД загружен: " + nf0.format(n) + " кодов"); render(); } catch (err) { toast("Не удалось загрузить справочник: " + err.message); } }; inp.click(); break; }
    case "addloan": { const f = fcParams(); f.loans = f.loans || []; if (!f.loans.length) { const d = ratio(C.obj, "debt", lastPid()); if (isNum(d) && d > 0) f.loans.push({ name: "Долг по балансу", bal: d, rate: f.aggRate, rem: f.aggTerm, scheme: "Дифференцированный", grace: 0 }); else f.loans.push({ name: "", bal: 0, rate: 0.16, rem: 36, scheme: "Дифференцированный", grace: 0 }); } else f.loans.push({ name: "", bal: 0, rate: 0.16, rem: 36, scheme: "Дифференцированный", grace: 0 }); touch(); render(); break; }
    case "addproj": { const f = fcParams(); f.projects = f.projects || []; f.projects.push({ name: "", amt: 0, start: 3, dur: 3, own: 0.3 }); touch(); render(); break; }
    case "word": { const html = `<html><head><meta charset="utf-8"><style>body{font-family:Roboto,Calibri,Arial;font-size:11pt;color:#272727}h1,h2{font-family:'Futura PT','Century Gothic',Arial;color:#272727}h1{font-size:16pt;border-bottom:3pt solid #023DFF;padding-bottom:4pt}h2{font-size:13pt;color:#023DFF}.small,.muted{font-family:Verdana;font-size:8pt;color:#666}td,th{border:1px solid #E5E4E2;padding:3px 6px;text-align:right}</style></head><body>${conclusionHTML(true)}</body></html>`; download(`Заключение_${safeName(C.card.name)}.doc`, "﻿" + html, "application/msword"); break; }
    case "print": window.print(); break;
  }
});
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset;
  if (!C) return;
  if (d.key) {
    const v = parseNum(t.value);
    if (t.value.trim() !== "" && v === null) { toast("Не число: «" + t.value + "» — значение не сохранено"); t.value = fmt(rawComp(+d.k, d.key, d.pid)); return; }
    C.data[d.k] = C.data[d.k] || {}; C.data[d.k][d.key] = C.data[d.k][d.key] || {}; C.data[d.k][d.key][d.pid] = v;
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
  if (d.card) { C.card[d.card] = d.num !== undefined ? parseNum(t.value) : t.value; touch(); if (d.card === "name") render(); return; }
  if (d.comp !== undefined) { C.companies[+d.comp][d.f] = t.value; touch(); return; }
  if (d.per !== undefined) { const p = C.periods[+d.per]; p[d.f] = d.f === "months" ? Math.max(1, Math.min(12, parseInt(t.value, 10) || 12)) : t.value; touch(); return; }
  if (d.act === "obj") { C.obj = +t.value; touch(); render(); return; }
  if (d.concl) { C.concl[d.concl] = t.value; touch(); const doc = $("#conclDoc"); if (doc) doc.innerHTML = conclusionHTML(false); return; }
  if (d.set) { C.settings[d.set] = d.set === "units" ? t.value : +t.value; touch(); return; }
  if (d.custom) { C.custom[d.custom] = t.value.trim(); touch(); return; }
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
render();
