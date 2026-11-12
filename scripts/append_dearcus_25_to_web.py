#!/usr/bin/env python3
import json

with open("jeegong-web/data.json", "r", encoding="utf-8") as f:
    web_data = json.load(f)

with open("data/dearcus_new_25_dashboard.json", "r", encoding="utf-8") as f:
    new_items = json.load(f)

# Find dearcus-bamboo-tissue in gongguCampaigns
dearcus_campaign = None
for c in web_data.get("gongguCampaigns", []):
    if c["id"] == "dearcus-bamboo-tissue":
        dearcus_campaign = c
        break

if not dearcus_campaign:
    raise ValueError("dearcus-bamboo-tissue campaign not found in gongguCampaigns!")

current_influencers = dearcus_campaign.get("influencers", [])
existing_ids = set(inf["id"] for inf in current_influencers)

added = []
for item in new_items:
    if item["id"] in existing_ids:
        print(f"Skipping duplicate: {item['id']}")
        continue
    current_influencers.append(item)
    added.append(item["id"])

print(f"Added {len(added)} new influencers to dearcus-bamboo-tissue. Total now: {len(current_influencers)}")

# Also update gongguCampaign singular if present
if "gongguCampaign" in web_data and web_data["gongguCampaign"].get("id") == "dearcus-bamboo-tissue":
    web_data["gongguCampaign"]["influencers"] = current_influencers

# Save back to data.json
with open("jeegong-web/data.json", "w", encoding="utf-8") as f:
    json.dump(web_data, f, ensure_ascii=False, indent=2)

print("Saved updated jeegong-web/data.json")
