"use strict";
/* ---------------------------------------------------------------- распознавание PDF: налоговые декларации и справки банков об оборотах
   Только разбор текста (без интерфейса), чтобы проверялось отдельно. Суммы возвращаются в тенге, как в документах. */
const DocParse = (() => {
  const norm = s => String(s ?? "").replace(/[   ]/g, " ").replace(/ё/g, "е").replace(/Ё/g, "Е");
  const low = s => norm(s).toLowerCase();
  const NUMCELL = /^[-−–+(]?\s*\d[\d\s.,]*\)?$/;
  const stripCur = s => norm(s).replace(/₸|\bkzt\b|\bтг\.?|\bтенге\b/gi, "").trim();
  function amt(s) {
    let t = stripCur(s).replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/^\+/, "");
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
  const isNumCell = s => NUMCELL.test(stripCur(s)) && /\d/.test(s);
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
    const codes = [];   // строки с кодом: индекс, код, ячейка кода
    for (let i = 0; i < L.length; i++) { const c = codeAt(L[i]); if (c) { codes.push({ i, c, ln: L[i], labs: c.rest ? [c.rest] : [], nums: [] }); cnt.set(c.form + "." + c.sub, (cnt.get(c.form + "." + c.sub) || 0) + 1); } }
    const byLine = new Map(codes.map(o => [o.i, o]));
    // каждую строку без кода относим к ближайшему коду на той же странице (сумма бывает выше или ниже строки с кодом)
    for (let i = 0; i < L.length; i++) {
      const ln = L[i], own = byLine.get(i);
      let tgt = own;
      if (!tgt) {
        let best = null, d = 1e9;
        for (const o of codes) { if (o.ln.page !== ln.page) continue; const dd = Math.abs(o.ln.y - ln.y); if (dd < d) { d = dd; best = o; } }
        const lim = 2.8 * Math.max(ln.fs, best ? best.ln.fs : 6, 6);
        if (!best || d > lim) continue;
        // строка ниже кода — продолжение названия; выше — только суммы
        tgt = best;
      }
      const codeCell = tgt.ln.cells[tgt.c.ci];
      ln.cells.forEach((cell, ci) => {
        if (own && ci <= tgt.c.ci) return;
        const t = norm(cell.s).trim();
        if (isNumCell(t) && cell.x > codeCell.x2 + 2) tgt.nums.push({ x: cell.x, x2: cell.x2, v: amt(t), raw: t.replace(/\s+/g, ""), fs: cell.fs, d: Math.abs(ln.y - tgt.ln.y) });
        else if (!own && ln.y > tgt.ln.y) return;                 // текст выше строки кода — не наш
        else if (!/^стр\.?\s*\d+$/i.test(t) && !(own === undefined && codeAt({ cells: [cell] }))) tgt.labs.push(t);
      });
    }
    for (const o of codes) {
      // одна и та же колонка — берём ближайшую по вертикали сумму
      const cols = [];
      for (const n of o.nums.sort((a, b) => a.x - b.x)) { const c = cols.find(k => Math.abs(k.x - n.x) < 12 || Math.abs(k.x2 - n.x2) < 12); if (!c) cols.push({ ...n }); else if (n.d < c.d) Object.assign(c, n); }
      // цифры «по клеткам», разбитые на отдельные ячейки, — склеиваем в одно число
      const merged = [];
      for (const c of cols.sort((a, b) => a.x - b.x)) {
        const pv = merged[merged.length - 1];
        if (pv && /^\d+$/.test(pv.raw) && /^\d+$/.test(c.raw) && c.raw.length <= 3 && c.x - pv.x2 < 3 * (c.fs || 8)) { pv.raw += c.raw; pv.v = +pv.raw; pv.x2 = c.x2; }
        else merged.push({ ...c });
      }
      const c = o.c;
      rows.push({ code: c.code + (c.suf ? " " + c.suf : ""), base: c.code, suf: c.suf, form: c.form, sub: c.sub, label: o.labs.join(" ").replace(/\s+/g, " ").trim(), vals: merged.map(n => n.v).filter(v => v !== null) });
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
    // вид декларации: отметка (X, V, ✓) перед «дополнительная» / «дополнительная по уведомлению»
    const vm = /(?:^|\s)[xхv✓✔☒■]\s*(?:[a-zа-я]?\s*)?дополнительн\S*(\s+по\s+уведомлени)?/i.exec(lw);
    const vid = vm ? (vm[1] ? "addn" : "add") : "";
    return { form, formName: FORMS[form]?.name || (form ? `Форма ${form}.00` : "Форма не определена"), year, part, vid, bin: binM ? binM[1] : "", lines, partGuessed: !m };
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

  /* ---------- выписки по счёту: операции */
  const DATE = /^(\d{2})[./](\d{2})[./](\d{4}|\d{2})\b/;
  function toISO(s) {
    const m = DATE.exec(norm(s).trim()); if (!m) { const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(norm(s).trim()); return m2 ? `${m2[1]}-${m2[2]}-${m2[3]}` : null; }
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31 ? `${y}-${m[2]}-${m[1]}` : null;
  }
  function colSem(text) {
    const t = low(text).replace(/\s+/g, " ").trim();
    if (!t) return null;
    if (/^(дата|date)|дата\s+(операц|провод|документ|валютир)|^день/.test(t)) return "date";
    if (/кнп|код\s+назнач|knp/.test(t)) return "knp";
    if (/назначени|основани|описани|детал|purpose|комментар|содержани/.test(t)) return "purp";
    if (/эквивалент|в\s+тенге|в\s+нац\S*\s+валют|equivalent/.test(t)) return "eq";
    if (/^(сумма\s+)?(по\s+)?(дебет|списан|расход)|debit|withdraw|^расход/.test(t)) return "db";
    if (/^(сумма\s+)?(по\s+)?(кредит|поступ|приход|зачисл)|credit|^приход/.test(t)) return "cr";
    if (/корреспондент|контрагент|отправител|получател|плательщик|бенефициар|counterparty|наименован/.test(t)) return "cp";
    if (/^(бин|иин)|бин\s*\/\s*иин|^bin|^iin/.test(t)) return "bin";
    if (/^(сумма|amount)/.test(t)) return "amt";
    if (/номер\s+док|№\s*док|^№|^номер|^doc/.test(t)) return "doc";
    if (/иик|iban|сч[её]т/.test(t)) return "iik";
    if (/банк|бик|bic/.test(t)) return "bnk";
    if (/^валют|currency/.test(t)) return "cur";
    if (/операц|^вид|д\s*\/\s*к|тип/.test(t)) return "op";
    return null;
  }
  function stmtHeader(line) {
    const cols = [];
    for (const c of line.cells) { const k = colSem(c.s); if (k) cols.push({ k, x1: c.x, x2: c.x2, s: c.s }); }
    const ks = new Set(cols.map(c => c.k));
    const score = ks.has("date") && (ks.has("cr") || ks.has("amt") || ks.has("db")) ? ks.size : 0;
    return score >= 3 ? cols : null;
  }
  function isStmt(pdf) {
    const L = allLines(pdf); let hdr = false, n = 0;
    for (const l of L) { if (!hdr && stmtHeader(l)) hdr = true; else if (hdr && toISO(l.cells[0]?.s || "")) n++; }
    return hdr ? n : 0;
  }
  function parseStmt(pdf) {
    const L = allLines(pdf), txt = L.map(l => norm(l.text)).join("\n"), txs = [];
    let cols = null, cur = null, page = -1;
    const bm = BANKS.exec(txt);
    const accM = IBAN.exec(txt);
    let accCur = null;
    for (const l of L.slice(0, 40)) if (/валют/i.test(l.text) || IBAN.test(norm(l.text))) { const c = curCode(norm(l.text).replace(IBAN, "")); if (c) { accCur = c; break; } }
    const pm = /(?:с|period\s+from|from|за\s+период)\s*(\d{2}\.\d{2}\.\d{4})\D{1,15}?(?:по|to|-|–)\s*(\d{2}\.\d{2}\.\d{4})/i.exec(txt);
    for (let i = 0; i < L.length; i++) {
      const ln = L[i];
      const h = stmtHeader(ln);
      if (h) {
        // шапка в две строки: «Сумма» сверху, «Дебет | Кредит» снизу (или наоборот)
        const nx = L[i + 1];
        if (nx && nx.page === ln.page && !toISO(nx.cells[0]?.s || "")) for (const c of nx.cells) { const k = colSem(c.s); if (k && !h.some(x => x.k === k)) h.push({ k, x1: c.x, x2: c.x2, s: c.s }); }
        cols = h;
        cur = null; continue;
      }
      if (!cols) continue;
      const lt = low(ln.text);
      if (/^(итого|всего|обороты|входящ|исходящ|остаток|сальдо|страниц|page)/.test(lt)) { cur = null; continue; }
      // ячейки → колонки
      const f = {};
      for (const c of ln.cells) {
        const xc = (c.x + c.x2) / 2; let best = null, d = 1e9;
        for (const col of cols) { const dd = xc >= col.x1 - 4 && xc <= col.x2 + 4 ? 0 : Math.min(Math.abs(xc - col.x1), Math.abs(xc - col.x2)); if (dd < d) { d = dd; best = col; } }
        if (best) f[best.k] = f[best.k] ? f[best.k] + " " + c.s : c.s;
      }
      const iso = f.date ? toISO(f.date) : null;
      if (iso) {
        cur = { d: iso, doc: f.doc || "", cp: f.cp || "", bin: "", knp: "", purp: f.purp || "", op: f.op || "", iik: f.iik || "", db: 0, cr: 0, eq: null, cur: f.cur ? curCode(f.cur) : null, _f: f };
        txs.push(cur); page = ln.page;
      } else if (cur && ln.page === page) {
        for (const k of ["cp", "purp", "op", "doc", "bin", "knp", "iik"]) if (f[k]) cur[k] = (cur[k] ? cur[k] + " " : "") + f[k];
        for (const k of ["db", "cr", "amt", "eq"]) if (f[k] && !cur._f[k]) cur._f[k] = f[k];
      } else continue;
      if (f.bin) cur.bin = (cur.bin ? cur.bin + " " : "") + f.bin;
      if (f.knp) cur.knp = (cur.knp ? cur.knp + " " : "") + f.knp;
    }
    for (const t of txs) {
      const f = t._f; delete t._f;
      const n = k => (f[k] ? amt(f[k].replace(/[^\d\s.,()+−–-]/g, "")) : null);
      let db = n("db"), cr = n("cr");
      if (db === null && cr === null && f.amt) {
        const v = amt(f.amt), sign = /^\s*[-−–]/.test(norm(f.amt)) ? -1 : 1, op = low(t.op + " " + f.amt);
        if (v !== null) { if (/(^|\s)(к|кредит|приход|зачисл|пополн)/.test(op) && !/(^|\s)(д|дебет|расход|списан)\b/.test(op)) cr = Math.abs(v); else if (/(^|\s)(д|дебет|расход|списан|покупк|оплат)/.test(op) || sign < 0 || v < 0) db = Math.abs(v); else cr = Math.abs(v); }
      }
      t.db = Math.abs(db || 0); t.cr = Math.abs(cr || 0);
      if (f.eq) t.eq = amt(f.eq);
      const binM = /\b(\d{12})\b/.exec(t.bin + " " + t.cp) || /(?:бин|иин)\D{0,5}(\d{12})/i.exec(t.purp);
      t.bin = binM ? binM[1] : "";
      const knpM = /\b(\d{3})\b/.exec(t.knp) || /кнп\D{0,5}(\d{3})/i.exec(t.purp);
      t.knp = knpM ? knpM[1] : "";
      for (const k of ["cp", "purp", "op", "doc", "iik"]) t[k] = norm(t[k]).replace(/\s+/g, " ").trim();
      if (t.cur === null) delete t.cur;
    }
    const binC = /(?:бин|иин)[^\d]{0,30}(\d{12})/i.exec(squeeze(L.slice(0, 30).map(l => l.text).join(" ")));
    return { bank: bm ? bm[0].replace(/\s+/g, " ") : "", acc: accM ? accM[0] : "", cur: accCur || "KZT", from: pm ? pm[1] : "", to: pm ? pm[2] : "", bin: binC ? binC[1] : "", txs: txs.filter(t => t.db || t.cr) };
  }

  /* ---------- чистые кредитовые обороты: что не принимается в расчёт */
  const CATS = {
    loan: "Выдача кредитов и займов",
    conv: "Конвертация (продажа валюты)",
    own: "Перевод собственных средств",
    ret: "Возврат платёжных документов",
    aid: "Фин. помощь, субсидии, штрафы и пени, вознаграждение, страховые",
    cash: "Взносы наличными",
    grp: "Поступления от компаний группы",
  };
  const KNP_CAT = { "411": "loan", "413": "loan", "419": "loan", "421": "loan", "423": "loan", "429": "loan", "211": "conv", "213": "conv", "221": "conv", "223": "conv", "230": "conv", "342": "own", "343": "own", "324": "own", "329": "own", "331": "cash", "333": "aid" };
  const clean = s => low(s).replace(/[«»"'“”]/g, "").replace(/\b(тоо|ао|ип|кх|ооо|пк|гкп|рго|ргп|llp|jsc)\b/g, "").replace(/\s+/g, " ").trim();
  function classify(t, own) {
    if (!t.cr) return null;
    const x = low(`${t.purp} ${t.op} ${t.cp}`), p = low(`${t.purp} ${t.op}`);
    const ownBin = t.bin && own.bins.includes(t.bin), ownName = own.names.some(n => n && n.length > 3 && clean(t.cp) === n);
    // исключения, которые остаются в расчёте
    const gchp = /гчп|государственно[-\s]?частн/.test(x);
    const cashOk = /инкасс/.test(x) || ((/индивидуальн\S*\s+предпринимат|(^|\s)ип(\s|$)/.test(x)) && /договор|контракт/.test(x));
    if (/конверт|продаж\S*\s+(иностранн\S*\s+)?валют|обмен\S*\s+валют|покупк\S*\s+тенге|conversion|fx\s*deal/.test(p)) return ["conv", "назначение: конвертация / продажа валюты"];
    if (/(выдач|предоставлен|зачислен|получен)\S*\s+(\S+\s+){0,3}(кредит|займ|заем|транш)|транш|(по|согласно)\s+(\S+\s+){0,2}(кредитн\S*|заемн\S*|займ\S*)\s+(договор|соглашени|линии)|(кредитн|заемн)\S*\s+средств|возврат\S*\s+(\S+\s+){0,2}(займ|заем|кредит)|погашен\S*\s+(\S+\s+){0,2}(займ|заем)|овердрафт/.test(p)) return ["loan", "назначение: кредит / заём"];
    if (ownBin || ownName) return ["own", ownBin ? "отправитель — сама компания (БИН)" : "отправитель — сама компания"];
    if (own.grp && t.bin && own.grp.includes(t.bin)) return ["grp", "отправитель — компания группы (БИН)"];
    if (/перевод\S*\s+(\S+\s+){0,3}(собственн|собств\.|своих|сво\S+\s+(средств|сч)|между\s+(своими\s+|собственными\s+)?сч|на\s+(свой|собственный)\s+сч|со\s+(своего|собственного)\s+сч)|собственн\S+\s+(денежн\S+\s+)?средств|собств\.\s*средств|между\s+(своими\s+|собственными\s+)?сч[её]т|с\s+(текущего\s+|депозитного\s+|карточного\s+|сберегательного\s+)?сч[её]та\s+на\s+(текущий\s+)?сч[её]т|пополнен\S*\s+(\S+\s+)?сч[её]та\s+(с|со)\s+(карт|друг|своего|депозит|сберегат)/.test(p)) return ["own", "назначение: перевод между своими счетами / собственных средств"];
    if (!/вознагражд|процент/.test(p) && /(выплат|возврат|изъяти|закрыти|погашени|сняти|сумм)\S*\s+(\S+\s+){0,2}(вклад|депозит)|(вклад|депозит)\S*\s+(\S+\s+){0,2}(выплат|возврат|изъят|закрыт|сняти|окончани)/.test(p)) return ["own", "назначение: выплата (возврат) вклада / депозита"];
    if (/возврат/.test(p) && /(платеж|плат\.|п\/п|ошибочн|излишн|реквизит|не\s*зачисл|неверн|отказ|ненадлежащ|оплат|аванс|средств|денег|денежн)/.test(p)) return ["ret", "назначение: возврат платежа"];
    if (/субсиди/.test(p) && !gchp) return ["aid", "субсидия"];
    if (/финансов\S*\s+помощ|фин\.?\s*помощ|безвозмездн/.test(p)) return ["aid", "финансовая помощь"];
    if (/штраф|(^|\s)пени(\s|$|,)|(^|\s)пеня|неустойк/.test(p)) return ["aid", "штрафы, пени"];
    if (!/агентск|комиссионн|посредническ|по\s+договору\s+(поручения|комиссии|оказания)/.test(p) && /выплат\S*\s+(\S+\s+){0,2}(вознагражден|процент)|(вознагражден|процент|интерес)\S*\s+(\S+\s+){0,3}(депозит|остат|вклад|сч[её]т|банк)|капитализац|начислен\S*\s+(\S+\s+)?(вознагражден|процент)/.test(p)) return ["aid", "выплата вознаграждения (проценты)"];
    if (/страхов\S*\s+(преми|возмещ|выплат|сумм)|страховое\s+возмещ/.test(p)) return ["aid", "страховые выплаты"];
    if (/взнос\S*\s+(\S+\s+)?наличн|наличн\S*\s+(деньг|средств)|пополнен\S*\s+(\S+\s+)?наличн|внесени\S*\s+(\S+\s+)?наличн|cash\s*(deposit|-?in)|(^|\s)наличными|банкомат|(через|в)\s+(\S+\s+)?касс[уеы]|кассу\s+банка|терминал\S*\s+(\S+\s+)?пополн|пополн\S*\s+(\S+\s+){0,3}(через\s+)?(терминал|atm|банкомат|касс)|кэш[-\s]?ин/.test(p) && !cashOk) return ["cash", "пополнение наличными (банкомат, касса)"];
    const kc = KNP_CAT[t.knp];
    if (kc && !(kc === "cash" && cashOk)) return [kc, "по коду назначения платежа " + t.knp];
    return null;
  }

  /* ---------- списания по видам */
  const DCATS = { loan: "Погашение кредитов и займов", int: "Вознаграждение по кредитам", tax: "Налоги и платежи в бюджет", pay: "Заработная плата", soc: "Пенсионные и социальные отчисления", cash: "Снятие наличных", own: "Переводы собственных средств", conv: "Покупка валюты", grp: "Компаниям группы", sup: "Поставщикам и прочие" };
  function classifyDebit(t, own) {
    if (!t.db) return null;
    const p = low(`${t.purp} ${t.op} ${t.cp}`), k = t.knp;
    if (t.bin && own.bins.includes(t.bin) || /перевод\S*\s+(\S+\s+){0,2}(собственн|своих|между\s+(своими\s+)?сч)|на\s+(свой|собственный)\s+сч|размещени\S*\s+(\S+\s+)?депозит/.test(p) || ["342", "343", "321", "322"].includes(k)) return "own";
    if (own.grp && t.bin && own.grp.includes(t.bin)) return "grp";
    if (/покупк\S*\s+(иностранн\S*\s+)?валют|конверт/.test(p) || ["211", "213", "230"].includes(k)) return "conv";
    if (/(вознагражден|процент)\S*\s+(\S+\s+){0,3}(кредит|займ|заем|договор\S*\s+(банковского\s+)?займ)/.test(p) || ["422", "424"].includes(k) && /вознагр|процент/.test(p)) return "int";
    if (/погашени\S*\s+(\S+\s+){0,3}(кредит|займ|заем|основного\s+долга|од\b)|возврат\S*\s+(\S+\s+){0,2}(кредит|займ|заем)|оплата\s+по\s+кредит/.test(p) || ["421", "423"].includes(k)) return "loan";
    if (/(заработн|зарплат|оплат\S*\s+труда|отпускн|аванс\s+работник|перечислени\S*\s+на\s+карт\S*\s+работник)/.test(p) || ["311", "312"].includes(k)) return "pay";
    if (/(опв|оппв|осмс|соцотчисл|социальн\S*\s+отчисл|пенсионн\S*\s+взнос|медицинск\S*\s+страх|гфсс|енпф)/.test(p) || ["010", "012", "013", "017", "019", "121", "122"].includes(k)) return "soc";
    if (/(налог|ндс|кпн|ипн|бюджет|кбк|угд|пени\s+по\s+налог|госпошлин|сбор)/.test(p) || /^9\d\d$/.test(k)) return "tax";
    if (/(снят\S*|выдач\S*)\s+(\S+\s+)?наличн|выдача\s+с\s+сч[её]та\s+наличн|cash\s+withdraw/.test(p) || k === "341") return "cash";
    return "sup";
  }

  /* ---------- кредитный отчёт (ПКБ, ГКБ) */
  const CRF = [
    ["creditor", /^(кредитор|наименование\s+кредитора|финансов\S*\s+(институт|организаци)|банк\s*[-–]\s*кредитор)/],
    ["type", /^(вид\s+(финансирования|кредита|договора|займа)|тип\s+(договора|кредита|финансирования))/],
    ["num", /^(номер\s+договора|№\s*договора|код\s+договора|договор\s*№)/],
    ["role", /^(роль(\s+субъекта)?|тип\s+субъекта|роль\s+в\s+договоре)/],
    ["amount", /^(сумма\s+(договора|кредита|финансирования|займа)|общая\s+сумма|лимит|размер\s+кредита)/],
    ["cur", /^валюта/],
    ["start", /^(дата\s+(начала|выдачи|заключения|получения)|начало\s+срока)/],
    ["end", /^(дата\s+(окончания|погашения|завершения)|срок\s+(погашения|окончания)|окончание\s+срока|плановая\s+дата\s+погашения)/],
    ["bal", /^(остаток(\s+основного\s+долга|\s+задолженности)?|непогашенн\S*\s+(сумма|часть)|сумма\s+(непогашенн|задолженност)|текущ\S*\s+задолженност|задолженность\s+по\s+основному)/],
    ["odAmt", /^(сумма\s+просроч|просроченн\S*\s+(сумм|задолжен|взнос))/],
    ["maxOd", /^(максимальн\S*\s+(количество\s+)?(дней\s+)?просрочк|макс\S*\s+просрочк)/],
    ["odDays", /^((текущее\s+)?количество\s+дней\s+просрочки|дни\s+просрочки|дней\s+просрочки|просрочка,?\s+дн)/],
    ["pay", /^(сумма\s+(ежемесячного|периодического|очередного)\s+платежа|размер\s+(ежемесячного\s+)?платежа|ежемесячн\S*\s+платеж)/],
    ["rate", /^((годовая\s+)?(процентная\s+)?ставка(\s+вознаграждения)?|гэсв|ставка)/],
  ];
  function crLabel(s) { const t = low(s).replace(/[:*]+\s*$/, "").trim(); for (const [k, re] of CRF) if (re.test(t)) return k; return null; }
  function isCredit(pdf) {
    const txt = low(allLines(pdf).slice(0, 60).map(l => l.text).join(" "));
    let n = 0; for (const l of allLines(pdf)) for (const c of l.cells.slice(0, 2)) if (crLabel(c.s.split(":")[0])) n++;
    return /кредитн\S*\s+(отчет|истори)|кредитн\S*\s+бюро|пкб|гкб/.test(txt) ? n : Math.floor(n / 3);
  }
  function parseCredit(pdf) {
    const L = allLines(pdf), out = []; let cur = null, status = "active";
    const txt = L.map(l => norm(l.text)).join("\n");
    const put = (k, v) => {
      if (v === undefined || v === null || String(v).trim() === "") return;
      if (k === "creditor" && cur && cur.creditor) cur = null;
      if (!cur) { cur = { status }; out.push(cur); }
      if (cur[k] === undefined) cur[k] = String(v).trim();
    };
    let thdr = null;   // табличный вид: строка-шапка с названиями полей, ниже — договор в каждой строке
    for (const l of L) {
      const lt = low(l.text);
      const hk = l.cells.map(c => crLabel(c.s));
      if (hk.filter(Boolean).length >= 3 && new Set(hk.filter(Boolean)).size >= 3) { thdr = hk; cur = null; continue; }
      if (thdr && l.cells.length >= 3 && !l.cells.some(c => crLabel(c.s.split(":")[0]) && c.s.includes(":"))) {
        const rec = { status }; let n = 0;
        l.cells.forEach((c, i) => { const k = thdr[i]; if (k && c.s.trim()) { rec[k] = c.s.trim(); n++; } });
        if (n >= 2 && (rec.creditor || rec.bal || rec.amount)) { out.push(rec); cur = null; continue; }
      }
      if (/(действующ|текущ|открыт)\S*\s+(договор|кредит|обязательств)/.test(lt) && l.cells.length <= 2) { status = "active"; cur = null; thdr = null; continue; }
      if (/(завершенн|погашенн|закрыт)\S*\s+(договор|кредит|обязательств)/.test(lt) && l.cells.length <= 2) { status = "closed"; cur = null; thdr = null; continue; }
      for (let i = 0; i < l.cells.length; i++) {
        const s = norm(l.cells[i].s), ci = s.indexOf(":");
        let k = crLabel(ci > 0 ? s.slice(0, ci) : s);
        if (!k) continue;
        let v = ci > 0 ? s.slice(ci + 1).trim() : "";
        if (!v && l.cells[i + 1] && !crLabel(l.cells[i + 1].s)) { v = l.cells[i + 1].s; i++; }
        put(k, v);
      }
    }
    const num = s => (s ? amt(String(s).replace(/[^\d\s.,()−–-]/g, "")) : null);
    const loans = out.filter(c => c.creditor || c.bal || c.amount).map(c => ({
      creditor: c.creditor || "", type: c.type || "", num: c.num || "", role: c.role || "", status: c.status,
      amount: num(c.amount), cur: curCode(c.cur || "") || (c.cur ? c.cur : "KZT"), start: toISO(c.start || "") || "", end: toISO(c.end || "") || "",
      bal: num(c.bal), odAmt: num(c.odAmt), odDays: num(c.odDays), maxOd: num(c.maxOd), pay: num(c.pay), rate: c.rate ? (amt(String(c.rate).replace(/[^\d.,]/g, "")) ?? null) : null,
    }));
    for (const x of loans) { if (/закрыт|погашен|завершен/i.test(x.type + " " + (x.role || ""))) x.status = "closed"; if (isNum(x.rate) && x.rate > 1) x.rate = x.rate / 100; }
    const dm = /(?:дата\s+(?:формирования|отчета|выдачи\s+отчета)|сформирован\S*)\D{0,20}(\d{2}\.\d{2}\.\d{4})/i.exec(txt);
    const binM = /(?:бин|иин)[^\d]{0,30}(\d{12})/i.exec(squeeze(L.slice(0, 40).map(l => l.text).join(" ")));
    const bureau = /первое\s+кредитное\s+бюро|пкб/i.test(txt) ? "ПКБ" : /государственн\S*\s+кредитн\S*\s+бюро|гкб/i.test(txt) ? "ГКБ" : "кредитное бюро";
    return { bureau, date: dm ? toISO(dm[1]) : "", bin: binM ? binM[1] : "", loans };
  }
  const isNum = v => typeof v === "number" && isFinite(v);

  /* ---------- Excel как «страница» из строк и ячеек — те же разборщики работают и для таблиц */
  function sheetToPdf(sheets) {
    const pages = [];
    for (const sh of sheets) {
      if (sh.hidden) continue;
      const lines = [];
      (sh.rows || []).forEach((row, ri) => {
        if (!row) return;
        const cells = [];
        row.forEach((v, ci) => {
          if (v === undefined || v === null || v === "") return;
          let s = v;
          if (typeof v === "number") s = String(v);
          s = String(s).replace(/\s+/g, " ").trim(); if (!s) return;
          cells.push({ x: ci * 100, x2: ci * 100 + 90, s, fs: 10 });
        });
        if (cells.length) lines.push({ y: -ri * 12, fs: 10, cells, text: cells.map(c => c.s).join("  ") });
      });
      pages.push({ lines });
    }
    return { pages, noText: false };
  }
  // даты Excel (число дней с 1899-12-30) в колонке «дата» превращаем в дд.мм.гггг
  function fixExcelDates(pdf) {
    for (const p of pdf.pages) {
      let dcol = null;
      for (const l of p.lines) {
        const h = stmtHeader(l);
        if (h) { const d = h.find(c => c.k === "date"); dcol = d ? d.x1 : null; continue; }
        for (const c of l.cells) if ((dcol !== null && c.x === dcol || c.x === 0) && /^\d{5}(\.\d+)?$/.test(c.s)) {
          const n = parseFloat(c.s); if (n > 30000 && n < 80000) { const d = new Date(Math.round((n - 25569) * 86400000)); c.s = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; }
        }
        l.text = l.cells.map(c => c.s).join("  ");
      }
    }
    return pdf;
  }
  const pad = n => String(n).padStart(2, "0");

  function detect(pdf) {
    const nd = isDecl(pdf), ns = isStmt(pdf), nb = isBank(pdf), nc = isCredit(pdf);
    if (nc >= 6 && nc > nd && ns < 5) return "credit";
    if (nd >= 3 && nd * 2 >= nb) return "decl";
    if (ns >= 3) return "stmt";
    if (nb >= 3) return "bank";
    return nd >= 2 ? "decl" : ns >= 1 ? "stmt" : null;
  }
  async function read(buf) {
    const pdf = await PdfReader.read(buf);
    const kind = pdf.noText ? null : detect(pdf);
    return { pdf, kind, decl: kind === "decl" ? parseDecl(pdf) : null, bank: kind === "bank" ? parseBank(pdf) : null, stmt: kind === "stmt" ? parseStmt(pdf) : null, credit: kind === "credit" ? parseCredit(pdf) : null };
  }
  function readLines(pdf) {   // уже готовые строки (например, из HTML)
    const kind = detect(pdf);
    return { pdf, kind, decl: kind === "decl" ? parseDecl(pdf) : null, bank: kind === "bank" ? parseBank(pdf) : null, stmt: kind === "stmt" ? parseStmt(pdf) : null, credit: kind === "credit" ? parseCredit(pdf) : null };
  }
  function readSheets(sheets) {
    const pdf = fixExcelDates(sheetToPdf(sheets));
    const kind = detect(pdf);
    return { pdf, kind, decl: kind === "decl" ? parseDecl(pdf) : null, bank: kind === "bank" ? parseBank(pdf) : null, stmt: kind === "stmt" ? parseStmt(pdf) : null, credit: kind === "credit" ? parseCredit(pdf) : null };
  }
  return { read, readSheets, readLines, sheetToPdf, parseDecl, parseBank, parseStmt, parseCredit, classify, classifyDebit, DCATS, clean, pickKeys, isDecl, isBank, isStmt, monthLabel, headerSem, amt, toISO, FORMS, KEYS, CATS };
})();
