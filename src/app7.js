"use strict";
/* ---------------------------------------------------------------- распознавание PDF: налоговые декларации и справки банков об оборотах
   Только разбор текста (без интерфейса), чтобы проверялось отдельно. Суммы возвращаются в тенге, как в документах. */
const DocParse = (() => {
  const norm = s => String(s ?? "").replace(/[   ]/g, " ").replace(/ё/g, "е").replace(/Ё/g, "Е");
  const low = s => norm(s).toLowerCase();
  const NUMCELL = /^[-−–(]?\s*\d[\d\s.,]*\)?$/;
  function amt(s) {
    let t = norm(s).replace(/\s+/g, "").replace(/[−–]/g, "-");
    if (!/\d/.test(t)) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (t[0] === "-") { neg = !neg; t = t.slice(1); }
    const seps = t.match(/[.,]/g) || [];
    if (seps.length) {
      const p = Math.max(t.lastIndexOf("."), t.lastIndexOf(",")), tail = t.length - p - 1;
      const same = seps.every(x => x === seps[0]);
      t = tail === 3 && same ? t.replace(/[.,]/g, "") : t.slice(0, p).replace(/[.,]/g, "") + "." + t.slice(p + 1);
    }
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = parseFloat(t);
    return isFinite(v) ? (neg ? -v : v) : null;
  }
  const isNumCell = s => NUMCELL.test(norm(s).trim()) && /\d/.test(s);
  const allLines = pdf => pdf.pages.flatMap((p, pi) => p.lines.map(l => ({ ...l, page: pi })));
  // «2 0 2 4» → «2024» (цифры в клетках)
  const squeeze = s => norm(s).replace(/\b\d(?: \d\b)+/g, m => m.replace(/ /g, ""));

  /* ---------- декларации */
  const FORMS = {
    "100": { name: "КПН (ф. 100.00)", part: "Y" }, "110": { name: "КПН (ф. 110.00)", part: "Y" }, "150": { name: "КПН недропользователя (ф. 150.00)", part: "Y" },
    "200": { name: "ИПН и социальный налог (ф. 200.00)", part: "Q" }, "220": { name: "ИПН (ф. 220.00)", part: "Y" }, "240": { name: "ИПН (ф. 240.00)", part: "Y" },
    "300": { name: "НДС (ф. 300.00)", part: "Q" }, "910": { name: "Упрощённая декларация (ф. 910.00)", part: "H" }, "913": { name: "Розничный налог (ф. 913.00)", part: "H" },
    "920": { name: "Фиксированный вычет (ф. 920.00)", part: "Y" }, "700": { name: "Имущество, земля, транспорт (ф. 700.00)", part: "Y" }, "101": { name: "Расчёт КПН (ф. 101)", part: "Y" },
  };
  // показатели для сверки: ключ → название и правила поиска по наименованию строки
  const KEYS = {
    rev: { t: "Доход от реализации / доход", forms: ["100", "110", "150", "910", "913", "220"] },
    sgd: { t: "Совокупный годовой доход", forms: ["100", "110", "150", "220"] },
    taxinc: { t: "Налогооблагаемый доход", forms: ["100", "110", "150", "220"] },
    cit: { t: "КПН / ИПН исчисленный", forms: ["100", "110", "150", "910", "913", "220"] },
    vat_turn: { t: "Облагаемый оборот (НДС)", forms: ["300"] },
    vat_ex: { t: "Освобождённый оборот (НДС)", forms: ["300"] },
    fot: { t: "Доходы работников (ФОТ)", forms: ["200", "910"] },
  };
  const RULES = {
    rev: [/доход\S*\s+от\s+реализац/, /^доход(\s|$|,)/, /^доход\S*\s+(субъекта|получ)/],
    sgd: [/совокупн\S*\s+годов\S*\s+доход(?!.*корректир)/],
    taxinc: [/налогооблагаем\S*\s+доход/],
    cit: [/(исчисл\S*|сумм\S*)\s+(корпоративн\S*\s+подоходн\S*\s+налог|кпн|ипн)/, /(кпн|ипн)\S*\s*(\(кпн\))?.*(исчисл|к\s+уплат|подлежащ)/, /^сумма\s+(ипн|кпн)/],
    vat_turn: [/облагаем\S*\s+оборот/, /оборот\S*.*облагаем/],
    vat_ex: [/освобожд\S*\s+оборот/, /оборот\S*.*освобожд/],
    fot: [/доход\S*.*работник/, /начисленн\S*\s+доход/, /фонд\s+оплат/],
  };
  const EXCL = { cit: /^доход|облагаем\S*\s+доход|оборот/, rev: /уменьша|корректир|налогооблагаем|для\s+исчисл/ };
  const CODE = /^(\d{3})\.(\d{2})\.(\d{3})(?:\s*([A-ZА-Я]{1,2}|[IVX]{1,4})(?![A-Za-zА-Яа-я]))?/;
  const LAT = { "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X" };
  const sufNorm = s => (s || "").split("").map(ch => LAT[ch] || ch).join("");
  function codeAt(line) {
    for (let i = 0; i < Math.min(2, line.cells.length); i++) {
      const s = norm(line.cells[i].s).trim(), m = CODE.exec(s);
      if (m) {
        let suf = sufNorm(m[4]);
        let ci = i, rest = s.slice(m[0].length).trim();
        if (!suf && !rest && line.cells[i + 1] && /^([A-ZА-Я]|[IVX]{1,4})$/.test(norm(line.cells[i + 1].s).trim())) { suf = sufNorm(norm(line.cells[i + 1].s).trim()); ci = i + 1; }
        return { form: m[1], sub: m[2], code: `${m[1]}.${m[2]}.${m[3]}`, suf, ci, rest };
      }
      if (!/^\d{1,3}\.?$/.test(s)) break;          // номер п/п перед кодом допускается
    }
    return null;
  }
  function isDecl(pdf) {
    let n = 0; for (const l of allLines(pdf)) if (codeAt(l)) n++;
    return n;
  }
  function parseDecl(pdf) {
    const L = allLines(pdf), rows = [], cnt = new Map();
    for (let i = 0; i < L.length; i++) {
      const c = codeAt(L[i]); if (!c) continue;
      cnt.set(c.form + "." + c.sub, (cnt.get(c.form + "." + c.sub) || 0) + 1);
      // блок строки: эта строка и продолжения названия до следующего кода
      const blk = [L[i]];
      for (let j = i + 1; j < L.length && blk.length < 6; j++) {
        if (L[j].page !== L[i].page || codeAt(L[j])) break;
        const gap = blk[blk.length - 1].y - L[j].y;
        if (gap > 2.6 * Math.max(L[j].fs, 6)) break;
        blk.push(L[j]);
      }
      const codeCell = L[i].cells[c.ci];
      const labs = [], nums = [];
      if (c.rest) labs.push(c.rest);
      blk.forEach((ln, bi) => ln.cells.forEach((cell, ci) => {
        if (bi === 0 && ci <= c.ci) return;
        const s = norm(cell.s).trim();
        if (isNumCell(s) && cell.x > codeCell.x2 + 2) nums.push({ x: cell.x, v: amt(s), bi });
        else if (!/^стр\.?\s*\d+$/i.test(s)) labs.push(s);
      }));
      nums.sort((a, b) => a.x - b.x);
      // одиночная цифра сразу за кодом — чаще номер графы/подстроки, а не сумма
      rows.push({ code: c.code + (c.suf ? " " + c.suf : ""), base: c.code, suf: c.suf, form: c.form, sub: c.sub, label: labs.join(" ").replace(/\s+/g, " ").trim(), vals: nums.map(n => n.v).filter(v => v !== null) });
    }
    // основная форма: чаще всего встречающийся префикс вида XXX.00
    let form = null, best = 0;
    for (const [k, n] of cnt) if (k.endsWith(".00") && n > best) { best = n; form = k.slice(0, 3); }
    if (!form) for (const [k, n] of cnt) if (n > best) { best = n; form = k.slice(0, 3); }
    // строки без дублей (одна и та же строка могла попасть дважды на разных страницах)
    const seen = new Set(), lines = [];
    for (const r of rows) { const key = r.code + "|" + r.vals.join(","); if (seen.has(key)) continue; seen.add(key); lines.push(r); }
    // налоговый период и БИН
    const first = L.filter(l => l.page === 0).map(l => squeeze(l.text));
    const all = first.join("\n"), lw = low(all);
    let year = null;
    for (let i = 0; i < first.length && !year; i++) if (/период/i.test(first[i])) for (const s of first.slice(i, i + 3)) { const m = /\b(20[1-4]\d)\b/.exec(s); if (m) { year = +m[1]; break; } }
    if (!year) { const m = /\b(20[1-4]\d)\b/.exec(all); if (m) year = +m[1]; }
    let part = FORMS[form]?.part === "Y" || !FORMS[form] ? "Y" : null;
    let m = /\b([1-4])\s*-?\s*(?:й|ый|ой|ий)?\s*квартал/.exec(lw) || /квартал\D{0,20}?\b([1-4])\b/.exec(lw);
    if (m && FORMS[form]?.part !== "H" && FORMS[form]?.part !== "Y") part = "Q" + m[1];
    m = /\b([12])\s*-?\s*(?:е|ое)?\s*полугоди/.exec(lw) || /полугоди\S*\D{0,20}?\b([12])\b/.exec(lw);
    if (m && FORMS[form]?.part === "H") part = "H" + m[1];
    if (!part) part = FORMS[form]?.part === "H" ? "H1" : FORMS[form]?.part === "Q" ? "Q1" : "Y";
    const binM = /(?:бин|иин)[^\d]{0,30}(\d{12})/i.exec(squeeze(L.slice(0, 40).map(l => l.text).join(" ")));
    return { form, formName: FORMS[form]?.name || (form ? `Форма ${form}.00` : "Форма не определена"), year, part, bin: binM ? binM[1] : "", lines, partGuessed: !m };
  }
  // какие строки декларации идут в показатели сверки: сначала выбор пользователя (по коду), потом правила
  function pickKeys(d, userMap) {
    const out = {}, used = new Set(), um = (userMap || {})[d.form] || {};
    for (const [key, code] of Object.entries(um)) { const r = d.lines.find(l => l.code === code); if (r) { out[key] = r.code; used.add(r.code); } }
    for (const key of Object.keys(KEYS)) {
      if (out[key] || !KEYS[key].forms.includes(d.form)) continue;
      if (um[key] === "") continue;                       // пользователь явно отключил
      let hit = null;
      if (key === "rev" && d.form === "910") hit = d.lines.find(l => l.base === "910.00.001" && !l.suf);
      for (const re of RULES[key]) {
        if (hit) break;
        const cand = d.lines.filter(l => re.test(low(l.label)) && !(EXCL[key] && EXCL[key].test(low(l.label))) && l.base.startsWith(d.form + ".00") && !used.has(l.code));
        hit = cand.find(l => !l.suf) || cand[0] || null;
      }
      if (hit) { out[key] = hit.code; used.add(hit.code); }
    }
    return out;
  }

  /* ---------- справки банков */
  const MON = [/^январ/, /^феврал/, /^март/, /^апрел/, /^ма[йяе]/, /^июн/, /^июл/, /^август/, /^сентябр/, /^октябр/, /^ноябр/, /^декабр/];
  const MON_KZ = [/^қаңтар/, /^ақпан/, /^наурыз/, /^с[әа]уір/, /^мамыр/, /^маусым/, /^шілде/, /^тамыз/, /^қыркүйек/, /^қазан/, /^қараша/, /^желтоқсан/];
  const MON_EN = [/^jan/, /^feb/, /^mar/, /^apr/, /^may/, /^jun/, /^jul/, /^aug/, /^sep/, /^oct/, /^nov/, /^dec/];
  function monthLabel(s) {
    const t = low(s).trim().replace(/^за\s+/, "");
    let m = /^(\d{2})\.(\d{2})\.(\d{4})\s*(?:-|–|—|по)\s*(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
    if (m && m[2] === m[5] && m[3] === m[6] && m[1] === "01") return { m: +m[2] - 1, y: +m[3] };
    m = /^(\d{1,2})[./](\d{4})(\s*г\.?)?$/.exec(t); if (m && +m[1] >= 1 && +m[1] <= 12) return { m: +m[1] - 1, y: +m[2] };
    m = /^(\d{4})[-./](\d{1,2})$/.exec(t); if (m && +m[2] >= 1 && +m[2] <= 12) return { m: +m[2] - 1, y: +m[1] };
    for (const L of [MON, MON_KZ, MON_EN]) for (let i = 0; i < 12; i++) if (L[i].test(t)) {
      const y = /\b(20\d{2})\b/.exec(t);
      if (t.replace(/\b20\d{2}\b/, "").replace(/г(ода?)?\.?/, "").trim().split(/\s+/).length > 2) return null;
      return { m: i, y: y ? +y[1] : null };
    }
    return null;
  }
  const SEM = [["in", /(входящ\S*(\s+остат\S*|\s+сальдо)?|остат\S*\s+на\s+начало|сальдо\s+на\s+начало|начальн\S*\s+остат\S*)/g], ["out", /(исходящ\S*(\s+остат\S*|\s+сальдо)?|остат\S*\s+на\s+конец|сальдо\s+на\s+конец|конечн\S*\s+остат\S*)/g],
    ["db", /(дебет\S*|списан\S*|расход\S*|debit)/g], ["cr", /(кредит\S*|поступлен\S*|приход\S*|зачислен\S*|credit)/g]];
  function semList(text) {
    const t = low(text), hits = [];
    for (const [k, re] of SEM) { re.lastIndex = 0; let m; while ((m = re.exec(t))) hits.push([m.index, k, m[0].length]); }
    hits.sort((a, b) => a[0] - b[0]);
    const out = []; let end = -1;
    for (const [i, k, n] of hits) { if (i < end) continue; out.push(k); end = i + n; }
    return out;
  }
  function headerSem(text) { const s = semList(text); return s.includes("db") && s.includes("cr") ? s : null; }
  const IBAN = /\bKZ\d{2}[0-9A-Z]{14,18}\b/;
  const CUR = /\b(KZT|USD|EUR|RUB|CNY|GBP|CHF|AED|TRY|KGS|UZS)\b|(тенге|доллар\S*|евро|рубл\S*|юан\S*)/i;
  const curCode = s => { const m = CUR.exec(s); if (!m) return null; if (m[1]) return m[1].toUpperCase(); const w = m[2].toLowerCase(); return w.startsWith("тенге") ? "KZT" : w.startsWith("доллар") ? "USD" : w === "евро" ? "EUR" : w.startsWith("рубл") ? "RUB" : "CNY"; };
  const BANKS = /(Halyk|Народн\S*\s+банк|Kaspi|Каспи|Forte|Форте|Jusan|Жусан|Freedom|Фридом|Bereke|Береке|Центр\s*Кредит|CenterCredit|Bank\s*RBK|Банк\s*RBK|Отбасы|Otbasy|ВТБ|VTB|Альфа[-\s]?Банк|Alfa[-\s]?Bank|Home\s*Credit|Хоум\s*Кредит|Евразийск\S*\s+банк|Eurasian|Нурбанк|Nurbank|KZI|Зираат|Ситибанк|Citibank|Bank\s+of\s+China|Банк\s+Китая|Шинхан|Shinhan|Altyn|Алтын|Tengri|Kassa\s*Nova|Касса\s*Нова|Исламск\S*\s+банк|Al\s*Hilal|Аль\s*Хилал|ICBC|Торгово-промышленн\S*\s+банк|Hunan|Хунань|Береке)/i;
  function isBank(pdf) {
    const L = allLines(pdf); let score = 0;
    for (const l of L) { const t = low(l.text); if (headerSem(l.text)) score += 3; if (/оборот/.test(t)) score++; if (IBAN.test(norm(l.text))) score++; }
    return score;
  }
  function parseBank(pdf) {
    const L = allLines(pdf), secs = [], txt = L.map(l => norm(l.text)).join("\n");
    let sec = null, cur = null, hdr = null, period = null, lastM = null, lastY = null;
    const pm = /(?:с|period\s+from|from)\s*(\d{2}\.\d{2}\.\d{4})\D{1,15}?(?:по|to|-|–)\s*(\d{2}\.\d{2}\.\d{4})/i.exec(txt);
    if (pm) period = { from: pm[1], to: pm[2] };
    else { const y = /за\s+(20\d{2})\s*(?:год|г\.)/i.exec(txt); if (y) period = { from: "01.01." + y[1], to: "31.12." + y[1] }; }
    const startY = period ? +period.from.slice(6) : null;
    const bm = BANKS.exec(txt);
    let bank = bm ? bm[0].replace(/\s+/g, " ") : "";
    if (!bank) { const bl = L.find(l => /банк|bank/i.test(l.text) && l.text.length < 90); if (bank === "" && bl) bank = norm(bl.text).replace(/\s+/g, " ").trim(); }
    const newSec = acc => { sec = { acc: acc || "", cur: cur || null, months: {}, total: null, rows: 0 }; secs.push(sec); return sec; };
    const ymKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
    for (let i = 0; i < L.length; i++) {
      const ln = L[i], t = norm(ln.text), lt = low(t);
      const ib = IBAN.exec(t);
      if (ib) {
        const acc = ib[0];
        if (!sec) newSec(acc);
        else if (sec.acc !== acc) { if (sec.rows || sec.acc) newSec(acc); else sec.acc = acc; }
      }
      if (/валют/i.test(t) || ib) { const c = curCode(t.replace(IBAN, "")); if (c) { cur = c; if (sec && !sec.rows) sec.cur = c; } }
      if (headerSem(t)) {
        // заголовок таблицы (с учётом строки над ним, если шапка в две строки): порядок и положение колонок
        const cols = [], take = l => { for (const c of l.cells) { const ks = semList(c.s); ks.forEach((k, j) => cols.push({ k, x: c.x + (c.x2 - c.x) * (j + 0.5) / ks.length })); } };
        const pv = L[i - 1];
        if (pv && pv.page === ln.page && pv.y - ln.y < 2.6 * Math.max(ln.fs, 6) && !pv.cells.some(c => isNumCell(c.s))) take(pv);
        take(ln);
        cols.sort((a, b) => a.x - b.x);
        const sem = []; for (const c of cols) if (!sem.includes(c.k)) sem.push(c.k);
        hdr = { sem, cols };
        if (!sec) newSec("");
        continue;
      }
      if (!hdr) continue;
      let first = norm(ln.cells[0]?.s || "").trim();
      const nums = ln.cells.slice(1).filter(c => isNumCell(c.s)).map(c => ({ x: (c.x + c.x2) / 2, v: amt(c.s) })).filter(n => n.v !== null);
      const glued = /^(\S+(?:\s+20\d{2})?(?:\s*г\.?)?)\s+([-−(]?\d[\d\s.,]*\)?)$/.exec(first);
      if (glued && !monthLabel(first) && monthLabel(glued[1])) { first = glued[1]; nums.unshift({ x: ln.cells[0].x2 - 20, v: amt(glued[2]) }); }
      if (!nums.length) continue;
      const assign = () => {
        const numSem = hdr.sem.filter(k => ["in", "out", "db", "cr"].includes(k)), r = {};
        if (nums.length === numSem.length) nums.forEach((n, j) => (r[numSem[j]] = n.v));
        else if (hdr.cols.length) nums.forEach(n => { let best = null, d = 1e9; for (const c of hdr.cols) { const dd = Math.abs(c.x - n.x); if (dd < d) { d = dd; best = c.k; } } if (best && d < 60 && r[best] === undefined) r[best] = n.v; });
        else if (nums.length === 2) { const o = hdr.sem.filter(k => k === "db" || k === "cr"); r[o[0]] = nums[0].v; r[o[1]] = nums[1].v; }
        return r;
      };
      if (/^(итого|всего|total|итог)/i.test(low(first))) { const r = assign(); if (r.cr !== undefined || r.db !== undefined) sec.total = { cr: r.cr ?? null, db: r.db ?? null }; continue; }
      const ml = monthLabel(first);
      if (!ml) continue;
      let y = ml.y;
      if (!y) { y = lastY ?? startY ?? new Date().getFullYear(); if (lastM !== null && ml.m < lastM && lastY !== null) y = lastY + 1; }
      lastM = ml.m; lastY = y;
      const r = assign();
      if (r.cr === undefined && r.db === undefined) continue;
      const k = ymKey(y, ml.m), o = sec.months[k] || (sec.months[k] = { cr: 0, db: 0 });
      o.cr += r.cr || 0; o.db += r.db || 0; sec.rows++;
    }
    // справка без помесячной таблицы: обороты одной суммой за период
    if (!secs.some(s => s.rows)) {
      const find = re => { const m = re.exec(txt.replace(/\n/g, " ")); return m ? amt(m[1]) : null; };
      const NUM = "(\\d{1,3}(?:[\\s]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
      const cr = find(new RegExp("(?:оборот\\S*\\s+по\\s+кредиту|кредитов\\S*\\s+оборот\\S*|сумма\\s+поступлен\\S*|поступлен\\S*\\s+(?:денег|денежных|средств)\\S*|зачислен\\S*)[^\\d]{0,80}?" + NUM, "i"));
      const db = find(new RegExp("(?:оборот\\S*\\s+по\\s+дебету|дебетов\\S*\\s+оборот\\S*|сумма\\s+списан\\S*|списан\\S*\\s+(?:денег|денежных|средств)\\S*)[^\\d]{0,80}?" + NUM, "i"));
      if (cr !== null || db !== null) { if (!secs.length) newSec(IBAN.exec(txt)?.[0] || ""); secs[0].total = { cr, db }; secs[0].rangeOnly = true; if (!secs[0].cur) secs[0].cur = curCode(txt) || "KZT"; }
    }
    for (const s of secs) if (!s.cur) s.cur = cur || "KZT";
    const binM = /(?:бин|иин)[^\d]{0,30}(\d{12})/i.exec(squeeze(txt));
    return { bank, period, bin: binM ? binM[1] : "", accounts: secs.filter(s => s.rows || s.total) };
  }

  async function read(buf) {
    const pdf = await PdfReader.read(buf);
    const nd = isDecl(pdf), nb = isBank(pdf);
    let kind = nd >= 3 && nd * 2 >= nb ? "decl" : nb >= 3 ? "bank" : nd >= 2 ? "decl" : null;
    return { pdf, kind, decl: kind === "decl" ? parseDecl(pdf) : null, bank: kind === "bank" ? parseBank(pdf) : null };
  }
  return { read, parseDecl, parseBank, pickKeys, isDecl, isBank, monthLabel, headerSem, amt, FORMS, KEYS };
})();
