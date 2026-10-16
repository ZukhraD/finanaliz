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
/* ---------- старый формат Excel 97–2003 (.xls): контейнер OLE2 + записи BIFF8 */
function readXls(buf) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = o => dv.getUint16(o, true), u32 = o => dv.getUint32(o, true), i32 = o => dv.getInt32(o, true);
  // --- контейнер OLE2 (Compound File)
  const ss = 1 << u16(30), mss = 1 << u16(32), nFat = u32(44), dirStart = u32(48), miniCut = u32(56), miniFatStart = u32(60), difStart = u32(68);
  const sec = n => 512 + n * ss;
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const v = u32(76 + i * 4); if (v < 0xFFFFFFFA) fatSecs.push(v); }
  for (let d = difStart, guard = 0; d < 0xFFFFFFFA && fatSecs.length < nFat && guard < 10000; guard++) {
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) { const v = u32(sec(d) + i * 4); if (v < 0xFFFFFFFA) fatSecs.push(v); }
    d = u32(sec(d) + ss - 4);
  }
  const fat = []; for (const f of fatSecs) for (let i = 0; i < ss / 4; i++) fat.push(u32(sec(f) + i * 4));
  const chain = (start, f) => { const out = []; for (let s = start, g = 0; s < 0xFFFFFFFA && g < 1e6; g++) { out.push(s); s = f[s]; } return out; };
  const readChain = (start, size) => { const out = new Uint8Array(chain(start, fat).length * ss); let p = 0; for (const s of chain(start, fat)) { out.set(b.subarray(sec(s), sec(s) + ss), p); p += ss; } return size !== undefined ? out.subarray(0, size) : out; };
  const dir = readChain(dirStart), ents = [];
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = ddv.getUint16(o + 64, true); let name = ""; for (let i = 0; i < Math.max(0, nl / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    ents.push({ name, type: dir[o + 66], start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const root = ents[0], wbE = ents.find(e => e.type === 2 && /^(workbook|book)$/i.test(e.name));
  if (!wbE) throw new Error("в файле .xls нет книги Excel");
  let W;
  if (wbE.size < miniCut) {
    const mini = readChain(root.start), mfat = [], mf = readChain(miniFatStart);
    for (let i = 0; i + 4 <= mf.length; i += 4) mfat.push(new DataView(mf.buffer, mf.byteOffset).getUint32(i, true));
    W = new Uint8Array(chain(wbE.start, mfat).length * mss); let p = 0;
    for (const s of chain(wbE.start, mfat)) { W.set(mini.subarray(s * mss, s * mss + mss), p); p += mss; }
    W = W.subarray(0, wbE.size);
  } else W = readChain(wbE.start, wbE.size);
  // --- записи BIFF
  const wv = new DataView(W.buffer, W.byteOffset, W.byteLength);
  const recs = []; for (let o = 0; o + 4 <= W.length;) { const t = wv.getUint16(o, true), l = wv.getUint16(o + 2, true); recs.push({ t, o: o + 4, l }); o += 4 + l; }
  const bof = recs[0]; if (!bof || (bof.t !== 0x809)) throw new Error("файл .xls не распознан");
  if (wv.getUint16(bof.o, true) !== 0x600) throw new Error("файл в формате Excel 95 или старее — откройте его в Excel и сохраните как .xlsx");
  if (recs.some(r => r.t === 0x2F)) throw new Error("файл .xls защищён паролем — снимите защиту и сохраните заново");
  const dec1252 = new TextDecoder("windows-1252");
  // строка XLUnicodeString; parts — куски данных (запись + CONTINUE), строка может переходить между ними
  function strReader(parts) {
    let pi = 0, off = 0;
    const need = () => { while (pi < parts.length && off >= parts[pi].length) { pi++; off = 0; } };
    const byte = () => { need(); return parts[pi][off++]; };
    const u16r = () => byte() | (byte() << 8), u32r = () => (u16r() | (u16r() << 16)) >>> 0;
    const skip = n => { while (n > 0) { need(); if (pi >= parts.length) return; const k = Math.min(n, parts[pi].length - off); off += k; n -= k; } };
    const str = (cch, flags) => {
      let hi = flags & 1, s = "";
      const rich = flags & 8 ? u16r() : 0, ext = flags & 4 ? u32r() : 0;
      while (s.length < cch) {
        need(); if (pi >= parts.length) break;
        if (off === 0 && pi > 0 && s.length > 0 && parts[pi]._cont && !parts[pi]._used) { parts[pi]._used = true; hi = byte() & 1; }
        const left = cch - s.length, avail = parts[pi].length - off, n = Math.min(left, hi ? Math.floor(avail / 2) : avail);
        if (n <= 0) { off = parts[pi].length; continue; }
        if (hi) { for (let i = 0; i < n; i++) s += String.fromCharCode(parts[pi][off + i * 2] | (parts[pi][off + i * 2 + 1] << 8)); off += n * 2; }
        else { s += dec1252.decode(parts[pi].subarray(off, off + n)); off += n; }
      }
      skip(rich * 4 + ext);
      return s;
    };
    return { byte, u16: u16r, u32: u32r, str, xstr: () => { const c = u16r(), f = byte(); return str(c, f); } };
  }
  // общие строки (SST)
  const sst = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].t !== 0xFC) continue;
    const parts = [W.subarray(recs[i].o, recs[i].o + recs[i].l)];
    for (let j = i + 1; j < recs.length && recs[j].t === 0x3C; j++) { const p = W.subarray(recs[j].o, recs[j].o + recs[j].l); p._cont = true; parts.push(p); }
    const r = strReader(parts); r.u32(); const n = r.u32();
    for (let k = 0; k < n; k++) { try { sst.push(r.xstr()); } catch (e) { break; } }
    break;
  }
  const sheetsMeta = [];
  for (const r of recs) if (r.t === 0x85) {
    const pos = wv.getUint32(r.o, true), hid = W[r.o + 4], typ = W[r.o + 5], cch = W[r.o + 6], fl = W[r.o + 7];
    const name = fl & 1 ? Array.from({ length: cch }, (_, i) => String.fromCharCode(wv.getUint16(r.o + 8 + i * 2, true))).join("") : dec1252.decode(W.subarray(r.o + 8, r.o + 8 + cch));
    if (typ === 0) sheetsMeta.push({ pos, name, hidden: hid !== 0 });
  }
  const rk = v => { let n; if (v & 2) n = v >> 2; else { const t = new DataView(new ArrayBuffer(8)); t.setUint32(4, v & 0xFFFFFFFC, true); t.setUint32(0, 0, true); n = t.getFloat64(0, true); } return v & 1 ? n / 100 : n; };
  const sheets = [];
  for (const sm of sheetsMeta) {
    const rows = [], put = (r, c, v) => { if (v === null || v === undefined || v === "") return; (rows[r + 1] = rows[r + 1] || [])[c + 1] = v; };
    let i = recs.findIndex(r => r.o - 4 === sm.pos); if (i < 0) continue;
    let pendingStr = null;
    for (i = i + 1; i < recs.length && recs[i].t !== 0x0A; i++) {
      const { t, o, l } = recs[i];
      if (t === 0xFD) put(wv.getUint16(o, true), wv.getUint16(o + 2, true), sst[wv.getUint32(o + 6, true)]);
      else if (t === 0x203) put(wv.getUint16(o, true), wv.getUint16(o + 2, true), wv.getFloat64(o + 6, true));
      else if (t === 0x27E) put(wv.getUint16(o, true), wv.getUint16(o + 2, true), rk(wv.getUint32(o + 6, true)));
      else if (t === 0xBD) { const r = wv.getUint16(o, true), c1 = wv.getUint16(o + 2, true), n = (l - 6) / 6; for (let k = 0; k < n; k++) put(r, c1 + k, rk(wv.getUint32(o + 4 + k * 6 + 2, true))); }
      else if (t === 0x204) { const parts = [W.subarray(o + 6, o + l)]; put(wv.getUint16(o, true), wv.getUint16(o + 2, true), strReader(parts).xstr()); }
      else if (t === 0x06) {
        const r = wv.getUint16(o, true), c = wv.getUint16(o + 2, true);
        if (wv.getUint16(o + 12, true) === 0xFFFF) { const k = W[o + 6]; if (k === 0) pendingStr = [r, c]; else if (k === 1) put(r, c, !!W[o + 8]); }
        else put(r, c, wv.getFloat64(o + 6, true));
      }
      else if (t === 0x207 && pendingStr) { const parts = [W.subarray(o, o + l)]; for (let j = i + 1; j < recs.length && recs[j].t === 0x3C; j++) { const p = W.subarray(recs[j].o, recs[j].o + recs[j].l); p._cont = true; parts.push(p); } put(pendingStr[0], pendingStr[1], strReader(parts).xstr()); pendingStr = null; }
      else if (t === 0x205) { if (!W[o + 7]) put(wv.getUint16(o, true), wv.getUint16(o + 2, true), !!W[o + 6]); }
    }
    sheets.push({ name: sm.name, hidden: sm.hidden, rows });
  }
  if (!sheets.length) throw new Error("в файле .xls не найдено листов");
  return sheets;
}
const isXls = buf => { const u = new Uint8Array(buf, 0, 4); return u[0] === 0xD0 && u[1] === 0xCF && u[2] === 0x11 && u[3] === 0xE0; };
async function readWorkbook(buf) {
  if (isXls(buf)) return readXls(buf);
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
function profileCol(kindRow, prof) { return prof === 3 ? (C.custom?.[kindRow[1]] || "") : prof === 4 ? (kindRow[6] || "") : kindRow[prof === 1 ? 2 : 3]; }
function mapCodes(kind) {
  const cs = new Set();
  for (const m of S.mapping) if (m[0] === kind) for (const p of [1, 2, 3, 4]) for (let t of String(profileCol(m, p) || "").split(",")) {
    t = t.trim(); if (!t) continue; if ("*-~+!".includes(t[0])) t = t.slice(1).trim(); const c = normCode(t); if (c) cs.add(c);
  }
  return cs;
}
function parseForm(sh, kind) {
  const rows = sh.rows, [R, Cc] = sheetSize(rows);
  if (R < 3 || Cc < 2) return { err: "мало данных на листе" };
  const mc = mapCodes(kind);
  const cnts = [], scs = []; let best = 0;
  for (let c = 1; c <= Cc; c++) {
    let cnt = 0, sc = 0; const seen = new Set();
    for (let r = 1; r <= R; r++) { const k = normCode(cellAt(rows, r, c)); if (k) { cnt++; if (!seen.has(k)) { seen.add(k); if (mc.has(k)) sc++; } } }
    cnts[c] = cnt; scs[c] = sc; if (cnt > best) best = cnt;
  }
  if (best < 3) return { err: "не найдена колонка кодов строк" };
  // колонок с кодами может быть несколько: в печатных формах 1С после разрыва страницы таблица сдвигается
  let codeCols = []; for (let c = 1; c <= Cc; c++) if (scs[c] >= 3) codeCols.push(c);
  if (!codeCols.length) for (let c = 1; c <= Cc; c++) if (cnts[c] >= best * 0.6) { codeCols.push(c); break; }
  const isLab = x => typeof x === "string" && /[a-zа-яё]/i.test(x) && !normCode(x);
  const labelOf = (r, c) => { const row = rows[r] || []; let t = normTxt(row.slice(1, c).filter(isLab).join(" ")); if (!/[a-zа-я]/.test(t)) t = normTxt(row.slice(c + 1).filter(isLab).join(" ")); return /[a-zа-я]/.test(t) ? t : ""; };
  const rowCol = new Map();
  for (let r = 1; r <= R; r++) for (const c of codeCols) { const k = normCode(cellAt(rows, r, c)); if (k) { rowCol.set(r, { k, c }); break; } }
  // колонки сумм — для каждой колонки кодов свои
  const skip = kwList(S.kw.skipcol), vmap = new Map();
  for (const cc of codeCols) {
    const rs = [...rowCol.entries()].filter(([, o]) => o.c === cc).map(([r]) => r); if (!rs.length) continue;
    const first = rs[0], vc = [];
    for (let c = cc + 1; c <= Cc && vc.length < 2; c++) {
      const hdr = normTxt([1, 2, 3, 4].map(d => cellAt(rows, first - d, c)).filter(x => typeof x === "string").join(" "));
      if (skip.some(t => hdr.includes(t))) continue;
      let n = 0; for (const r of rs) if (parseNum(cellAt(rows, r, c)) !== null) n++;
      if (n >= Math.min(2, rs.length)) vc.push(c);
    }
    vmap.set(cc, vc);
  }
  // значение строки: из колонки сумм; если там пусто (сдвиг объединённых ячеек) — n-е число правее кода
  const valAt = (r, cc, w) => {
    const vc = vmap.get(cc) || [], v = vc[w] ? parseNum(cellAt(rows, r, vc[w])) : null;
    if (v !== null) return v;
    if (vc[w] && cellAt(rows, r, vc[w]) !== undefined) return null;
    const nums = []; for (let c = cc + 1; c <= Cc; c++) { const x = cellAt(rows, r, c); if (typeof x === "number" || (typeof x === "string" && parseNum(x) !== null && /\d/.test(x))) nums.push(parseNum(x)); }
    return nums[w] ?? null;
  };
  const codes = new Map(), unc = []; let first = 0, lastCol = codeCols[0];
  for (let r = 1; r <= R; r++) {
    const o = rowCol.get(r);
    if (o) { const lab = labelOf(r, o.c); lastCol = o.c; if (!first) first = r; if (!codes.has(o.k)) { const cc = o.c; codes.set(o.k, { r, lab, val: w => valAt(r, cc, w) }); } }
    else if (first) { const lab = labelOf(r, Cc + 1), cc = lastCol; if (lab && cellAt(rows, r, cc) === undefined) unc.push({ r, lab, val: w => valAt(r, cc, w) }); }
  }
  if (codes.size < 3) return { err: "не найдена колонка кодов строк" };
  if (![...vmap.values()].some(v => v.length)) return { err: "правее кодов нет колонок с суммами" };
  const hasPrev = [...vmap.values()].some(v => v.length > 1);
  return { codes, unc, hasPrev, max: Math.max(0, ...Array.from(codes.values()).map(c => Math.abs(c.val(0) || 0))) };
}
// одна форма на нескольких листах (страницах) — объединяем
function mergeForms(a, b) {
  for (const [k, v] of b.codes) if (!a.codes.has(k)) a.codes.set(k, v);
  a.unc.push(...b.unc); a.hasPrev = a.hasPrev || b.hasPrev; a.max = Math.max(a.max, b.max);
  return a;
}
function chooseProfile(f, kind) {
  if (C.settings.variant >= 1) return C.settings.variant;
  const sc = [0, 0, 0, 0, 0];
  for (const [form, kw, full, sme, nsfo] of S.signs) {
    if (form !== kind) continue;
    for (const [p, code] of [[1, full], [2, sme], [4, nsfo]]) { if (!code) continue; const c = f.codes.get(normCode(code)); if (c && c.lab.includes(normTxt(kw))) sc[p]++; }
  }
  // НСФО (малый бизнес): коды 01–23, итог активов — строка 10
  if (kind === "B") { const c10 = f.codes.get("010"), c01 = f.codes.get("001"); if (c10 && /итого\s+актив/.test(c10.lab) && c01 && /денежн/.test(c01.lab)) sc[4] += 3; }
  if (kind === "P") { const c01 = f.codes.get("001"), c13 = f.codes.get("013"); if (c01 && /доход/.test(c01.lab) && c13 && /прибыл/.test(c13.lab)) sc[4] += 3; }
  if (sc[4] > sc[1] && sc[4] > sc[2]) return 4;
  return sc[2] > sc[1] ? 2 : 1;
}
function evalSpec(spec, f, w) {
  let s = 0, found = false; const missing = [];
  for (let t of String(spec || "").split(",")) {
    t = t.trim(); if (!t) continue;
    let op = ""; if ("*-~+!".includes(t[0])) { op = t[0]; t = t.slice(1).trim(); }
    let v = null;
    if (t[0] === "#") { const u = f.unc.find(x => x.lab.includes(normTxt(t.slice(1)))); if (!u) continue; v = u.val(w) ?? 0; }
    else { const c = f.codes.get(normCode(t)); if (!c) { missing.push(t); continue; } found = true; v = c.val(w) ?? 0; }
    s += op === "*" ? Math.abs(v) : op === "-" ? -Math.abs(v) : op === "!" ? -v : op === "~" ? -v : v;
  }
  return { v: s, found, missing };
}
const SRC_TXT = { B: "Баланс (ф.1)", P: "ОПиУ (ф.2)", C: "ОДДС (ф.3)" };
const PROF_TXT = { 1: "полная форма (приказ №404)", 2: "форма МСБ", 3: "свой вариант", 4: "форма НСФО (малый бизнес)" };
/* PDF финансовой отчётности (с текстовым слоем) → таблицы, как из Excel: колонки по положению на странице */
function pdfNum(s) {
  const t = String(s).replace(/[  ]/g, "").replace(/−|–|—/g, "-").trim();
  if (/^-+$/.test(t)) return 0;
  const m = /^(\()?(-)?(\d+(?:[.,]\d+)?)(\))?$/.exec(t.replace(/(?<=\d)[.,](?=\d{3}(?:\D|$))/g, ""));
  if (!m) return null;
  const v = parseFloat(m[3].replace(",", "."));
  return (m[1] && m[4]) || m[2] ? -v : v;
}
function pdfToSheets(pdf) {
  const sheets = [];
  pdf.pages.forEach((pg, pi) => {
    const lines = pg.lines || []; if (!lines.length) return;
    // якоря колонок: числа — по правому краю, текст и коды — по левому
    const anc = [];
    for (const l of lines) for (const c of l.cells || []) { const isNum = pdfNum(c.s) !== null && !/^\d{3}$/.test(c.s.trim()); anc.push({ a: isNum ? c.x2 : c.x, num: isNum }); }
    const cols = [];
    for (const a of anc.sort((x, y) => x.a - y.a)) { const c = cols.find(z => z.num === a.num && Math.abs(z.a - a.a) < 14); if (c) { c.a = (c.a * c.n + a.a) / (c.n + 1); c.n++; } else cols.push({ a: a.a, num: a.num, n: 1 }); }
    const order = cols.slice().sort((x, y) => x.a - y.a);
    const rows = [undefined];
    for (const l of lines.slice().sort((x, y) => y.y - x.y)) {
      const row = [];
      const hasCode = (l.cells || []).some(c => /^\d{3}$/.test(c.s.trim()));
      for (const c of l.cells || []) {
        const v = pdfNum(c.s), isNum = v !== null && !/^\d{3}$/.test(c.s.trim());
        const a = isNum ? c.x2 : c.x;
        let best = 0, bd = 1e9; order.forEach((z, j) => { if (z.num === isNum) { const d = Math.abs(z.a - a); if (d < bd) { bd = d; best = j; } } });
        let col = best + 1; while (row[col] !== undefined) col++;
        // «Выручка 010» — название и код строки слиплись в одну ячейку
        const sp = !isNum && !hasCode && /^(.*[А-Яа-яЁёA-Za-z)\s.])\s*(\d{3})$/.exec(c.s);
        if (sp && sp[1].trim().length > 2) { row[col] = sp[1].trim(); let c2 = col + 1; while (row[c2] !== undefined) c2++; row[c2] = sp[2]; }
        else row[col] = isNum ? v : c.s;
      }
      rows.push(row);
    }
    sheets.push({ name: "стр. " + (pi + 1), rows, hidden: false });
  });
  return sheets;
}
async function readFormFile(file) {
  if (/\.pdf$/i.test(file.name)) {
    const pdf = await PdfReader.read(await file.arrayBuffer());
    if (pdf.noText) throw new Error("это скан (в PDF нет текста) — сайт читает только PDF с текстовым слоем; распознайте скан в программе (например, ABBYY FineReader) или загрузите Excel");
    return pdfToSheets(pdf);
  }
  return readWorkbook(await file.arrayBuffer());
}
async function importFiles(files, k, pid, askUnits, forced) {
  const report = [];
  const pp = prevPid(pid);
  for (const file of files) {
    if (!/\.(xlsx|xlsm|xls|pdf)$/i.test(file.name)) { report.push({ file: file.name, err: "формат не поддерживается — нужен Excel (.xlsx, .xlsm, .xls) или PDF" }); continue; }
    let sheets;
    try { sheets = await readFormFile(file); } catch (e) { report.push({ file: file.name, err: "не удалось прочитать: " + e.message }); continue; }
    const parsed = [], used = [], eqSheets = [];
    let lastKind = null;
    for (const sh of sheets) {
      if (sh.hidden && sheets.length > 1) continue;
      let kind = detectKind(sh);
      if (kind === "X") { lastKind = null; if (isEquitySheet(sh)) eqSheets.push(sh); continue; }
      // лист без заголовка сразу после формы — её продолжение (вторая страница)
      if (!kind && lastKind) { const mc = mapCodes(lastKind); let n = 0; for (const row of sh.rows) if (row) for (const v of row) if (mc.has(normCode(v))) n++; if (n >= 3) kind = lastKind; }
      if (!kind) continue;
      lastKind = kind; used.push(sh);
      const f = parseForm(sh, kind);
      const same = parsed.find(p => p.kind === kind);
      if (same) { if (!f.err) { mergeForms(same.f, f); same.sheet += ", " + sh.name; } continue; }
      if (f.err) { report.push({ file: file.name, sheet: sh.name, err: f.err }); continue; }
      parsed.push({ kind, f, sheet: sh.name });
    }
    if (!parsed.length && !eqSheets.length) { if (!report.some(r => r.file === file.name)) report.push({ file: file.name, err: "не найдено ни баланса, ни ОПиУ, ни ОДДС (нужен заголовок формы или колонка кодов строк)" }); continue; }
    // единицы — один ответ на файл
    const units = forced || C.settings.units || "auto";
    let factor = { t: 0.001, k: 1, m: 1000 }[units] || 0, why = forced ? "указано при загрузке" : "по настройке";
    const mx = parsed.length ? Math.max(...parsed.map(p => p.f.max)) : 0;
    const hints = unitHints(used), au = autoUnits(k, pid, mx, hints);
    if (forced === "k" && (hints.frac >= 0.3 || mx >= 1e9)) why += " — внимание: " + (hints.frac >= 0.3 ? "в файле суммы с тиынами, так бывает в тенге" : "числа очень большие для тысяч") + ", проверьте";
    if (forced === "t" && mx > 0 && mx < 1e5) why += " — внимание: числа маленькие для тенге, проверьте";
    if (!forced && (units === "ask" || (!factor && au.ask))) { factor = await askUnits(file.name, mx, au.f === 0.001 ? "t" : au.f === 1000 ? "m" : "k"); why = "указано вручную"; if (!factor) { report.push({ file: file.name, err: "загрузка отменена" }); continue; } }
    if (!factor) { factor = au.f; why = "определено автоматически " + au.why; }
    for (const sh of eqSheets) { const r = eqImport(sh, k, pid, factor, file.name); if (r) report.push(r); }
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
