#!/usr/bin/env python3
# 테스트 사이트(test/index.html) 생성: index.html 수정 후 실행
import os
s = open('index.html', encoding='utf-8').read()
a = '<body>\n<script>'
assert s.count(a) == 1
s = s.replace(a, '<body>\n<script>window.BALLFIGHT_TEST_SITE = true;</script>\n<script>')
os.makedirs('test', exist_ok=True)
open('test/index.html', 'w', encoding='utf-8').write(s)
