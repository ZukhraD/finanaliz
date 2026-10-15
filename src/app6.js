"use strict";
/* ---------------------------------------------------------------- чтение PDF: только текстовый слой, без библиотек и сети.
   Объекты (в т.ч. в потоках ObjStm), фильтры Flate/LZW/ASCII85/ASCIIHex/RunLength, PNG-предикторы,
   стандартная защита с пустым паролем (RC4, AES-128, AES-256), шрифты ToUnicode / кодировки / Differences,
   координаты текста, повёрнутые страницы. Результат — страницы из строк, строки из «ячеек» (x, текст). */
const PdfReader = (() => {
  const WS = new Uint8Array(256); [0, 9, 10, 12, 13, 32].forEach(c => (WS[c] = 1));
  const DL = new Uint8Array(256); for (const ch of "()<>[]{}/%") DL[ch.charCodeAt(0)] = 1;
  class Ref { constructor(n, g) { this.n = n; this.g = g; } }
  const KW = w => ({ k: w });
  const isKw = (t, w) => t && typeof t === "object" && t.k === w;
  const concat = arrs => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
  function latin1(b) { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; }

  /* ---------- лексер */
  class Lex {
    constructor(b, p = 0, end = b.length) { this.b = b; this.p = p; this.end = end; }
    skip() {
      const b = this.b;
      for (;;) {
        while (this.p < this.end && WS[b[this.p]]) this.p++;
        if (this.p < this.end && b[this.p] === 37) { while (this.p < this.end && b[this.p] !== 10 && b[this.p] !== 13) this.p++; } else return;
      }
    }
    tok() {
      this.skip();
      const b = this.b; if (this.p >= this.end) return undefined;
      const c = b[this.p];
      if (c === 91) { this.p++; return "["; } if (c === 93) { this.p++; return "]"; }
      if (c === 123) { this.p++; return "{"; } if (c === 125) { this.p++; return "}"; }
      if (c === 60) { if (b[this.p + 1] === 60) { this.p += 2; return "<<"; } return this.hex(); }
      if (c === 62) { if (b[this.p + 1] === 62) { this.p += 2; return ">>"; } this.p++; return this.tok(); }
      if (c === 40) return this.str();
      if (c === 47) { let p = this.p + 1, s = ""; while (p < this.end && !WS[b[p]] && !DL[b[p]]) { if (b[p] === 35 && p + 2 < this.end) { s += String.fromCharCode(parseInt(String.fromCharCode(b[p + 1], b[p + 2]), 16) || 0); p += 3; } else s += String.fromCharCode(b[p++]); } this.p = p; return "/" + s; }
      let p = this.p, s = "";
      while (p < this.end && !WS[b[p]] && !DL[b[p]]) s += String.fromCharCode(b[p++]);
      if (p === this.p) { this.p++; return this.tok(); }
      this.p = p;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
      if (/^[+-]?\d*\.?\d*[+-.]+\d*/.test(s) && /\d/.test(s)) { const v = parseFloat(s.replace(/^([+-]?\d*\.?\d*).*$/, "$1")); return isFinite(v) ? v : 0; }
      return KW(s);
    }
    hex() {
      const b = this.b; let p = this.p + 1, h = "";
      while (p < this.end && b[p] !== 62) { const c = b[p++]; if (!WS[c]) h += String.fromCharCode(c); }
      this.p = p + 1;
      if (h.length % 2) h += "0";
      const o = new Uint8Array(h.length / 2);
      for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16) || 0;
      return o;
    }
    str() {
      const b = this.b, o = []; let p = this.p + 1, depth = 1;
      while (p < this.end) {
        let c = b[p++];
        if (c === 92) {
          c = b[p++];
          const m = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 }[c];
          if (m !== undefined) o.push(m);
          else if (c >= 48 && c <= 55) { let v = c - 48; for (let i = 0; i < 2 && b[p] >= 48 && b[p] <= 55; i++) v = v * 8 + b[p++] - 48; o.push(v & 255); }
          else if (c === 13) { if (b[p] === 10) p++; }
          else if (c !== 10) o.push(c);
          continue;
        }
        if (c === 40) depth++;
        else if (c === 41 && --depth === 0) break;
        o.push(c);
      }
      this.p = p;
      return Uint8Array.from(o);
    }
  }
  function parse(lx, t = lx.tok()) {
    if (t === "[") { const a = []; for (;;) { const u = lx.tok(); if (u === "]" || u === undefined) return a; a.push(parse(lx, u)); } }
    if (t === "<<") {
      const d = {};
      for (;;) {
        const k = lx.tok();
        if (k === ">>" || k === undefined) return d;
        if (typeof k === "string" && k[0] === "/") d[k.slice(1)] = parse(lx);
      }
    }
    if (typeof t === "number" && Number.isInteger(t) && t >= 0) {
      const p0 = lx.p, t2 = lx.tok();
      if (typeof t2 === "number" && Number.isInteger(t2)) { const t3 = lx.tok(); if (isKw(t3, "R")) return new Ref(t, t2); }
      lx.p = p0;
      return t;
    }
    if (isKw(t, "true")) return true;
    if (isKw(t, "false")) return false;
    if (isKw(t, "null")) return null;
    return t;
  }

  /* ---------- фильтры */
  async function pump(fmt, data) {
    const ds = new DecompressionStream(fmt), w = ds.writable.getWriter();
    w.write(data).catch(() => {}); w.close().catch(() => {});
    const r = ds.readable.getReader(), chunks = []; let n = 0;
    try { for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); n += value.length; } }
    catch (e) { if (!n) throw e; }
    return concat(chunks);
  }
  async function inflate(data) {
    try { return await pump("deflate", data); } catch (e) { /* испорченный заголовок или контрольная сумма */ }
    try { return await pump("deflate-raw", data.subarray(2)); } catch (e) { /* дальше */ }
    try { return await pump("deflate-raw", data); } catch (e) { return new Uint8Array(0); }
  }
  function unpredict(data, prm) {
    const pred = prm?.Predictor || 1; if (pred < 10) return data;
    const colors = prm.Colors || 1, bpc = prm.BitsPerComponent || 8, cols = prm.Columns || 1;
    const bpp = Math.max(1, Math.ceil(colors * bpc / 8)), row = Math.ceil(colors * bpc * cols / 8);
    const out = new Uint8Array(Math.floor(data.length / (row + 1)) * row); let prev = new Uint8Array(row);
    for (let r = 0, p = 0; p + row < data.length + 1 && r * row < out.length; r++) {
      const ft = data[p++], cur = out.subarray(r * row, r * row + row);
      for (let i = 0; i < row; i++) {
        const x = data[p + i] || 0, a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = x;
        if (ft === 1) v = x + a; else if (ft === 2) v = x + up; else if (ft === 3) v = x + ((a + up) >> 1);
        else if (ft === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
        cur[i] = v & 255;
      }
      p += row; prev = cur;
    }
    return out;
  }
  function lzw(data, early = 1) {
    const out = []; let dict = [], bits = 9, buf = 0, nb = 0, prev = null;
    const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push(null, null); bits = 9; };
    reset();
    for (let i = 0; i < data.length; i++) {
      buf = (buf << 8) | data[i]; nb += 8;
      while (nb >= bits) {
        const code = (buf >> (nb - bits)) & ((1 << bits) - 1); nb -= bits;
        if (code === 256) { reset(); prev = null; continue; }
        if (code === 257) return Uint8Array.from(out);
        let e = dict[code];
        if (!e) { if (!prev) return Uint8Array.from(out); e = prev.concat([prev[0]]); }
        for (const x of e) out.push(x);
        if (prev) dict.push(prev.concat([e[0]]));
        prev = e;
        if (dict.length + early >= (1 << bits) && bits < 12) bits++;
      }
    }
    return Uint8Array.from(out);
  }
  function a85(data) {
    const out = []; let g = [], i = 0;
    if (data[0] === 60 && data[1] === 126) i = 2;
    for (; i < data.length; i++) {
      const c = data[i];
      if (c === 126) break;
      if (WS[c]) continue;
      if (c === 122 && !g.length) { out.push(0, 0, 0, 0); continue; }
      g.push(c - 33);
      if (g.length === 5) { let v = 0; for (const x of g) v = v * 85 + x; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); g = []; }
    }
    if (g.length > 1) { const n = g.length; while (g.length < 5) g.push(84); let v = 0; for (const x of g) v = v * 85 + x; const by = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; out.push(...by.slice(0, n - 1)); }
    return Uint8Array.from(out);
  }
  function ahex(data) { let h = ""; for (const c of data) { if (c === 62) break; if (!WS[c]) h += String.fromCharCode(c); } if (h.length % 2) h += "0"; const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16) || 0; return o; }
  function rle(data) { const o = []; for (let i = 0; i < data.length;) { const n = data[i++]; if (n === 128) break; if (n < 128) { for (let j = 0; j <= n; j++) o.push(data[i++]); } else { const v = data[i++]; for (let j = 0; j < 257 - n; j++) o.push(v); } } return Uint8Array.from(o); }

  /* ---------- шифрование (стандартный обработчик, пустой пароль пользователя) */
  function md5(bytes) {
    const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const n = bytes.length, len = ((n + 8) >> 6) + 1 << 6, m = new Uint8Array(len);
    m.set(bytes); m[n] = 128; const bits = n * 8; m[len - 8] = bits & 255; m[len - 7] = (bits >>> 8) & 255; m[len - 6] = (bits >>> 16) & 255; m[len - 5] = (bits >>> 24) & 255;
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    const W = new Int32Array(16);
    for (let o = 0; o < len; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = m[o + i * 4] | (m[o + i * 4 + 1] << 8) | (m[o + i * 4 + 2] << 16) | (m[o + i * 4 + 3] << 24);
      let A = a0, B = b0, Cc = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & Cc) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & Cc); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ Cc ^ D; g = (3 * i + 5) & 15; } else { F = Cc ^ (B | ~D); g = (7 * i) & 15; }
        const s = S[(i >> 4) * 4 + (i & 3)], t = (A + F + K[i] + W[g]) | 0;
        A = D; D = Cc; Cc = B; B = (B + ((t << s) | (t >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + Cc) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((v, i) => { out[i * 4] = v & 255; out[i * 4 + 1] = (v >>> 8) & 255; out[i * 4 + 2] = (v >>> 16) & 255; out[i * 4 + 3] = (v >>> 24) & 255; });
    return out;
  }
  function rc4(key, data) {
    const s = new Uint8Array(256); for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    const o = new Uint8Array(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; o[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
    return o;
  }
  const subtle = () => globalThis.crypto && globalThis.crypto.subtle;
  async function aesEnc(key, iv, data) { const k = await subtle().importKey("raw", key, "AES-CBC", false, ["encrypt"]); return new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv }, k, data)).subarray(0, data.length); }
  // CBC-расшифровка без проверки дополнения: добавляем блок, который гарантированно даёт корректное дополнение
  async function aesDecRaw(key, iv, data) {
    const n = data.length - (data.length % 16); if (n <= 0) return new Uint8Array(0);
    data = data.subarray(0, n);
    const last = data.subarray(n - 16), x = new Uint8Array(16); for (let i = 0; i < 16; i++) x[i] = 16 ^ last[i];
    const extra = await aesEnc(key, new Uint8Array(16), x);
    const k = await subtle().importKey("raw", key, "AES-CBC", false, ["decrypt"]);
    return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv }, k, concat([data, extra.subarray(0, 16)])));
  }
  const unpad = d => { const p = d[d.length - 1]; return p > 0 && p <= 16 && d.length >= p ? d.subarray(0, d.length - p) : d; };
  const PAD = Uint8Array.from([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);
  async function sha(n, d) { return new Uint8Array(await subtle().digest(n, d)); }
  async function hash2B(pwd, salt, udata, R) {
    let K = await sha("SHA-256", concat([pwd, salt, udata]));
    if (R === 5) return K;
    for (let i = 0; ; i++) {
      const one = concat([pwd, K, udata]), K1 = new Uint8Array(one.length * 64); for (let j = 0; j < 64; j++) K1.set(one, j * one.length);
      const E = await aesEnc(K.subarray(0, 16), K.subarray(16, 32), K1);
      let s = 0; for (let j = 0; j < 16; j++) s += E[j];
      K = await sha(["SHA-256", "SHA-384", "SHA-512"][s % 3], E);
      if (i >= 63 && E[E.length - 1] <= i - 31) break;
    }
    return K.subarray(0, 32);
  }
  async function makeCrypt(enc, id0) {
    if (enc.Filter !== "/Standard") throw new Error("PDF защищён нестандартным способом");
    const V = enc.V | 0, R = enc.R | 0, O = enc.O instanceof Uint8Array ? enc.O : new Uint8Array(0), U = enc.U instanceof Uint8Array ? enc.U : new Uint8Array(0);
    let mode = "rc4", len = (enc.Length || 40) / 8, identity = false;
    if (V >= 4) {
      const cf = enc.CF && enc.StmF ? enc.CF[enc.StmF.slice(1)] : null;
      if (!enc.StmF || enc.StmF === "/Identity") identity = true;
      if (cf?.CFM === "/AESV2") mode = "aes"; else if (cf?.CFM === "/AESV3") mode = "aes256"; else if (cf?.CFM === "/None") identity = true;
      if (cf?.Length) len = cf.Length > 32 ? cf.Length / 8 : cf.Length;
    }
    if (R >= 5) {
      if (!subtle()) throw new Error("браузер не поддерживает расшифровку AES");
      const empty = new Uint8Array(0);
      const h = await hash2B(empty, U.subarray(32, 40), empty, R);
      if (!h.every((x, i) => x === U[i])) throw new Error("PDF защищён паролем на открытие");
      const ik = await hash2B(empty, U.subarray(40, 48), empty, R);
      const key = await aesDecRaw(ik, new Uint8Array(16), enc.UE);
      return { identity, mode: "aes256", key };
    }
    const P = enc.P | 0, pb = Uint8Array.from([P & 255, (P >>> 8) & 255, (P >>> 16) & 255, (P >>> 24) & 255]);
    let k = md5(concat([PAD, O.subarray(0, 32), pb, id0 || new Uint8Array(0), R >= 4 && enc.EncryptMetadata === false ? Uint8Array.from([255, 255, 255, 255]) : new Uint8Array(0)]));
    const n = R === 2 ? 5 : Math.min(16, len);
    if (R >= 3) for (let i = 0; i < 50; i++) k = md5(k.subarray(0, n));
    const key = k.subarray(0, n);
    // проверка пустого пароля пользователя
    if (R === 2) { if (!rc4(key, PAD).every((x, i) => x === U[i])) throw new Error("PDF защищён паролем на открытие"); }
    else if (U.length >= 16) {
      let x = rc4(key, md5(concat([PAD, id0 || new Uint8Array(0)])));
      for (let i = 1; i <= 19; i++) x = rc4(key.map(b => b ^ i), x);
      if (!x.every((b, i) => b === U[i])) throw new Error("PDF защищён паролем на открытие");
    }
    return { identity, mode, key };
  }
  async function decryptData(cr, n, g, data) {
    if (!cr || cr.identity) return data;
    if (cr.mode === "aes256") return data.length < 32 ? new Uint8Array(0) : unpad(await aesDecRaw(cr.key, data.subarray(0, 16), data.subarray(16)));
    const ok = md5(concat([cr.key, Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255]), cr.mode === "aes" ? Uint8Array.from([0x73, 0x41, 0x6C, 0x54]) : new Uint8Array(0)])).subarray(0, Math.min(cr.key.length + 5, 16));
    if (cr.mode === "aes") return data.length < 32 ? new Uint8Array(0) : unpad(await aesDecRaw(ok, data.subarray(0, 16), data.subarray(16)));
    return rc4(ok, data);
  }

  /* ---------- документ */
  async function openDoc(buf) {
    const b = new Uint8Array(buf), str = latin1(b), objs = new Map(), trailers = [];
    if (!/^%PDF-|%PDF-/.test(str.slice(0, 1024))) throw new Error("это не PDF");
    const re = /(\d+)\s+(\d+)\s+obj\b/g; let m, skipTo = 0;
    while ((m = re.exec(str))) {
      if (m.index < skipTo) continue;
      const n = +m[1], g = +m[2], lx = new Lex(b, m.index + m[0].length);
      let v; try { v = parse(lx); } catch (e) { continue; }
      lx.skip();
      const save = lx.p, t = lx.tok();
      if (isKw(t, "stream") && v && typeof v === "object") {
        let s = lx.p; if (b[s] === 13) s++; if (b[s] === 10) s++;
        let e = -1;
        if (typeof v.Length === "number" && s + v.Length <= b.length && /^\s*endstream/.test(str.substr(s + v.Length, 20))) e = s + v.Length;
        if (e < 0) { e = str.indexOf("endstream", s); if (e < 0) e = b.length; let q = e; if (b[q - 1] === 10) q--; if (b[q - 1] === 13) q--; e = Math.max(s, q); }
        objs.set(n, { v: { dict: v, s, e, n, g, stream: true }, g });
        skipTo = e; re.lastIndex = e;
        if (v.Type === "/XRef") trailers.push(v);
      } else { lx.p = save; objs.set(n, { v, g }); }
    }
    const tre = /trailer\s*<</g;
    while ((m = tre.exec(str))) { try { trailers.push(parse(new Lex(b, m.index + 7))); } catch (e) { /* пропуск */ } }
    const doc = { b, objs, crypt: null };
    const R = v => { for (let i = 0; i < 20 && v instanceof Ref; i++) { const o = objs.get(v.n); v = o ? o.v : null; } return v; };
    doc.R = R;
    // длины потоков, заданные ссылками
    for (const [, o] of objs) if (o.v && o.v.stream && o.v.dict.Length instanceof Ref) {
      const L = R(o.v.dict.Length);
      if (typeof L === "number" && o.v.s + L <= b.length) o.v.e = o.v.s + L;
    }
    const tr = {}; for (const t of trailers) for (const k of ["Root", "Encrypt", "ID"]) if (t[k] !== undefined) tr[k] = t[k];
    if (tr.Encrypt) {
      const enc = R(tr.Encrypt), id = R(tr.ID);
      doc.crypt = await makeCrypt(enc, Array.isArray(id) && id[0] instanceof Uint8Array ? id[0] : null);
      doc.encrypted = true;
    }
    doc.stream = async so => {
      let d = b.subarray(so.s, so.e);
      if (doc.crypt && so.dict.Type !== "/XRef") d = await decryptData(doc.crypt, so.n, so.g, d);
      let f = R(so.dict.Filter), prm = R(so.dict.DecodeParms);
      if (!Array.isArray(f)) f = f ? [f] : []; if (!Array.isArray(prm)) prm = [prm];
      for (let i = 0; i < f.length; i++) {
        const fn = f[i], p = R(prm[i]);
        if (fn === "/FlateDecode" || fn === "/Fl") d = unpredict(await inflate(d), p);
        else if (fn === "/LZWDecode" || fn === "/LZW") d = unpredict(lzw(d, p?.EarlyChange ?? 1), p);
        else if (fn === "/ASCII85Decode" || fn === "/A85") d = a85(d);
        else if (fn === "/ASCIIHexDecode" || fn === "/AHx") d = ahex(d);
        else if (fn === "/RunLengthDecode" || fn === "/RL") d = rle(d);
        else return new Uint8Array(0);           // картинки и прочее — не нужны
      }
      return d;
    };
    // объекты внутри потоков ObjStm
    for (const [, o] of Array.from(objs)) {
      if (!o.v || !o.v.stream || o.v.dict.Type !== "/ObjStm") continue;
      const d = await doc.stream(o.v), N = o.v.dict.N | 0, first = o.v.dict.First | 0, lx = new Lex(d), hdr = [];
      for (let i = 0; i < N; i++) { const a = lx.tok(), c = lx.tok(); if (typeof a !== "number") break; hdr.push([a, c]); }
      for (const [num, off] of hdr) {
        if (objs.has(num)) continue;
        try { const v = parse(new Lex(d, first + off)); objs.set(num, { v, g: 0 }); } catch (e) { /* пропуск */ }
      }
    }
    let root = R(tr.Root);
    if (!root || !root.Pages) for (const [, o] of objs) if (o.v && o.v.Type === "/Catalog") { root = o.v; break; }
    doc.pages = [];
    const walk = (node, inh, depth) => {
      node = R(node); if (!node || depth > 40) return;
      const res = node.Resources !== undefined ? node.Resources : inh.res, rot = node.Rotate !== undefined ? R(node.Rotate) : inh.rot;
      if (node.Type === "/Pages" || (Array.isArray(R(node.Kids)) && node.Type !== "/Page")) { for (const k of R(node.Kids) || []) walk(k, { res, rot }, depth + 1); }
      else doc.pages.push({ node, res, rot });
    };
    if (root && root.Pages) walk(root.Pages, { res: null, rot: 0 }, 0);
    if (!doc.pages.length) for (const [, o] of [...objs].sort((a, c) => a[0] - c[0])) if (o.v && o.v.Type === "/Page") doc.pages.push({ node: o.v, res: o.v.Resources, rot: 0 });
    return doc;
  }

  /* ---------- шрифты */
  const CP1252 = (() => { const a = []; const d = new TextDecoder("windows-1252"); for (let i = 0; i < 256; i++) a.push(d.decode(Uint8Array.of(i))); return a; })();
  const CP1251 = (() => { const a = []; try { const d = new TextDecoder("windows-1251"); for (let i = 0; i < 256; i++) a.push(d.decode(Uint8Array.of(i))); } catch (e) { for (let i = 0; i < 256; i++) a.push(i >= 192 ? String.fromCharCode(0x410 + i - 192) : i === 168 ? "Ё" : i === 184 ? "ё" : CP1252[i]); } return a; })();
  const GN = { space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", quoteright: "’", quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/",
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", underscore: "_", braceleft: "{", bar: "|", braceright: "}",
    endash: "–", emdash: "—", guillemotleft: "«", guillemotright: "»", quotedblleft: "“", quotedblright: "”", quotedblbase: "„", bullet: "•", ellipsis: "…", numero: "№", afii61352: "№", degree: "°", section: "§", nbspace: " ", uni00A0: " ", sfthyphen: "-", periodcentered: "·", multiply: "×", copyright: "©", registered: "®", plusminus: "±" };
  function glyphUni(name) {
    if (!name) return null;
    name = name.replace(/^\//, "").replace(/\..*$/, "");
    if (GN[name] !== undefined) return GN[name];
    if (/^[A-Za-z]$/.test(name)) return name;
    let m = /^uni([0-9A-Fa-f]{4})/.exec(name); if (m) return String.fromCharCode(parseInt(m[1], 16));
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(name); if (m) return String.fromCodePoint(parseInt(m[1], 16));
    m = /^afii(\d{5})$/.exec(name);
    if (m) { const n = +m[1]; if (n >= 10017 && n <= 10022) return String.fromCharCode(0x410 + n - 10017); if (n === 10023) return "Ё"; if (n >= 10024 && n <= 10049) return String.fromCharCode(0x416 + n - 10024);
      if (n >= 10065 && n <= 10070) return String.fromCharCode(0x430 + n - 10065); if (n === 10071) return "ё"; if (n >= 10072 && n <= 10097) return String.fromCharCode(0x436 + n - 10072); }
    m = /^(?:g|glyph|cid)?(\d+)$/.exec(name); if (m) return null;
    return null;
  }
  function parseCMap(d) {
    const s = latin1(d), map = new Map(), spaces = [];
    const hx = h => parseInt(h, 16);
    const uni = h => { let o = ""; for (let i = 0; i + 4 <= h.length; i += 4) o += String.fromCharCode(hx(h.substr(i, 4))); if (h.length === 2) o = String.fromCharCode(hx(h)); return o; };
    for (const blk of s.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) spaces.push(p[1].length / 2);
    for (const blk of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(hx(p[1]), uni(p[2]));
    for (const blk of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const body = blk[1], rr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g; let p;
      while ((p = rr.exec(body))) {
        const lo = hx(p[1]), hi = hx(p[2]);
        if (hi - lo > 65536) continue;
        if (p[4] !== undefined) {
          const base = p[4], last = hx(base.slice(-4)), pre = base.slice(0, -4);
          for (let c = lo; c <= hi; c++) map.set(c, uni(pre + (last + c - lo).toString(16).padStart(4, "0")));
        } else { const arr = [...p[5].matchAll(/<([0-9A-Fa-f]*)>/g)].map(x => x[1]); for (let c = lo; c <= hi && c - lo < arr.length; c++) map.set(c, uni(arr[c - lo])); }
      }
    }
    return { map, bytes: spaces.length ? Math.max(...spaces) : 0 };
  }
  async function loadFont(doc, ref) {
    const R = doc.R, fd = R(ref) || {};
    const f = { two: false, map: null, w: new Map(), dw: 1000, fw: 0, enc: null, scale: 1, noUni: false };
    const sub = fd.Subtype;
    if (sub === "/Type0") {
      f.two = true;
      const desc = R((R(fd.DescendantFonts) || [])[0]) || {};
      f.dw = typeof desc.DW === "number" ? desc.DW : 1000;
      const W = R(desc.W) || [];
      for (let i = 0; i < W.length;) {
        const a = R(W[i]), nx = R(W[i + 1]);
        if (Array.isArray(nx)) { nx.forEach((w, j) => f.w.set(a + j, R(w))); i += 2; }
        else { const c = R(W[i + 2]); for (let k = a; k <= nx && k - a < 65536; k++) f.w.set(k, c); i += 3; }
      }
      const encObj = R(fd.Encoding);
      if (encObj && encObj.stream) { const cm = parseCMap(await doc.stream(encObj)); if (cm.bytes === 1) f.two = false; }
    } else {
      const fc = R(fd.FirstChar) | 0, ws = R(fd.Widths) || [];
      ws.forEach((w, i) => f.w.set(fc + i, R(w)));
      const desc = R(fd.FontDescriptor); f.dw = desc && typeof R(desc.MissingWidth) === "number" && R(desc.MissingWidth) > 0 ? R(desc.MissingWidth) : 0;
      if (!ws.length) { const bf = String(fd.BaseFont || ""); f.dw = /Courier/i.test(bf) ? 600 : 500; }
      if (sub === "/Type3") { const fm = R(fd.FontMatrix); if (Array.isArray(fm)) f.scale = R(fm[0]) * 1000; }
      const e = R(fd.Encoding); f.enc = new Array(256).fill(null);
      if (e && typeof e === "object" && !(e instanceof Uint8Array)) {
        let code = 0; for (const x of R(e.Differences) || []) { const v = R(x); if (typeof v === "number") code = v; else if (typeof v === "string") { f.enc[code & 255] = glyphUni(v); code++; } }
        f.base = e.BaseEncoding;
      } else f.base = e;
    }
    const tu = R(fd.ToUnicode);
    if (tu && tu.stream) { const cm = parseCMap(await doc.stream(tu)); f.map = cm.map; if (!f.two && cm.bytes === 2 && sub !== "/Type0") f.two = false; }
    if (f.two && !f.map) f.noUni = true;
    return f;
  }
  function decodeStr(f, bytes) {
    const glyphs = [];
    if (f.two) {
      for (let i = 0; i + 1 < bytes.length; i += 2) { const c = (bytes[i] << 8) | bytes[i + 1]; glyphs.push([c, f.map ? (f.map.get(c) ?? "") : "", f.w.has(c) ? f.w.get(c) : f.dw, false]); }
    } else {
      for (const c of bytes) {
        let ch = f.map && f.map.has(c) ? f.map.get(c) : null;
        if (ch === null && f.enc && f.enc[c] !== null) ch = f.enc[c];
        if (ch === null) ch = c < 32 ? "" : c < 128 ? String.fromCharCode(c) : String.fromCharCode(0xF000 + c);  // решение 1251/1252 — после
        glyphs.push([c, ch, f.w.has(c) ? f.w.get(c) : f.dw, c === 32]);
      }
    }
    return glyphs;
  }

  /* ---------- содержимое страницы */
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  async function runContent(doc, data, res, ctm0, items, fonts, depth) {
    const R = doc.R; res = R(res) || {};
    const fontRes = R(res.Font) || {}, xres = R(res.XObject) || {};
    let gs = { ctm: ctm0.slice(), font: null, fs: 1, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
    const stack = []; let tm = [1, 0, 0, 1, 0, 0], tlm = tm.slice(), ops = [];
    const lx = new Lex(data);
    const show = bytes => {
      const f = gs.font; if (!f) return;
      const gl = decodeStr(f, bytes);
      const M = mul(tm, gs.ctm), sx = Math.hypot(M[0], M[1]) || 1, sy = Math.hypot(M[2], M[3]) || 1;
      const trm = mul([gs.fs * gs.th, 0, 0, gs.fs, 0, gs.rise], M);
      let adv = 0, s = "";
      for (const [, ch, w, sp] of gl) { s += ch; adv += ((w * f.scale) / 1000 * gs.fs + gs.tc + (sp ? gs.tw : 0)) * gs.th; }
      if (s) items.push({ x: trm[4], y: trm[5], s, w: adv * sx, fs: Math.abs(gs.fs) * sy, dx: M[0] / sx, dy: M[1] / sx });
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    };
    const nextLine = () => { tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm.slice(); };
    for (;;) {
      const t = lx.tok(); if (t === undefined) break;
      if (!(t && typeof t === "object" && typeof t.k === "string")) { ops.push(parse(lx, t)); continue; }
      const op = t.k, a = ops; ops = [];
      switch (op) {
        case "q": stack.push({ ...gs, ctm: gs.ctm.slice() }); break;
        case "Q": if (stack.length) gs = stack.pop(); break;
        case "cm": if (a.length >= 6) gs.ctm = mul(a.slice(-6), gs.ctm); break;
        case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case "Tf": {
          const nm = String(a[0] || "").slice(1), ref = fontRes[nm];
          const key = ref instanceof Ref ? "r" + ref.n : null;
          let f = key && fonts.get(key);
          if (!f && ref) { f = await loadFont(doc, ref); if (key) fonts.set(key, f); }
          gs.font = f || null; gs.fs = typeof a[1] === "number" ? a[1] : 1; break;
        }
        case "Tc": gs.tc = +a[0] || 0; break;
        case "Tw": gs.tw = +a[0] || 0; break;
        case "Tz": gs.th = (+a[0] || 100) / 100; break;
        case "TL": gs.tl = +a[0] || 0; break;
        case "Ts": gs.rise = +a[0] || 0; break;
        case "Td": tlm = mul([1, 0, 0, 1, +a[0] || 0, +a[1] || 0], tlm); tm = tlm.slice(); break;
        case "TD": gs.tl = -(+a[1] || 0); tlm = mul([1, 0, 0, 1, +a[0] || 0, +a[1] || 0], tlm); tm = tlm.slice(); break;
        case "Tm": if (a.length >= 6) { tlm = a.slice(-6).map(Number); tm = tlm.slice(); } break;
        case "T*": nextLine(); break;
        case "Tj": if (a[0] instanceof Uint8Array) show(a[0]); break;
        case "'": nextLine(); if (a[0] instanceof Uint8Array) show(a[0]); break;
        case '"': gs.tw = +a[0] || 0; gs.tc = +a[1] || 0; nextLine(); if (a[2] instanceof Uint8Array) show(a[2]); break;
        case "TJ": for (const el of a[0] || []) { if (el instanceof Uint8Array) show(el); else if (typeof el === "number") tm = mul([1, 0, 0, 1, -el / 1000 * gs.fs * gs.th, 0], tm); } break;
        case "Do": {
          if (depth > 6) break;
          const xo = R(xres[String(a[0] || "").slice(1)]);
          if (xo && xo.stream && xo.dict.Subtype === "/Form") {
            const mtx = R(xo.dict.Matrix), ctm = Array.isArray(mtx) && mtx.length === 6 ? mul(mtx.map(Number), gs.ctm) : gs.ctm;
            await runContent(doc, await doc.stream(xo), xo.dict.Resources || res, ctm, items, fonts, depth + 1);
          }
          break;
        }
        case "BI": { // встроенная картинка: пропускаем до EI
          const b = lx.b; let p = lx.p;
          while (p < lx.end - 1 && !(b[p] === 73 && b[p + 1] === 68 && WS[b[p - 1]] && (WS[b[p + 2]] || p + 2 >= lx.end))) p++;
          p += 3;
          while (p < lx.end - 1 && !(WS[b[p - 1]] && b[p] === 69 && b[p + 1] === 73 && (WS[b[p + 2]] || p + 2 >= lx.end))) p++;
          lx.p = p + 2; break;
        }
      }
    }
  }

  /* ---------- раскладка: элементы → строки → ячейки */
  function layout(items) {
    items = items.filter(it => it.s.trim() !== "" && isFinite(it.x) && isFinite(it.y));
    if (!items.length) return [];
    // направление текста: поворачиваем систему координат так, чтобы основной текст шёл слева направо
    const votes = new Map();
    for (const it of items) { const k = Math.round(it.dx) + "," + Math.round(it.dy); votes.set(k, (votes.get(k) || 0) + it.s.length); }
    let [dx, dy] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
    if (!dx && !dy) [dx, dy] = [1, 0];
    const P = items.map(it => ({ ...it, X: it.x * dx + it.y * dy, Y: -it.x * dy + it.y * dx }));
    P.sort((a, b) => b.Y - a.Y || a.X - b.X);
    const lines = [];
    for (const it of P) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(L.Y - it.Y) <= Math.max(1, 0.45 * Math.min(L.fs, it.fs))) L.items.push(it);
      else lines.push({ Y: it.Y, fs: it.fs, items: [it] });
    }
    return lines.map(L => {
      const its = L.items.sort((a, b) => a.X - b.X), cells = [];
      let cur = null, prev = null;
      for (const it of its) {
        if (prev && it.s === prev.s && Math.abs(it.X - prev.X) < 0.5) continue;      // двойная печать (псевдожирный)
        const fs = Math.max(it.fs, 1);
        if (cur) {
          const gap = it.X - (prev.X + prev.w);
          if (gap > 0.9 * fs) { cells.push(cur); cur = null; }
          else { const sp = gap > 0.18 * fs && !/\s$/.test(cur.s) && !/^\s/.test(it.s) ? " " : ""; cur.s += sp + it.s; cur.x2 = it.X + it.w; cur.parts.push(it); }
        }
        if (!cur) cur = { x: it.X, x2: it.X + it.w, s: it.s, fs, parts: [it] };
        prev = it;
      }
      if (cur) cells.push(cur);
      for (const c of cells) c.s = c.s.replace(/\s+/g, " ").trim();
      return { y: L.Y, fs: L.fs, cells: cells.filter(c => c.s), text: cells.map(c => c.s.replace(/\s+/g, " ").trim()).filter(Boolean).join("  ") };
    }).filter(l => l.cells.length);
  }

  /* ---------- заполняемые поля (AcroForm): значения деклараций часто лежат здесь, а не в тексте страницы */
  function pdfText(b) {
    if (!(b instanceof Uint8Array)) return typeof b === "string" ? b.replace(/^\//, "") : "";
    if (b[0] === 0xFE && b[1] === 0xFF) { let s = ""; for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]); return s; }
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder("utf-8").decode(b.subarray(3));
    let s = ""; for (const c of b) s += c < 128 ? String.fromCharCode(c) : CP1252[c]; return s;
  }
  function inherit(doc, node, key) { for (let n = doc.R(node), i = 0; n && i < 20; n = doc.R(n.Parent), i++) if (n[key] !== undefined) return doc.R(n[key]); return undefined; }
  async function runAnnots(doc, pg, items, fonts) {
    const R = doc.R, annots = R(pg.node.Annots); if (!Array.isArray(annots)) return;
    for (const ref of annots) {
      const a = R(ref); if (!a || typeof a !== "object") continue;
      if (a.Subtype && a.Subtype !== "/Widget" && a.Subtype !== "/FreeText") continue;
      const rect = (R(a.Rect) || []).map(x => +R(x)); if (rect.length !== 4 || rect.some(x => !isFinite(x))) continue;
      const [x1, y1, x2, y2] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
      const before = items.length;
      // 1) внешний вид поля (appearance stream)
      let ap = R(a.AP), n = ap && R(ap.N);
      if (n && !n.stream && typeof n === "object") { const as = R(a.AS); n = R(as && n[String(as).slice(1)]) || R(Object.values(n)[0]); }
      if (n && n.stream) {
        const bb = (R(n.dict.BBox) || [0, 0, x2 - x1, y2 - y1]).map(x => +R(x)), mtx = (R(n.dict.Matrix) || [1, 0, 0, 1, 0, 0]).map(x => +R(x));
        const pts = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]].map(([x, y]) => [x * mtx[0] + y * mtx[2] + mtx[4], x * mtx[1] + y * mtx[3] + mtx[5]]);
        const tx1 = Math.min(...pts.map(p => p[0])), tx2 = Math.max(...pts.map(p => p[0])), ty1 = Math.min(...pts.map(p => p[1])), ty2 = Math.max(...pts.map(p => p[1]));
        const sx = (x2 - x1) / ((tx2 - tx1) || 1), sy = (y2 - y1) / ((ty2 - ty1) || 1);
        const A = mul(mtx, [sx, 0, 0, sy, x1 - tx1 * sx, y1 - ty1 * sy]);
        try { await runContent(doc, await doc.stream(n), n.dict.Resources || pg.res, A, items, fonts, 1); } catch (e) { /* дальше — значение поля */ }
      }
      if (items.length > before) continue;
      // 2) значение поля без внешнего вида
      const v = inherit(doc, a, "V") ?? a.Contents;
      let s = Array.isArray(v) ? v.map(pdfText).join(" ") : pdfText(v);
      s = (s || "").replace(/\s+/g, " ").trim(); if (!s || s === "Off") continue;
      const da = String(pdfText(inherit(doc, a, "DA") || "")), fm = /([\d.]+)\s+Tf/.exec(da);
      const fs = fm && +fm[1] > 0 ? +fm[1] : Math.max(6, Math.min(12, (y2 - y1) * 0.7));
      const comb = (+inherit(doc, a, "Ff") & (1 << 24)) && +inherit(doc, a, "MaxLen") > 0;     // поле «по клеткам»
      const q = +(inherit(doc, a, "Q") || 0), w = s.length * fs * 0.5;
      const x = comb ? x1 + (x2 - x1) * (1 - s.length / +inherit(doc, a, "MaxLen")) : q === 2 ? x2 - w - 2 : q === 1 ? (x1 + x2 - w) / 2 : x1 + 2;
      items.push({ x, y: y1 + Math.max(1, (y2 - y1 - fs) / 2), s, w: comb ? x2 - x : w, fs, dx: 1, dy: 0 });
    }
  }

  async function read(buf, onProgress) {
    const doc = await openDoc(buf), fonts = new Map(), pages = [];
    let fallback = 0, latinHi = 0, noUni = false;
    for (let i = 0; i < doc.pages.length; i++) {
      const pg = doc.pages[i], items = [];
      let cont = doc.R(pg.node.Contents);
      const parts = Array.isArray(cont) ? cont.map(doc.R) : cont ? [cont] : [];
      const datas = []; for (const p of parts) if (p && p.stream) { datas.push(await doc.stream(p)); datas.push(Uint8Array.of(10)); }
      try { await runContent(doc, concat(datas), pg.res, [1, 0, 0, 1, 0, 0], items, fonts, 0); } catch (e) { /* страница с ошибкой — берём, что успели */ }
      try { await runAnnots(doc, pg, items, fonts); } catch (e) { /* поля формы не прочитались */ }
      for (const it of items) for (const ch of it.s) { const c = ch.charCodeAt(0); if (c >= 0xF080 && c <= 0xF0FF) { fallback++; if (c >= 0xF0C0) latinHi++; } }
      pages.push(items);
      if (onProgress) onProgress(i + 1, doc.pages.length);
    }
    for (const [, f] of fonts) if (f.noUni) noUni = true;
    // однобайтные шрифты без таблицы символов: русские генераторы часто кладут кириллицу в кодировке 1251
    const table = fallback && latinHi / fallback > 0.3 ? CP1251 : CP1252;
    const fix = s => s.replace(/[-]/g, ch => table[ch.charCodeAt(0) - 0xF000]);
    const out = pages.map(items => { for (const it of items) it.s = fix(it.s); return { lines: layout(items) }; });
    const chars = out.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.text.length, 0), 0);
    return { pages: out, encrypted: !!doc.encrypted, noText: chars < 30, noUni, nPages: doc.pages.length };
  }
  return { read, _test: { md5, rc4, parseCMap, layout } };
})();
