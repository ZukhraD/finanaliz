# -*- coding: utf-8 -*-
"""Собирает один офлайн-файл: HTML + CSS + встроенный шрифт + спецификация + код. Никаких внешних ссылок."""
import base64, json, re, glob
kz = {}
for f in sorted(glob.glob("i18n/kz*.json")): kz.update(json.load(open(f, encoding="utf-8")))
for k, v in list(kz.items()):
    lk = k[:1].lower() + k[1:]
    if len(k) >= 5 and lk != k and lk not in kz and v: kz[lk] = v[:1].lower() + v[1:]
kzjs = json.dumps(kz, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
css = open("src/app.css", encoding="utf-8").read()
spec = open("src/spec.json", encoding="utf-8").read()
js = "\n".join(open("src/" + f, encoding="utf-8").read() for f in ("app0.js", "app1.js", "app2.js", "app4.js", "app5.js", "app6.js", "app7.js", "app8.js", "app9.js", "app10.js", "app11.js", "app12.js", "app13.js", "app3.js"))
html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; connect-src 'self' blob: data:">
<title>Финансовый анализ РК</title>
<style>{css}</style></head>
<body><script>window.SPEC = {spec}; window.I18N_KZ = {kzjs};</script>
<script>{js}</script></body></html>"""
assert not re.search(r"https?://(?!www\.w3\.org|schemas\.openxmlformats|stat\.gov\.kz|old\.stat\.gov\.kz)", html), "внешние ссылки"
open("index.html", "w", encoding="utf-8").write(html)
print(len(html))
