// Кнопка «Подтянуть по БИН»: загружает открытую страницу компании на ba.prg.kz («Параграф: Бизнес Аналитик»)
// и возвращает её текст построчно — разбор делает браузер. Страницы компаний разрешены в robots.txt
// (закрыты только /api, /list и служебные параметры). Запрос — один на нажатие, без маскировки.
// Ничего не сохраняет и не пишет в журнал; финансовые данные клиента сюда не попадают — только БИН.
const UA = "Mozilla/5.0 (compatible; finanaliz/1.0; +https://finanaliz-ofkk-kst.vercel.app)";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", nbhy: "-" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function htmlLines(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(div|p|li|ul|ol|tr|td|th|table|thead|tbody|section|article|header|footer|main|nav|aside|h[1-6]|dt|dd|dl|label|button|a|form|figure|figcaption|summary|details)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(h).split("\n").map(s => s.replace(/[\s ]+/g, " ").trim()).filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Только GET" }); return; }
  const bin = String((req.query && req.query.bin) || "").trim();
  if (!/^\d{12}$/.test(bin)) { res.status(400).json({ ok: false, error: "БИН/ИИН должен состоять из 12 цифр" }); return; }
  const url = `https://ba.prg.kz/${bin}-${bin}/`;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "ru-RU,ru;q=0.9" } });
    clearTimeout(timer);
    if (r.status === 404) { res.status(404).json({ ok: false, error: "На ba.prg.kz нет компании с таким БИН" }); return; }
    if (!r.ok) { res.status(502).json({ ok: false, error: "ba.prg.kz ответил " + r.status }); return; }
    const html = await r.text();
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const lines = htmlLines(html).slice(0, 6000);
    if (!lines.some(l => l.includes(bin))) { res.status(404).json({ ok: false, error: "На ba.prg.kz не найдена страница компании с этим БИН" }); return; }
    res.status(200).json({
      ok: true, source: "Параграф: Бизнес Аналитик (ba.prg.kz)", url: r.url || url, fetched: new Date().toISOString(),
      h1: h1 ? decode(h1[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "",
      title: title ? decode(title[1]).replace(/\s+/g, " ").trim() : "",
      lines,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.name === "AbortError" ? "ba.prg.kz не ответил за 12 секунд" : "ba.prg.kz недоступен" });
  }
};
