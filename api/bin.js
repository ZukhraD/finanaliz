// Посредник для кнопки «Подтянуть по БИН».
// Принимает только 12-значный БИН/ИИН, запрашивает открытые регистрационные данные
// Бюро национальной статистики (stat.gov.kz) и возвращает их в упрощённом виде.
// Ничего не сохраняет и не пишет в журнал; финансовые данные клиента сюда не попадают.
const SOURCES = [
  b => `https://stat.gov.kz/api/juridical/counter/api/?bin=${b}&lang=ru`,
  b => `https://old.stat.gov.kz/api/juridical/counter/api/?bin=${b}&lang=ru`,
];

function pick(o, ...keys) { for (const k of keys) if (o && o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim(); return ""; }

function normalize(j) {
  const o = j && (j.obj || j.data || j.result || j);
  if (!o || typeof o !== "object") return null;
  const name = pick(o, "name", "nameRu", "fullName");
  if (!name && !pick(o, "bin")) return null;
  let sec = o.secondOkeds ?? o.secondOked ?? "";
  if (Array.isArray(sec)) sec = sec.join(",");
  return {
    bin: pick(o, "bin", "BIN"),
    name,
    regDate: pick(o, "registerDate", "regDate", "registrationDate"),
    okedCode: pick(o, "okedCode", "oked"),
    okedName: pick(o, "okedName"),
    secondOkeds: String(sec || "").split(/[,;\s]+/).filter(Boolean),
    krp: pick(o, "krpName"),
    kse: pick(o, "kseName"),
    kfs: pick(o, "kfsName"),
    address: pick(o, "katoAddress", "address", "legalAddress"),
    director: pick(o, "fio", "director", "head"),
    ip: o.ip === true || o.ip === "true",
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Только GET" }); return; }
  const bin = String((req.query && req.query.bin) || "").trim();
  if (!/^\d{12}$/.test(bin)) { res.status(400).json({ ok: false, error: "БИН/ИИН должен состоять из 12 цифр" }); return; }
  let lastErr = "";
  for (const url of SOURCES) {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url(bin), { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (finanaliz BIN lookup)" } });
      clearTimeout(timer);
      if (!r.ok) { lastErr = "источник ответил " + r.status; continue; }
      const j = await r.json();
      if (j && j.success === false) { res.status(404).json({ ok: false, error: "Компания с таким БИН не найдена в Бюро национальной статистики" }); return; }
      const d = normalize(j);
      if (!d) { lastErr = "непонятный ответ источника"; continue; }
      res.status(200).json({ ok: true, source: "Бюро национальной статистики (stat.gov.kz)", fetched: new Date().toISOString(), data: d });
      return;
    } catch (e) { lastErr = e.name === "AbortError" ? "источник не ответил за 8 секунд" : "источник недоступен"; }
  }
  res.status(502).json({ ok: false, error: "Не удалось получить данные: " + lastErr });
};
