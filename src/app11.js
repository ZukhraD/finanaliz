"use strict";
/* ---------------------------------------------------------------- Расшифровки (Excel без кодов строк): износ и амортизация, разовые доходы/расходы,
   дивиденды, ФОТ. Строки находятся по названию, суммы — из колонки отчётного периода; перед записью — окно проверки. */
const DEC_RULES = [
  { key: "da", re: /(амортизац|(?:^|[^а-яё])износ)/, not: /(накоплен|на\s+начало|на\s+конец|остаточн|первоначальн|балансов|(?:^|[^а-яё])ос\s+на)/, why: "износ и амортизация" },
  { key: "div", re: /дивиденд/, not: /(получен|к\s+получению|доход\S*\s+(в\s+виде|по|от)\s+дивиденд|налог)/, why: "дивиденды объявленные / начисленные" },
  { key: "fot", re: /(заработн\S*\s+плат|оплат\S*\s+труда|фонд\S*\s+оплат|(?:^|[^а-яё])фот(?![а-яё])|зарплат|вознагражден\S*\s+работник|оклад)/, not: /(задолжен|обязательств|налог|отчислен|взнос|осмс|опв|социальн|резерв|отпуск)/, why: "оплата труда" },
  { key: "nonrec", sign: 1, re: /(списани\S*\s+(кредиторск|обязательств)|доход\S*\s+от\s+(выбыти|реализаци|продаж)\S*\s+(основн|(?:ос|нма)(?![а-яё])|актив|имуществ|долгосроч)|прибыл\S*\s+от\s+(выбыти|реализаци)|безвозмездн\S*\s+получ|страхов\S*\s+возмещ|положительн\S*\s+курсов|доход\S*\s+от\s+курсов|курсов\S*\s+разниц\S*\s*\(?\s*доход|восстановлени\S*\s+(обесцен|резерв|убытк)|штраф\S*\s+(получ|к\s+получ)|неустойк\S*\s+получ|доход\S*\s+от\s+(переоценк|списани))/, why: "разовый доход" },
  { key: "nonrec", sign: -1, re: /(убыт\S*\s+от\s+(выбыти|реализаци|обесцен|продаж|переоценк)|расход\S*\s+(по|от)\s+(выбыти|реализаци\S*\s+(основн|ос(?![а-яё])))|обесценени|списани\S*\s+(дебиторск|запас|тмз|основн|актив|безнадеж|нма|недостач)|отрицательн\S*\s+курсов|расход\S*\s+(по|от)\s+курсов|курсов\S*\s+разниц\S*\s*\(?\s*расход|(?:^|[^а-яё])штраф|(?:^|[^а-яё])пени(?![а-яё])|неустойк|спонсор|благотвор|безвозмездн\S*\s+(переда|переч)|недостач|хищени|чрезвычайн|расход\S*\s+на\s+ликвидац)/, why: "разовый расход" },
];
const DEC_KEYS = { da: "Износ и амортизация", nonrec: "Разовые доходы/(расходы), нетто", div: "Дивиденды объявленные", fot: "ФОТ (оплата труда)" };

// колонка суммы отчётного периода: по году периода или «отчётный / текущий» в шапке; иначе — первая колонка с числом в строке
function decPickCol(rows, year) {
  for (let r = 1; r <= Math.min(rows.length - 1, 15); r++) {
    const row = rows[r]; if (!row) continue;
    for (let c = 1; c < row.length; c++) {
      const v = row[c];
      if (typeof v === "number" && v === year) return c;
      if (typeof v === "string" && (new RegExp("(^|\\D)" + year + "(\\D|$)").test(v) || /(отчетн|отчётн|текущ)\S*\s+(период|год)/i.test(v))) return c;
    }
  }
  return 0;
}
function decParseSheet(sh, year) {
  const rows = sh.rows, col = decPickCol(rows, year), out = [];
  for (let r = 1; r < Math.min(rows.length, 1500); r++) {
    const row = rows[r]; if (!row) continue;
    const texts = [], nums = [];
    for (let c = 1; c < row.length; c++) { const v = row[c]; if (typeof v === "string" && /[А-Яа-яЁё]/.test(v)) texts.push(v); else if (typeof v === "number" && v !== 0 && c > 1) nums.push([c, v]); }
    if (!texts.length || !nums.length) continue;
    const label = texts.join(" ").replace(/\s+/g, " ").trim(), low = normTxt(label);
    const rule = DEC_RULES.find(x => x.re.test(low) && !(x.not && x.not.test(low)));
    if (!rule) continue;
    const pick = col ? nums.find(n => n[0] === col) : nums[0];
    if (!pick) continue;
    out.push({ key: rule.key, sign: rule.sign || 1, why: rule.why, label: label.slice(0, 140), v: Math.abs(pick[1]), sheet: sh.name, total: /^(итого|всего)/.test(low) });
  }
  return out;
}
async function decodeFiles(files, k, pid, factor) {
  const year = +(perById(pid)?.date || "").slice(0, 4) || 0, found = [];
  for (const file of files) {
    let sheets; try { sheets = await readWorkbook(await file.arrayBuffer()); } catch (e) { continue; }
    for (const sh of sheets) {
      if (sh.hidden && sheets.length > 1) continue;
      if (["B", "P", "C"].includes(detectKind(sh))) continue;   // формы отчётности разбираются отдельно
      for (const it of decParseSheet(sh, year)) found.push({ ...it, file: file.name, v: Math.round(it.v * factor * 1000) / 1000 });
    }
  }
  return found;
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
