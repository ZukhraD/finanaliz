"use strict";
/* ---------------------------------------------------------------- Расшифровки (Excel без кодов строк): износ и амортизация, разовые доходы/расходы,
   дивиденды, ФОТ. Строки находятся по названию, суммы — из колонки отчётного периода; перед записью — окно проверки. */
const DEC_RULES = [
  { key: "da", re: /(амортизац|(?:^|[^а-яё])износ|истощени)/, not: /(накоплен|на\s+начало|на\s+конец|остаточн|первоначальн|балансов|(?:^|[^а-яё])ос\s+на)/, why: "износ и амортизация" },
  { key: "div", re: /дивиденд/, not: /(получен|к\s+получению|доход\S*\s+(в\s+виде|по|от)\s+дивиденд|налог)/, why: "дивиденды объявленные / начисленные" },
  { key: "fot", re: /(заработн\S*\s+плат|оплат\S*\s+труда|фонд\S*\s+оплат|(?:^|[^а-яё])фот(?![а-яё])|зарплат|вознагражден\S*\s+работник|расход\S*\s+на\s+персонал|оклад)/, not: /(задолжен|обязательств|налог|отчислен|взнос|осмс|опв|социальн|резерв|отпуск)/, why: "оплата труда" },
  { key: "nonrec", sign: 1, re: /(списани\S*\s+(кредиторск|обязательств)|доход\S*\s+от\s+(выбыти|реализаци|продаж)\S*\s+(основн|(?:ос|нма)(?![а-яё])|актив|имуществ|долгосроч)|прибыл\S*\s+от\s+(выбыти|реализаци)|безвозмездн\S*\s+получ|страхов\S*\s+возмещ|положительн\S*\s+курсов|доход\S*\s+от\s+курсов|курсов\S*\s+разниц\S*\s*\(?\s*доход|восстановлени\S*\s+(обесцен|резерв|убытк)|штраф\S*\s+(получ|к\s+получ)|неустойк\S*\s+получ|доход\S*\s+от\s+(переоценк|списани))/, why: "разовый доход" },
  { key: "nonrec", sign: -1, re: /(убыт\S*\s+от\s+(выбыти|реализаци|обесцен|продаж|переоценк)|расход\S*\s+(по|от)\s+(выбыти|реализаци\S*\s+(основн|ос(?![а-яё])))|обесценени|списани\S*\s+(дебиторск|запас|тмз|основн|актив|безнадеж|нма|недостач)|отрицательн\S*\s+курсов|расход\S*\s+(по|от)\s+курсов|курсов\S*\s+разниц\S*\s*\(?\s*расход|(?:^|[^а-яё])штраф|(?:^|[^а-яё])пени(?![а-яё])|неустойк|спонсор|благотвор|безвозмездн\S*\s+(переда|переч)|недостач|хищени|чрезвычайн|расход\S*\s+на\s+ликвидац)/, why: "разовый расход" },
];
const DEC_KEYS = { da: "Износ и амортизация", nonrec: "Разовые доходы/(расходы), нетто", div: "Дивиденды объявленные", fot: "ФОТ (оплата труда)" };

// колонка суммы отчётного периода: по году периода или «отчётный / текущий» в шапке; иначе — колонка, где чаще всего стоят суммы
function decPickCol(rows, year, form) {
  for (let r = 1; r <= Math.min(rows.length - 1, 15); r++) {
    const row = rows[r]; if (!row) continue;
    for (let c = 1; c < row.length; c++) {
      const v = row[c];
      if (c > 1 && typeof v === "string" && v.length < 60 && ((year && new RegExp("(^|\\D)" + year + "(\\D|$)").test(v)) || /(отчетн|отчётн|текущ)\S*\s+(период|год)/i.test(v))) return c;
    }
  }
  const cnt = {};
  for (let r = 1; r < Math.min(rows.length, 600); r++) { const row = rows[r]; if (!row) continue; for (let c = 2; c < row.length; c++) { const v = row[c]; if (typeof v === "number" && (Math.abs(v) >= 100 || v % 1)) cnt[c] = (cnt[c] || 0) + 1; } }
  const best = Object.entries(cnt).sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
  return best ? +best[0] : 0;
}
function decParseSheet(sh, year, form) {
  const rows = sh.rows, col = decPickCol(rows, year, form), out = [];
  // колонка кодов строк формы: в первых колонках, где чаще всего стоят коды 001–999
  let codeCol = 0;
  if (form) { const cc = {}; for (let r = 1; r < Math.min(rows.length, 400); r++) { const row = rows[r]; if (!row) continue; for (let c = 1; c <= Math.min(5, row.length - 1); c++) if (c !== col && normCode(row[c])) cc[c] = (cc[c] || 0) + 1; } const b = Object.entries(cc).sort((x, y) => y[1] - x[1])[0]; if (b && b[1] >= 3) codeCol = +b[0]; }
  let ctx = normTxt(sh.name), scanned = 0;
  for (let r = 1; r < Math.min(rows.length, 1500); r++) {
    const row = rows[r]; if (!row) continue;
    const texts = [], nums = [];
    let coded = false;
    for (let c = 1; c < row.length; c++) {
      const v = row[c];
      if (typeof v === "string" && /[А-Яа-яЁё]/.test(v)) texts.push(v);
      else if (typeof v === "number" && v !== 0 && c > 1) nums.push([c, v]);
      if (form && c === codeCol && normCode(v)) coded = true;
    }
    if (texts.length && !nums.length) { ctx = normTxt(sh.name + " " + texts.join(" ")); continue; }   // заголовок раздела
    if (!texts.length || !nums.length) continue;
    if (form && coded) { ctx = normTxt(sh.name + " " + texts.join(" ")); continue; }   // в форме — только строки без кода; строка с кодом задаёт раздел
    scanned++;
    const label = texts.join(" ").replace(/\s+/g, " ").trim(), low = normTxt(label);
    let rule = DEC_RULES.find(x => x.re.test(low) && !(x.not && x.not.test(low)));
    if (!rule && /курсов\S*\s+разниц/.test(low)) {   // курсовая разница без слов «доход/расход» — по разделу
      const sg = /расход|убыт/.test(ctx) ? -1 : /доход|прибыл/.test(ctx) ? 1 : 0;
      if (sg) rule = { key: "nonrec", sign: sg, why: sg > 0 ? "разовый доход (курсовая разница)" : "разовый расход (курсовая разница)" };
    }
    if (!rule) continue;
    const pick = (col && nums.find(n => n[0] === col)) || nums.find(n => Math.abs(n[1]) >= 100 || n[1] % 1) || nums[0];
    if (!pick) continue;
    out.push({ key: rule.key, sign: rule.sign || 1, why: rule.why, label: label.slice(0, 140), v: Math.abs(pick[1]), sheet: sh.name, total: /^(итого|всего)/.test(low) });
  }
  return { out, scanned };
}
async function decodeFiles(files, k, pid, factor) {
  const year = +(perById(pid)?.date || "").slice(0, 4) || 0, found = [], stat = {};
  for (const file of files) {
    let sheets; try { sheets = await readWorkbook(await file.arrayBuffer()); } catch (e) { continue; }
    stat[file.name] = { rows: 0, sheets: [] };
    for (const sh of sheets) {
      if (sh.hidden && sheets.length > 1) continue;
      const form = ["B", "P", "C"].includes(detectKind(sh));   // в формах — только строки без кодов
      const { out, scanned } = decParseSheet(sh, year, form);
      stat[file.name].rows += scanned; if (scanned) stat[file.name].sheets.push(sh.name);
      for (const it of out) found.push({ ...it, file: file.name, v: Math.round(it.v * factor * 1000) / 1000 });
    }
  }
  return { found, stat };
}
async function decodeReview(found, k, pid) {
  if (!found.length) return 0;
  const groups = Object.keys(DEC_KEYS).map(key => [key, found.map((f, i) => ({ ...f, i })).filter(f => f.key === key)]).filter(g => g[1].length);
  const body = `<p class="small muted">${esc(compName(k))} · ${esc(perById(pid)?.label || "")}. Суммы в тыс. тг. Строки найдены по названию — снимите галочки у лишних (например, у промежуточных итогов, чтобы не посчитать дважды).</p>
    ${groups.map(([key, items]) => `<h3 style="margin:14px 0 6px">${esc(DEC_KEYS[key])}${key === "nonrec" ? ' <span class="small muted">доход +, расход −</span>' : ""}</h3>
      <div class="tablewrap" style="max-height:none"><table class="data"><tbody>${items.map(f => `<tr><td style="width:28px"><input type="checkbox" data-dec="${f.i}" ${f.total && items.length > 1 ? "" : "checked"}></td><td class="lab" style="white-space:normal">${esc(f.label)}<span class="formula">${esc(f.file)} / ${esc(f.sheet)} · ${esc(f.why)}</span></td><td>${(f.sign < 0 ? "−" : "") + fmt(f.v)}</td></tr>`).join("")}</tbody></table></div>`).join("")}
    <p class="hint" style="margin-top:10px">Выбранные суммы запишутся в строки ОПиУ «${Object.values(DEC_KEYS).join("», «")}» за этот период (прежние значения в этих строках заменятся). Разовые статьи уменьшают или увеличивают скорректированную EBITDA.</p>`;
  setTimeout(() => $("#dlg").classList.add("wide"));
  const sel = await dialog("Расшифровки: проверьте найденные суммы", body, [{ t: "Пропустить", v: null }, { t: "Записать", primary: true, v: d => [...d.querySelectorAll("[data-dec]")].filter(x => x.checked).map(x => +x.dataset.dec) }]);
  $("#dlg")?.classList.remove("wide");
  if (!sel || !sel.length) return 0;
  const sums = {};
  for (const i of sel) { const f = found[i]; sums[f.key] = (sums[f.key] || 0) + f.sign * f.v; }
  C.data[k] = C.data[k] || {}; C.src[k] = C.src[k] || {};
  for (const [key, v] of Object.entries(sums)) {
    C.data[k][key] = C.data[k][key] || {}; C.data[k][key][pid] = Math.round(v * 1000) / 1000;
    C.src[k][key] = C.src[k][key] || {}; C.src[k][key][pid] = "расшифровка";
  }
  C.log.unshift({ t: new Date().toISOString(), file: [...new Set(sel.map(i => found[i].file))].join(", "), comp: compName(k), per: perById(pid)?.label, kind: "Расшифровка", note: Object.entries(sums).map(([key, v]) => `${DEC_KEYS[key]}: ${fmt(v)}`).join("; ") });
  touch();
  return Object.keys(sums).length;
}
