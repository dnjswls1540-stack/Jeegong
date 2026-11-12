import json
import openpyxl
import os
import subprocess

candidates_data = [
    {
        'row': 225,
        'id': 'dana_danaspick',
        'name': '데이나',
        'follow': '23.1만',
        'url': 'https://www.instagram.com/dana_danaspick/',
        'cat': '바디케어, 스킨케어, 뷰티, 다이어트',
        'note': '지속가능한 뷰티습관 헬스코칭, 프로틴쉐이크·탄력앰플 공구 셀러',
        'intro': '건강과 아름다움을 직접 파헤치며 지속 가능한 뷰티 습관을 전해주시는 모습 늘 인상 깊게 보고 있습니다! 단백질 쉐이크와 탄력 앰플 등 바디·스킨케어에 진심이신 대표님 팔로워분들께 바디라인 정리를 돕는 PCL 앰플은 반응이 뜨거울 상품입니다😁'
    },
    {
        'row': 262,
        'id': 'hea_utiful',
        'name': '희쌤',
        'follow': '23.8만',
        'url': 'https://www.instagram.com/hea_utiful/',
        'cat': '홈트, 산후 다이어트, 바디라인, 필라테스',
        'note': '10년차 필라테스 강사, 쌍둥이 출산 후 -14kg 감량 체형관리',
        'intro': '쌍둥이 출산 후 조리원에서부터 건강하게 체형을 회복해 가시는 모습 정말 멋지고 큰 귀감이 되고 있습니다! 산후 무리한 운동 없이도 늘어진 뱃살과 복부 탄력을 집중 케어할 수 있어 산후 다이어트와 라인 정리가 절실한 대표님 팔로워분들께 딱 맞는 제품입니다😁'
    },
    {
        'row': 272,
        'id': '___dodoi',
        'name': '도이키친',
        'follow': '18.4만',
        'url': 'https://www.instagram.com/___dodoi/',
        'cat': '다이어트, 헬스, 바디라인, 식단',
        'note': '팔뚝살 없애는 루틴·건강 레시피 크리에이터, 헬스 바디케어',
        'intro': '출렁거리는 팔뚝살 없애는 실전 운동 루틴과 건강한 식단을 함께 나눠주시는 모습 정말 유익하게 보았습니다! 대표님이 강조하시는 고민 부위 집중 관리 루틴에 바르는 PCL 앰플이 더해지면 팔로워분들께 비포·애프터 시너지가 폭발할 상품입니다😁'
    },
    {
        'row': 303,
        'id': 'hyoris2',
        'name': '효리',
        'follow': '19.6만',
        'url': 'https://www.instagram.com/hyoris2/',
        'cat': '자기관리, 뷰티, 운동, 체형관리',
        'note': '복싱·자기관리 라이프스타일, 음식물 과민증 검사 공구 셀러',
        'intro': '복싱과 꾸준한 자기관리로 탄탄한 일상과 에너지를 보여주시는 모습 늘 매력적으로 보고 있습니다! 운동과 식단 관리에 관심 많은 대표님 팔로워분들께 고민 부위의 바디라인을 빠르게 살려주는 PCL 앰플은 시너지가 확실할 아이템입니다😁'
    },
    {
        'row': 324,
        'id': 'hansomang',
        'name': '더위시',
        'follow': '17.0만',
        'url': 'https://www.instagram.com/hansomang/',
        'cat': '뷰티, 바디케어, 자기관리, 슬리밍',
        'note': '스킨케어·압박스타킹 공구 셀러, 라인 관리 특화',
        'intro': '슬림한 핏을 완성하는 압박스타킹과 프리미엄 스킨케어로 팔로워분들의 큰 사랑을 받으시는 모습 인상 깊게 보았습니다! 하체와 팔뚝 등 군살 고민을 바르는 것만으로 관리할 수 있는 고기능성 PCL 앰플이라 대표님 피드와 완벽하게 어우러질 상품입니다😁'
    },
    {
        'row': 439,
        'id': 'gil.raim_1204',
        'name': '라임언니',
        'follow': '14.9만',
        'url': 'https://www.instagram.com/gil.raim_1204/',
        'cat': '다이어트, 바디케어, 자기관리, 뷰티',
        'note': '-10kg 감량 직장인 다이어터, LDM 리프팅 기기·콜라겐 공구 셀러',
        'intro': '-10kg 감량 후 우아한 자기관리와 감각적인 코디를 보여주시는 모습 팔로워분들께 큰 동기부여가 되고 있습니다! 탄력 기기와 이너뷰티를 애정하시는 대표님 팔로워분들께 팔뚝·뱃살 고민 부위를 집중 관리해 주는 PCL 바디앰플은 반응이 매우 뜨거울 상품입니다😁'
    },
    {
        'row': 468,
        'id': 'walking_yang',
        'name': '양가',
        'follow': '12.2만',
        'url': 'https://www.instagram.com/walking_yang/',
        'cat': '다이어트, 건강식품, 체형관리, 자기관리',
        'note': '-25kg 실전 감량 다이어터, 플라이밀 단백질쉐이크 공구 셀러',
        'intro': '직접 체중을 감량하며 실전 다이어트 노하우와 유쾌한 에너지를 전해주시는 모습 늘 든든하게 보고 있습니다! 단백질 쉐이크와 식단으로 감량 중인 대표님 팔로워분들께 마지막 군살과 라인을 정리해 주는 PCL 바디앰플은 찰떡궁합의 메인템이 될 것입니다😁'
    },
    {
        'row': 650,
        'id': 'soori_table',
        'name': '수리테이블',
        'follow': '10.9만',
        'url': 'https://www.instagram.com/soori_table/',
        'cat': '다이어트, 식단, 건강식품, 자기관리',
        'note': '다이어트 레시피·입맛리셋 크리에이터, 당구마 공구 셀러',
        'intro': '맛있고 지속 가능한 다이어트 레시피와 꿀팁으로 건강한 식단을 이끌어주시는 모습 늘 유익하게 보고 있습니다! 식단 조절과 함께 복부와 허벅지 라인을 간편하게 관리할 수 있는 바디앰플이라 대표님 팔로워분들의 다이어트 니즈를 완벽히 채워줄 상품입니다😁'
    },
    {
        'row': 734,
        'id': 'sugarbee_mj',
        'name': '슈가비',
        'follow': '8.8만',
        'url': 'https://www.instagram.com/sugarbee_mj/',
        'cat': '뷰티, 헬스, 자기관리, 바디케어',
        'note': '40대 아들둘맘 뷰티/헬스, 하체PT·석류콜라겐 공구 셀러',
        'intro': '40대 두 아들의 엄마로서 바디프로필까지 해내시며 철저한 헬스와 뷰티 관리를 보여주시는 모습 정말 존경스럽습니다! 운동과 이너뷰티를 챙기시는 대표님 팔로워분들께 나잇살과 처진 탄력을 끌어올리는 PCL 바디앰플은 설득력이 남다를 상품입니다😁'
    },
    {
        'row': 788,
        'id': 'to.ongs_',
        'name': '토옹쓰',
        'follow': '10.5만',
        'url': 'https://www.instagram.com/to.ongs_/',
        'cat': '다이어트, 추천템, 식단, 자기관리',
        'note': '다이어트 식단·추천템 크리에이터, 한끼통살 다이어트 공구 셀러',
        'intro': '부담 없는 일주일 다이어트 도시락과 찐 추천템들로 현실적인 감량 팁을 주시는 모습 늘 재미있게 보고 있습니다! 식단 관리와 함께 군살과 뱃살을 간편하게 정리할 수 있는 PCL 바디앰플이라 대표님 팔로워분들의 다이어트 장바구니에 쏙 들어갈 상품입니다😁'
    }
]

def make_dm_text(name, intro):
    return (
        f"3주면 뱃살·팔뚝살! 빠지는 바디라인 앰플 공구 협업 제안드립니다 :)\n\n"
        f"안녕하세요 {name} 대표님!\n"
        f"저희는 공동구매 전문 벤더사 올쓰컴퍼니입니다.\n\n"
        f"{intro}\n\n"
        f"턱선부터 복부, 팔뚝, 허벅지까지 원하는 부위에\n"
        f"간편하게 바르는 케이스키니 PCL 바디앰플 소개드립니다😊\n\n"
        f"👉 뱃살·팔뚝살·허벅지 등 고민 부위별 집중 홈케어!\n"
        f"👉 3주간 바르면서 관리하는 바디라인 케어 루틴\n"
        f"👉 별도 기기 없이 원하는 부위에 바르기만 하면 끝!\n"
        f"👉 국제특허 기술을 적용한 5나노 PCL 바디앰플\n"
        f"👉 와디즈 13차 완판 및 누적 12억 매출까지🔥\n\n"
        f"특히 이 제품은 오래 테스트하기 보다, 며칠간 사용 과정을 빌드업하고,\n"
        f"실제 비포·애프터를 영상으로 보여주는 콘텐츠 방식에 적합합니다!\n\n"
        f"대표님께서 직접 고민하는 부위를 선택해 사용 과정을 소개할 수 있어\n"
        f"이번 다이어트 메인템으로 자신 있게 추천드립니다 :)\n\n"
        f"상품페이지도 아래에 남겨놓겠습니다ㅎㅎ\n"
        f"https://kskinny.co.kr/product/detail.html?product_no=24"
    )

# 1. Update master sheet detailed category (column 15)
wb = openpyxl.load_workbook('master_sheet_latest.xlsx')
sheet = wb['인플루언서 List']
for c in candidates_data:
    r = c['row']
    sheet.cell(row=r, column=15, value=c['cat'])
wb.save('master_sheet_latest.xlsx')
print('Updated master_sheet_latest.xlsx category details.')

# 2. Update jeegong-web/data.json
with open('jeegong-web/data.json', 'r', encoding='utf-8') as f:
    web_data = json.load(f)

for camp in web_data.get('gongguCampaigns', []):
    if camp['id'] == 'kskinny-body-ampoule':
        curr_infs = camp.get('influencers', [])
        start_num = len(curr_infs) + 1
        for idx, c in enumerate(candidates_data):
            num = start_num + idx
            entry = {
                'num': num,
                'row': c['row'],
                'id': c['id'],
                'name': c['name'],
                'follow': c['follow'],
                'url': c['url'],
                'cat': c['cat'],
                'kakao': '',
                'note': c['note'],
                'intro': c['intro'],
                'dmText': make_dm_text(c['name'], c['intro']),
                'sent': False
            }
            curr_infs.append(entry)
        camp['influencers'] = curr_infs
        print(f"kskinny-body-ampoule campaign now has {len(curr_infs)} influencers.")

with open('jeegong-web/data.json', 'w', encoding='utf-8') as f:
    json.dump(web_data, f, ensure_ascii=False, indent=2)

print('Updated jeegong-web/data.json successfully.')
