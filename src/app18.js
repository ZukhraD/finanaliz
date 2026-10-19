"use strict";
/* ---------------------------------------------------------------- Устройства: компьютер, планшет, телефон.
   Тип устройства определяется по браузеру (iPhone/Android-телефон, iPad/планшет), сенсорному экрану и ширине окна;
   результат — атрибуты <html data-device="phone|tablet|desktop" data-touch="1|0" data-nav="drawer|rail">.
   На телефоне и планшете в портретной ориентации меню разделов прячется в выдвижную панель (кнопка ☰ в верхней строке). */
function detectDevice() {
  const ua = navigator.userAgent || "", w = window.innerWidth;
  const touch = (window.matchMedia && matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0;
  const ipadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const tabletUA = /iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua) || ipadOS;
  const phoneUA = !tabletUA && /iPhone|iPod|Android.*Mobile|Windows Phone|Mobile/i.test(ua);
  const dev = phoneUA || w < 700 ? "phone" : tabletUA || (touch && w < 1280) || w < 1024 ? "tablet" : "desktop";
  const nav = dev === "phone" || (dev === "tablet" && w < 1024) ? "drawer" : "rail";
  const h = document.documentElement, ch = h.dataset.device !== dev || h.dataset.nav !== nav;
  h.dataset.device = dev; h.dataset.touch = touch ? "1" : "0"; h.dataset.nav = nav;
  return ch;
}
detectDevice();
let DEV_T = null;
window.addEventListener("resize", () => { clearTimeout(DEV_T); DEV_T = setTimeout(() => { if (detectDevice() && typeof render === "function") { navOpen(false); render(); } }, 150); });
window.addEventListener("orientationchange", () => setTimeout(() => { if (detectDevice()) render(); }, 200));

function navOpen(on) { document.documentElement.classList.toggle("navopen", !!on); }
const PAGE_TITLE = () => { const b = document.querySelector(`nav [data-page="${PAGE}"]`); if (!b) return ""; const c = b.cloneNode(true); c.querySelectorAll(".pdot,.spark").forEach(x => x.remove()); return c.textContent.trim(); };
// верхняя строка для телефона/планшета: ☰, раздел, клиент
function mobileChrome() {
  if (document.documentElement.dataset.nav !== "drawer") return;
  const main = document.getElementById("main"), app = document.querySelector(".app");
  if (!main || !app || document.querySelector(".mbar")) return;
  const bar = document.createElement("header");
  bar.className = "mbar";
  bar.innerHTML = `<button class="mburger" data-act="navtoggle" aria-label="Меню разделов"><span></span><span></span><span></span></button>
    <div class="mtitle"><b></b><small data-nt></small></div>`;
  bar.querySelector("b").textContent = PAGE_TITLE() || tr("Финансовый анализ");
  bar.querySelector("small").textContent = C ? C.card.name : "";
  app.insertBefore(bar, app.firstChild);
  const shade = document.createElement("div"); shade.className = "navshade"; shade.dataset.act = "navclose"; app.appendChild(shade);
}
{ const r0 = render; render = function () { navOpen(false); r0.apply(this, arguments); mobileChrome(); }; }   // eslint-disable-line no-func-assign
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act=navtoggle],[data-act=navclose]");
  if (t) { e.preventDefault(); navOpen(t.dataset.act === "navtoggle" && !document.documentElement.classList.contains("navopen")); return; }
  if (document.documentElement.classList.contains("navopen") && e.target.closest(".rail [data-page], .rail [data-act]")) navOpen(false);
});
document.addEventListener("keydown", e => { if (e.key === "Escape") navOpen(false); });
// свайп влево по панели — закрыть
{ let x0 = null; document.addEventListener("touchstart", e => { if (e.target.closest(".rail")) x0 = e.touches[0].clientX; }, { passive: true });
  document.addEventListener("touchend", e => { if (x0 !== null && e.changedTouches[0].clientX - x0 < -60) navOpen(false); x0 = null; }, { passive: true }); }
