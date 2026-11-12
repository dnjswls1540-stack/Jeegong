import json
import subprocess
import openpyxl

doc_id = "1jcX02MndnIcc8Q-Z0NMnKLc8JPXwuu4HGUxiojfrPxg"

# Load workbook to get exact rows 2219 to 2248
wb = openpyxl.load_workbook('downloads/influencers_live.xlsx')
ws = wb['인플루언서 List']

with open('data/dearcus_dm_rows.json', 'r', encoding='utf-8') as f:
    dm_rows = json.load(f)

# Build map of custom intro phrase per username
# Rule: "평소 ~하시는 걸 보고\n매일 쓰는 생필품 화장지도 잘 맞을 것 같아서,\n디어커스 대나무 뱀부 화장지 공구 협업 제안드립니다:)"
intros_map = {
    'lime__vely': '평소 살림템·주방템 공구를 전용으로 진행하시는 걸 보고',
    'very_mj': '평소 감각적인 DIY·리폼·살림 콘텐츠를 꾸준히 보여주시는 걸 보고',
    'rimcook__': '평소 살림·쿠킹 공구를 자주 진행하시는 걸 보고',
    'home_d.one': '평소 유용한 살림 꿀템 댓글 이벤트를 활발히 진행하시는 걸 보고',
    'cherry_meal': '평소 첨가물 걱정 없는 건강한 집밥 콘텐츠를 정성껏 올려주시는 걸 보고',
    'kimjinsun_lunch': '평소 정성 가득한 요리 레시피로 살림 팔로워분들과 소통하시는 걸 보고',
    'blooming_dada_': '평소 14년 차 주부님의 내공 있는 살림·주방 보석함 콘텐츠를 보고',
    'dini_terrace': '평소 감각적인 홈인테리어와 살림 공구를 자주 진행하시는 걸 보고',
    'ggungdi_baking': '평소 알찬 홈베이킹과 주방 콘텐츠로 팔로워분들과 활발히 소통하시는 걸 보고',
    'commeci_kitchen': '평소 실속 있는 간편레시피와 주방 살림 공구를 정기적으로 진행하시는 걸 보고',
    'salim_station': '평소 진정성 있게 직접 촬영하시는 살림 꿀템 콘텐츠를 챙겨보고',
    'coco_haus_': '평소 실생활에 유용한 주방·살림 꿀팁 콘텐츠를 활발히 다뤄주시는 걸 보고',
    'temqueen0': '평소 감각적인 잇템 큐레이션으로 생활 꿀템을 자주 소개해 주시는 걸 보고',
    'living_pluss': '평소 센스 있는 리빙·살림 꿀템 큐레이션을 꾸준히 진행하시는 걸 보고',
    'hehe_home_tem': '평소 집꾸미기와 살림·요리 꿀템을 실속 있게 소개해 주시는 걸 보고',
    'homemaster00': '평소 가성비 식재료와 유용한 살림 꿀템을 활발히 소개해 주시는 걸 보고',
    'home.in.on': '평소 실생활에 꼭 필요한 살림 꿀팁 콘텐츠를 알차게 올려주시는 걸 보고',
    'home._.standard': '평소 세련된 홈스타일링과 주방 살림 꿀템을 전문적으로 다뤄주시는 걸 보고',
    'lallina.home': '평소 정성 가득한 아빠의 살림 콘텐츠를 인상 깊게 챙겨보고',
    'shop._.dami': '평소 생생한 꿀템 리뷰와 살림 꿀팁 콘텐츠를 자주 소개해 주시는 걸 보고',
    'maeil_papa': '평소 살림을 편하게 만들어주는 아빠의 아이디어 콘텐츠를 인상 깊게 보고',
    'kkomsense.home': '평소 10년 내공 전업주부 아빠의 찐 살림템 콘텐츠를 눈여겨보고',
    'home_salimm': '평소 감각적인 살림템과 홈인테리어 콘텐츠를 활발히 보여주시는 걸 보고',
    '5452__home': '평소 살림·생활 꿀템 공구와 알찬 댓글 이벤트를 활발히 진행하시는 걸 보고',
    'kiki__som': '평소 주방세제 공구와 구매인증 이벤트를 활발히 운영하시는 걸 보고',
    'salad__lee': '평소 감각적인 리빙·주방 살림 공구와 댓글 이벤트를 꾸준히 진행하시는 걸 보고',
    'maisonde_mommy': '평소 살림 전문 콘텐츠와 신뢰도 높은 공구를 꾸준히 진행하시는 걸 보고',
    '__heyhome': '평소 감각적인 소파·리빙 가구와 주방용품 공구를 이어서 진행하시는 걸 보고',
    'bonbon.atelier22': '평소 공예가 언니가 소개해 주시는 감각적인 리빙템 콘텐츠를 눈여겨보고',
    'haram.table': '평소 실속 있는 무선초퍼와 주방 식재료 공구를 정기적으로 진행하시는 걸 보고'
}

nick_map = {
    'lime__vely': '라임블리',
    'very_mj': '베리',
    'rimcook__': '림쿡',
    'home_d.one': '홈디원',
    'cherry_meal': '체리밀',
    'kimjinsun_lunch': '김진순',
    'blooming_dada_': '블루밍다다',
    'dini_terrace': '디니테라스',
    'ggungdi_baking': '끙디베이킹',
    'commeci_kitchen': '꼼미키친',
    'salim_station': '살림스테이션',
    'coco_haus_': '코코하우스',
    'temqueen0': '템퀸',
    'living_pluss': '리빙플러스',
    'hehe_home_tem': '헤헤홈템',
    'homemaster00': '홈마스터',
    'home.in.on': '홈인온',
    'home._.standard': '홈스탠다드',
    'lallina.home': '랄리나홈',
    'shop._.dami': '샵담이',
    'maeil_papa': '매일파파',
    'kkomsense.home': '꼼센스홈',
    'home_salimm': '홈살림',
    '5452__home': '오사오이홈',
    'kiki__som': '키키솜',
    'salad__lee': '샐러드리',
    'maisonde_mommy': '메종드마미',
    '__heyhome': '헤이홈',
    'bonbon.atelier22': '봉봉',
    'haram.table': '하람테이블'
}

influencers = []
for r in range(2219, 2249):
    uid = ws.cell(r, 1).value
    follow = ws.cell(r, 2).value
    url = ws.cell(r, 3).value
    cat = ws.cell(r, 15).value
    kakao = ws.cell(r, 19).value
    influencers.append({
        'num': r - 2218,
        'row': r,
        'id': uid,
        'follow': follow,
        'url': url,
        'cat': cat,
        'kakao': kakao,
        'nick': nick_map.get(uid, uid),
        'intro': intros_map.get(uid, '평소 알찬 살림·주방 콘텐츠를 꾸준히 올려주시는 걸 보고')
    })

lines = []
lines.append('# 디어커스 대나무 뱀부 화장지 공구 제안 맞춤 DM (30명)\n')
lines.append('> **발굴 기준**: 리빙·살림·청소·주방·요리 타깃, 팔로워 3만 이상, 평균 댓글 100개 이상, 최근 1달 내 활동, 중복 0건')
lines.append('> **공구 제안사**: 올쓰컴퍼니 (공동구매 전문 벤더사)')
lines.append('> **상품**: 디어커스 뱀부500 대나무 화장지 (3겹 500매, 먼지 없는 친환경 화장지)\n')
lines.append('## 📊 30명 요약 명단\n')
lines.append('| 번호 | 인스타 계정 | 대표 닉네임 | 팔로워 | 상세 카테고리 | 비고 |')
lines.append('|:---:|:---|:---|:---:|:---|:---|')

for inf in influencers:
    note = '⚠️ 타사 대나무 휴지 공구 진행 중' if inf['id'] == 'very_mj' else '-'
    lines.append(f'| {inf["num"]} | [@{inf["id"]}]({inf["url"]}) | {inf["nick"]} | {inf["follow"]} | {inf["cat"]} | {note} |')

lines.append('\n---\n')
lines.append('## 📝 계정별 맞춤 DM 전문 (복사용)\n')

for inf in influencers:
    lines.append(f'### {inf["num"]}. @{inf["id"]} ({inf["nick"]} 대표님 · 팔로워 {inf["follow"]})')
    lines.append(f'- **프로필 링크**: {inf["url"]}')
    lines.append(f'- **상세 카테고리**: {inf["cat"]}')
    if inf['kakao']:
        lines.append(f'- **직통 카톡**: {inf["kakao"]}')
    if inf['id'] == 'very_mj':
        lines.append('- **⚠️ 주의**: 현재 타사 대나무 휴지 공구 진행 중으로, 일정 조율 또는 맞춤 소구점 활용 권장')
    lines.append('\n**📌 개인화 첫 문장:**')
    lines.append(f'{inf["intro"]}')
    lines.append('매일 쓰는 생필품 화장지도 잘 맞을 것 같아서,')
    lines.append('디어커스 대나무 뱀부 화장지 공구 협업 제안드립니다:)\n')
    lines.append('**📝 DM 발송 전문:**\n')
    lines.append('```text')
    lines.append(f'{inf["intro"]}')
    lines.append('매일 쓰는 생필품 화장지도 잘 맞을 것 같아서,')
    lines.append('디어커스 대나무 뱀부 화장지 공구 협업 제안드립니다:)')
    lines.append('')
    lines.append(f'안녕하세요 {inf["nick"]} 대표님!')
    lines.append('공동구매 전문 벤더사 올쓰컴퍼니입니다.')
    lines.append('')
    lines.append('인지도 있는 디어커스 브랜드에 매일 사용하는 생활 필수품이라는 점까지 더해져,')
    lines.append('요리와 살림에 관심 많은 대표님 계정의 팔로워분들께 소개하기 좋은 상품이라 제안드립니다😁')
    lines.append('')
    lines.append('👉 매일 쓰는 휴지, 이제 먼지날림 걱정은 줄이고!')
    lines.append('👉 나무 대신 대나무로 만든 뱀부500 화장지')
    lines.append('👉 3겹으로 탄탄하게, 일상에서 쓰기 좋은 사용감')
    lines.append('👉 온 가족이 매일 사용하는 실속 있는 살림 필수템!')
    lines.append('👉 요리부터 집안 살림까지 꼼꼼하게 챙기는 분들께 추천!')
    lines.append('')
    lines.append('주방용품뿐 아니라 생활 생필품에도 관심이 많은 팔로워분들께')
    lines.append('충분히 매력적으로 다가갈 수 있는 상품이라 생각합니다.')
    lines.append('')
    lines.append('이번 공구 메인 생필품으로 자신 있게 추천드립니다🔥')
    lines.append('')
    lines.append('상품페이지도 아래에 남겨놓을게요ㅎㅎ')
    lines.append('확인 후, 회신 부탁드리겠습니다!!')
    lines.append('https://brand.naver.com/dearcus/products/11378771632')
    lines.append('```\n')
    lines.append('----------------------------------------\n')

full_md = '\n'.join(lines)
with open('downloads/dearcus_30_dms_perfect.md', 'w', encoding='utf-8') as f:
    f.write(full_md)

print("Generated downloads/dearcus_30_dms_perfect.md with size:", len(full_md))

# Now write into Google Docs (clear and write full_md)
res_clear = subprocess.run([
    'gog', '--account', 'dnjswls1540@gmail.com', 'docs', 'clear', doc_id
], capture_output=True, text=True)
print("Clear result:", res_clear.stdout)

res_write = subprocess.run([
    'gog', '--account', 'dnjswls1540@gmail.com', 'docs', 'write', doc_id,
    '--file', 'downloads/dearcus_30_dms_perfect.md', '--markdown'
], capture_output=True, text=True)
print("Write result:", res_write.stdout)
