"use strict";
/* ---------------------------------------------------------------- Язык интерфейса: RUS (по умолчанию) / KAZ.
   Сайт строит страницы на русском; при KAZ слой перевода заменяет выводимый текст по словарю window.I18N_KZ
   (текстовые узлы, подсказки, placeholder, заголовки окон, всплывающие сообщения, выгрузка в Word).
   Значения полей ввода и данные, которые вводит пользователь, не трогаются. */
const LANG_KEY = "finkz.lang";
let LANG = (() => { try { return localStorage.getItem(LANG_KEY) === "kz" ? "kz" : "ru"; } catch (e) { return "ru"; } })();
const I18N = window.I18N_KZ || {};
const LOC = () => (LANG === "kz" ? "kk-KZ" : "ru-RU");
const KZ_MON = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
const p2 = n => String(n).padStart(2, "0");
// даты без зависимости от языковых данных браузера: казахские месяцы — свои
const dDayMonth = d => { d = new Date(d); return LANG === "kz" ? `${d.getDate()} ${KZ_MON[d.getMonth()]}` : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); };
const dTime = d => { d = new Date(d); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const dDateTime = d => { d = new Date(d); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}, ${dTime(d)}`; };
const CYR_RE = /[А-Яа-яЁё]/;
let I18N_RE = null;
function i18nRe() {
  if (I18N_RE) return I18N_RE;
  const keys = Object.keys(I18N).filter(k => k.length >= 2 && CYR_RE.test(k) && !/\{\d\}/.test(k)).sort((a, b) => b.length - a.length);
  const e = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // фраза не должна начинаться/заканчиваться внутри слова
  I18N_RE = new RegExp(keys.map(k => (/^[А-Яа-яЁёA-Za-z]/.test(k) ? "(?<![А-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһA-Za-z])" : "") + e(k) + (/[А-Яа-яЁёA-Za-z.]$/.test(k) ? "(?![А-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ])" : "")).join("|"), "g");
  return I18N_RE;
}
function tr(s) {
  if (LANG !== "kz" || s == null) return s;
  s = String(s); if (!CYR_RE.test(s)) return s;
  const t = s.trim();
  if (I18N[t] !== undefined) return s.replace(t, I18N[t]);
  // шаблоны с числами: «по {0} проверкам» — числа подставляются в перевод по порядку
  const nums = []; const tk = t.replace(/\d+(?:[ \u00a0.,]\d+)*/g, m => { nums.push(m); return "{" + (nums.length - 1) + "}"; });
  if (nums.length && I18N[tk] !== undefined) return s.replace(t, I18N[tk].replace(/\{(\d+)\}/g, (m, i) => nums[+i] ?? m));
  return s.replace(i18nRe(), m => I18N[m] ?? m).replace(/(\d)\s+из\s+(\d)/g, "$1 / $2");
}
// для готовой HTML-строки (выгрузка в Word): переводится только текст между тегами
function trHTML(html) {
  if (LANG !== "kz") return html;
  return String(html).replace(/>([^<>]+)</g, (m, t) => ">" + tr(t) + "<");
}
const I18N_DONE = new WeakMap();
const I18N_ATTR = ["placeholder", "title", "aria-label"];
function trNode(root) {
  if (LANG !== "kz" || !root) return;
  if (root.nodeType === 3) { trText(root); return; }
  if (root.nodeType !== 1) return;
  if (root.closest && root.closest("script,style,textarea,[data-nt]")) return;
  trAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => n.nodeType === 1 ? (/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.nodeName) || n.hasAttribute("data-nt") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT,
  });
  // атрибуты элементов — отдельным проходом (TreeWalker выше отдаёт только текст)
  root.querySelectorAll && root.querySelectorAll("[placeholder],[title],[aria-label]").forEach(trAttrs);
  let n; while ((n = w.nextNode())) trText(n);
}
function trText(n) {
  const v = n.nodeValue; if (!v || I18N_DONE.get(n) === v || !CYR_RE.test(v)) return;
  if (n.parentNode && n.parentNode.closest && n.parentNode.closest("[data-nt],textarea")) return;
  const o = tr(v); I18N_DONE.set(n, o); if (o !== v) n.nodeValue = o;
}
function trAttrs(el) {
  if (!el.getAttribute) return;
  for (const a of I18N_ATTR) { const v = el.getAttribute(a); if (v && CYR_RE.test(v)) { const o = tr(v); if (o !== v) el.setAttribute(a, o); } }
}
const I18N_OBS = new MutationObserver(list => {
  if (LANG !== "kz") return;
  for (const m of list) {
    if (m.type === "characterData") trText(m.target);
    else if (m.type === "attributes") trAttrs(m.target);
    else for (const n of m.addedNodes) trNode(n);
  }
});
function i18nStart() {
  I18N_OBS.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: I18N_ATTR });
  document.documentElement.lang = LANG === "kz" ? "kk" : "ru";
  if (LANG === "kz") { trNode(document.body); document.title = tr(document.title); }
}
function setLang(l) {
  LANG = l === "kz" ? "kz" : "ru";
  try { localStorage.setItem(LANG_KEY, LANG); } catch (e) { /* только до перезагрузки */ }
  document.documentElement.lang = LANG === "kz" ? "kk" : "ru";
  document.title = LANG === "kz" ? tr("Финансовый анализ РК") : "Финансовый анализ РК";
  if (typeof render === "function") render();
}
const langSwitch = () => `<span class="lang" role="group" aria-label="Язык"><button data-lang="ru" class="${LANG === "ru" ? "on" : ""}" data-nt>RUS</button><button data-lang="kz" class="${LANG === "kz" ? "on" : ""}" data-nt>KAZ</button></span>`;
document.addEventListener("click", e => { const b = e.target.closest("button[data-lang]"); if (b && b.dataset.lang !== LANG) setLang(b.dataset.lang); });
i18nStart();
