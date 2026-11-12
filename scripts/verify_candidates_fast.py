#!/usr/bin/env python3
"""Parallel Instagram embed verifier using ig_verify_embed.py logic."""
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")

def fetch(url, timeout=15):
    try:
        p = subprocess.run(
            ["curl", "-s", "-m", str(timeout), "-A", UA,
             "-H", "Accept-Language: ko-KR,ko;q=0.9", url],
            capture_output=True, text=True, timeout=timeout + 2)
        return p.stdout
    except Exception:
        return ""

def unescape_json_string(s):
    for _ in range(3):
        try:
            new = json.loads('"' + s + '"')
        except Exception:
            break
        if new == s:
            break
        s = new
    return s

def _clean_caption(seg):
    i = seg.rfind("edge_media_to_caption")
    if i < 0:
        return ""
    w = re.sub(r'\\+"', '"', seg[i:i + 12000])
    m = re.search(r'"text":"((?:[^"\\]|\\.)*)"', w)
    if not m:
        return ""
    s = m.group(1)
    for _ in range(4):
        try:
            new = json.loads('"' + s + '"')
        except Exception:
            break
        if new == s:
            break
        s = new
    return s

def parse_posts(html, top=6):
    anchors = list(re.finditer(r'edge_media_to_comment\\":\{\\"count\\":(\d+)', html))
    scs = [m.start() for m in re.finditer(r'shortcode\\":\\"([A-Za-z0-9_-]{5,20})\\"', html)]
    sc_map = {}
    for m in re.finditer(r'shortcode\\":\\"([A-Za-z0-9_-]{5,20})\\"', html):
        sc_map[m.start()] = m.group(1)
    ts_all = [(m.start(), int(m.group(1)))
              for m in re.finditer(r'taken_at_timestamp\\":(\d+)', html)]
    like_all = [(m.start(), int(m.group(1)))
                for m in re.finditer(r'edge_liked_by\\":\{\\"count\\":(\d+)', html)]
    posts, seen = [], set()
    for a in anchors:
        prev_sc = [p for p in scs if p < a.start()]
        if not prev_sc:
            continue
        sc = sc_map[prev_sc[-1]]
        if sc in seen:
            continue
        nxt_ts = [t for t in ts_all if t[0] > a.start()]
        if not nxt_ts:
            continue
        ts = nxt_ts[0][1]
        likes = None
        nxt_l = [l for l in like_all if l[0] > a.start()]
        if nxt_l:
            likes = nxt_l[0][1]
        seen.add(sc)
        caption = _clean_caption(html[max(0, a.start() - 30000): a.start()])
        posts.append({
            "shortcode": sc,
            "comments": int(a.group(1)),
            "likes": likes,
            "ts": ts,
            "date": datetime.fromtimestamp(ts, tz=timezone.utc)
                             .astimezone().strftime("%Y-%m-%d"),
            "caption": caption[:500],
        })
    posts.sort(key=lambda p: p["ts"], reverse=True)
    return posts[:top]

def field(html, key):
    m = re.search(key + r'\\":\\"((?:[^"\\]|\\.)*?)\\"', html)
    if not m:
        return None
    raw = m.group(1)
    return unescape_json_string(raw)

def profile_meta(html):
    out = {}
    m = re.search(r'edge_followed_by\\":\{\\"count\\":(\d+)', html)
    if not m:
        m = re.search(r'follower_count\\":(\d+)', html)
    if m:
        out["followers"] = int(m.group(1))
    for k, name in (("full_name", "name"), ("biography", "bio"), ("external_url", "link")):
        v = field(html, k)
        if v is not None:
            out[name] = v
    return out

def check_one(username, top=6):
    html = fetch(f"https://www.instagram.com/{username}/embed/")
    if len(html) < 5000 or "Page Not Found" in html[:20000]:
        return {"username": username, "error": "not_found_or_blocked", "size": len(html)}
    posts = parse_posts(html, top)
    meta = profile_meta(html)
    res = {"username": username, **meta, "posts": posts, "posts_found": len(posts)}
    if posts:
        cs = [p["comments"] for p in posts]
        res["avg_comments"] = round(sum(cs) / len(cs), 1)
        res["median_comments"] = sorted(cs)[len(cs) // 2]
        res["max_comments"] = max(cs)
        res["latest"] = posts[0]["date"]
        res["days_since_latest"] = (datetime.now(timezone.utc)
                                    - datetime.fromtimestamp(posts[0]["ts"], tz=timezone.utc)).days
    return res

def main():
    users = sys.argv[1:]
    if not users:
        print("Usage: python3 scripts/verify_candidates_fast.py user1 user2 ...")
        sys.exit(1)
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(check_one, users))
    for r in results:
        print(json.dumps(r, ensure_ascii=False))

if __name__ == "__main__":
    main()
