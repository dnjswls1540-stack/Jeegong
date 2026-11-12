import json
import openpyxl

wb = openpyxl.load_workbook('downloads/influencers_compact_final.xlsx')
ws = wb['인플루언서 List']

with open('jeegong-web/data.json', 'r', encoding='utf-8') as f:
    web_data = json.load(f)

influencers = web_data['gongguCampaign']['influencers']
for inf in influencers:
    r = inf['row']
    dm_text = ws.cell(r, 18).value
    inf['dmText'] = dm_text

with open('jeegong-web/data.json', 'w', encoding='utf-8') as f:
    json.dump(web_data, f, indent=2, ensure_ascii=False)

print("Updated jeegong-web/data.json with compact DMs successfully!")
