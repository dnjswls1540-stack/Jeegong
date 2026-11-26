-- 정산에 공구 시작일 추가: 월별 실적·원천징수를 "공구 진행 월(시작일)" 기준으로 묶는다
-- (2026-11-26 원진님 확정: 기존 시트 대시보드·원천징수_신고리스트와 같은 기준)
alter table public.ops_settlements add column if not exists start_date date;
update public.ops_settlements s set start_date = e.start_date
from public.ops_gonggu_events e where e.id = s.event_id and s.start_date is null;

create or replace function public.ops_create_due_settlements() returns integer
language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.ops_settlements (event_id, title, influencer, brand, product, start_date, end_date)
    select e.id, e.title, e.influencer, e.brand, e.product, e.start_date, e.end_date
    from public.ops_gonggu_events e
    where not e.removed
      and e.end_date < (now() at time zone 'Asia/Seoul')::date
      and not exists (select 1 from public.ops_settlements s where s.event_id = e.id)
    on conflict (event_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.ops_create_due_settlements() from public, anon, authenticated;
grant execute on function public.ops_create_due_settlements() to service_role;

-- 원천징수 알림: 지난달 공구분(개인 3.3%) 인원 = 활동명 기준 사람 수
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
       to_char(m.month, 'YYYY-MM') || ' 공구분 원천징수 신고' || coalesce(' · ' || wh.people || '명', ''),
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
  and (d.today <= m.due or coalesce(wh.people, 0) > 0);
revoke all on public.ops_alerts from anon;
grant select on public.ops_alerts to authenticated;
