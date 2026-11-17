#!/usr/bin/env python3
"""rnd-budget/index.html 의 자주 묻는 질문을 검색엔진용 구조화 데이터(FAQPage JSON-LD)로 넣는다.
질문·답변을 고친 뒤 실행:  python3 tools/rnd_faq_jsonld.py"""
import html, json, re, sys
from pathlib import Path

path = Path(__file__).resolve().parent.parent / 'rnd-budget' / 'index.html'
src = path.read_text(encoding='utf-8')
text = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip()
items = []
for m in re.finditer(r'<details data-cat="[^"]*"[^>]*><summary>(.*?)</summary><p>(.*?)</p></details>', src, re.S):
    items.append({'@type': 'Question', 'name': text(m.group(1)), 'acceptedAnswer': {'@type': 'Answer', 'text': text(m.group(2))}})
if not items:
    sys.exit('질문을 찾지 못했습니다.')
block = '<script type="application/ld+json" id="faqLd">' + json.dumps({'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': items}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + '</script>'
if 'id="faqLd"' in src:
    src = re.sub(r'<script type="application/ld\+json" id="faqLd">.*?</script>', lambda _: block, src, flags=re.S)
else:
    src = src.replace('</head>', block + '\n</head>', 1)
path.write_text(src, encoding='utf-8')
print(f'FAQ 구조화 데이터 {len(items)}건 반영')
