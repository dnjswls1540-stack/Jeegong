-- 원천징수: 구글 드라이브 "원천징수_신고리스트.xlsx" 월 시트 값을 저장 (매달 말일 Claude 예약 작업이 갱신)
-- names 는 셀러 활동명만 저장한다. 실명·주민등록번호·계좌번호는 저장하지 않는다.
alter table public.ops_withholding add column if not exists people integer;
alter table public.ops_withholding add column if not exists total bigint;
alter table public.ops_withholding add column if not exists names text[];
alter table public.ops_withholding add column if not exists sheet_synced_at timestamptz;

-- 원천징수 알림 인원도 시트 값을 우선 사용
create or replace view public.ops_alerts with (security_invoker = true) as
with d as (select (now() at time zone 'Asia/Seoul')::date as today),
wh as (
  select date_trunc('month', coalesce(s.start_date, s.end_date))::date as month, count(distinct s.influencer) as people
  from public.ops_settlements s
  where s.is_individual and coalesce(s.start_date, s.end_date) is not null
  group by 1
)
select 'event_end'::text as kind, 'warn'::text as level, e.end_date as due_date,
       e.title as title, e.id as ref_id
from public.ops_gonggu_events e, d
where not e.removed and e.end_date between d.today and d.today + 3
union all
select case when s.due_date < d.today then 'settle_late' else 'settle_due' end,
       case when s.due_date < d.today then 'danger' else 'warn' end,
       s.due_date, s.title, s.id
from public.ops_settlements s, d
where s.status in ('waiting','amount') and s.due_date is not null and s.due_date <= d.today + 3
union all
select 'sourcing_follow',
       case when o.follow_up_date < d.today then 'danger' else 'warn' end,
       o.follow_up_date, trim(o.brand || ' ' || o.product), o.id
from public.ops_sourcing o, d
where o.stage not in ('confirmed','hold') and o.follow_up_date is not null and o.follow_up_date <= d.today + 3
union all
select 'withholding',
       case when d.today > m.due then 'danger' else 'warn' end,
       m.due,
       to_char(m.month, 'YYYY-MM') || ' 공구분 원천징수 신고' || coalesce(' · ' || coalesce(w.people, wh.people) || '명', ''),
       null::uuid
from d
cross join lateral (
  select (date_trunc('month', d.today) - interval '1 month')::date as month,
         (date_trunc('month', d.today) + interval '9 days')::date as due
) m
left join wh on wh.month = m.month
left join public.ops_withholding w on w.month = m.month
where coalesce(w.filed, false) = false
  and d.today >= m.due - 3
  and (d.today <= m.due or coalesce(w.people, wh.people, 0) > 0);
revoke all on public.ops_alerts from anon;
grant select on public.ops_alerts to authenticated;
