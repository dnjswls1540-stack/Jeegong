// 실행: node supabase/functions/ops-sync/ical.test.ts  (배포에는 포함하지 않는 자체 점검)
import assert from "node:assert/strict";
import { parseGongguEvents, parseTitle } from "./ical.ts";

const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261120",
  "DTEND;VALUE=DATE:20261124",
  "UID:a1@google.com",
  "SUMMARY:[공구] 지수맘 아넬라 과일퓨레 진행",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261125T010000Z",
  "DTEND:20261125T150000Z", // 한국 시간 26일 00:00 종료 → 25일로 본다
  "UID:a2@google.com",
  "SUMMARY:[공구] 라임맘 디어커스 뱀부500 대나무 ",
  " 화장지 진행",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Asia/Seoul:20261201T100000",
  "DTEND;TZID=Asia/Seoul:20261203T180000",
  "UID:a3@google.com",
  "SUMMARY:[공구] 하루맘 케이스키니 바디앰플",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261121",
  "DTEND;VALUE=DATE:20261122",
  "UID:x1@google.com",
  "SUMMARY:치과 예약",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261121",
  "UID:x2@google.com",
  "STATUS:CANCELLED",
  "SUMMARY:[공구] 취소된 공구 진행",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ev = parseGongguEvents(ics);
assert.equal(ev.length, 3, "[공구] 일정 3건만(일반·취소 일정 제외)");

const [a, b, c] = ev;
assert.deepEqual(a, {
  uid: "a1@google.com", title: "지수맘 아넬라 과일퓨레", influencer: "지수맘", brand: "아넬라", product: "과일퓨레",
  start_date: "2026-11-20", end_date: "2026-11-23", all_day: true,
}, "종일 일정 종료일 = DTEND - 1일");
assert.equal(b.product, "뱀부500 대나무 화장지", "접힌 줄 이어 붙이기");
assert.equal(b.start_date, "2026-11-25");
assert.equal(b.end_date, "2026-11-25", "UTC → 한국 시간, 자정 종료는 전날");
assert.equal(b.all_day, false);
assert.equal(c.start_date, "2026-12-01");
assert.equal(c.end_date, "2026-12-03");
assert.equal(parseTitle("[공구]").influencer, "");
console.log("ical ok:", ev.length, "events");
