// Личная облачная база сотрудника: вход с любого устройства, у каждого — только свои клиенты.
// Сервер НЕ видит данных клиентов: браузер шифрует их личным ключом сотрудника (AES-GCM 256). Ключ случайный,
// на сервере хранится только «завёрнутым»: паролем и кодом восстановления (оба на сервер не передаются —
// только производные «ключи входа», которые здесь ещё раз хешируются scrypt).
// Защита от подбора: не больше 5 неудачных попыток на логин и 30 на IP за 15 минут.
// Хранилище — Upstash Redis (Vercel → Storage), доступ по REST.
// Переменные окружения: KV_REST_API_URL + KV_REST_API_TOKEN (или UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN),
// INVITE_CODE — необязательно (иначе код приглашения задаёт первый сотрудник), SESSION_SECRET — необязательно.
const crypto = require("crypto");
// адрес и токен Upstash: KV_…, UPSTASH_REDIS_… или любой свой префикс (…_REST_API_URL / …_REST_API_TOKEN)
const envEnd = suf => { for (const [k, v] of Object.entries(process.env)) if (k.endsWith(suf) && !/READ_ONLY/.test(k) && v) return v; return ""; };
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || envEnd("_REST_API_URL") || envEnd("_REDIS_REST_URL");
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || envEnd("_REST_API_TOKEN") || envEnd("_REDIS_REST_TOKEN");
const INVITE_ENV = process.env.INVITE_CODE || "";   // если не задан — код приглашения задаёт первый зарегистрированный сотрудник (хранится как хеш)
const SECRET = process.env.SESSION_SECRET || (TOK ? crypto.createHash("sha256").update("finkz-session|" + TOK).digest("hex") : "");
const P = "finkz:";
const TTL_DAYS = 14, WIN = 900, MAX_LOGIN = 5, MAX_IP = 30;
const PART = 3000000;   // длина одной части (base64), чтобы уложиться в лимит запроса Vercel 4,5 МБ

async function redis(cmds) {
  const r = await fetch(URL_.replace(/\/$/, "") + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("хранилище ответило " + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const one = async (...c) => (await redis([c]))[0];
const hmac = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const normLogin = s => String(s || "").trim().toLowerCase();
const validLogin = s => /^[a-z0-9а-яё._@-]{3,40}$/i.test(s);
const b64ok = (s, max) => typeof s === "string" && s.length <= max && /^[A-Za-z0-9+/=]*$/.test(s);
const wrapOk = w => w && b64ok(w.iv, 40) && b64ok(w.ct, 200);
const idOk = s => typeof s === "string" && /^[a-z0-9]{4,40}$/i.test(s);
const scryptHash = (key, salt) => new Promise((ok, no) => crypto.scrypt(Buffer.from(key, "base64"), Buffer.from(salt, "base64"), 32, { N: 16384, r: 8, p: 1 }, (e, d) => (e ? no(e) : ok(d.toString("base64")))));
const fakeSalt = (l, k) => crypto.createHmac("sha256", SECRET).update(k + "|" + l).digest().subarray(0, 16).toString("base64");
function token(login, ver) { const p = Buffer.from(JSON.stringify({ l: login, v: ver || 0, e: Date.now() + TTL_DAYS * 864e5 })).toString("base64url"); return p + "." + hmac(p); }
function readToken(req) {
  const t = String(req.headers["x-finkz-token"] || ""), [p, s] = t.split(".");
  if (!p || !s || !eq(hmac(p), s)) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.e > Date.now() ? o : null; } catch (e) { return null; }
}
const ipOf = req => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
async function blocked(login, ip) {
  const [a, b] = await redis([["GET", P + "fail:l:" + login], ["GET", P + "fail:ip:" + ip]]);
  return (+a || 0) >= MAX_LOGIN || (+b || 0) >= MAX_IP;
}
async function fail(login, ip) {
  const c = []; if (login) c.push(["INCR", P + "fail:l:" + login], ["EXPIRE", P + "fail:l:" + login, WIN]);
  c.push(["INCR", P + "fail:ip:" + ip], ["EXPIRE", P + "fail:ip:" + ip, WIN]); await redis(c);
}
const TOO_MANY = "Слишком много неудачных попыток. Попробуйте через 15 минут.";
// администратор — первый зарегистрированный сотрудник; он может восстановить доступ коллеге, забывшему пароль
// (ключ данных каждого сотрудника дополнительно «завёрнут» открытым ключом администратора; закрытый ключ хранится у администратора зашифрованным)
async function adminLogin() {
  const a = await one("GET", P + "admin"); if (a) return a;
  const users = (await one("SMEMBERS", P + "users")) || []; if (!users.length) return null;
  const recs = await redis(users.map(l => ["GET", P + "user:" + l])); let best = null;
  recs.forEach((r, i) => { if (!r) return; const o = JSON.parse(r); if (!best || (o.t || 0) < best.t) best = { l: users[i], t: o.t || 0 }; });
  if (!best) return null; await one("SET", P + "admin", best.l, "NX"); return one("GET", P + "admin");
}
async function adminInfo(l, r) {
  const adm = await adminLogin(), ks = await one("GET", P + "adminkeys"), k = ks ? JSON.parse(ks) : null;
  return { admin: l === adm, adminPub: k ? k.pub : null, hasEscrow: !!(r && r.ewrap), adminPriv: l === adm && k ? k.priv : null };
}
const userKey = l => P + "user:" + l, metaKey = l => P + "u:" + l + ":meta", partKey = (l, id, i) => P + "u:" + l + ":c:" + id + ":" + i;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const send = (code, o) => res.status(code).json(o);
  const configured = !!(URL_ && TOK);
  const invHash = s => crypto.createHash("sha256").update("finkz-invite|" + String(s || "")).digest("base64");
  const inviteOk = async s => (INVITE_ENV ? eq(s || "", INVITE_ENV) : eq(invHash(s), (await one("GET", P + "invite")) || "-"));
  try {
    if (req.method === "GET") {   // состояние + диагностика (только названия найденных переменных, без значений)
      const envNames = Object.keys(process.env).filter(k => /(KV|REDIS|UPSTASH|STORAGE)/i.test(k)).sort();
      let firstUser = false, redisErr = "";
      if (configured) { try { firstUser = !INVITE_ENV && !(await one("GET", P + "invite")); } catch (e) { redisErr = e.message; } }
      return send(200, { ok: true, configured: configured && !redisErr, partSize: PART, mode: "personal", firstUser, diag: { url: !!URL_, token: !!TOK, envNames, redisErr } });
    }
    if (req.method !== "POST") return send(405, { ok: false, error: "Только GET/POST" });
    if (!configured) return send(503, { ok: false, error: "Хранилище не настроено: подключите Upstash Redis в Vercel" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const a = b.a, ip = ipOf(req);

    if (a === "salt" || a === "rsalt") {   // соль пароля / кода восстановления (для чужого логина — поддельная)
      const l = normLogin(b.login); if (!validLogin(l)) return send(400, { ok: false, error: "Логин: 3–40 знаков (буквы, цифры, . _ - @)" });
      const u = await one("GET", userKey(l)), r = u ? JSON.parse(u) : null;
      return send(200, { ok: true, salt: r ? (a === "salt" ? r.salt : r.rsalt) : fakeSalt(l, a) });
    }
    if (a === "register") {
      if (await blocked("", ip)) return send(429, { ok: false, error: TOO_MANY });
      let firstInvite = false;
      if (!INVITE_ENV && !(await one("GET", P + "invite"))) {   // первый сотрудник задаёт код приглашения для коллег
        if (String(b.invite || "").length < 6) return send(400, { ok: false, error: "Код приглашения — не меньше 6 знаков" });
        firstInvite = !!(await one("SET", P + "invite", invHash(b.invite), "NX"));
      }
      if (!firstInvite && !(await inviteOk(b.invite))) { await fail("", ip); return send(403, { ok: false, error: "Неверный код приглашения" }); }
      const l = normLogin(b.login); if (!validLogin(l)) return send(400, { ok: false, error: "Логин: 3–40 знаков (буквы, цифры, . _ - @)" });
      if (!b64ok(b.auth, 100) || !b64ok(b.salt, 40) || !wrapOk(b.wrap) || !b64ok(b.rauth, 100) || !b64ok(b.rsalt, 40) || !wrapOk(b.rwrap)) return send(400, { ok: false, error: "Неверные данные" });
      const hs = crypto.randomBytes(16).toString("base64"), rhs = crypto.randomBytes(16).toString("base64");
      const rec = { login: l, name: String(b.name || "").slice(0, 80), salt: b.salt, hs, h: await scryptHash(b.auth, hs), wrap: b.wrap,
        rsalt: b.rsalt, rhs, rh: await scryptHash(b.rauth, rhs), rwrap: b.rwrap, ver: 1, t: Date.now() };
      if (!(await one("SET", userKey(l), JSON.stringify(rec), "NX"))) return send(409, { ok: false, error: "Такой логин уже занят" });
      await one("SADD", P + "users", l);
      return send(200, { ok: true, token: token(l, rec.ver), wrap: rec.wrap, name: rec.name, ...(await adminInfo(l, rec)) });
    }
    if (a === "login" || a === "recover") {   // recover: по коду восстановления — выдаёт ключ, завёрнутый кодом, и (с новым паролем) меняет пароль
      const l = normLogin(b.login);
      if (!validLogin(l)) return send(403, { ok: false, error: "Неверный логин или пароль" });
      if (await blocked(l, ip)) return send(429, { ok: false, error: TOO_MANY });
      const u = await one("GET", userKey(l)), r = u ? JSON.parse(u) : null;
      const good = r && (a === "login" ? b64ok(b.auth, 100) && eq(await scryptHash(b.auth, r.hs), r.h) : b64ok(b.rauth, 100) && eq(await scryptHash(b.rauth, r.rhs), r.rh));
      if (!good) { await fail(l, ip); return send(403, { ok: false, error: a === "login" ? "Неверный логин или пароль" : "Неверный логин или код восстановления" }); }
      await one("DEL", P + "fail:l:" + l);
      if (a === "login") return send(200, { ok: true, token: token(l, r.ver), wrap: r.wrap, name: r.name || "", ...(await adminInfo(l, r)) });
      if (!b.auth) return send(200, { ok: true, rwrap: r.rwrap });
      if (!b64ok(b.auth, 100) || !b64ok(b.salt, 40) || !wrapOk(b.wrap)) return send(400, { ok: false, error: "Неверные данные" });
      r.hs = crypto.randomBytes(16).toString("base64"); r.h = await scryptHash(b.auth, r.hs); r.salt = b.salt; r.wrap = b.wrap; r.ver = (r.ver || 1) + 1;
      await one("SET", userKey(l), JSON.stringify(r));
      return send(200, { ok: true, token: token(l, r.ver), name: r.name || "", ...(await adminInfo(l, r)) });
    }
    // сброс пароля через администратора: запрос (сотрудник) → подтверждение (администратор) → завершение (сотрудник)
    if (a === "resetreq" || a === "resetpoll" || a === "resetfinish") {
      const l = normLogin(b.login);
      if (!validLogin(l)) return send(400, { ok: false, error: "Неверный логин" });
      if (await blocked(l, ip)) return send(429, { ok: false, error: TOO_MANY });
      const u = await one("GET", userKey(l)), r = u ? JSON.parse(u) : null;
      if (a === "resetreq") {
        if (!r) { await fail("", ip); return send(404, { ok: false, error: "Такого логина нет" }); }
        if (!r.ewrap) return send(409, { ok: false, error: "Для этой учётной записи восстановление через администратора ещё не настроено — войдите хотя бы раз после обновления сайта или используйте код восстановления" });
        if (!b64ok(b.auth, 100) || !b64ok(b.salt, 40) || !b64ok(b.epub, 1000)) return send(400, { ok: false, error: "Неверные данные" });
        const hs = crypto.randomBytes(16).toString("base64"), code = String(crypto.randomInt(100000, 1000000));
        const rec = { login: l, name: r.name || "", salt: b.salt, hs, h: await scryptHash(b.auth, hs), epub: b.epub, code, t: Date.now() };
        await redis([["SET", P + "reset:" + l, JSON.stringify(rec), "EX", 259200], ["SADD", P + "resets", l]]);
        return send(200, { ok: true, code });
      }
      const q = await one("GET", P + "reset:" + l), R = q ? JSON.parse(q) : null;
      if (!R || !b64ok(b.auth, 100) || !eq(await scryptHash(b.auth, R.hs), R.h)) { await fail(l, ip); return send(404, { ok: false, error: "Запрос не найден или устарел — отправьте его заново" }); }
      if (a === "resetpoll") return send(200, { ok: true, grant: R.grant || null });
      if (!R.grant || !r || !wrapOk(b.wrap)) return send(409, { ok: false, error: "Администратор ещё не подтвердил запрос" });
      r.hs = R.hs; r.h = R.h; r.salt = R.salt; r.wrap = b.wrap; r.ver = (r.ver || 1) + 1;
      await redis([["SET", userKey(l), JSON.stringify(r)], ["DEL", P + "reset:" + l], ["SREM", P + "resets", l], ["DEL", P + "fail:l:" + l]]);
      return send(200, { ok: true, token: token(l, r.ver), wrap: r.wrap, name: r.name || "", ...(await adminInfo(l, r)) });
    }

    // дальше — только с действующим входом (после смены пароля старые входы на других устройствах прекращаются)
    const tk = readToken(req); if (!tk) return send(401, { ok: false, error: "Войдите заново" });
    const me = tk.l, uRaw = await one("GET", userKey(me));
    if (!uRaw) return send(401, { ok: false, error: "Учётная запись удалена" });
    const U = JSON.parse(uRaw); if ((U.ver || 1) !== (tk.v || 1)) return send(401, { ok: false, error: "Пароль был изменён — войдите заново" });

    if (a === "passwd" || a === "deluser") {
      if (await blocked(me, ip)) return send(429, { ok: false, error: TOO_MANY });
      if (!b64ok(b.authOld || "", 100) || !eq(await scryptHash(b.authOld, U.hs), U.h)) { await fail(me, ip); return send(403, { ok: false, error: "Неверный текущий пароль" }); }
      if (a === "deluser") {
        const h = (await one("HGETALL", metaKey(me))) || [], cmds = [];
        for (let i = 0; i < h.length; i += 2) { const m = JSON.parse(h[i + 1]); for (let p = 0; p < (m.n || 1); p++) cmds.push(["DEL", partKey(me, h[i], p)]); }
        cmds.push(["DEL", metaKey(me)], ["DEL", userKey(me)], ["SREM", P + "users", me]);
        await redis(cmds); return send(200, { ok: true });
      }
      if (!b64ok(b.auth, 100) || !b64ok(b.salt, 40) || !wrapOk(b.wrap)) return send(400, { ok: false, error: "Неверные данные" });
      U.hs = crypto.randomBytes(16).toString("base64"); U.h = await scryptHash(b.auth, U.hs); U.salt = b.salt; U.wrap = b.wrap; U.ver = (U.ver || 1) + 1;
      await one("SET", userKey(me), JSON.stringify(U));
      return send(200, { ok: true, token: token(me, U.ver) });
    }
    if (a === "escrow") {   // ключ данных, завёрнутый открытым ключом администратора
      if (!b64ok(b.ewrap, 800)) return send(400, { ok: false, error: "Неверные данные" });
      U.ewrap = b.ewrap; await one("SET", userKey(me), JSON.stringify(U)); return send(200, { ok: true });
    }
    const isAdm = async () => me === (await adminLogin());
    if (a === "setadmin") {
      if (!(await isAdm())) return send(403, { ok: false, error: "Только для администратора" });
      if (!b64ok(b.pub, 1000) || !b.priv || !b64ok(b.priv.iv, 40) || !b64ok(b.priv.ct, 4000)) return send(400, { ok: false, error: "Неверные данные" });
      const ok = await one("SET", P + "adminkeys", JSON.stringify({ pub: b.pub, priv: b.priv, t: Date.now() }), "NX");
      return send(200, { ok: !!ok });
    }
    if (a === "resetlist" || a === "resetgrant" || a === "resetdeny") {
      if (!(await isAdm())) return send(403, { ok: false, error: "Только для администратора" });
      if (a === "resetlist") {
        const ls = (await one("SMEMBERS", P + "resets")) || []; if (!ls.length) return send(200, { ok: true, list: [] });
        const rs = await redis(ls.map(l => ["GET", P + "reset:" + l])), us = await redis(ls.map(l => ["GET", userKey(l)])), list = [], gone = [];
        ls.forEach((l, i) => { if (!rs[i] || !us[i]) { gone.push(l); return; } const R = JSON.parse(rs[i]), u = JSON.parse(us[i]); list.push({ login: l, name: R.name, code: R.code, t: R.t, granted: !!R.grant, epub: R.epub, ewrap: u.ewrap || null }); });
        if (gone.length) await redis(gone.map(l => ["SREM", P + "resets", l]));
        return send(200, { ok: true, list });
      }
      const l = normLogin(b.login), q = await one("GET", P + "reset:" + l); if (!q) return send(404, { ok: false, error: "Запрос не найден" });
      if (a === "resetdeny") { await redis([["DEL", P + "reset:" + l], ["SREM", P + "resets", l]]); return send(200, { ok: true }); }
      if (!b64ok(b.grant, 800)) return send(400, { ok: false, error: "Неверные данные" });
      const R = JSON.parse(q); R.grant = b.grant; await one("SET", P + "reset:" + l, JSON.stringify(R), "EX", 86400);
      return send(200, { ok: true });
    }
    if (a === "list") {
      const h = (await one("HGETALL", metaKey(me))) || [], meta = {};
      for (let i = 0; i < h.length; i += 2) meta[h[i]] = JSON.parse(h[i + 1]);
      return send(200, { ok: true, me, meta, ...(await adminInfo(me, U)) });
    }
    if (a === "get") {
      if (!idOk(b.id)) return send(400, { ok: false, error: "Неверный id" });
      return send(200, { ok: true, data: await one("GET", partKey(me, b.id, Math.max(0, b.part | 0))) });
    }
    if (a === "put") {
      if (!idOk(b.id) || !b64ok(b.data, PART + 100)) return send(400, { ok: false, error: "Неверные данные" });
      const p = b.part | 0, n = b.n | 0, u = +b.u || Date.now();
      if (p < 0 || n < 1 || n > 40 || p >= n) return send(400, { ok: false, error: "Неверные части" });
      const cmds = [["SET", partKey(me, b.id, p), b.data]];
      if (p === n - 1) {
        const old = await one("HGET", metaKey(me), b.id), on = old ? JSON.parse(old).n || 1 : 0;
        for (let i = n; i < on; i++) cmds.push(["DEL", partKey(me, b.id, i)]);
        cmds.push(["HSET", metaKey(me), b.id, JSON.stringify({ u, n, t: Date.now(), size: (n - 1) * PART + b.data.length })]);
      }
      await redis(cmds); return send(200, { ok: true });
    }
    if (a === "del") {
      if (!idOk(b.id)) return send(400, { ok: false, error: "Неверный id" });
      const old = await one("HGET", metaKey(me), b.id), on = old ? JSON.parse(old).n || 1 : 1, cmds = [];
      for (let i = 0; i < on; i++) cmds.push(["DEL", partKey(me, b.id, i)]);
      cmds.push(["HSET", metaKey(me), b.id, JSON.stringify({ u: Date.now(), del: true, t: Date.now() })]);
      await redis(cmds); return send(200, { ok: true });
    }
    return send(400, { ok: false, error: "Неизвестное действие" });
  } catch (e) {
    return send(500, { ok: false, error: "Ошибка сервера: " + e.message });
  }
};
