"use strict";
/* ---------------------------------------------------------------- Личная облачная база сотрудника (вход с любого устройства).
   У каждого сотрудника — только свои клиенты. Данные шифруются здесь, в браузере, личным ключом (AES-GCM 256, случайный).
   На сервере ключ хранится только «завёрнутым»: паролем и кодом восстановления (PBKDF2, 600 000 итераций) — ни пароль,
   ни код на сервер не уходят. Локальная копия в браузере остаётся (работа без интернета); изменения отправляются сами.
   На общем компьютере при выходе клиенты сотрудника удаляются из браузера (если не выбрано «оставить копию»). */
const CLOUD = { cfg: null, token: "", login: "", name: "", key: null, synced: {}, meta: {}, busy: false, last: null, err: "", queued: false };
const CL_STORE = "finkz.cloud.v2", KDF_IT = 600000;
const clSave = () => { try { localStorage.setItem(CL_STORE, JSON.stringify({ token: CLOUD.token, login: CLOUD.login, name: CLOUD.name, synced: CLOUD.synced })); } catch (e) { /* без запоминания */ } };
try { Object.assign(CLOUD, JSON.parse(localStorage.getItem(CL_STORE) || "{}")); } catch (e) { /* нет сессии */ }
const cloudOn = () => !!(CLOUD.token && CLOUD.key);
// какие клиенты видны в этом браузере: свои (после входа), локальные без владельца, пример; чужие копии скрыты
const cloudVisible = c => c.demo || !c.owner || (cloudOn() ? c.owner === CLOUD.login : !!c.kept);
const cloudMine = c => !c.demo && (!c.owner || c.owner === CLOUD.login);

/* --- личный ключ в IndexedDB (неизвлекаемый CryptoKey: «сырой» ключ из браузера не прочитать) */
function idb() { return new Promise((ok, no) => { const r = indexedDB.open("finkz", 1); r.onupgradeneeded = () => r.result.createObjectStore("keys"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
async function idbKey(op, v) {
  const db = await idb();
  return new Promise((ok, no) => {
    const tx = db.transaction("keys", op === "get" ? "readonly" : "readwrite"), st = tx.objectStore("keys");
    const r = op === "get" ? st.get("user") : op === "put" ? st.put(v, "user") : st.delete("user");
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
  const s = new Blob([u8]).stream().pipeThrough(inflate ? new DecompressionStream("gzip") : new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const canGz = () => typeof CompressionStream !== "undefined";
async function packClient(c) {   // JSON → gzip → AES-GCM → base64 (iv + шифртекст)
  const raw = te.encode(JSON.stringify(c)), z = canGz() ? await gz(raw) : raw, iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, CLOUD.key, cat(new Uint8Array([canGz() ? 1 : 0]), z)));
  return b64(cat(iv, ct));
}
async function unpackClient(s) {
  const u = unb64(s), pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12) }, CLOUD.key, u.subarray(12)));
  return JSON.parse(td.decode(pt[0] ? await gz(pt.subarray(1), true) : pt.subarray(1)));
}
// код восстановления: 20 знаков (100 бит), без похожих букв
function newRecoveryCode() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(20)); let s = ""; r.forEach((x, i) => { s += A[x % 32]; if (i % 4 === 3 && i < 19) s += "-"; }); return s; }
const recCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");

/* --- запросы к серверу */
async function api(a, body = {}) {
  const r = await fetch("/api/cloud", { method: "POST", headers: { "Content-Type": "application/json", "X-Finkz-Token": CLOUD.token || "" }, body: JSON.stringify({ a, ...body }) });
  const j = await r.json().catch(() => ({ ok: false, error: "сервер недоступен (" + r.status + ")" }));
  if (r.status === 401 && CLOUD.token) { cloudLogout({ expired: j.error }); render(); }
  if (!j.ok) throw new Error(tr(j.error || "ошибка " + r.status));
  return j;
}
async function cloudCfg() {
  if (location.protocol === "file:") return (CLOUD.cfg = { configured: false, offline: true });
  try { const r = await fetch("/api/cloud", { cache: "no-store" }); const t = await r.text(); try { CLOUD.cfg = JSON.parse(t); } catch (e) { CLOUD.cfg = { configured: false, error: "HTTP " + r.status + ": " + t.slice(0, 200) }; } } catch (e) { CLOUD.cfg = { configured: false, error: e.message }; }
  return CLOUD.cfg;
}

/* --- вход, регистрация, восстановление */
async function passWrap(pass, raw) {   // → {auth, salt, wrap} для пароля
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { auth: b64(await pbkdf2(pass, salt, "auth")), salt: b64(salt), wrap: await aesEnc(await aesKey(await pbkdf2(pass, salt, "kek"), ["encrypt"]), raw) };
}
async function cloudRegister({ login, name, pass, invite }) {
  const cfg = await cloudCfg(); if (!cfg.configured) throw new Error(tr("Облачная база не настроена на сервере"));
  const raw = crypto.getRandomValues(new Uint8Array(32)), code = newRecoveryCode();
  const pw = await passWrap(pass, raw), rc = await passWrap(code, raw);
  const j = await api("register", { login, name, invite, ...pw, rauth: rc.auth, rsalt: rc.salt, rwrap: rc.wrap });
  await cloudStart(j, raw, login);
  return code;
}
async function cloudLogin({ login, pass }) {
  const cfg = await cloudCfg(); if (!cfg.configured) throw new Error(tr("Облачная база не настроена на сервере"));
  const salt = unb64((await api("salt", { login })).salt);
  const j = await api("login", { login, auth: b64(await pbkdf2(pass, salt, "auth")) });
  let raw; try { raw = await aesDec(await aesKey(await pbkdf2(pass, salt, "kek"), ["decrypt"]), j.wrap); } catch (e) { throw new Error(tr("Не удалось расшифровать личный ключ")); }
  await cloudStart(j, raw, login);
}
async function cloudRecover({ login, code, pass }) {
  const cfg = await cloudCfg(); if (!cfg.configured) throw new Error(tr("Облачная база не настроена на сервере"));
  code = recCode(code);
  const rsalt = unb64((await api("rsalt", { login })).salt), rauth = b64(await pbkdf2(code, rsalt, "auth"));
  const j0 = await api("recover", { login, rauth });
  let raw; try { raw = await aesDec(await aesKey(await pbkdf2(code, rsalt, "kek"), ["decrypt"]), j0.rwrap); } catch (e) { throw new Error(tr("Неверный логин или код восстановления")); }
  const j = await api("recover", { login, rauth, ...(await passWrap(pass, raw)) });
  await cloudStart(j, raw, login);
}
async function cloudStart(j, raw, login) {
  CLOUD.key = await aesKey(raw, ["encrypt", "decrypt"]); raw.fill(0);
  CLOUD.token = j.token; CLOUD.login = String(login).trim().toLowerCase(); CLOUD.name = j.name || ""; CLOUD.synced = {};
  try { await idbKey("put", CLOUD.key); } catch (e) { /* ключ только на эту вкладку */ }
  clSave(); await cloudSync(true);
}
function cloudLogout(o = {}) {
  const me = CLOUD.login;
  if (o.keep) CLIENTS.forEach(c => { if (c.owner === me) c.kept = true; });
  // синхронизированные — удаляются из браузера; неотправленные изменения не теряются: скрыты до следующего входа
  else if (me) { CLIENTS = CLIENTS.filter(c => c.owner !== me || (c.updated || 0) > (CLOUD.synced[c.id] || 0)); if (C && C.owner === me) C = null; }
  CLIENTS.forEach(c => { if (c.owner === me && !o.keep) c.kept = false; });
  if (C && !cloudVisible(C)) C = null;
  saveAllLocal(true);
  CLOUD.token = ""; CLOUD.key = null; CLOUD.meta = {}; CLOUD.synced = {}; CLOUD.last = null; clSave();
  idbKey("del").catch(() => {});
  if (o.expired) toast(tr("Вход в облачную базу завершён") + ": " + tr(o.expired));
}
async function cloudPasswd(oldPass, newPass) {
  const salt0 = unb64((await api("salt", { login: CLOUD.login })).salt), authOld = b64(await pbkdf2(oldPass, salt0, "auth"));
  const j0 = await api("login", { login: CLOUD.login, auth: authOld });
  const raw = await aesDec(await aesKey(await pbkdf2(oldPass, salt0, "kek"), ["decrypt"]), j0.wrap);
  CLOUD.token = j0.token;
  const j = await api("passwd", { authOld, ...(await passWrap(newPass, raw)) });
  raw.fill(0); CLOUD.token = j.token; clSave();
}
async function cloudDeleteAccount(pass) {
  const salt0 = unb64((await api("salt", { login: CLOUD.login })).salt);
  await api("deluser", { authOld: b64(await pbkdf2(pass, salt0, "auth")) });
  CLIENTS.forEach(c => { if (c.owner === CLOUD.login) delete c.owner; });   // копии в этом браузере становятся обычными локальными
  saveAllLocal(true);
  CLOUD.token = ""; CLOUD.key = null; CLOUD.meta = {}; CLOUD.synced = {}; clSave(); idbKey("del").catch(() => {});
}

/* --- синхронизация */
async function cloudGet(id, n) {
  let s = ""; for (let p = 0; p < (n || 1); p++) { const j = await api("get", { id, part: p }); if (j.data == null) throw new Error("нет части " + p); s += j.data; }
  return unpackClient(s);
}
async function cloudPut(c) {
  c.owner = CLOUD.login;
  const s = await packClient(c), PS = (CLOUD.cfg && CLOUD.cfg.partSize) || 3000000, n = Math.max(1, Math.ceil(s.length / PS));
  for (let p = 0; p < n; p++) await api("put", { id: c.id, u: c.updated, part: p, n, data: s.slice(p * PS, (p + 1) * PS) });
  CLOUD.synced[c.id] = c.updated;
}
async function cloudSync(force) {
  if (!cloudOn()) return;
  if (CLOUD.busy) { CLOUD.queued = true; return; }
  if (LOCK.on && !LOCK.key) return;
  CLOUD.busy = true; CLOUD.err = ""; paintCloud();
  let got = 0, sent = 0, gone = 0;
  try {
    if (!CLOUD.cfg) await cloudCfg();
    CLOUD.meta = (await api("list")).meta || {};
    for (const [id, m] of Object.entries(CLOUD.meta)) {
      const i = CLIENTS.findIndex(c => c.id === id), loc = i >= 0 ? CLIENTS[i] : null;
      if (loc && !cloudMine(loc)) continue;
      if (m.del) {
        if (loc && (loc.updated || 0) <= m.u) { CLIENTS.splice(i, 1); if (C && C.id === id) C = null; gone++; }
        delete CLOUD.synced[id]; continue;
      }
      if (!loc && CLOUD.synced[id] && m.u <= CLOUD.synced[id]) continue;   // удалён здесь — удалится на сервере ниже
      if (loc && (loc.updated || 0) >= m.u) { if (loc.updated === m.u) CLOUD.synced[id] = m.u; continue; }
      const c = await cloudGet(id, m.n);
      c.updated = m.u; c.owner = CLOUD.login;
      if (i >= 0) { CLIENTS[i] = c; if (C && C.id === id) { C = c; CACHE.clear(); toast(tr("Клиент обновлён с другого устройства")); } } else CLIENTS.push(c);
      CLOUD.synced[id] = m.u; got++;
    }
    for (const c of CLIENTS.slice()) {
      if (!cloudMine(c)) continue;
      const m = CLOUD.meta[c.id];
      if (m && !m.del && (c.updated || 0) <= m.u) { c.owner = CLOUD.login; continue; }
      if (!c.updated) c.updated = Date.now();
      await cloudPut(c); sent++;
    }
    for (const id of Object.keys(CLOUD.synced)) if (!CLIENTS.some(c => c.id === id) && CLOUD.meta[id] && !CLOUD.meta[id].del) { await api("del", { id }); delete CLOUD.synced[id]; }
    CLOUD.last = new Date(); clSave();
    if (got || gone || sent) saveAllLocal(true);
    if (got || gone) render();
    if (force && (got || sent)) toast(tr("Облачная база: получено {0}, отправлено {1}").replace("{0}", got).replace("{1}", sent));
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
  if (CLOUD.err) return tr("Облачная база: нет связи") + " (" + CLOUD.err + ")";
  return CLOUD.last ? tr("Облачная база: синхронизировано") + " " + dTime(CLOUD.last) : tr("Облачная база подключена");
}
function paintCloud() {
  const t = cloudStatus();
  document.querySelectorAll("[data-cloudst]").forEach(el => { el.textContent = t; el.classList.toggle("bad", !!CLOUD.err); });
}
function cloudHeaderHTML() {
  if (location.protocol === "file:") return "";
  return cloudOn()
    ? `<span class="cloudchip" title="${esc(tr("Ваши клиенты хранятся на сервере в зашифрованном виде и доступны с любого устройства после входа. Другие сотрудники их не видят."))}">☁ <b data-nt>${esc(CLOUD.name || CLOUD.login)}</b> <span data-cloudst class="small">${esc(cloudStatus())}</span></span><button class="btn ghost" data-act="cloudsync">Синхронизировать</button><button class="btn ghost" data-act="cloudacc">Учётная запись</button><button class="btn ghost" data-act="cloudout">Выйти</button>`
    : `<button class="btn ghost" data-act="cloudin">Войти / Регистрация</button>`;
}
const CL_TABS = [["in", "Вход"], ["reg", "Регистрация"], ["rec", "Забыли пароль?"]];
async function cloudDialog(mode = "in") {
  const cfg = await cloudCfg();
  if (!cfg.configured) { await dialog("Облачная база", `<p>${cfg.offline ? "Файл открыт с компьютера — облачная база работает только на сайте." : "Облачная база ещё не подключена на сервере. Администратору: в Vercel → Storage подключить Upstash Redis к проекту, затем Redeploy."}</p>${cfg.diag || cfg.error ? `<p class="small muted" data-nt>Диагностика: ${esc(JSON.stringify(cfg.diag || { error: cfg.error }))}</p>` : ""}`, [{ t: "Понятно", primary: true, v: true }]); return; }
  const tabs = `<div class="tabs" role="tablist" style="margin-bottom:12px">${CL_TABS.map(([k, t]) => `<button role="tab" aria-selected="${mode === k}" data-cltab="${k}">${t}</button>`).join("")}</div>`;
  const fld = (id, lab, type = "text", ac = "off", val = "") => `<label class="f"><span>${lab}</span><input class="inp" id="${id}" type="${type}" autocomplete="${ac}" value="${esc(val)}"></label>`;
  const hint = { in: "После входа ваши клиенты загрузятся на это устройство, а изменения будут сохраняться на сервере в зашифрованном виде. Другие сотрудники ваших клиентов не видят.",
    reg: (cfg.firstUser ? "<b>Вы регистрируетесь первым.</b> Придумайте код приглашения — его вы потом передадите коллегам для регистрации. " : "Код приглашения выдаёт администратор. ") + "Пароль шифрует ваши данные и на сервер не отправляется. После регистрации появится код восстановления — запишите его: без него забытый пароль восстановить нельзя.",
    rec: "Введите код восстановления, который вы записали при регистрации, и придумайте новый пароль. Входы на других устройствах после этого прекратятся." }[mode];
  const fields = mode === "in" ? fld("clL", "Логин", "text", "username", CLOUD.login) + fld("clP", "Пароль", "password", "current-password")
    : mode === "reg" ? fld("clL", "Логин", "text", "username") + fld("clN", "Имя и фамилия", "text", "name") + fld("clP", "Пароль (не меньше 10 знаков)", "password", "new-password") + fld("clP2", "Повторите пароль", "password", "new-password") + fld("clI", cfg.firstUser ? "Придумайте код приглашения для коллег (не меньше 6 знаков)" : "Код приглашения")
    : fld("clL", "Логин", "text", "username", CLOUD.login) + fld("clR", "Код восстановления") + fld("clP", "Новый пароль (не меньше 10 знаков)", "password", "new-password") + fld("clP2", "Повторите пароль", "password", "new-password");
  const body = `${tabs}<p class="hint">${hint}</p><div class="grid2" style="margin-top:8px">${fields}</div><p class="lockmsg" id="clMsg"></p>`;
  let code = "";
  setTimeout(() => { const el = document.querySelector("#clL"); if (el) el.focus(); }, 30);
  const r = await dialog("Облачная база", body, [{ t: "Отменить", v: null }, { t: { in: "Войти", reg: "Зарегистрироваться", rec: "Сменить пароль и войти" }[mode], primary: true, keep: true, v: async dlg => {
    const g = id => (dlg.querySelector("#" + id) || {}).value || "", msg = dlg.querySelector("#clMsg");
    const f = { login: g("clL").trim(), name: g("clN").trim(), pass: g("clP"), invite: g("clI").trim(), code: g("clR") };
    if (!f.login || !f.pass) { msg.textContent = tr("Заполните логин и пароль"); return false; }
    if (mode !== "in") {
      if (f.pass.length < 10) { msg.textContent = tr("Пароль — не меньше 10 знаков"); return false; }
      if (f.pass !== g("clP2")) { msg.textContent = tr("Пароли не совпадают"); return false; }
      if (mode === "reg" && !f.invite) { msg.textContent = tr("Введите код приглашения"); return false; }
      if (mode === "rec" && recCode(f.code).length !== 24) { msg.textContent = tr("Код восстановления — 20 знаков"); return false; }
    }
    msg.textContent = tr("Проверяю… (шифрование занимает несколько секунд)");
    try { if (mode === "reg") code = await cloudRegister(f); else if (mode === "rec") await cloudRecover(f); else await cloudLogin(f); return true; } catch (e) { msg.textContent = e.message; return false; }
  } }]);
  if (!r) return;
  render();
  if (code) await showRecoveryCode(code); else toast(tr("Вход выполнен"));
}
async function showRecoveryCode(code) {
  for (;;) {
    const ok = await dialog("Код восстановления", `<p>Запишите этот код и храните отдельно от пароля (например, на бумаге в сейфе). Он нужен, если вы забудете пароль. <b>Показывается один раз</b>; без него и без пароля ваши данные на сервере расшифровать невозможно — ни вам, ни администратору.</p>
      <p class="rcode" data-nt>${esc(code)}</p><label class="chk"><input type="checkbox" id="rcOk"> Я записал(а) код восстановления</label>`,
      [{ t: "Скопировать", v: "copy" }, { t: "Готово", primary: true, v: d => (d.querySelector("#rcOk").checked ? "ok" : "no") }]);
    if (ok === "copy") { try { await navigator.clipboard.writeText(code); toast(tr("Код скопирован")); } catch (e) { /* вручную */ } continue; }
    if (ok === "ok") return;
    toast(tr("Отметьте, что код записан"));
  }
}
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-cltab]");
  if (t) { e.preventDefault(); const d = document.getElementById("dlg"); if (d && d.open) d.close(); cloudDialog(t.dataset.cltab); return; }
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "cloudin") cloudDialog("in");
  else if (a === "cloudsync") cloudSync(true);
  else if (a === "cloudout") {
    const r = await dialog("Выйти из облачной базы?", `<p>При выходе ваши клиенты удаляются из этого браузера — на сервере они остаются и откроются после следующего входа. Так на общем компьютере не останется конфиденциальных данных.</p><label class="chk"><input type="checkbox" id="clKeep"> Это мой личный компьютер — оставить копию клиентов для работы без интернета</label>`,
      [{ t: "Отменить", v: null }, { t: "Выйти", primary: true, v: d => ({ keep: d.querySelector("#clKeep").checked }) }]);
    if (!r) return;
    clearTimeout(cloudT); await cloudSync();
    if (CLOUD.err && !r.keep && !(await dialog("Есть неотправленные изменения", `<p>${esc(tr("Нет связи с сервером"))}: ${esc(CLOUD.err)}. Если выйти сейчас с удалением, последние изменения пропадут.</p>`, [{ t: "Остаться", primary: true, v: false }, { t: "Всё равно выйти", v: true }]))) return;
    cloudLogout(r); render(); toast(tr("Вы вышли из облачной базы"));
  } else if (a === "cloudacc") {
    const r = await dialog("Учётная запись", `<p>Логин: <b data-nt>${esc(CLOUD.login)}</b>${CLOUD.name ? ` · <span data-nt>${esc(CLOUD.name)}</span>` : ""}</p>
      <h3>Сменить пароль</h3><div class="grid2"><label class="f"><span>Текущий пароль</span><input class="inp" id="cp0" type="password" autocomplete="current-password"></label><label class="f"><span>Новый пароль (не меньше 10 знаков)</span><input class="inp" id="cp1" type="password" autocomplete="new-password"></label><label class="f"><span>Повторите новый</span><input class="inp" id="cp2" type="password" autocomplete="new-password"></label></div>
      <p class="hint">После смены пароля входы на других устройствах прекратятся. Код восстановления остаётся прежним.</p>
      <h3 style="margin-top:14px">Удалить учётную запись</h3><p class="hint">Удаляет учётную запись и всех ваших клиентов с сервера. Копии в этом браузере останутся. Для подтверждения введите текущий пароль выше.</p>`,
      [{ t: "Закрыть", v: null }, { t: "Удалить с сервера", v: d => ({ del: true, o: d.querySelector("#cp0").value }) }, { t: "Сменить пароль", primary: true, v: d => ({ o: d.querySelector("#cp0").value, a: d.querySelector("#cp1").value, b: d.querySelector("#cp2").value }) }]);
    if (!r) return;
    try {
      if (r.del) {
        if (!r.o) { toast(tr("Введите текущий пароль")); return; }
        if (!(await dialog("Удалить учётную запись?", "<p>Все ваши клиенты будут удалены с сервера без возможности восстановления. Копии в этом браузере останутся.</p>", [{ t: "Отменить", v: false }, { t: "Удалить", primary: true, v: true }]))) return;
        await cloudDeleteAccount(r.o); render(); toast(tr("Учётная запись удалена"));
      } else {
        if (r.a.length < 10 || r.a !== r.b) { toast(tr("Новый пароль — не меньше 10 знаков, оба раза одинаково")); return; }
        await cloudPasswd(r.o, r.a); toast(tr("Пароль изменён"));
      }
    } catch (err) { toast(err.message); }
  }
});
// восстановление сессии при открытии сайта
(async () => {
  if (location.protocol === "file:") return;
  if (!CLOUD.token) { cloudCfg(); return; }
  try { CLOUD.key = await idbKey("get") || null; } catch (e) { CLOUD.key = null; }
  if (!CLOUD.key) { CLOUD.token = ""; clSave(); return; }
  await cloudCfg(); render(); cloudSync();
})();
