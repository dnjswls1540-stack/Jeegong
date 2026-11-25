-- 예약 실행
--  · 캘린더 동기화: 한국 시간 09·13·17·20시 (Edge Function ops-sync 호출)
--  · 휴대폰 마감 알림: 한국 시간 09:05, DB 가 ntfy 로 직접 발송
--    (Edge Function 은 여러 고객이 같은 IP 를 써서 ntfy 가 429 로 막는 경우가 있어 DB 에서 보낸다. 2026-11-25 확인)
-- 호출 키(cron_key)·알림 주제(alert_topic)는 DB(ops_meta)에서 읽으므로 이 파일에 비밀값이 없다.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

drop function if exists public.ops_call_sync(boolean);
create or replace function public.ops_call_sync() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://ipxbmrvadxrvuveujaaq.supabase.co/functions/v1/ops-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select value->>'key' from public.ops_meta where key = 'cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$$;
revoke all on function public.ops_call_sync() from public, anon, authenticated;

-- 이름·금액 없이 종류별 건수만 보낸다 (ntfy 주제는 주소만 알면 누구나 읽을 수 있음)
create or replace function public.ops_push_alerts() returns bigint
language plpgsql security definer set search_path = '' as $$
declare msg text; danger boolean; topic text;
begin
  select string_agg(label || ' ' || n || '건', ' · ' order by ord), bool_or(has_danger) into msg, danger
  from (
    select count(*) as n, bool_or(level = 'danger') as has_danger,
      case kind when 'settle_late' then '정산 지연' when 'settle_due' then '정산 예정' when 'event_end' then '공구 종료'
                when 'sourcing_follow' then '소싱 후속 연락' else '원천징수 신고' end as label,
      case kind when 'settle_late' then 1 when 'withholding' then 2 when 'settle_due' then 3 when 'event_end' then 4 else 5 end as ord
    from public.ops_alerts group by kind
  ) c;
  select value->>'topic' into topic from public.ops_meta where key = 'alert_topic';
  if msg is null or topic is null then return null; end if;
  return net.http_post(
    url := 'https://ntfy.sh/',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'topic', topic,
      'title', case when danger then '지공 마감 알림 · 지난 마감 있음' else '지공 마감 알림' end,
      'message', msg,
      'priority', case when danger then 4 else 3 end,
      'tags', jsonb_build_array(case when danger then 'rotating_light' else 'bell' end),
      'click', 'https://dnjswls1540-stack.github.io/Jeegong/'));
end $$;
revoke all on function public.ops_push_alerts() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('ops-sync-0900', 'ops-sync-day', 'ops-sync', 'ops-alerts');
select cron.schedule('ops-sync', '0 0,4,8,11 * * *', 'select public.ops_call_sync()');
select cron.schedule('ops-alerts', '5 0 * * *', 'select public.ops_push_alerts()');
