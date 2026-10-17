// Общая база отдела: учётные записи сотрудников и зашифрованные данные клиентов.
// Сервер НЕ видит данных клиентов: браузер шифрует их ключом отдела (AES-GCM), ключ выводится из кодового слова отдела,
// которое на сервер не передаётся. Пароль сотрудника тоже не передаётся — только производный «ключ входа» (PBKDF2 в браузере),
// который здесь ещё раз хешируется (scrypt). Хранилище — Upstash Redis (Vercel → Storage), доступ по REST.
// Переменные окружения: KV_REST_API_URL + KV_REST_API_TOKEN (или UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN),
// INVITE_CODE — код приглашения для регистрации, SESSION_SECRET — необязательно (иначе выводится из токена хранилища).
const crypto = require("crypto");
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const INVITE = process.env.INVITE_CODE || "";
const SECRET = process.env.SESSION_SECRET || (TOK ? crypto.createHash("sha256").update("finkz-session|" + TOK).digest("hex") : "");
const PFX = "finkz:";
const TTL_DAYS = 30;

async function redis(cmds) {   // cmds: [[...], ...] → результаты
  const r = await fetch(URL_.replace(/\/$/, "") + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("хранилище ответило " + r.status);
  const j = await r.json();
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const one = async (...c) => (await redis([c]))[0];
const hmac = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const normLogin = s => String(s || "").trim().toLowerCase();
const validLogin = s => /^[a-z0-9а-яё._@-]{3,40}$/i.test(s);
function token(login) { const exp = Date.now() + TTL_DAYS * 864e5, p = Buffer.from(JSON.stringify({ l: login, e: exp })).toString("base64url"); return p + "." + hmac(p); }
function who(req) {
  const t = String(req.headers["x-finkz-token"] || ""), [p, s] = t.split(".");
  if (!p || !s || !eq(hmac(p), s)) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.e > Date.now() ? o.l : null; } catch (e) { return null; }
}
const scryptHash = (key, salt) => new Promise((ok, no) => crypto.scrypt(Buffer.from(key, "base64"), Buffer.from(salt, "base64"), 32, { N: 16384, r: 8, p: 1 }, (e, d) => (e ? no(e) : ok(d.toString("base64")))));
const b64ok = (s, max) => typeof s === "string" && s.length <= max && /^[A-Za-z0-9+/=]*$/.test(s);
const idOk = s => typeof s === "string" && /^[a-z0-9]{4,40}$/i.test(s);
const PART = 3000000;   // длина одной части (base64), чтобы уложиться в лимит запроса Vercel 4,5 МБ

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const send = (code, o) => res.status(code).json(o);
  const configured = !!(URL_ && TOK && INVITE);
  try {
    if (req.method === "GET") {
      const dept = configured ? await one("GET", PFX + "dept") : null;
      return send(200, { ok: true, configured, deptInit: !!dept, partSize: PART });
    }
    if (req.method !== "POST") return send(405, { ok: false, error: "Только GET/POST" });
    if (!configured) return send(503, { ok: false, error: "Хранилище не настроено: подключите Upstash Redis в Vercel и задайте INVITE_CODE" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const a = b.a;

    // соль для вывода ключей конкретного сотрудника (для несуществующего логина — правдоподобная поддельная)
    if (a === "salt") {
      const l = normLogin(b.login); if (!validLogin(l)) return send(400, { ok: false, error: "Логин: 3–40 знаков (буквы, цифры, . _ - @)" });
      const u = await one("GET", PFX + "user:" + l);
      return send(200, { ok: true, salt: u ? JSON.parse(u).salt : crypto.createHmac("sha256", SECRET).update("fake|" + l).digest().subarray(0, 16).toString("base64") });
    }
    // параметры ключа отдела — только по коду приглашения
    if (a === "dept") {
      if (!eq(b.invite || "", INVITE)) return send(403, { ok: false, error: "Неверный код приглашения" });
      const d = await one("GET", PFX + "dept");
      return send(200, { ok: true, dept: d ? JSON.parse(d) : null });
    }
    if (a === "register") {
      if (!eq(b.invite || "", INVITE)) return send(403, { ok: false, error: "Неверный код приглашения" });
      const l = normLogin(b.login); if (!validLogin(l)) return send(400, { ok: false, error: "Логин: 3–40 знаков (буквы, цифры, . _ - @)" });
      if (!b64ok(b.auth, 100) || !b64ok(b.salt, 40) || !b.wrap || !b64ok(b.wrap.iv, 40) || !b64ok(b.wrap.ct, 200)) return send(400, { ok: false, error: "Неверные данные" });
      const name = String(b.name || "").slice(0, 80);
      if (b.deptInit) {
        const di = b.deptInit; if (!b64ok(di.salt, 40) || !di.check || !b64ok(di.check.iv, 40) || !b64ok(di.check.ct, 200)) return send(400, { ok: false, error: "Неверные данные" });
        const set = await one("SET", PFX + "dept", JSON.stringify({ salt: di.salt, check: di.check, t: Date.now() }), "NX");
        if (!set) return send(409, { ok: false, error: "Кодовое слово отдела уже задано — обновите страницу и зарегистрируйтесь заново" });
      } else if (!(await one("GET", PFX + "dept"))) return send(409, { ok: false, error: "Кодовое слово отдела ещё не задано" });
      const hs = crypto.randomBytes(16).toString("base64");
      const rec = { login: l, name, salt: b.salt, hs, h: await scryptHash(b.auth, hs), wrap: b.wrap, t: Date.now() };
      const ok = await one("SET", PFX + "user:" + l, JSON.stringify(rec), "NX");
      if (!ok) return send(409, { ok: false, error: "Такой логин уже занят" });
      await one("SADD", PFX + "users", l);
      return send(200, { ok: true, token: token(l), wrap: rec.wrap, name, dept: JSON.parse(await one("GET", PFX + "dept")) });
    }
    if (a === "login") {
      const l = normLogin(b.login), u = validLogin(l) ? await one("GET", PFX + "user:" + l) : null;
      if (!u || !b64ok(b.auth, 100)) return send(403, { ok: false, error: "Неверный логин или пароль" });
      const r = JSON.parse(u);
      if (!eq(await scryptHash(b.auth, r.hs), r.h)) return send(403, { ok: false, error: "Неверный логин или пароль" });
      return send(200, { ok: true, token: token(l), wrap: r.wrap, name: r.name || "", dept: JSON.parse(await one("GET", PFX + "dept")) });
    }

    // дальше — только с действующим входом
    const me = who(req); if (!me) return send(401, { ok: false, error: "Войдите заново" });
    if (a === "passwd") {
      const u = JSON.parse(await one("GET", PFX + "user:" + me));
      if (!eq(await scryptHash(b.authOld || "", u.hs), u.h)) return send(403, { ok: false, error: "Неверный текущий пароль" });
      if (!b64ok(b.auth, 100) || !b64ok(b.salt, 40) || !b.wrap || !b64ok(b.wrap.iv, 40) || !b64ok(b.wrap.ct, 200)) return send(400, { ok: false, error: "Неверные данные" });
      u.hs = crypto.randomBytes(16).toString("base64"); u.h = await scryptHash(b.auth, u.hs); u.salt = b.salt; u.wrap = b.wrap;
      await one("SET", PFX + "user:" + me, JSON.stringify(u));
      return send(200, { ok: true, token: token(me) });
    }
    if (a === "list") {
      const h = (await one("HGETALL", PFX + "meta")) || [];
      const meta = {}; for (let i = 0; i < h.length; i += 2) meta[h[i]] = JSON.parse(h[i + 1]);
      const users = await one("SMEMBERS", PFX + "users");
      return send(200, { ok: true, me, meta, users: (users || []).length });
    }
    if (a === "get") {
      if (!idOk(b.id)) return send(400, { ok: false, error: "Неверный id" });
      const p = Math.max(0, b.part | 0);
      const d = await one("GET", PFX + "c:" + b.id + ":" + p);
      return send(200, { ok: true, data: d });
    }
    if (a === "put") {   // части отправляются по порядку; метаданные обновляются после последней
      if (!idOk(b.id) || !b64ok(b.data, PART + 100)) return send(400, { ok: false, error: "Неверные данные" });
      const p = b.part | 0, n = b.n | 0, u = +b.u || Date.now();
      if (p < 0 || n < 1 || n > 40 || p >= n) return send(400, { ok: false, error: "Неверные части" });
      const cmds = [["SET", PFX + "c:" + b.id + ":" + p, b.data]];
      if (p === n - 1) {
        const old = await one("HGET", PFX + "meta", b.id), on = old ? JSON.parse(old).n || 1 : 0;
        for (let i = n; i < on; i++) cmds.push(["DEL", PFX + "c:" + b.id + ":" + i]);
        cmds.push(["HSET", PFX + "meta", b.id, JSON.stringify({ u, n, by: me, t: Date.now(), size: (n - 1) * PART + b.data.length })]);
      }
      await redis(cmds);
      return send(200, { ok: true });
    }
    if (a === "del") {
      if (!idOk(b.id)) return send(400, { ok: false, error: "Неверный id" });
      const old = await one("HGET", PFX + "meta", b.id), on = old ? JSON.parse(old).n || 1 : 1;
      const cmds = []; for (let i = 0; i < on; i++) cmds.push(["DEL", PFX + "c:" + b.id + ":" + i]);
      cmds.push(["HSET", PFX + "meta", b.id, JSON.stringify({ u: Date.now(), del: true, by: me, t: Date.now() })]);
      await redis(cmds);
      return send(200, { ok: true });
    }
    return send(400, { ok: false, error: "Неизвестное действие" });
  } catch (e) {
    return send(500, { ok: false, error: "Ошибка сервера: " + e.message });
  }
};
