# -*- coding: utf-8 -*-
"""Собирает один офлайн-файл: HTML + CSS + встроенный шрифт + спецификация + код. Никаких внешних ссылок."""
import base64, json, re
css = open("src/app.css", encoding="utf-8").read()
spec = open("src/spec.json", encoding="utf-8").read()
js = "\n".join(open("src/" + f, encoding="utf-8").read() for f in ("app1.js", "app2.js", "app4.js", "app5.js", "app6.js", "app7.js", "app8.js", "app9.js", "app10.js", "app3.js"))
html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; connect-src 'self' blob: data:">
<title>Финансовый анализ РК</title>
<style>{css}</style></head>
<body><script>window.SPEC = {spec};</script>
<script>{js}</script></body></html>"""
assert not re.search(r"https?://(?!www\.w3\.org|schemas\.openxmlformats)", html), "внешние ссылки"
open("index.html", "w", encoding="utf-8").write(html)
print(len(html))
