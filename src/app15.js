"use strict";
/* ---------------------------------------------------------------- Анализ с помощью ИИ (Gemini).
   1) «Скачать в PDF для ИИ» — обезличенный отчёт: только цифры и стандартные названия строк/показателей.
      Не попадают: названия компаний и группы, БИН/ИИН, адреса, имена руководителей и учредителей, контрагенты, банки-кредиторы,
      описания залогов, комментарии. Дополнительно все строки проходят «чистку» по списку известных имён клиента.
   2) Gemini: вручную (открыть gemini.google.com и приложить PDF) или по своему API-ключу — тогда браузер отправляет
      в Google только этот обезличенный PDF и текст запроса. Ключ хранится только в этом браузере (по желанию).
   PDF собирается здесь же: свой мини-писатель PDF со встроенным шрифтом DejaVu Sans Condensed (кириллица и казахские буквы). */

/* ---------- мини-писатель PDF */
const PDFF = window.PDF_FONTS || null;
const pdfEncStr = s => { let o = ""; for (let i = 0; i < s.length; i++) o += s.charCodeAt(i) < 128 ? s[i] : "?"; return o; };
function pdfGid(f, ch) { const g = f.cmap[ch.codePointAt(0)]; return g !== undefined ? g : (f.cmap[63] || 0); }
function pdfWidth(s, size, bold) { const f = PDFF[bold ? "b" : "r"]; let w = 0; for (const ch of String(s)) w += f.w[pdfGid(f, ch)] || 500; return w * size / 1000; }
function pdfHex(s, bold) { const f = PDFF[bold ? "b" : "r"]; let h = ""; for (const ch of String(s)) h += pdfGid(f, ch).toString(16).padStart(4, "0"); return h; }
function pdfAssemble(pages, PW, PH) {
  const enc = new TextEncoder(), objs = [];   // каждый объект: Uint8Array[] частей
  const add = parts => { objs.push(parts); return objs.length; };
  const str = s => enc.encode(s);
  const stream = (dict, data) => [str(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, str("\nendstream")];
  const fontRefs = {};
  for (const [k, F] of Object.entries(PDFF)) {
    const bin = Uint8Array.from(atob(F.b64), c => c.charCodeAt(0));
    const ff = add(stream(`/Length1 ${bin.length}`, bin));
    const fd = add([str(`<< /Type /FontDescriptor /FontName /${F.name} /Flags 32 /FontBBox [${F.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${F.asc} /Descent ${F.dsc} /CapHeight ${F.cap} /StemV ${k === "b" ? 120 : 80} /FontFile2 ${ff} 0 R >>`)]);
    const cid = add([str(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${F.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /CIDToGIDMap /Identity /DW 500 /W [0 [${F.w.join(" ")}]] >>`)]);
    const pairs = Object.entries(F.cmap).filter(([u]) => +u < 0x10000);
    let cm = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
    for (let i = 0; i < pairs.length; i += 100) {
      const ch = pairs.slice(i, i + 100);
      cm += `${ch.length} beginbfchar\n${ch.map(([u, g]) => `<${(+g).toString(16).padStart(4, "0")}> <${(+u).toString(16).padStart(4, "0")}>`).join("\n")}\nendbfchar\n`;
    }
    cm += "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
    const tu = add(stream("", str(cm)));
    fontRefs[k] = add([str(`<< /Type /Font /Subtype /Type0 /BaseFont /${F.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`)]);
  }
  const pagesId = objs.length + 1 + pages.length * 2 + 0; // объект «Pages» добавим после страниц
  const kids = [];
  for (const ops of pages) {
    const c = add(stream("", str(pdfEncStr(ops))));
    kids.push(add([str(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${fontRefs.r} 0 R /F2 ${fontRefs.b} 0 R >> >> /Contents ${c} 0 R >>`)]));
  }
  const pid = add([str(`<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`)]);
  if (pid !== pagesId) throw new Error("pdf pages id");
  const info = add([str(`<< /Producer (FinAnalysis KZ) /Title <FEFF${[...tr("Обезличенные данные для анализа")].map(c => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}> >>`)]);
  const cat = add([str(`<< /Type /Catalog /Pages ${pid} 0 R >>`)]);
  const out = [str("%PDF-1.4\n%âãÏÓ\n".replace(/[^\x00-\x7f]/g, "x"))], offs = []; let pos = out[0].length;
  objs.forEach((parts, i) => {
    offs.push(pos); const h = str(`${i + 1} 0 obj\n`), e = str("\nendobj\n");
    out.push(h, ...parts, e); pos += h.length + parts.reduce((a, p) => a + p.length, 0) + e.length;
  });
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  x += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  out.push(str(x));
  const all = new Uint8Array(out.reduce((a, b) => a + b.length, 0)); let p = 0; for (const b of out) { all.set(b, p); p += b.length; }
  return all;
}
// раскладка: заголовки, абзацы, таблицы с переносом страниц (A4 книжная)
function pdfLayout(blocks) {
  const PW = 595.28, PH = 841.89, M = 36, CW = PW - 2 * M, pages = [];
  let ops = "", y = PH - M;
  const col = c => c.map(v => (v / 255).toFixed(3)).join(" ");
  const text = (x, yy, s, size, bold, rgb = [39, 39, 39]) => { ops += `BT ${col(rgb)} rg /F${bold ? 2 : 1} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td <${pdfHex(s, bold)}> Tj ET\n`; };
  const rect = (x, yy, w, h, rgb) => { ops += `${col(rgb)} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`; };
  const hline = (x, yy, w, rgb = [229, 228, 226]) => { ops += `${col(rgb)} RG 0.5 w ${x.toFixed(2)} ${yy.toFixed(2)} m ${(x + w).toFixed(2)} ${yy.toFixed(2)} l S\n`; };
  const flush = () => { pages.push(ops); ops = ""; y = PH - M; };
  const need = h => { if (y - h < M + 14) flush(); };
  const wrap = (s, size, bold, maxw) => {
    const out = []; for (const para of String(s ?? "").split("\n")) {
      let line = ""; for (const w of para.split(/\s+/)) {
        const t = line ? line + " " + w : w;
        if (pdfWidth(t, size, bold) <= maxw || !line) line = t; else { out.push(line); line = w; }
        while (pdfWidth(line, size, bold) > maxw && line.length > 1) { let k = line.length; while (k > 1 && pdfWidth(line.slice(0, k), size, bold) > maxw) k--; out.push(line.slice(0, k)); line = line.slice(k); }
      }
      out.push(line);
    }
    return out;
  };
  for (const b of blocks) {
    if (b.h1) { need(30); text(M, y - 16, b.h1, 15, true); y -= 22; hline(M, y, CW, [2, 61, 255]); y -= 10; continue; }
    if (b.h2) { need(40); y -= 6; text(M, y - 11, b.h2, 11.5, true, [2, 61, 255]); y -= 18; continue; }
    if (b.p !== undefined) {
      const size = b.small ? 7.5 : 9, lh = size * 1.3;
      for (const ln of wrap(b.p, size, false, CW)) { need(lh); text(M, y - size, ln, size, false, b.small ? [102, 102, 102] : [39, 39, 39]); y -= lh; }
      y -= 4; continue;
    }
    if (b.table) {
      const { head, rows } = b.table, pad = 3, n = head.length;
      let size = b.table.size || 7.5;
      const natW = sz => head.map((h, i) => Math.max(pdfWidth(h, sz, true), ...rows.map(r => pdfWidth(r[i] ?? "", sz, i === 0 ? !!r.bold : false))) + 2 * pad);
      for (let it = 0; it < 8; it++) { const nw = natW(size), tot0 = nw.slice(1).reduce((a, v) => a + v, 0) + Math.max(90, Math.min(nw[0], 140)); if (tot0 <= CW || size <= 5) break; size = Math.max(5, size * CW / tot0 - 0.05); }
      const lh = size * 1.25;
      const nat = head.map((h, i) => Math.max(pdfWidth(h, size, true), ...rows.map(r => pdfWidth(r[i] ?? "", size, i === 0 ? !!r.bold : false))) + 2 * pad);
      let w = nat.slice(); const rest = w.slice(1).reduce((a, v) => a + v, 0);
      w[0] = Math.max(90, Math.min(w[0], CW - rest)); if (w[0] + rest > CW) { const k = (CW - w[0]) / rest; for (let i = 1; i < n; i++) w[i] *= k; }
      const tot = w.reduce((a, v) => a + v, 0);
      const cellLines = (r, bold) => r.map((c, i) => (i === 0 ? wrap(c ?? "", size, bold, w[0] - 2 * pad) : [String(c ?? "")]));
      const drawRow = (r, isHead) => {
        const L = cellLines(r, isHead || r.bold), h = Math.max(...L.map(l => l.length)) * lh + 2 * pad - 1;
        need(h);
        if (isHead) rect(M, y - h, tot, h, [229, 228, 226]); else if (r.sec) rect(M, y - h, tot, h, [242, 244, 255]);
        let x = M;
        L.forEach((lines, i) => {
          lines.forEach((ln, j) => {
            const bold = isHead || !!r.bold || !!r.sec, tw = pdfWidth(ln, size, bold);
            const tx = i === 0 || r.sec ? x + pad : x + w[i] - pad - tw;
            text(tx, y - pad - size * 0.9 - j * lh, ln, size, bold, String(ln).startsWith("−") && !isHead ? [200, 30, 30] : [39, 39, 39]);
          });
          x += w[i];
        });
        y -= h; hline(M, y, tot);
        return h;
      };
      need(lh * 3); drawRow(head, true);
      for (const r of rows) { const L = cellLines(r, r.bold), h = Math.max(...L.map(l => l.length)) * lh + 2 * pad; if (y - h < M + 14) { flush(); drawRow(head, true); } drawRow(r, false); }
      y -= 8; continue;
    }
  }
  if (ops) flush();
  const N = pages.length;
  return { pages: pages.map((p, i) => p + `BT 0.5 0.5 0.5 rg /F1 7 Tf ${M} 20 Td <${pdfHex(tr("Обезличенные данные для анализа") + " · " + (i + 1) + " / " + N, false)}> Tj ET\n`), PW, PH };
}
function pdfFromBlocks(blocks) { const L = pdfLayout(blocks); return pdfAssemble(L.pages, L.PW, L.PH); }

/* ---------- обезличивание */
function aiSecrets() {
  const s = new Set(), push = v => { v = String(v || "").trim(); if (v.length >= 3) s.add(v); };
  push(C.card.name); push(C.card.bin); push(C.card.nameKz);
  C.companies.forEach((x, i) => { push(x.name); push(x.nameKz); push(x.bin); push(x.director); push(x.address); push(compName(i + 1)); });
  for (const t of Object.values(C.trust || {})) { push(t.director); push(t.address); push(t.addressKz); for (const f of t.founders || []) push(f.name || f); }
  for (const x of C.cr || []) push(x.creditor);
  for (const x of C.coll || []) { push(x.owner); push(x.desc); }
  for (const x of C.guar || []) { push(x.name); push(x.owner); }
  for (const b of C.bank || []) { push(b.bank); push(b.acc); }
  // составные части названий: «ТОО «Тест-Агро»» → «Тест-Агро»
  for (const v of [...s]) for (const m of v.matchAll(/[«"]([^«»"]{3,})[»"]/g)) push(m[1]);
  return [...s].sort((a, b) => b.length - a.length);
}
function aiScrubber() {
  const list = aiSecrets(), e = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = list.length ? new RegExp(list.map(e).join("|"), "gi") : null;
  return s => {
    s = String(s ?? "");
    if (re) s = s.replace(re, "[скрыто]");
    return s.replace(/\b\d{12}\b/g, "[БИН/ИИН скрыт]").replace(/\bKZ\d{2}[A-Z0-9]{10,}\b/gi, "[счёт скрыт]").replace(/\b[A-Z]{4}KZ[A-Z0-9]{2}\b/g, "[БИК скрыт]");
  };
}
const AI_KEYS_BAL = ["cash", "stinv", "ar", "oar", "inv", "taxa", "oca", "ca", "ppe", "intang", "ltinv", "olta", "lta", "ta", "stloan", "cpltd", "ap", "adv", "taxl", "ocl", "cl", "ltloan", "lease", "oltl", "ltl", "sc", "re", "oeq", "eq"];
const AI_KEYS_ODR = ["rev", "cogs", "gp", "selling", "admin", "ooe", "ooi", "ebit", "fin_inc", "int", "onoi_in", "onoi_out", "ebt", "cit", "ni", "da", "nonrec", "div", "fot", "ebitda", "adj"];
function aiOpts() { C.ai = C.ai || {}; return C.ai; }
function aiBlocks() {
  const A = aiOpts(), sc = aiScrubber(), B = [], pers = C.periods, obj = C.obj || 0, od = isOD();
  const T = (head, rows, size) => B.push({ table: { head: head.map(h => sc(tr(h))), rows: rows.map(r => Object.assign(r.map((c, i) => (i === 0 ? sc(tr(c)) : sc(c))), { bold: r.bold, sec: r.sec })), size } });
  const H2 = s => B.push({ h2: tr(s) }), P = (s, small) => B.push({ p: sc(tr(s)), small });
  const objLab = nComp() > 1 ? (obj ? `Компания ${obj}` : `Группа (${nComp()} компании, консолидировано)`) : "Компания";
  B.push({ h1: tr("Обезличенные данные для анализа") });
  P("Документ сформирован автоматически для анализа с помощью ИИ. Исключены названия компаний и группы, БИН/ИИН, адреса, имена руководителей и учредителей, наименования контрагентов и банков, описания залогов и комментарии. Суммы — в тыс. тенге, если не указано иное.", true);
  H2("1. Запрос");
  const f = fcParams();
  const req = [["Продукт", C.card.product || ""], ["Сумма запроса, тыс. тг", fmt(C.card.amount)], ["Цель финансирования", C.card.purpose || ""]];
  if (!od) req.push(["Срок, мес.", fmt(f.req.term, "d")], ["Ставка, %", isNum(f.req.rate) ? fmt(f.req.rate * 100, "m1") : ""], ["Льготный период по ОД, мес.", fmt(f.req.grace, "d")], ["Схема погашения", f.req.scheme || ""]);
  if (A.oked) { const o = C.card.oked?.[0]; if (o?.code) req.push(["Отрасль (раздел ОКЭД)", o.code.slice(0, 2) + " — " + (typeof OKED_DIV !== "undefined" && OKED_DIV[o.code.slice(0, 2)] ? OKED_DIV[o.code.slice(0, 2)] : "")]); }
  req.push(["Объект анализа", objLab], ["Компаний в группе", String(nComp())]);
  T(["Параметр", "Значение"], req.map(r => [r[0], tr(r[1])]));
  if (nComp() > 1) T(["Компания", "Роль", "Режим налогообложения", "НДС"], C.companies.map((x, i) => [`Компания ${i + 1}`, tr(compRoles(x).join(", ")), tr(x.regime || ""), tr(x.vat || "")]));
  const ph = ["Показатель", ...pers.map(p => `${p.label} (${p.months || 12} мес.)`)];
  const lineRows = keys => keys.filter(k => LINE[k] && pers.some(p => isNum(val(obj, k, p.id)))).map(k => Object.assign([LINE[k].label, ...pers.map(p => fmt(val(obj, k, p.id)))], { bold: LINE[k].typ === "calc" }));
  if (od) {
    H2("2. Баланс и ОПиУ (таблица анализа сделки)");
    const F = odFinVals();
    T(["Показатель", ...F.cols.map(c => c.label)], OD_ROWS.map(([k, l, typ]) => [l, ...F.cols.map(c => { const v = F.v(c, k); return k === "npm" ? fmt(v, "p") : k === "dso" ? fmt(v, "d") : k === "eqpos" ? (isNum(v) ? (v > 0 ? "да" : "нет") : "") : fmt(v); })]));
  } else {
    H2(`2. Баланс, тыс. тг — ${objLab}`); T(ph, lineRows(AI_KEYS_BAL));
    H2(`3. Отчёт о прибылях и убытках, тыс. тг — ${objLab}`); T(ph, lineRows(AI_KEYS_ODR));
    H2("4. Коэффициенты");
    const rr = Object.keys(RAT).filter(k => pers.some(p => isNum(ratio(obj, k, p.id)))).map(k => [RAT[k].label, ...pers.map(p => { const v = ratio(obj, k, p.id); return v === NP ? NP : fmt(v, KIND[k]); }), ST[rstatus(k, ratio(obj, k, lastPid()))] || ""]);
    T([...ph, "Оценка (последний период)"], rr);
    if (nComp() > 1) {
      H2("5. Компании группы — последний период");
      const L = lastPid();
      T(["Показатель", ...C.companies.map((_, i) => `Компания ${i + 1}`)], [["rev", "Выручка"], ["ebitda", "EBITDA"], ["ni", "Чистая прибыль"], ["ta", "Итого активы"], ["eq", "Капитал"]].map(([k, l]) => [l, ...C.companies.map((_, i) => fmt(val(i + 1, k, L)))]).concat([["Общий долг", ...C.companies.map((_, i) => fmt(ratio(i + 1, "debt", L)))]]));
    }
  }
  // банк
  H2("Банковские выписки: поступления по месяцам");
  for (let k = 1; k <= nComp(); k++) {
    let tx = []; try { tx = stmtTx(k); } catch (e) { tx = []; }
    const cr = tx.filter(x => x.cr); if (!cr.length) continue;
    const months = [...new Set(cr.map(x => x.m))].sort().slice(-12), byM = new Map(months.map(m => [m, { g: 0, n: 0, c: 0, cps: new Set() }]));
    const cpv = new Map();
    for (const x of cr) { const r = byM.get(x.m); if (!r) continue; r.g += x.cr; if (!x.cat) { r.n += x.cr; r.c++; const key = x.t.bin || x.t.cp || "?"; r.cps.add(key); cpv.set(key, (cpv.get(key) || 0) + x.cr); } }
    const net = [...cpv.values()].reduce((a, b) => a + b, 0), top = [...cpv.values()].sort((a, b) => b - a);
    if (nComp() > 1) P(`Компания ${k}`);
    T(["Месяц", "Общий кредитовый оборот", "Чистый кредитовый оборот", "Кол-во поступлений", "Кол-во контрагентов"], months.map(m => { const r = byM.get(m); return [m, fmt(r.g / 1000), fmt(r.n / 1000), fmt(r.c, "d"), fmt(r.cps.size, "d")]; }));
    P(`Доля крупнейшего покупателя: ${fmt(net ? top[0] / net : null, "p")}; доля пяти крупнейших: ${fmt(net ? top.slice(0, 5).reduce((a, b) => a + b, 0) / net : null, "p")}; покупателей всего: ${top.length}.`, true);
  }
  if (od) {
    H2("Расчёт лимита овердрафта");
    const k = 1, ob = odBank(k), c = odCfg();
    T(["Показатель", "В Банке", "В других банках"], [["Чистый кредитовый оборот за период", fmt(ob.our.net), fmt(ob.other.net)], ["Ограничение 60 % по контрагенту", fmt(ob.our.cut), fmt(ob.other.cut)], ["Среднемесячный очищенный оборот", fmt(ob.our.avg), fmt(ob.other.avg)], ["Лимит 40 %", fmt(ob.our.lim), fmt(ob.other.lim)]]);
    P(`Расчётный лимит: ${fmt(ob.limit)} тыс. тг; транш ${c.tranche} дней; срок линии ${c.line} мес.; период доступности ${c.avail} мес.; сезонный бизнес: ${c.seasonal}.`);
    const ch = odChecks(); T(["Требование", "Результат"], ch.out.map(x => [x.title, { ok: "соответствует", crit: "не соответствует", chk: "требует проверки", nd: "нет данных" }[x.st] || x.st]));
  }
  // кредитная история
  H2("Кредитная история (действующие обязательства)");
  ensureCredit();
  const crs = C.cr.filter(x => x.status !== "closed");
  if (crs.length) T(["Кредитор", "Компания", "Роль", "Вид", "Валюта", "Сумма", "Остаток", "Платёж в мес.", "Ставка, %", "Окончание", "Просрочка, дн. (тек./макс.)"], crs.map((x, i) => [`Кредитор ${i + 1}`, nComp() > 1 ? `Компания ${x.k}` : "", x.role || "", x.type || "", x.cur || "KZT", fmt(isNum(x.amount) ? x.amount / 1000 : null), fmt(isNum(x.bal) ? x.bal / 1000 : null), fmt(isNum(x.pay) ? x.pay / 1000 : null), isNum(x.rate) ? fmt(x.rate * 100, "m1") : "", (x.end || "").slice(0, 7), `${fmt(N(x.odDays), "d")} / ${fmt(Math.max(N(x.maxOd), N(x.odDays)), "d")}`]), 7);
  else P("Действующих обязательств в реестре нет.");
  P("Суммы в таблице кредитной истории — тыс. в валюте обязательства.", true);
  // залог
  if (!od && (C.coll || []).length) {
    H2("Обеспечение");
    T(["Вид", "Рыночная стоимость", "Дисконт", "Залоговая стоимость"], C.coll.map(x => [x.type || "", fmt(x.market), fmt(N(x.disc), "p"), fmt(N(x.market) * (1 - N(x.disc)))]));
  }
  // благонадёжность
  H2("Благонадёжность (результаты проверок)");
  ensureTrust();
  T(["Проверка", ...C.companies.map((_, i) => (nComp() > 1 ? `Компания ${i + 1}` : "Результат"))], TRUST.map(([id, lab]) => [lab, ...C.companies.map((_, i) => tr(TST[C.trust[i + 1]?.items?.[id]?.st || "na"]))]));
  // прогноз
  if (!od) {
    const o = fcq(obj);
    H2("Прогноз движения денежных средств по кварталам (базовый сценарий), тыс. тг");
    if (o.err) P("Прогноз не построен: " + o.err);
    else {
      const q = fcqParams();
      P(`Квартал последней отчётности: ${q.lq} кв. ${q.ly}. Рост выручки в стоимостном выражении: ${fmt(o.G, "p")} в год. Потоки — за квартал.`);
      const ids = ["r11", "r17", "r22", "r33", "r34", "r37", "r38", "r45", "r48", "r63", "r74", "r77", "r78", "r81", "r95", "r107", "r116", "r119"];
      const lab = Object.fromEntries(FCQ_ROWS.map(r => [r[0], r]));
      for (let s = 0; s < o.cols.length; s += 8) {
        const cs = o.cols.slice(s, s + 8), idx = s === 0 ? [0, ...cs.map(c => c.i)] : cs.map(c => c.i);
        T(["Тыс. тг", ...(s === 0 ? ["База (4 кв.)"] : []), ...cs.map(c => c.h)], ids.map(id => Object.assign([lab[id][1], ...idx.map(i => fmt(o.V[id][i], lab[id][3] === "x" ? "x" : lab[id][3] === "p" ? "p" : "m"))], { bold: lab[id][3] === "c" })), 7);
      }
      H2("Прогноз по годам");
      T(["Период", "Выручка", "Опер. прибыль", "Чистая прибыль", "ОДП", "ИДП", "ФДП", "ЧДП", "Деньги на конец", "Фин. долг", "EBITDA 4 кв.", "Долг / EBITDA"], fcqYears(o).map(y => [y.h, fmt(y.rev), fmt(y.op), fmt(y.ni), fmt(y.cfo), fmt(y.cfi), fmt(y.cff), fmt(y.ncf), fmt(y.cash), fmt(y.debt), fmt(y.ebitda), fmt(y.de, "x")]), 7);
      P("ОДП, ИДП, ФДП, ЧДП — операционный, инвестиционный, финансовый и чистый денежный поток.", true);
      const b = forecast(obj, 0), st = forecast(obj, 1);
      if (!b.err) T(["Обслуживание долга (помесячный расчёт)", "База", "Стресс"], [["DSCR с новым кредитом за горизонт", fmt(b.dscr_h_post, "x"), fmt(st.dscr_h_post, "x")], ["Минимальный годовой DSCR", fmt(b.dscr_year_min, "x"), fmt(st.dscr_year_min, "x")], ["Минимальный остаток денег с кредитом", fmt(b.mincash_post), fmt(st.mincash_post)], ["Потребность в финансировании (с резервом)", fmt(b.rec), fmt(st.rec)]]);
      const sc2 = f.scen; T(["Допущение", "База", "Стресс"], Object.keys(FC_LAB).map(k => [FC_LAB[k], FC_PCT.has(k) ? fmt(sc2[k][0] * 100, "m1") : fmt(sc2[k][0]), FC_PCT.has(k) ? fmt(sc2[k][1] * 100, "m1") : fmt(sc2[k][1])]));
    }
  }
  // проблемы
  H2("Выявленные проблемы и риски");
  const pr = (PROB || []).filter(p => p.sev !== "nd");
  if (pr.length) T(["Проблема", "Уровень", "Детали"], pr.slice(0, 60).map(p => [p.title, tr(SEV[p.sev]), tr(p.detail || "")]), 7);
  else P("Проблем не выявлено.");
  if (A.notes && C.concl?.text) { H2("Выводы кредитного менеджера"); P(C.concl.text); }
  return B;
}
function aiPdf() {
  if (!PDFF) { toast("Шрифт для PDF не встроен"); return null; }
  return pdfFromBlocks(aiBlocks());
}
function aiPdfDownload() {
  const bin = aiPdf(); if (!bin) return;
  download(`Для_ИИ_${new Date().toISOString().slice(0, 10)}.pdf`, bin, "application/pdf");
  C.log.unshift({ t: new Date().toISOString(), file: "Для_ИИ.pdf", comp: "", per: "", kind: "Выгрузка", note: "обезличенный PDF для ИИ" }); touch();
  toast("Обезличенный PDF сохранён в «Загрузки»");
}
function aiPreviewHTML() {
  return aiBlocks().map(b => b.h1 ? `<h3>${esc(b.h1)}</h3>` : b.h2 ? `<h4>${esc(b.h2)}</h4>` : b.p !== undefined ? `<p class="${b.small ? "small muted" : ""}">${esc(b.p)}</p>`
    : `<div class="tablewrap" style="max-height:none"><table class="data"><thead><tr>${b.table.head.map((h, i) => `<th class="${i ? "" : "lab"}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.table.rows.map(r => `<tr class="${r.bold ? "calc" : ""}">${r.map((c, i) => `<td class="${i ? "" : "lab"}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("");
}

/* ---------- Gemini */
const AI_KEY = "finkz.gemini.key", AI_MODEL = "finkz.gemini.model", AI_URL = "https://generativelanguage.googleapis.com/v1beta/";
const aiGet = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const aiSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* на сеанс */ } };
let AI_SESSION_KEY = "", AI_BUSY = false, AI_MODELS = [];
const aiDefaultPrompt = () => (LANG === "kz"
  ? "Сен Қазақстандағы банктің тәжірибелі несие талдаушысысың. Тіркелген PDF-те заңды тұлғаның (топтың) иесіздендірілген қаржылық деректері берілген, сомалар мың теңгемен. Талдау жаса: 1) қаржылық жағдай және динамика; 2) өтімділік, қарыз жүктемесі, рентабельділік; 3) банк үзінділері бойынша ақша ағындарының сапасы; 4) болжамның шынайылығы және қарызды өтеу қабілеті; 5) негізгі тәуекелдер және оларды азайту шаралары; 6) мәміле құрылымы бойынша ұсыныстар (сома, мерзім, кепілдік, ковенанттар). Деректерде жоқ нәрсені ойдан шығарма — жетіспейтін ақпаратты бөлек тізіп жаз. Қазақ тілінде жауап бер."
  : "Ты — опытный кредитный аналитик банка в Казахстане. Во вложенном PDF — обезличенные финансовые данные юридического лица (группы), суммы в тыс. тенге. Проанализируй: 1) финансовое состояние и динамику; 2) ликвидность, долговую нагрузку, рентабельность; 3) качество денежных потоков по банковским выпискам; 4) реалистичность прогноза и способность обслуживать долг; 5) ключевые риски и меры по их снижению; 6) рекомендации по структуре сделки (сумма, срок, обеспечение, ковенанты). Не придумывай данные, которых нет в документе, — недостающую информацию перечисли отдельно. Ответь на русском языке.");
function aiMd(s) {   // упрощённый markdown → HTML (заголовки, жирный, списки)
  const lines = esc(s || "").split("\n"); let h = "", list = false;
  for (let ln of lines) {
    ln = ln.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(ln);
    if (li) { if (!list) { h += "<ul>"; list = true; } h += `<li>${li[2]}</li>`; continue; }
    if (list) { h += "</ul>"; list = false; }
    const hd = /^#{1,4}\s+(.*)$/.exec(ln);
    h += hd ? `<h4>${hd[1]}</h4>` : ln.trim() ? `<p>${ln}</p>` : "";
  }
  return h + (list ? "</ul>" : "");
}
function pageAi() {
  const A = aiOpts(), key = AI_SESSION_KEY || aiGet(AI_KEY), model = A.model || aiGet(AI_MODEL) || "gemini-flash-latest";
  const prompt = aiDefaultPrompt();
  return `<div class="pagehead"><div class="lead"><h1>Анализ с помощью ИИ</h1><p>Анализ в Gemini по обезличенному PDF: в Google уходят только цифры и стандартные названия показателей — без названий компаний, БИН, адресов, имён, контрагентов и банков.</p></div></div>
  <section class="panel"><h2>1. Обезличенный PDF</h2>
    <p class="hint">Состав: запрос (продукт, сумма, цель), баланс, ОПиУ и коэффициенты по периодам, поступления по выпискам помесячно, кредитная история (кредиторы — «Кредитор 1, 2…»), обеспечение (только вид и суммы), результаты проверок благонадёжности, квартальный прогноз, найденные проблемы. Компании группы — «Компания 1, 2…».</p>
    <label class="chk" style="display:block"><input type="checkbox" data-aiopt="oked" ${A.oked ? "checked" : ""}> Указать отрасль (только раздел ОКЭД, 2 знака)</label>
    <label class="chk" style="display:block"><input type="checkbox" data-aiopt="notes" ${A.notes ? "checked" : ""}> Добавить выводы кредитного менеджера со страницы «Заключение» (проверьте, что в тексте нет названий и имён)</label>
    <p style="margin-top:10px"><button class="btn primary" data-act="aipdf">Скачать в PDF для ИИ</button> <button class="btn ghost" data-act="aiprev">${A._prev ? "Скрыть содержимое" : "Посмотреть, что попадёт в PDF"}</button></p>
    ${A._prev ? `<div class="aiprev" data-nt>${aiPreviewHTML()}</div>` : ""}</section>
  <section class="panel"><h2>2. Gemini</h2>
    <div class="aigrid">
      <div><h3>Вариант А — вручную</h3><p class="hint">Откройте Gemini, приложите скачанный PDF и вставьте запрос (кнопка «Скопировать запрос»). Ответ вставьте ниже, в поле «Ответ ИИ».</p>
        <p><a class="btn" href="https://gemini.google.com/app" target="_blank" rel="noopener noreferrer">Открыть Gemini</a> <button class="btn ghost" data-act="aicopy">Скопировать запрос</button></p></div>
      <div><h3>Вариант Б — по API-ключу</h3><p class="hint">Сайт сам отправит обезличенный PDF и запрос в Gemini API и покажет ответ. Ключ создаётся в Google AI Studio (aistudio.google.com → Get API key). Учтите условия Google: на бесплатном тарифе данные запросов могут использоваться для улучшения сервисов.</p>
        <div class="grid2 tight"><label class="f"><span>API-ключ Gemini</span><input class="inp" type="password" autocomplete="off" data-aikey value="${esc(key)}" placeholder="AIza…"></label>
        <label class="f"><span>Модель</span><input class="inp" data-aimodel list="aiModels" value="${esc(model)}"><datalist id="aiModels">${AI_MODELS.map(m => `<option value="${esc(m)}">`).join("")}</datalist></label></div>
        <label class="chk" style="display:block;margin-top:6px"><input type="checkbox" data-airemember ${aiGet(AI_KEY) ? "checked" : ""}> Запомнить ключ в этом браузере</label>
        <p style="margin-top:8px"><button class="btn primary" data-act="aisend" ${AI_BUSY ? "disabled" : ""}>${AI_BUSY ? "Gemini анализирует…" : "Отправить в Gemini"}</button> <button class="btn ghost" data-act="aimodels">Проверить ключ и модели</button></p></div>
    </div></section>
  <section class="panel"><h2>3. Ответ ИИ</h2>
    <p class="hint">${A.t ? `Получен ${esc(dDateTime(A.t))}${A.src ? " · " + esc(A.src) : ""}. ` : ""}Ответ ИИ — справочный: проверьте выводы по исходным данным. Его можно поправить в поле ниже.</p>
    <label class="chk" style="display:block"><input type="checkbox" data-aiopt="inConcl" ${A.inConcl ? "checked" : ""}> Добавить ответ в заключение (Word) отдельным разделом «Анализ ИИ — справочно»</label>
    <label class="f" style="margin-top:8px"><span>Ответ ИИ</span><textarea class="inp" data-aians style="min-height:160px" data-nt>${esc(A.answer || "")}</textarea></label>
    ${A.answer ? `<div class="aians" data-nt>${aiMd(A.answer)}</div>` : ""}</section>`;
}
function aiConclHTML() {
  const A = C.ai; if (!A || !A.inConcl || !A.answer) return "";
  return `<h2>${esc(tr("Анализ ИИ — справочно"))}</h2><p class="small">${esc(tr("Сформирован по обезличенным данным"))}${A.src ? " · " + esc(A.src) : ""}${A.t ? ", " + esc(dDateTime(A.t)) : ""}.</p>${aiMd(A.answer)}`;
}
function aiKeyNow() { const el = document.querySelector("[data-aikey]"); return (el ? el.value : AI_SESSION_KEY || aiGet(AI_KEY)).trim(); }
async function aiFetch(path, opt) {
  const key = aiKeyNow(); if (!key) throw new Error(tr("Укажите API-ключ Gemini"));
  const r = await fetch(AI_URL + path, { ...opt, headers: { "Content-Type": "application/json", "x-goog-api-key": key, ...(opt?.headers || {}) }, referrerPolicy: "no-referrer", credentials: "omit" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
  return j;
}
async function aiModels() {
  try {
    const j = await aiFetch("models?pageSize=200", { method: "GET" });
    AI_MODELS = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, "")).filter(m => /gemini/i.test(m) && !/(image|tts|audio|live|embedding)/i.test(m));
    render(); toast(AI_MODELS.length ? tr("Ключ работает. Доступно моделей: ") + AI_MODELS.length : tr("Ключ работает, но подходящих моделей нет"));
  } catch (e) { toast(tr("Gemini: ") + e.message); }
}
async function aiSend() {
  const A = aiOpts(); if (AI_BUSY) return;
  const model = (document.querySelector("[data-aimodel]")?.value || "gemini-flash-latest").trim();
  const pdf = aiPdf(); if (!pdf) return;
  const prompt = aiDefaultPrompt();
  AI_BUSY = true; render();
  try {
    const j = await aiFetch(`models/${encodeURIComponent(model)}:generateContent`, { method: "POST", body: JSON.stringify({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: b64(pdf) } }, { text: prompt }] }] }) });
    const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
    if (!txt) throw new Error(j.promptFeedback?.blockReason ? tr("запрос отклонён: ") + j.promptFeedback.blockReason : tr("пустой ответ"));
    Object.assign(A, { answer: txt, t: new Date().toISOString(), src: "Gemini API, " + model });
    aiSet(AI_MODEL, model);
    C.log.unshift({ t: A.t, file: "Gemini API", comp: "", per: model, kind: "ИИ", note: "отправлен обезличенный PDF" });
    touch(); toast(tr("Ответ Gemini получен"));
  } catch (e) { toast(tr("Gemini: ") + e.message); }
  AI_BUSY = false; render();
}
document.addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b || !C) return;
  const a = b.dataset.act;
  if (a === "aipdf") aiPdfDownload();
  else if (a === "aiprev") { const A = aiOpts(); A._prev = !A._prev; render(); }
  else if (a === "aisend") aiSend();
  else if (a === "aimodels") aiModels();
  else if (a === "aiprompt0") { aiOpts().prompt = ""; touch(); render(); }
  else if (a === "aicopy") { const t = aiDefaultPrompt(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(tr("Запрос скопирован")), () => toast(tr("Скопируйте текст запроса вручную"))); }
});
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset; if (!C) return;
  if (d.aiopt) { aiOpts()[d.aiopt] = t.checked; touch(); if (d.aiopt !== "inConcl") render(); return; }
  if (d.aikey !== undefined) { AI_SESSION_KEY = t.value.trim(); if (aiGet(AI_KEY)) aiSet(AI_KEY, AI_SESSION_KEY); return; }
  if (d.airemember !== undefined) { aiSet(AI_KEY, t.checked ? aiKeyNow() : ""); toast(t.checked ? tr("Ключ сохранён в этом браузере") : tr("Ключ удалён из браузера")); return; }
  if (d.aimodel !== undefined) { aiSet(AI_MODEL, t.value.trim()); aiOpts().model = t.value.trim(); touch(); return; }
  if (d.aiprompt !== undefined) { aiOpts().prompt = t.value === aiDefaultPrompt() ? "" : t.value; touch(); return; }
  if (d.aians !== undefined) { const A = aiOpts(); A.answer = t.value; if (!A.t && t.value) { A.t = new Date().toISOString(); A.src = "вставлено вручную"; } touch(); render(); return; }
});
