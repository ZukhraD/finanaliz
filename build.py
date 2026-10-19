# -*- coding: utf-8 -*-
"""Собирает один офлайн-файл: HTML + CSS + встроенный шрифт + спецификация + код. Никаких внешних ссылок."""
import base64, json, re, glob
from fontTools.ttLib import TTFont
kz = {}
for f in sorted(glob.glob("i18n/kz*.json")): kz.update(json.load(open(f, encoding="utf-8")))
for k, v in list(kz.items()):
    lk = k[:1].lower() + k[1:]
    if len(k) >= 5 and lk != k and lk not in kz and v: kz[lk] = v[:1].lower() + v[1:]
kzjs = json.dumps(kz, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
def pdf_font(path, name):
    f = TTFont(path); go = f.getGlyphOrder(); gid = {g: i for i, g in enumerate(go)}; upm = f["head"].unitsPerEm
    sc = lambda v: round(v * 1000 / upm); hd = f["head"]; os2 = f["OS/2"]
    return {"name": name, "b64": base64.b64encode(open(path, "rb").read()).decode(), "cmap": {str(u): gid[g] for u, g in f.getBestCmap().items()},
            "w": [sc(f["hmtx"][g][0]) for g in go], "asc": sc(f["hhea"].ascent), "dsc": sc(f["hhea"].descent),
            "bbox": [sc(hd.xMin), sc(hd.yMin), sc(hd.xMax), sc(hd.yMax)], "cap": sc(getattr(os2, "sCapHeight", 0) or 700)}
fonts = json.dumps({"r": pdf_font("src/fonts/DejaVuSansCondensed.ttf", "FKAAAA+DejaVuSansCondensed"), "b": pdf_font("src/fonts/DejaVuSansCondensed-Bold.ttf", "FKAAAB+DejaVuSansCondensed-Bold")}, separators=(",", ":"))
css = open("src/app.css", encoding="utf-8").read()
spec = open("src/spec.json", encoding="utf-8").read()
oked = open("src/oked.json", encoding="utf-8").read().replace("</", "<\\/")
js = "\n".join(open("src/" + f, encoding="utf-8").read() for f in ("app0.js", "app1.js", "app2.js", "app4.js", "app5.js", "app6.js", "app7.js", "app8.js", "app9.js", "app10.js", "app11.js", "app12.js", "app13.js", "app14.js", "app15.js", "app16.js", "app17.js", "app3.js", "app18.js"))
html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; connect-src 'self' blob: data: https://generativelanguage.googleapis.com">
<title>Финансовый анализ РК</title>
<style>{css}</style></head>
<body><script>window.SPEC = {spec}; window.I18N_KZ = {kzjs}; window.PDF_FONTS = {fonts}; window.OKED_BUILTIN = {oked};</script>
<script>{js}</script></body></html>"""
assert not re.search(r"https?://(?!www\.w3\.org|schemas\.openxmlformats|stat\.gov\.kz|old\.stat\.gov\.kz|gemini\.google\.com/app|generativelanguage\.googleapis\.com)", html), "внешние ссылки"
open("index.html", "w", encoding="utf-8").write(html)
print(len(html))
