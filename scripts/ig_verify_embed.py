#!/usr/bin/env python3
"""Verify Instagram public accounts without login.

Uses the public profile embed page (https://www.instagram.com/<user>/embed/),
which embeds a JSON payload with the recent posts (comment counts, likes,
taken_at timestamps). No login, no API key.

Parse strategy: anchor on each edge_media_to_comment count (only top-level
media carry one), then take the nearest preceding shortcode and the nearest
following taken_at_timestamp / like count.

Usage:
  python3 scripts/ig_verify_embed.py user1 user2 ... [--json out.json] [--top 6]
"""
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")


def fetch(url, timeout=30):
    p = subprocess.run(
        ["curl", "-s", "-m", str(timeout), "-A", UA,
         "-H", "Accept-Language: ko-KR,ko;q=0.9", url],
        capture_output=True, text=True)
    return p.stdout


def unescape_json_string(s):
    """Decode a JSON string literal that may be escaped once or twice."""
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
    """Extract and fully unescape the caption text of one media object."""
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


def check(username, top=6):
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
    argv = sys.argv[1:]
    out_path, top = None, 6
    if "--json" in argv:
        i = argv.index("--json")
        out_path = argv[i + 1]
        del argv[i:i + 2]
    if "--top" in argv:
        i = argv.index("--top")
        top = int(argv[i + 1])
        del argv[i:i + 2]
    results = []
    for u in argv:
        r = check(u.lstrip("@"), top=top)
        results.append(r)
        print(json.dumps(r, ensure_ascii=False))
        sys.stdout.flush()
        time.sleep(1.2)
    if out_path:
        json.dump(results, open(out_path, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
