"use strict";
/* ---------------------------------------------------------------- Анализ выписок в Excel (кнопка «Импорт» на странице «Банк»):
   помесячные сводные по контрагентам и по товарным группам — сумма и доля в чистых кредитовых оборотах (выручке по банку),
   за предыдущий год и за текущий год с 1 января. Файл собирается здесь же, в браузере. */

/* --- минимальная запись .xlsx (ZIP без сжатия + SpreadsheetML) */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {   // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder(), parts = [], cent = []; let off = 0;
  const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0)]);
    parts.push(lh, nm, f.data);
    cent.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += lh.length + nm.length + sz;
  }
  const csz = cent.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csz), ...u32(off), ...u16(0)]);
  const all = [...parts, ...cent, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}
const xEsc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = n => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// sheets: [{name, rows: [[cell]], widths: [], freeze: rows}] ; cell: value | {v, s} ; стили: 1 — заголовок, 2 — число, 3 — %, 4 — итог-число, 5 — итог-%, 6 — итог-текст, 7 — заголовок листа
function xlsxBuild(sheets) {
  const enc = new TextEncoder(), files = [];
  const sheetXml = sh => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
      if (c === null || c === undefined || c === "") return "";
      const o = typeof c === "object" ? c : { v: c }, ref = colName(ci) + (ri + 1), st = o.s ? ` s="${o.s}"` : "";
      return typeof o.v === "number" && isFinite(o.v) ? `<c r="${ref}"${st}><v>${o.v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xEsc(o.v ?? "")}</t></is></c>`;
    }).join("")}</row>`).join("");
    const cols = (sh.widths || []).length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const pane = sh.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const names = sheets.map((s, i) => (s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Лист" + (i + 1)));
  files.push({ name: "[Content_Types].xml", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` });
  files.push({ name: "_rels/.rels", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: "xl/workbook.xml", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` });
  files.push({ name: "xl/_rels/workbook.xml.rels", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: "xl/styles.xml", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="12"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E4E2"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="2" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="165" fontId="1" fillId="2" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>` });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, x: sheetXml(s) }));
  return zipStore(files.map(f => ({ name: f.name, data: enc.encode(f.x) })));
}

/* --- товарные группы по назначению платежа */
const PROD_STOP = new Set(["оплата", "оплату", "оплаты", "предоплата", "предоплату", "аванс", "авансовый", "платеж", "платежа", "окончательный", "частичная", "частичную", "полная", "доплата", "за", "по", "на", "от", "для", "и", "в", "с", "со", "к", "без", "договор", "договору", "договора", "дог", "согласно", "счет", "счету", "счета", "сч", "фактуре", "фактура", "накладной", "накладная", "поставка", "поставку", "поставки", "товар", "товары", "товара", "тмц", "продукцию", "продукция", "продукции", "реализацию", "реализация", "услуги", "услуг", "работы", "работ", "ндс", "т", "ч", "тч", "числе", "том", "сумма", "сумме", "года", "г", "гг", "тг", "тенге", "кзт", "kzt", "ед", "шт", "тонн", "тн", "кг", "руб", "тоо", "ао", "ип", "компания", "доп", "соглашению", "соглашение", "спецификации", "спецификация", "приложению", "заявке", "заказу", "заказ", "кнп", "код", "назначения", "назначение", "платежное", "поручение", "пп", "вкл", "включая", "т.ч", "в т.ч"]);
const stem = w => (w.length > 3 ? w.replace(/(ами|ями|ого|его|ому|ему|ов|ев|ей|ам|ям|ах|ях|ом|ем|ой|ий|ый|ая|ое|ые|ую|юю|у|ю|а|я|ы|и|е|о|ь)$/, "") : w).slice(0, 6);
function prodOf(purp) {
  let s = String(purp || "").toLowerCase().replace(/ё/g, "е");
  s = s.replace(/(в\s*т\.?\s*ч\.?|в\s+том\s+числе|без\s+ндс|ндс\s*\d|ндс\s+не\s+облаг).*$/, " ")
    .replace(/(по\s+)?(дог(овор\S*)?|д-р|сч(ет|\.)?(-?\s*фактур\S*)?|с\/ф|накладн\S*|спецификац\S*|приложени\S*|заявк\S*|доп\.?\s*соглаш\S*)\s*(№|n|no)?\s*[\w\-\/.]*\d[\w\-\/.]*/g, " ")
    .replace(/№\s*[\w\-\/.]+/g, " ").replace(/\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}/g, " ").replace(/\d+([.,]\d+)?/g, " ")
    .replace(/[«»"'()\[\]{},.;:!?№#%*+=\/\\_-]/g, " ");
  const words = s.split(/\s+/).filter(w => w.length >= 3 && !PROD_STOP.has(w) && /[а-яa-z]/.test(w));
  if (!words.length) return { key: "—", name: "Без указания товара (общая формулировка)" };
  const top = words.slice(0, 2);
  // название группы — фраза из исходного назначения: «пшеницу 3 класса», «муку высшего сорта»
  const src = String(purp || "").replace(/ё/g, "е");
  const m = new RegExp("(" + top[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^,;№]*)", "i").exec(src);
  let name = m ? m[1].split(/\s+(?:по\s+дог|дог\.|договор|согласно|в\s*т\.?\s*ч|в\s+том\s+числе|ндс|сч\.|счет|с\/ф|от\s+\d|на\s+сумму|за\s+период|за\s+\d)/i)[0] : top.join(" ");
  const nw = name.replace(/[\s.:-]+$/, "").split(/\s+/).slice(0, 5);
  while (nw.length > 1 && PROD_STOP.has(nw[nw.length - 1].toLowerCase().replace(/[^а-яa-z]/g, ""))) nw.pop();
  name = nw.join(" ");
  return { key: top.map(stem).join(" "), name: name || top.join(" ") };
}

/* --- сбор данных */
function bankPivot(k) {
  const tx = stmtTx(k).filter(x => x.cr && !x.cat);     // чистые кредитовые обороты (выручка по банку)
  if (!tx.length) return null;
  const last = tx.map(x => x.t.d).sort().pop(), Y = +last.slice(0, 4), lastM = +last.slice(5, 7);
  const mk = (year, toM) => {
    const months = Array.from({ length: toM }, (_, i) => `${year}-${pad2(i + 1)}`), ms = new Set(months);
    const cp = new Map(), pr = new Map(); let tot = 0;
    for (const x of tx) {
      if (!ms.has(x.m)) continue;
      const key = x.t.bin || DocParse.clean(x.t.cp) || "без названия";
      const o = cp.get(key) || { name: x.t.cp || key, bin: x.t.bin || "", m: {}, v: 0, n: 0 }; o.v += x.cr; o.n++; o.m[x.m] = (o.m[x.m] || 0) + x.cr; cp.set(key, o);
      const p = prodOf(x.t.purp), q = pr.get(p.key) || { names: new Map(), m: {}, v: 0, n: 0, ex: new Set(), cps: new Set() };
      q.names.set(p.name, (q.names.get(p.name) || 0) + 1); q.v += x.cr; q.n++; q.m[x.m] = (q.m[x.m] || 0) + x.cr; if (q.ex.size < 3) q.ex.add(String(x.t.purp || "").slice(0, 90)); q.cps.add(x.t.cp || key); pr.set(p.key, q);
      tot += x.cr;
    }
    const prods = [...pr.values()].map(q => ({ ...q, name: [...q.names.entries()].sort((a, b) => b[1] - a[1])[0][0] }));
    prods.forEach(q => { q.name = q.name.charAt(0).toUpperCase() + q.name.slice(1); });
    return { year, months, tot, cps: [...cp.values()].sort((a, b) => b.v - a.v), prods: prods.sort((a, b) => b.v - a.v) };
  };
  return { Y, lastM, prev: mk(Y - 1, 12), cur: mk(Y, lastM), tx, all: stmtTx(k) };
}
const MON_S = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function pivotSheet(title, per, kind) {
  const H = s => ({ v: s, s: 1 }), th = v => ({ v: v / 1000, s: 2 }), pc = v => ({ v, s: 3 });
  const mh = per.months.map(m => H(MON_S[+m.slice(5) - 1] + " " + m.slice(0, 4)));
  const rows = [[{ v: title, s: 7 }], [`Чистые кредитовые обороты (без займов, конвертации, своих переводов, возвратов, помощи, субсидий, штрафов, вознаграждений, страховых и наличных), тыс. тг. Всего: ${fmt(per.tot / 1000)} тыс. тг`], []];
  if (kind === "cp") {
    rows.push([H("№"), H("Контрагент"), H("БИН / ИИН"), ...mh, H("Итого, тыс. тг"), H("Доля"), H("Операций")]);
    per.cps.forEach((o, i) => rows.push([i + 1, o.name, o.bin, ...per.months.map(m => o.m[m] ? th(o.m[m]) : ""), th(o.v), pc(per.tot ? o.v / per.tot : 0), o.n]));
  } else {
    rows.push([H("№"), H("Товар / группа"), H("Покупателей"), ...mh, H("Итого, тыс. тг"), H("Доля"), H("Операций"), H("Примеры назначения платежа")]);
    per.prods.forEach((o, i) => rows.push([i + 1, o.name, o.cps.size, ...per.months.map(m => o.m[m] ? th(o.m[m]) : ""), th(o.v), pc(per.tot ? o.v / per.tot : 0), o.n, [...o.ex].join(" | ")]));
  }
  const mt = per.months.map(m => ({ v: (kind === "cp" ? per.cps : per.prods).reduce((a, o) => a + (o.m[m] || 0), 0) / 1000, s: 4 }));
  rows.push([{ v: "", s: 6 }, { v: "Итого", s: 6 }, { v: "", s: 6 }, ...mt, { v: per.tot / 1000, s: 4 }, { v: per.tot ? 1 : 0, s: 5 }, { v: (kind === "cp" ? per.cps : per.prods).reduce((a, o) => a + o.n, 0), s: 6 }]);
  return { name: title, rows, widths: [5, 42, kind === "cp" ? 15 : 12, ...per.months.map(() => 11), 15, 9, 10, 70], freeze: 4 };
}
function bankExport(k) {
  const P = bankPivot(k);
  if (!P) { toast("Нет выписок с поступлениями — загрузите выписки по счетам"); return; }
  const nm = compName(k), Y = P.Y, H = s => ({ v: s, s: 1 });
  const lastD = P.tx.map(x => x.t.d).sort().pop().split("-").reverse().join(".");
  const share = (per, n) => per.tot ? per.cps.slice(0, n).reduce((a, o) => a + o.v, 0) / per.tot : 0;
  const sum = [[{ v: `Анализ выписок: ${nm}`, s: 7 }], [`Суммы — тыс. тг, по курсу НБ РК для валютных поступлений. Выручка по банку = чистые кредитовые обороты. Данные выписок по ${lastD}.`], [],
    [H("Показатель"), H(`${Y - 1} год`), H(`${Y} год (01.01–${lastD})`)],
    ["Чистые кредитовые обороты, тыс. тг", { v: P.prev.tot / 1000, s: 2 }, { v: P.cur.tot / 1000, s: 2 }],
    ["Месяцев с поступлениями", P.prev.months.filter(m => P.prev.cps.some(o => o.m[m])).length, P.cur.months.filter(m => P.cur.cps.some(o => o.m[m])).length],
    ["Среднемесячно, тыс. тг", { v: P.prev.tot / 12000, s: 2 }, { v: P.cur.tot / 1000 / Math.max(1, P.lastM), s: 2 }],
    ["Покупателей (контрагентов)", P.prev.cps.length, P.cur.cps.length],
    ["Доля крупнейшего покупателя", { v: share(P.prev, 1), s: 3 }, { v: share(P.cur, 1), s: 3 }],
    ["Доля пяти крупнейших", { v: share(P.prev, 5), s: 3 }, { v: share(P.cur, 5), s: 3 }],
    ["Товарных групп", P.prev.prods.length, P.cur.prods.length],
    ["Крупнейшая товарная группа", P.prev.prods[0]?.name || "—", P.cur.prods[0]?.name || "—"],
    ["Её доля", { v: P.prev.prods[0] && P.prev.tot ? P.prev.prods[0].v / P.prev.tot : 0, s: 3 }, { v: P.cur.prods[0] && P.cur.tot ? P.cur.prods[0].v / P.cur.tot : 0, s: 3 }],
    [], ["Товарные группы определены автоматически по назначению платежа (первые значимые слова, разные окончания объединены). Проверьте группировку на листах «Товары»."]];
  const ops = [[{ v: "Все поступления из выписок", s: 7 }], [], [H("Дата"), H("Контрагент"), H("БИН / ИИН"), H("КНП"), H("Назначение платежа"), H("Товарная группа"), H("Сумма, тыс. тг"), H("В расчёте выручки")]];
  for (const x of P.all.filter(x => x.cr).sort((a, b) => a.t.d.localeCompare(b.t.d))) ops.push([x.t.d.split("-").reverse().join("."), x.t.cp || "", x.t.bin || "", x.t.knp || "", x.t.purp || "", x.cat ? "" : (s => s.charAt(0).toUpperCase() + s.slice(1))(prodOf(x.t.purp).name), { v: x.cr / 1000, s: 2 }, x.cat ? "нет — " + (DocParse.CATS[x.cat] || x.cat) : "да"]);
  const sheets = [{ name: "Сводка", rows: sum, widths: [44, 22, 26], freeze: 4 },
    pivotSheet(`Контрагенты ${Y - 1}`, P.prev, "cp"), pivotSheet(`Контрагенты ${Y} с 01.01`, P.cur, "cp"),
    pivotSheet(`Товары ${Y - 1}`, P.prev, "pr"), pivotSheet(`Товары ${Y} с 01.01`, P.cur, "pr"),
    { name: "Операции", rows: ops, widths: [11, 36, 15, 6, 70, 26, 14, 30], freeze: 3 }];
  const bin = xlsxBuild(sheets);
  download(`Анализ_выписок_${safeName(nm)}.xlsx`, bin, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  C.log.unshift({ t: new Date().toISOString(), file: `Анализ_выписок_${safeName(nm)}.xlsx`, comp: nm, per: `${Y - 1}, ${Y} с 01.01`, kind: "Выгрузка", note: `поступлений в расчёте: ${P.tx.length}` }); touch();
  toast("Файл анализа выписок сохранён в «Загрузки»");
}
document.addEventListener("click", e => { const b = e.target.closest("button[data-act=bankxls]"); if (b && C) bankExport(COMP_TAB > nComp() ? 1 : COMP_TAB); });
