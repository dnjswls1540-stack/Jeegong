#!/usr/bin/env python3
import openpyxl, json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.append('.')
from scripts.verify_candidates_fast import check_one

# 1. Load dashboard handles & excluded
with open('jeegong-web/data.json', 'r', encoding='utf-8') as f:
    web_data = json.load(f)

dashboard_handles = set()
for c in web_data.get('gongguCampaigns', []):
    for inf in c.get('influencers', []):
        dashboard_handles.add(inf['id'].lower().replace('@', '').strip())

wb = openpyxl.load_workbook('data/master_sheet_latest.xlsx', data_only=True)
ws = wb['인플루언서 List']

def parse_follow(val):
    if not val:
        return 0
    s = str(val).strip().replace(',', '')
    m = re.search(r'([\d.]+)\s*만', s)
    if m:
        return float(m.group(1)) * 10000
    m2 = re.search(r'([\d.]+)\s*천', s)
    if m2:
        return float(m2.group(1)) * 1000
    try:
        return float(s)
    except:
        return 0

dearcus_cands = []

for r in range(2, ws.max_row + 1):
    insta_id = ws.cell(row=r, column=1).value
    if not insta_id:
        continue
    handle = str(insta_id).lower().replace('@', '').strip()
    
    proposed = ws.cell(row=r, column=12).value
    prod = ws.cell(row=r, column=13).value
    pdate = ws.cell(row=r, column=14).value
    
    is_proposed = bool(proposed and str(proposed).strip().upper() == 'O') or bool(prod) or bool(pdate)
    if is_proposed:
        continue
    if handle in dashboard_handles:
        continue
        
    follow_raw = ws.cell(row=r, column=2).value or ''
    follow_num = parse_follow(follow_raw)
    
    living = ws.cell(row=r, column=7).value
    parenting = ws.cell(row=r, column=8).value
    food = ws.cell(row=r, column=9).value
    detail = str(ws.cell(row=r, column=15).value or '')
    kakao = str(ws.cell(row=r, column=17).value or '')
    
    keywords = ['살림', '주방', '인테리어', '청소', '집밥', '요리', '홈스타일', '생활']
    has_kw = any(kw in detail for kw in keywords)
    
    if (living or has_kw) and follow_num >= 30000:
        if '방송인' in detail or '인스타툰' in detail or '기자' in detail:
            continue
        dearcus_cands.append({
            'row': r,
            'handle': handle,
            'follow_raw': str(follow_raw),
            'follow_num': follow_num,
            'living': bool(living),
            'detail': detail,
            'kakao': kakao
        })

print(f'Starting verification for {len(dearcus_cands)} candidates...')

handles = [c['handle'] for c in dearcus_cands]
with ThreadPoolExecutor(max_workers=10) as ex:
    verify_results = list(ex.map(check_one, handles))

verified_map = {r['username']: r for r in verify_results}

# Match back and evaluate
passed = []
failed = []

for c in dearcus_cands:
    vr = verified_map.get(c['handle'], {})
    if 'error' in vr:
        c['fail_reason'] = f"접속 실패/계정 미존재 ({vr.get('error')})"
        failed.append(c)
        continue
        
    days = vr.get('days_since_latest', 999)
    if days > 30:
        c['fail_reason'] = f"1개월 초과 휴면 계정 (최근 게시 {days}일 전)"
        failed.append(c)
        continue
        
    avg_c = vr.get('avg_comments', 0)
    med_c = vr.get('median_comments', 0)
    max_c = vr.get('max_comments', 0)
    
    # Dearcus criteria: avg comments >= 70 or median >= 50
    if avg_c < 50:  # Check threshold
        c['fail_reason'] = f"댓글 지표 미달 (평균 {avg_c}개 / 중위 {med_c}개)"
        failed.append(c)
        continue
        
    c['verified'] = vr
    passed.append(c)

print(f'Total passed initial metrics: {len(passed)}')
with open('data/dearcus_sheet_screened.json', 'w', encoding='utf-8') as f:
    json.dump({'passed': passed, 'failed': failed}, f, ensure_ascii=False, indent=2)

print('Saved to data/dearcus_sheet_screened.json')
