"use strict";
/* ---------------------------------------------------------------- чтение .xlsx/.xlsm без библиотек и без сети: ZIP + XML прямо в браузере */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("файл не похож на .xlsx (не найден ZIP-каталог)");
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {}, td = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    files[name] = { method, data: u8.subarray(start, start + csize) };
    p += 46 + nlen + xlen + clen;
  }
  return {
    has: name => !!files[name],
    async text(name) {
      const f = files[name]; if (!f) return null;
      const b = f.method === 8 ? await inflateRaw(f.data) : f.data;
      return new TextDecoder().decode(b);
    }
  };
}
const xmlDoc = s => new DOMParser().parseFromString(s, "application/xml");
const tags = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
function colNum(ref) { let c = 0; for (const ch of ref) { if (ch >= "A" && ch <= "Z") c = c * 26 + ch.charCodeAt(0) - 64; else break; } return c; }
async function readWorkbook(buf) {
  const z = await unzip(buf);
  if (!z.has("xl/workbook.xml")) throw new Error("в файле нет книги Excel (xl/workbook.xml)");
  const wb = xmlDoc(await z.text("xl/workbook.xml"));
  const rels = xmlDoc(await z.text("xl/_rels/workbook.xml.rels") || "<r/>");
  const relMap = {};
  for (const r of tags(rels, "Relationship")) relMap[r.getAttribute("Id")] = r.getAttribute("Target");
  const ss = [];
  if (z.has("xl/sharedStrings.xml")) for (const si of tags(xmlDoc(await z.text("xl/sharedStrings.xml")), "si")) ss.push(tags(si, "t").map(t => t.textContent).join(""));
  const sheets = [];
  for (const sh of tags(wb, "sheet")) {
    const rid = sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || sh.getAttribute("r:id");
    let target = relMap[rid] || ""; target = target.replace(/^\//, "");
    const path = target.startsWith("xl/") ? target : "xl/" + target;
    const txt = await z.text(path); if (!txt) continue;
    const rows = [];
    for (const c of tags(xmlDoc(txt), "c")) {
      const ref = c.getAttribute("r"); if (!ref) continue;
      const col = colNum(ref), row = parseInt(ref.replace(/^[A-Z]+/, ""), 10);
      const t = c.getAttribute("t"), vEl = tags(c, "v")[0];
      let v = null;
      if (t === "s") v = vEl ? ss[parseInt(vEl.textContent, 10)] : null;
      else if (t === "inlineStr") v = tags(c, "t").map(x => x.textContent).join("");
      else if (t === "str") v = vEl ? vEl.textContent : null;
      else if (t === "b") v = vEl ? vEl.textContent === "1" : null;
      else if (t === "e") v = null;
      else if (vEl) { const n = parseFloat(vEl.textContent); v = isFinite(n) ? n : vEl.textContent; }
      if (v === null || v === "") continue;
      (rows[row] = rows[row] || [])[col] = v;
    }
    sheets.push({ name: sh.getAttribute("name"), hidden: (sh.getAttribute("state") || "visible") !== "visible", rows });
  }
  return sheets;
}

/* ---------------------------------------------------------------- распознавание форм (тот же алгоритм, что в макросе Excel) */
const normTxt = s => String(s ?? "").toLowerCase().replace(/[  \t\r\n]/g, " ").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const kwList = s => String(s || "").split(";").map(normTxt).filter(Boolean);
function normCode(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return (v >= 1 && v < 1000 && Number.isInteger(v)) ? String(v).padStart(3, "0") : "";
  const s = String(v).replace(/ /g, " ").trim().replace(/[. ]+$/, "");
  return /^\d{1,3}$/.test(s) && parseInt(s, 10) >= 1 ? s.padStart(3, "0") : "";
}
const cellAt = (rows, r, c) => (rows[r] ? rows[r][c] : undefined);
function sheetSize(rows) { let R = Math.min(rows.length - 1, 800), Cc = 0; for (let r = 1; r <= R; r++) if (rows[r]) Cc = Math.max(Cc, rows[r].length - 1); return [R, Math.min(Cc, 80)]; }
function detectKind(sh) {
  const [R, Cc] = sheetSize(sh.rows);
  const kx = kwList(S.kw.X), kc = kwList(S.kw.C), kp = kwList(S.kw.P), kb = kwList(S.kw.B);
  for (let r = 1; r <= Math.min(R, 40); r++) {
    const t = normTxt((sh.rows[r] || []).filter(x => typeof x === "string").join(" "));
    if (t.length <= 5) continue;
    if (kx.some(k => t.includes(k))) return "X";
    if (kc.some(k => t.includes(k))) return "C";
    if (kp.some(k => t.includes(k))) return "P";
    if (kb.some(k => t.includes(k))) return "B";
  }
  // по кодам строк
  const cs = new Set();
  for (let r = 1; r <= R; r++) for (let c = 1; c <= Cc; c++) { const k = normCode(cellAt(sh.rows, r, c)); if (k) cs.add(k); }
  const nb = ["120", "121", "124", "210", "213", "217", "310", "316", "410", "414"].filter(x => cs.has(x)).length;
  const np = ["010", "011", "012", "013", "014", "020", "021", "022", "100", "101", "200"].filter(x => cs.has(x)).length;
  return nb >= 4 ? "B" : (nb === 0 && np >= 7 ? "P" : "");
}
function profileCol(kindRow, prof) { return prof === 3 ? (C.custom?.[kindRow[1]] || "") : kindRow[prof === 1 ? 2 : 3]; }
function mapCodes(kind) {
  const cs = new Set();
  for (const m of S.mapping) if (m[0] === kind) for (const p of [1, 2, 3]) for (let t of String(profileCol(m, p) || "").split(",")) {
    t = t.trim(); if (!t) continue; if ("*-~+!".includes(t[0])) t = t.slice(1).trim(); const c = normCode(t); if (c) cs.add(c);
  }
  return cs;
}
function parseForm(sh, kind) {
  const rows = sh.rows, [R, Cc] = sheetSize(rows);
  if (R < 5 || Cc < 2) return { err: "мало данных на листе" };
  const mc = mapCodes(kind);
  let codeCol = 0, best = 0, bestSc = 0; const cnts = [];
  for (let c = 1; c <= Cc; c++) {
    let cnt = 0; const seen = new Set(); let sc = 0;
    for (let r = 1; r <= R; r++) { const k = normCode(cellAt(rows, r, c)); if (k) { cnt++; if (!seen.has(k)) { seen.add(k); if (mc.has(k)) sc++; } } }
    cnts[c] = cnt; if (cnt > best) best = cnt; if (sc > bestSc) { bestSc = sc; codeCol = c; }
  }
  if (best < 5) return { err: "не найдена колонка кодов строк" };
  if (bestSc < 3) { codeCol = 0; for (let c = 1; c <= Cc; c++) if (cnts[c] >= best * 0.6) { codeCol = c; break; } }
  const label = r => { const t = normTxt((rows[r] || []).slice(1, codeCol).filter(x => typeof x === "string").join(" ")); return /[a-zа-я]/.test(t) ? t : ""; };
  const codes = new Map(), unc = [];
  let first = 0;
  for (let r = 1; r <= R; r++) {
    const k = normCode(cellAt(rows, r, codeCol)), lab = label(r);
    if (k && lab) { if (!first) first = r; if (!codes.has(k)) codes.set(k, { r, lab }); }
    else if (!k && lab && first && cellAt(rows, r, codeCol) === undefined) unc.push({ r, lab });
  }
  if (codes.size < 5) return { err: "не найдена колонка кодов строк" };
  const skip = kwList(S.kw.skipcol);
  const vcols = [];
  for (let c = codeCol + 1; c <= Cc && vcols.length < 2; c++) {
    const hdr = normTxt([1, 2, 3, 4].map(d => cellAt(rows, first - d, c)).filter(x => typeof x === "string").join(" "));
    if (skip.some(s => hdr.includes(s))) continue;
    let n = 0; for (const { r } of codes.values()) if (parseNum(cellAt(rows, r, c)) !== null) n++;
    if (n >= 2) vcols.push(c);
  }
  if (!vcols.length) return { err: "правее кодов нет колонок с суммами" };
  const get = (r, w) => (vcols[w] ? parseNum(cellAt(rows, r, vcols[w])) : null);
  return { codes, unc, get, hasPrev: vcols.length > 1, max: Math.max(0, ...Array.from(codes.values()).map(({ r }) => Math.abs(get(r, 0) || 0))) };
}
function chooseProfile(f, kind) {
  if (C.settings.variant >= 1) return C.settings.variant;
  const sc = [0, 0, 0, 0];
  for (const [form, kw, full, sme] of S.signs) {
    if (form !== kind) continue;
    for (const [p, code] of [[1, full], [2, sme]]) { const c = f.codes.get(normCode(code)); if (c && c.lab.includes(normTxt(kw))) sc[p]++; }
  }
  return sc[2] > sc[1] ? 2 : 1;
}
function evalSpec(spec, f, w) {
  let s = 0, found = false; const missing = [];
  for (let t of String(spec || "").split(",")) {
    t = t.trim(); if (!t) continue;
    let op = ""; if ("*-~+!".includes(t[0])) { op = t[0]; t = t.slice(1).trim(); }
    let v = null;
    if (t[0] === "#") { const u = f.unc.find(x => x.lab.includes(normTxt(t.slice(1)))); if (!u) continue; v = f.get(u.r, w) ?? 0; }
    else { const c = f.codes.get(normCode(t)); if (!c) { missing.push(t); continue; } found = true; v = f.get(c.r, w) ?? 0; }
    s += op === "*" ? Math.abs(v) : op === "-" ? -Math.abs(v) : op === "!" ? -v : op === "~" ? -v : v;
  }
  return { v: s, found, missing };
}
const SRC_TXT = { B: "Баланс (ф.1)", P: "ОПиУ (ф.2)", C: "ОДДС (ф.3)" };
const PROF_TXT = { 1: "полная форма (приказ №404)", 2: "форма МСБ", 3: "свой вариант" };
async function importFiles(files, k, pid, askUnits) {
  const report = [];
  const pp = prevPid(pid);
  for (const file of files) {
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) { report.push({ file: file.name, err: "формат не поддерживается — сохраните файл как .xlsx (Файл → Сохранить как)" }); continue; }
    let sheets;
    try { sheets = await readWorkbook(await file.arrayBuffer()); } catch (e) { report.push({ file: file.name, err: "не удалось прочитать: " + e.message }); continue; }
    const parsed = [];
    for (const sh of sheets) {
      if (sh.hidden && sheets.length > 1) continue;
      const kind = detectKind(sh);
      if (!kind || kind === "X" || parsed.some(p => p.kind === kind)) continue;
      const f = parseForm(sh, kind);
      if (f.err) { report.push({ file: file.name, sheet: sh.name, err: f.err }); continue; }
      parsed.push({ kind, f, sheet: sh.name });
    }
    if (!parsed.length) { if (!report.some(r => r.file === file.name)) report.push({ file: file.name, err: "не найдено ни баланса, ни ОПиУ, ни ОДДС (нужен заголовок формы или колонка кодов строк)" }); continue; }
    // единицы — один ответ на файл
    const units = C.settings.units || "auto";
    let factor = { t: 0.001, k: 1, m: 1000 }[units] || 0, why = "по настройке";
    const mx = Math.max(...parsed.map(p => p.f.max));
    if (units === "ask") { factor = await askUnits(file.name, mx, autoUnits(k, pid, mx).f === 0.001 ? "t" : "k"); why = "указано вручную"; if (!factor) { report.push({ file: file.name, err: "загрузка отменена" }); continue; } }
    if (!factor) { const a = autoUnits(k, pid, mx); factor = a.f; why = "определено автоматически " + a.why; }
    for (const { kind, f, sheet } of parsed) {
      const prof = chooseProfile(f, kind);
      let n = 0, over = 0; const miss = new Set();
      for (const m of S.mapping) {
        if (m[0] !== kind) continue;
        const key = m[1], spec = profileCol(m, prof), rule = m[4];
        for (const [w, p] of [[0, pid], [1, pp]]) {
          if (w === 1 && (!C.settings.prev || !p || !f.hasPrev)) continue;
          const r = evalSpec(spec, f, w);
          if (w === 0) r.missing.forEach(x => miss.add(x));
          if (!r.found && rule !== "Z") continue;
          const v = Math.round((r.found ? r.v : 0) * factor * 1e6) / 1e6;
          C.data[k] = C.data[k] || {}; C.data[k][key] = C.data[k][key] || {};
          const old = C.data[k][key][p];
          if (w === 1 && isNum(old)) continue;
          if (w === 0 && isNum(old) && old !== v) over++;
          C.data[k][key][p] = v;
          C.src[k] = C.src[k] || {}; C.src[k][key] = C.src[k][key] || {};
          C.src[k][key][p] = { file: file.name, form: SRC_TXT[kind], status: "Не проверено" };
          if (w === 0) n++;
        }
      }
      const units = (factor < 0.5 ? "цифры в тенге — переведены в тыс. тг" : factor > 2 ? "цифры в млн тг — переведены в тыс. тг" : "цифры в тыс. тг") + " (" + why + ")";
      report.push({ file: file.name, sheet, kind, n, over, miss: [...miss], prof: PROF_TXT[prof], units });
    }
  }
  const per = C.periods[perIdx(pid)];
  for (const r of report) C.log.unshift({ t: new Date().toISOString(), comp: compName(k), per: per?.label, ...r });
  C.log = C.log.slice(0, 200);
  touch();
  return report;
}
