import json
import openpyxl

# Load excel for 30 rows
wb = openpyxl.load_workbook('downloads/influencers_r_col_final.xlsx')
ws = wb['인플루언서 List']

influencers = []
for r in range(2219, 2249):
    uid = ws.cell(r, 1).value
    follow = ws.cell(r, 2).value
    url = ws.cell(r, 3).value
    cat = ws.cell(r, 15).value
    kakao = ws.cell(r, 19).value
    dm_text = ws.cell(r, 18).value
    
    note = "⚠️ 타사 대나무 휴지 공구 진행 중 (~11/8)" if uid == "very_mj" else ""
    
    influencers.append({
        "num": r - 2218,
        "row": r,
        "id": uid,
        "follow": follow,
        "url": url,
        "cat": cat,
        "kakao": kakao or "",
        "note": note,
        "dmText": dm_text or ""
    })

print(f"Loaded {len(influencers)} influencers")

# Load jeegong-web/data.json
with open('jeegong-web/data.json', 'r', encoding='utf-8') as f:
    web_data = json.load(f)

# Add gongguCampaign object to root or latest briefing
web_data['gongguCampaign'] = {
    "product": "디어커스 뱀부500 대나무 화장지",
    "requestDate": "2026-11-05",
    "target": "리빙, 살림, 청소, 주방, 요리",
    "conditions": "팔로워 3만+, 평균 댓글 100개+, 최근 1달 활동, 중복 0건",
    "totalCount": len(influencers),
    "influencers": influencers
}

with open('jeegong-web/data.json', 'w', encoding='utf-8') as f:
    json.dump(web_data, f, indent=2, ensure_ascii=False)

print("Saved jeegong-web/data.json with gongguCampaign successfully!")
