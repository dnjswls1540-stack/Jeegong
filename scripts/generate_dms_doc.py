import json
import openpyxl

wb = openpyxl.load_workbook('downloads/influencers_live.xlsx')
ws = wb['인플루언서 List']

with open('data/anella_influencers_pilot.json', 'r', encoding='utf-8') as f:
    b1 = json.load(f)['influencers']

with open('data/anella_influencers_batch2.json', 'r', encoding='utf-8') as f:
    b2 = json.load(f)['influencers']

# Map DM info by insta_id
dm_map = {}
for item in b1:
    uid = item.get('insta_id')
    dm_map[uid] = {
        'dm_first': item.get('dm'),
        'hist': item.get('공구_이력'),
        'posts': item.get('최근_게시물_검증'),
        'nick': item.get('nickname')
    }

for item in b2:
    uid = item.get('id')
    dm_map[uid] = {
        'dm_first': item.get('dm'),
        'hist': item.get('hist'),
        'posts': item.get('posts'),
        'nick': item.get('nick')
    }

# Read live 30 from rows 2136 to 2165
influencers = []
for r in range(2136, 2166):
    uid = ws.cell(r, 1).value
    follow = ws.cell(r, 2).value
    url = ws.cell(r, 3).value
    cat = ws.cell(r, 15).value
    kakao = ws.cell(r, 19).value
    extra = dm_map.get(uid, {})
    influencers.append({
        'num': r - 2135,
        'row': r,
        'id': uid,
        'follow': follow,
        'url': url,
        'cat': cat,
        'kakao': kakao,
        'nick': extra.get('nick', uid),
        'hist': extra.get('hist', ''),
        'dm_first': extra.get('dm_first', '')
    })

md = []
md.append('# 아넬라 과일퓨레 공구 제안 맞춤 DM 초안 (30명)\n')
md.append('> **발굴 기준**: 5개월~4세 영유아·이유식·유아식·아기간식 타깃, 팔로워 5천 이상, 공구 이력 검증, 중복 0건')
md.append('> **공구 제안사**: 올쓰컴퍼니 (공동구매 전문 벤더사)\n')
md.append('## 📊 30명 요약 명단\n')
md.append('| 번호 | 계정 (인스타) | 닉네임 | 팔로워 | 상세 카테고리 | 연락처 (카톡 직통) |')
md.append('|:---:|:---|:---|:---:|:---|:---|')

for inf in influencers:
    k_link = f'[카톡 링크]({inf["kakao"]})' if inf['kakao'] else '인스타 DM'
    md.append(f'| {inf["num"]} | [@{inf["id"]}]({inf["url"]}) | {inf["nick"]} | {inf["follow"]} | {inf["cat"]} | {k_link} |')

md.append('\n---\n')
md.append('## 📝 계정별 맞춤 DM 전문 (복사용)\n')

for inf in influencers:
    md.append(f'### {inf["num"]}. @{inf["id"]} ({inf["nick"]} · 팔로워 {inf["follow"]})')
    md.append(f'- **인스타그램 프로필**: {inf["url"]}')
    md.append(f'- **상세 카테고리**: {inf["cat"]}')
    if inf['kakao']:
        md.append(f'- **직통 카톡**: {inf["kakao"]}')
    if inf['hist']:
        md.append(f'- **최근 공구 이력**: {inf["hist"]}')
    md.append('\n**📌 개인화 첫 줄 (실측 근거):**\n')
    md.append(f'> {inf["dm_first"]}\n')
    md.append('**📝 DM 발송 전문:**\n')
    md.append('```text')
    md.append(f'{inf["dm_first"]}')
    md.append('')
    md.append('아넬라 과일퓨레 공구 협업 제안드립니다 :)')
    md.append('')
    md.append('안녕하세요.')
    md.append('공동구매 전문 벤더사 올쓰컴퍼니입니다.')
    md.append('')
    md.append('👉 스페인 지중해 생과일 100% — 물 한 방울 안 넣고 갈아낸 퓨레')
    md.append('👉 파우치 100g 캡형 — 외출 간식으로 한 입 꺼내기 좋게')
    md.append('👉 첨가물 0% — 설탕·소금·물 없이 과일 그대로')
    md.append('')
    md.append('아넬라 과일퓨레: https://brand.naver.com/anela/products/6567763298')
    md.append('')
    md.append('올쓰컴퍼니 드림')
    md.append('```\n')

content = '\n'.join(md)
with open('downloads/anella_30_dms_doc.md', 'w', encoding='utf-8') as f:
    f.write(content)

print('Generated downloads/anella_30_dms_doc.md with size:', len(content))
