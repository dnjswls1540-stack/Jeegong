// 지공 대시보드 서버 작업: 캘린더 [공구] 일정 동기화 → 종료 공구 정산 대기 생성
// (휴대폰 마감 알림은 DB 함수 ops_push_alerts 가 보낸다 — migrations/20261125_ops_cron.sql)
// 호출: 예약 실행(x-cron-key) 또는 대시보드 "지금 동기화"(소유자 로그인 토큰)
// 비밀값 GONGGU_ICAL_URL 은 Supabase > Edge Functions > Secrets 에만 둔다.
import { parseGongguEvents } from "./ical.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`DB ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const meta = async (key: string) => (await db(`ops_meta?key=eq.${key}&select=value`))?.[0]?.value ?? {};
const saveMeta = (key: string, value: unknown) =>
  db("ops_meta?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key, value }),
  });

async function authorized(req: Request) {
  const cronKey = (await meta("cron_key")).key;
  if (cronKey && req.headers.get("x-cron-key") === cronKey) return true;
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  if (jwt === SR_KEY) return true;
  const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SR_KEY, Authorization: `Bearer ${jwt}` } });
  if (!res.ok) return false;
  const { id } = await res.json();
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return false;
  return (await db(`ops_owner?user_id=eq.${id}&select=user_id`)).length > 0;
}

async function syncCalendar() {
  const icalUrl = Deno.env.get("GONGGU_ICAL_URL");
  if (!icalUrl) throw new Error("GONGGU_ICAL_URL 비밀값이 아직 없습니다 (Supabase > Edge Functions > Secrets)");
  const res = await fetch(icalUrl);
  if (!res.ok) throw new Error(`캘린더 주소 응답 오류 ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("캘린더 주소가 iCal 형식이 아닙니다");
  const events = parseGongguEvents(text);
  const now = new Date().toISOString();
  if (events.length) {
    await db("ops_gonggu_events?on_conflict=uid", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(events.map((e) => ({ ...e, removed: false, synced_at: now }))),
    });
    // 이번에 안 들어온 일정 = 캘린더에서 지워진 일정 (빈 응답일 때는 건드리지 않는다)
    await db(`ops_gonggu_events?removed=eq.false&synced_at=lt.${encodeURIComponent(now)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ removed: true }),
    });
  }
  return events.length;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!(await authorized(req))) return json({ ok: false, error: "권한이 없습니다" }, 401);
    let count = 0, error = "";
    try { count = await syncCalendar(); } catch (e) { error = String((e as Error).message ?? e); }
    // 동기화가 실패해도 이미 저장된 일정으로 정산 대기 생성은 계속한다
    const created: number = await db("rpc/ops_create_due_settlements", { method: "POST", body: "{}" });
    const at = new Date().toISOString();
    await saveMeta("calendar_sync", error ? { ok: false, at, error, created } : { ok: true, at, count, created });
    return json({ ok: !error, count, created, error: error || undefined });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
