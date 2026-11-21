#!/usr/bin/env python3
# 테스트 사이트(test/index.html) · 연출 구경 서버(showcase/index.html) 생성: index.html 수정 후 실행
import os
s = open('index.html', encoding='utf-8').read()
a = '<body>\n<script>'
assert s.count(a) == 1
for d, flag in [('test', 'BALLFIGHT_TEST_SITE'), ('showcase', 'BALLFIGHT_SHOWCASE')]:
    os.makedirs(d, exist_ok=True)
    open(d + '/index.html', 'w', encoding='utf-8').write(s.replace(a, '<body>\n<script>window.%s = true;</script>\n<script>' % flag))
