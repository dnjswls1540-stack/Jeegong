// 구글 캘린더 비공개 iCal 에서 제목이 [공구] 로 시작하는 일정만 뽑는다.
export type GongguEvent = {
  uid: string; title: string; influencer: string; brand: string; product: string;
  start_date: string; end_date: string; all_day: boolean;
};
type Prop = { params: string; value: string };

const KST = 9 * 3600 * 1000;
const DAY = 86400 * 1000;

const unescapeText = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// shortcut: TZID 가 붙은 시간은 한국 시간으로 보고, Z(UTC)만 +9시간 한다. 해외 시간대 일정이 생기면 TZID 변환을 추가.
function parseDt(p: Prop) {
  const m = p.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = h === undefined || /VALUE=DATE(?!-)/i.test(p.params);
  let ms = Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(s ?? 0));
  if (z) ms += KST;
  return { ms, allDay };
}

// "[공구] 지수맘 아넬라 과일퓨레 진행" → 활동명 / 브랜드 / 상품
export function parseTitle(summary: string) {
  const title = summary.replace(/^\[공구\]\s*/, "").replace(/\s*진행\s*$/, "").trim();
  const [influencer = "", brand = "", ...rest] = title.split(/\s+/);
  return { title, influencer, brand, product: rest.join(" ") };
}

function toEvent(p: Record<string, Prop>): GongguEvent | null {
  const summary = unescapeText(p.SUMMARY?.value ?? "");
  if (!summary.startsWith("[공구]") || !p.UID || !p.DTSTART) return null;
  if ((p.STATUS?.value ?? "").toUpperCase() === "CANCELLED") return null;
  const start = parseDt(p.DTSTART);
  if (!start) return null;
  const end = p.DTEND ? parseDt(p.DTEND) : null;
  // 종일 일정의 DTEND 는 마지막 날의 "다음 날"이라 하루 뺀다. 시간 일정은 1초 빼서 자정 종료가 다음 날로 넘어가지 않게 한다.
  const endMs = end && end.ms > start.ms ? end.ms - (start.allDay ? DAY : 1000) : start.ms;
  const rid = p["RECURRENCE-ID"]?.value;
  // shortcut: 반복 일정(RRULE)은 첫 회차만 잡는다. [공구] 반복 일정을 쓰게 되면 회차 펼치기를 추가.
  return {
    uid: rid ? `${p.UID.value}#${rid}` : p.UID.value,
    ...parseTitle(summary),
    start_date: ymd(start.ms),
    end_date: ymd(endMs),
    all_day: start.allDay,
  };
}

export function parseGongguEvents(ics: string): GongguEvent[] {
  const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out = new Map<string, GongguEvent>();
  let cur: Record<string, Prop> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      const ev = cur && toEvent(cur);
      if (ev) out.set(ev.uid, ev);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (m && !(m[1] in cur)) cur[m[1]] = { params: m[2], value: m[3] };
  }
  return [...out.values()];
}
