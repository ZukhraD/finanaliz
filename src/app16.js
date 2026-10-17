"use strict";
/* ---------------------------------------------------------------- Общая база отдела (вход сотрудника, синхронизация между устройствами).
   Данные клиентов шифруются здесь, в браузере, ключом отдела (AES-GCM 256). Ключ выводится из кодового слова отдела
   (PBKDF2, 600 000 итераций) и на сервер не уходит; на сервере он хранится только «завёрнутым» в личный ключ сотрудника,
   который выводится из его пароля. Пароль на сервер тоже не уходит — только производный «ключ входа».
   Локальная копия в браузере остаётся (работа без интернета); изменения отправляются на сервер автоматически. */
const CLOUD = { cfg: null, token: "", login: "", name: "", key: null, synced: {}, meta: {}, busy: false, last: null, err: "", users: 0, queued: false };
const CL_STORE = "finkz.cloud.v1", KDF_IT = 600000;
const clSave = () => { try { localStorage.setItem(CL_STORE, JSON.stringify({ token: CLOUD.token, login: CLOUD.login, name: CLOUD.name, synced: CLOUD.synced })); } catch (e) { /* без запоминания */ } };
try { Object.assign(CLOUD, JSON.parse(localStorage.getItem(CL_STORE) || "{}")); } catch (e) { /* нет сессии */ }
const cloudOn = () => !!(CLOUD.token && CLOUD.key);

/* --- ключ отдела в IndexedDB (неизвлекаемый CryptoKey: прочитать «сырой» ключ из браузера нельзя) */
function idb() { return new Promise((ok, no) => { const r = indexedDB.open("finkz", 1); r.onupgradeneeded = () => r.result.createObjectStore("keys"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
async function idbKey(op, v) {
  const db = await idb();
  return new Promise((ok, no) => {
    const tx = db.transaction("keys", op === "get" ? "readonly" : "readwrite"), st = tx.objectStore("keys");
    const r = op === "get" ? st.get("dept") : op === "put" ? st.put(v, "dept") : st.delete("dept");
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}

/* --- криптография */
const te = new TextEncoder(), td = new TextDecoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
async function pbkdf2(secret, salt, label) {
  const base = await crypto.subtle.importKey("raw", te.encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: cat(salt, te.encode("|" + label)), iterations: KDF_IT, hash: "SHA-256" }, base, 256));
}
const aesKey = (raw, use) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, use);
async function aesEnc(key, u8) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, u8))) }; }
async function aesDec(key, o) { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.ct))); }
async function gz(u8, inflate) {
  if (typeof CompressionStream === "undefined") return u8;
  const s = new Blob([u8]).stream().pipeThrough(inflate ? new DecompressionStream("gzip") : new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function packClient(c) {   // JSON → gzip → AES-GCM → base64 (iv + шифртекст)
  const z = await gz(te.encode(JSON.stringify(c))), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, CLOUD.key, cat(new Uint8Array([typeof CompressionStream === "undefined" ? 0 : 1]), z)));
  return b64(cat(iv, ct));
}
async function unpackClient(s) {
  const u = unb64(s), pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12) }, CLOUD.key, u.subarray(12)));
  const body = pt.subarray(1);
  return JSON.parse(td.decode(pt[0] ? await gz(body, true) : body));
}

/* --- запросы к серверу */
async function api(a, body = {}) {
  const r = await fetch("/api/cloud", { method: "POST", headers: { "Content-Type": "application/json", "X-Finkz-Token": CLOUD.token || "" }, body: JSON.stringify({ a, ...body }) });
  const j = await r.json().catch(() => ({ ok: false, error: "сервер недоступен (" + r.status + ")" }));
  if (r.status === 401) { cloudLogout(true); }
  if (!j.ok) throw new Error(j.error || "ошибка " + r.status);
  return j;
}
async function cloudCfg() {
  if (location.protocol === "file:") return (CLOUD.cfg = { configured: false, offline: true });
  try { const r = await fetch("/api/cloud", { cache: "no-store" }); CLOUD.cfg = await r.json(); } catch (e) { CLOUD.cfg = { configured: false, error: e.message }; }
  return CLOUD.cfg;
}

/* --- вход и регистрация */
async function cloudRegister({ login, name, pass, invite, phrase }) {
  const cfg = await cloudCfg(); if (!cfg.configured) throw new Error(tr("Общая база не настроена на сервере"));
  let raw, deptInit = null;
  const d = (await api("dept", { invite })).dept;
  if (d) {
    raw = await pbkdf2(phrase, unb64(d.salt), "dept");
    try { await aesDec(await aesKey(raw, ["decrypt"]), d.check); } catch (e) { throw new Error(tr("Неверное кодовое слово отдела")); }
  } else {
    const salt = crypto.getRandomValues(new Uint8Array(16)); raw = await pbkdf2(phrase, salt, "dept");
    deptInit = { salt: b64(salt), check: await aesEnc(await aesKey(raw, ["encrypt"]), te.encode("finkz-dept-ok")) };
  }
  const usalt = crypto.getRandomValues(new Uint8Array(16));
  const auth = await pbkdf2(pass, usalt, "auth"), kek = await aesKey(await pbkdf2(pass, usalt, "kek"), ["encrypt"]);
  const j = await api("register", { login, name, invite, auth: b64(auth), salt: b64(usalt), wrap: await aesEnc(kek, raw), deptInit });
  await cloudStart(j, raw, login);
}
async function cloudLogin({ login, pass }) {
  const cfg = await cloudCfg(); if (!cfg.configured) throw new Error(tr("Общая база не настроена на сервере"));
  const usalt = unb64((await api("salt", { login })).salt);
  const auth = await pbkdf2(pass, usalt, "auth");
  const j = await api("login", { login, auth: b64(auth) });
  const kek = await aesKey(await pbkdf2(pass, usalt, "kek"), ["decrypt"]);
  let raw; try { raw = await aesDec(kek, j.wrap); } catch (e) { throw new Error(tr("Не удалось расшифровать ключ отдела")); }
  await cloudStart(j, raw, login);
}
async function cloudStart(j, raw, login) {
  CLOUD.key = await aesKey(raw, ["encrypt", "decrypt"]); raw.fill(0);
  CLOUD.token = j.token; CLOUD.login = String(login).trim().toLowerCase(); CLOUD.name = j.name || ""; CLOUD.synced = {};
  try { await idbKey("put", CLOUD.key); } catch (e) { /* ключ только на эту вкладку */ }
  clSave(); await cloudSync(true);
}
function cloudLogout(expired) {
  CLOUD.token = ""; CLOUD.key = null; CLOUD.meta = {}; CLOUD.synced = {}; clSave();
  idbKey("del").catch(() => {});
  if (expired) toast(tr("Сессия общей базы истекла — войдите заново"));
}
async function cloudPasswd(oldPass, newPass) {
  const usalt0 = unb64((await api("salt", { login: CLOUD.login })).salt);
  const authOld = await pbkdf2(oldPass, usalt0, "auth");
  const kekOld = await aesKey(await pbkdf2(oldPass, usalt0, "kek"), ["decrypt"]);
  const j0 = await api("login", { login: CLOUD.login, auth: b64(authOld) });
  const raw = await aesDec(kekOld, j0.wrap);
  const usalt = crypto.getRandomValues(new Uint8Array(16));
  const auth = await pbkdf2(newPass, usalt, "auth"), kek = await aesKey(await pbkdf2(newPass, usalt, "kek"), ["encrypt"]);
  const j = await api("passwd", { authOld: b64(authOld), auth: b64(auth), salt: b64(usalt), wrap: await aesEnc(kek, raw) });
  raw.fill(0); CLOUD.token = j.token; clSave();
}

/* --- синхронизация */
async function cloudGet(id, n) {
  let s = ""; for (let p = 0; p < (n || 1); p++) { const j = await api("get", { id, part: p }); if (j.data == null) throw new Error("нет части " + p); s += j.data; }
  return unpackClient(s);
}
async function cloudPut(c) {
  const s = await packClient(c), P = (CLOUD.cfg && CLOUD.cfg.partSize) || 3000000, n = Math.max(1, Math.ceil(s.length / P));
  for (let p = 0; p < n; p++) await api("put", { id: c.id, u: c.updated, part: p, n, data: s.slice(p * P, (p + 1) * P) });
  CLOUD.synced[c.id] = c.updated;
}
async function cloudSync(force) {
  if (!cloudOn() || CLOUD.busy) { if (CLOUD.busy) CLOUD.queued = true; return; }
  if (LOCK.on && !LOCK.key) return;
  CLOUD.busy = true; CLOUD.err = ""; paintCloud();
  let got = 0, sent = 0, gone = 0;
  try {
    if (!CLOUD.cfg) await cloudCfg();
    const L = await api("list"); CLOUD.meta = L.meta || {}; CLOUD.users = L.users || 0;
    // с сервера: новые и изменённые клиенты, удаления
    for (const [id, m] of Object.entries(CLOUD.meta)) {
      const i = CLIENTS.findIndex(c => c.id === id), loc = i >= 0 ? CLIENTS[i] : null;
      if (m.del) {
        if (loc && (loc.updated || 0) <= m.u) { CLIENTS.splice(i, 1); if (C && C.id === id) { C = null; toast(tr("Клиент удалён другим сотрудником")); } gone++; }
        delete CLOUD.synced[id]; continue;
      }
      if (!loc && CLOUD.synced[id] && m.u <= CLOUD.synced[id]) continue;   // удалён здесь — удалится на сервере ниже
      if (loc && (loc.updated || 0) >= m.u) { if (!CLOUD.synced[id] && loc.updated === m.u) CLOUD.synced[id] = m.u; continue; }
      const c = await cloudGet(id, m.n);
      c.updated = m.u; c.cloudBy = m.by;
      if (i >= 0) { CLIENTS[i] = c; if (C && C.id === id) { C = c; CACHE.clear(); toast(tr("Клиент обновлён с другого устройства")); } } else CLIENTS.push(c);
      CLOUD.synced[id] = m.u; got++;
    }
    // на сервер: локальные изменения и новые клиенты (пример «Тест-Агро» не отправляется)
    for (const c of CLIENTS.slice()) {
      if (c.demo) continue;
      const m = CLOUD.meta[c.id];
      if (m && !m.del && (c.updated || 0) <= m.u) continue;
      if ((c.updated || 0) <= (CLOUD.synced[c.id] || 0) && m && !m.del) continue;
      if (!c.updated) c.updated = Date.now();
      await cloudPut(c); sent++;
    }
    // удалённые здесь — удалить и на сервере
    for (const id of Object.keys(CLOUD.synced)) if (!CLIENTS.some(c => c.id === id) && CLOUD.meta[id] && !CLOUD.meta[id].del) { await api("del", { id }); delete CLOUD.synced[id]; }
    CLOUD.last = new Date(); clSave();
    if (got || gone) { saveAllLocal(true); render(); }
    if (force && (got || sent)) toast(tr("Общая база: получено {0}, отправлено {1}").replace("{0}", got).replace("{1}", sent));
  } catch (e) { CLOUD.err = e.message; }
  CLOUD.busy = false; paintCloud();
  if (CLOUD.queued) { CLOUD.queued = false; setTimeout(cloudSync, 500); }
}
// сохранение: как раньше (в браузере) + отправка на сервер через 2,5 с после последнего изменения
const saveAllLocal = saveAll;
let cloudT = null;
saveAll = function (now) { saveAllLocal(now); if (cloudOn()) { clearTimeout(cloudT); cloudT = setTimeout(cloudSync, now ? 300 : 2500); } };
setInterval(() => { if (cloudOn() && !document.hidden) cloudSync(); }, 60000);
window.addEventListener("focus", () => { if (cloudOn()) cloudSync(); });

/* --- интерфейс */
function cloudStatus() {
  if (!cloudOn()) return "";
  if (CLOUD.busy) return tr("Синхронизация…");
  if (CLOUD.err) return tr("Общая база: нет связи") + " (" + CLOUD.err + ")";
  return CLOUD.last ? tr("Общая база: синхронизировано") + " " + dTime(CLOUD.last) : tr("Общая база подключена");
}
function paintCloud() {
  const t = cloudStatus();
  document.querySelectorAll("[data-cloudst]").forEach(el => { el.textContent = t; el.classList.toggle("bad", !!CLOUD.err); });
}
function cloudHeaderHTML() {
  if (location.protocol === "file:") return "";
  return cloudOn()
    ? `<span class="cloudchip" title="${esc(tr("Данные клиентов хранятся на сервере в зашифрованном виде и доступны с любого устройства после входа"))}">☁ <b data-nt>${esc(CLOUD.name || CLOUD.login)}</b> <span data-cloudst class="small">${esc(cloudStatus())}</span></span><button class="btn ghost" data-act="cloudsync">Синхронизировать</button><button class="btn ghost" data-act="cloudpw">Сменить пароль</button><button class="btn ghost" data-act="cloudout">Выйти</button>`
    : `<button class="btn ghost" data-act="cloudin">Войти / Регистрация</button>`;
}
async function cloudDialog(mode = "in") {
  const cfg = CLOUD.cfg || await cloudCfg();
  if (!cfg.configured) { await dialog("Общая база отдела", `<p>${cfg.offline ? "Файл открыт с компьютера — общая база работает только на сайте." : "Общая база ещё не подключена на сервере. Администратору: в Vercel → Storage подключить Upstash Redis и задать переменную INVITE_CODE (код приглашения), затем Redeploy."}</p>`, [{ t: "Понятно", primary: true, v: true }]); return; }
  const first = !cfg.deptInit;
  const reg = mode === "reg";
  const body = `<div class="tabs" role="tablist" style="margin-bottom:12px"><button role="tab" aria-selected="${!reg}" data-cltab="in">Вход</button><button role="tab" aria-selected="${reg}" data-cltab="reg">Регистрация сотрудника</button></div>
    ${reg ? `<p class="hint">Нужны код приглашения (выдаёт администратор) и кодовое слово отдела${first ? " — <b>вы первый сотрудник: придумайте кодовое слово отдела</b> и передайте его коллегам лично. Восстановить его нельзя" : ""}. Кодовое слово шифрует данные клиентов и на сервер не отправляется.</p>` : `<p class="hint">После входа клиенты отдела загрузятся на это устройство, а ваши изменения будут сохраняться на сервере в зашифрованном виде.</p>`}
    <div class="grid2" style="margin-top:8px">
      <label class="f"><span>Логин</span><input class="inp" id="clL" autocomplete="username" value="${esc(CLOUD.login || "")}"></label>
      ${reg ? `<label class="f"><span>Имя и фамилия</span><input class="inp" id="clN" autocomplete="name"></label>` : ""}
      <label class="f"><span>Пароль${reg ? " (не меньше 8 знаков)" : ""}</span><input class="inp" id="clP" type="password" autocomplete="${reg ? "new-password" : "current-password"}"></label>
      ${reg ? `<label class="f"><span>Повторите пароль</span><input class="inp" id="clP2" type="password" autocomplete="new-password"></label>
      <label class="f"><span>Код приглашения</span><input class="inp" id="clI" autocomplete="off"></label>
      <label class="f"><span>Кодовое слово отдела${first ? " (новое, не меньше 10 знаков)" : ""}</span><input class="inp" id="clW" type="password" autocomplete="off"></label>
      ${first ? `<label class="f"><span>Повторите кодовое слово</span><input class="inp" id="clW2" type="password" autocomplete="off"></label>` : ""}` : ""}
    </div><p class="lockmsg" id="clMsg"></p>`;
  const r = await dialog("Общая база отдела", body, [{ t: "Отменить", v: null }, { t: reg ? "Зарегистрироваться" : "Войти", primary: true, keep: true, v: async dlg => {
    const g = id => (dlg.querySelector("#" + id) || {}).value || "", msg = dlg.querySelector("#clMsg");
    const f = { login: g("clL").trim(), name: g("clN").trim(), pass: g("clP"), invite: g("clI").trim(), phrase: g("clW") };
    if (reg) {
      if (f.pass.length < 8) { msg.textContent = tr("Пароль — не меньше 8 знаков"); return false; }
      if (f.pass !== g("clP2")) { msg.textContent = tr("Пароли не совпадают"); return false; }
      if (first && (f.phrase.length < 10 || f.phrase !== g("clW2"))) { msg.textContent = tr("Кодовое слово — не меньше 10 знаков, оба раза одинаково"); return false; }
      if (!f.phrase || !f.invite) { msg.textContent = tr("Заполните код приглашения и кодовое слово"); return false; }
    }
    msg.textContent = tr("Проверяю… (шифрование занимает несколько секунд)");
    try { if (reg) await cloudRegister(f); else await cloudLogin(f); return true; } catch (e) { msg.textContent = e.message; return false; }
  } }]);
  if (r) { toast(tr("Вход выполнен")); render(); }
}
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-cltab]");
  if (t) { e.preventDefault(); const d = document.getElementById("dlg"); if (d && d.open) { d.close(); } cloudDialog(t.dataset.cltab); return; }
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "cloudin") cloudDialog("in");
  else if (a === "cloudsync") cloudSync(true);
  else if (a === "cloudout") {
    if (await dialog("Выйти из общей базы?", "<p>Клиенты останутся в этом браузере, но перестанут синхронизироваться. Чтобы на чужом компьютере ничего не осталось, отметьте пункт ниже.</p><label class=\"chk\"><input type=\"checkbox\" id=\"clWipe\"> Удалить клиентов отдела из этого браузера</label>", [{ t: "Отменить", v: false }, { t: "Выйти", primary: true, v: d => ({ wipe: d.querySelector("#clWipe").checked }) }]).then(r => { if (r && r.wipe) { const ids = new Set(Object.keys(CLOUD.meta)); CLIENTS = CLIENTS.filter(c => !ids.has(c.id)); C = null; saveAllLocal(true); } return r; })) { cloudLogout(); render(); toast(tr("Вы вышли из общей базы")); }
  } else if (a === "cloudpw") {
    const r = await dialog("Сменить пароль", `<div class="grid2"><label class="f"><span>Текущий пароль</span><input class="inp" id="cp0" type="password" autocomplete="current-password"></label><label class="f"><span>Новый пароль (не меньше 8 знаков)</span><input class="inp" id="cp1" type="password" autocomplete="new-password"></label><label class="f"><span>Повторите новый</span><input class="inp" id="cp2" type="password" autocomplete="new-password"></label></div>`, [{ t: "Отменить", v: null }, { t: "Сменить", primary: true, v: d => ({ o: d.querySelector("#cp0").value, a: d.querySelector("#cp1").value, b: d.querySelector("#cp2").value }) }]);
    if (!r) return;
    if (r.a.length < 8 || r.a !== r.b) { toast(tr("Новый пароль — не меньше 8 знаков, оба раза одинаково")); return; }
    try { await cloudPasswd(r.o, r.a); toast(tr("Пароль изменён")); } catch (err) { toast(err.message); }
  }
});
// восстановление сессии при открытии сайта
(async () => {
  if (!CLOUD.token || location.protocol === "file:") return;
  try { CLOUD.key = await idbKey("get") || null; } catch (e) { CLOUD.key = null; }
  if (!CLOUD.key) { CLOUD.token = ""; clSave(); return; }
  await cloudCfg(); render(); cloudSync();
})();
