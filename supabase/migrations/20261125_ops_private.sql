-- 지공 대시보드 업무관리(정산·매출·공구 일정·인플루언서 정산·상품 소싱·원천징수) 비공개 저장소
-- 모든 테이블은 RLS로 잠그고, ops_owner 에 등록된 로그인 사용자만 읽고 쓸 수 있다.
-- 이 파일에는 이메일·비밀값을 넣지 않는다(공개 저장소).

-- 1) 소유자 목록: 정책·서버 함수만 읽는다(직접 조회 정책 없음)
create table if not exists public.ops_owner (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.ops_owner enable row level security;

create or replace function public.ops_is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ops_owner where user_id = (select auth.uid()));
$$;
revoke all on function public.ops_is_owner() from public, anon;
grant execute on function public.ops_is_owner() to authenticated;

create or replace function public.ops_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

-- 2) 매출 입력 (내 수수료 매출·순수익, 직접 입력)
create table if not exists public.ops_revenue (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),          -- 귀속 월(매달 1일)
  business text not null check (business in ('gonggu','paynote','onsess')),
  title text not null default '',
  revenue bigint not null default 0,
  net_profit bigint not null default 0,
  settlement_id uuid unique,                                          -- 정산 완료 공구에서 넘어온 줄
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) 월별 목표 순수익
create table if not exists public.ops_targets (
  month date primary key check (extract(day from month) = 1),
  target_net bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) 구글 캘린더 [공구] 일정 (서버 동기화 전용, 화면은 읽기만)
create table if not exists public.ops_gonggu_events (
  id uuid primary key default gen_random_uuid(),
  uid text not null unique,
  title text not null,
  influencer text not null default '',
  brand text not null default '',
  product text not null default '',
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  removed boolean not null default false,                             -- 캘린더에서 지워진 일정
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 5) 인플루언서 정산
create table if not exists public.ops_settlements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid unique references public.ops_gonggu_events(id) on delete set null,
  title text not null default '',
  influencer text not null default '',
  brand text not null default '',
  product text not null default '',
  end_date date,
  due_date date,                                                      -- 정산 예정일
  gross_sales bigint,                                                 -- 판매 총액
  payout bigint,                                                      -- 정산 금액(인플루언서 지급)
  my_fee bigint,                                                      -- 내 수수료 매출
  is_individual boolean not null default false,                       -- 개인 3.3% 원천징수 대상
  paid_date date,                                                     -- 지급·입금일(원천징수 귀속 월 기준)
  status text not null default 'waiting' check (status in ('waiting','amount','paid','done')),
  revenue_skipped boolean not null default false,                     -- 매출 미리 채우기 건너뜀
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6) 상품 소싱
create table if not exists public.ops_sourcing (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('건강','뷰티','패션','리빙','육아','식품','애견','여행')),
  product text not null default '',
  url text not null default '',
  brand text not null default '',
  email text not null default '',
  phone text not null default '',
  other_contact text not null default '',
  proposed_date date,
  stage text not null default 'proposed' check (stage in ('proposed','waiting','negotiating','confirmed','hold')),
  follow_up_date date,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7) 원천징수 신고 완료 여부 (지급 월 기준)
create table if not exists public.ops_withholding (
  month date primary key check (extract(day from month) = 1),
  filed boolean not null default false,
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 8) 서버 상태값(캘린더 동기화 결과, 알림 주제, 예약 실행 키)
create table if not exists public.ops_meta (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.ops_meta(key, value) values
  ('cron_key', jsonb_build_object('key', replace(gen_random_uuid()::text, '-', ''))),
  ('alert_topic', jsonb_build_object('topic', 'jeegong-alert-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)))
on conflict (key) do nothing;

-- updated_at 자동 기록
do $$
declare t text;
begin
  foreach t in array array['ops_revenue','ops_targets','ops_settlements','ops_sourcing','ops_withholding','ops_meta'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.ops_touch()', t, t);
  end loop;
end $$;

-- RLS: 소유자만 읽고 쓰기 / 캘린더 일정·서버 상태값은 소유자도 읽기만
do $$
declare t text;
begin
  foreach t in array array['ops_revenue','ops_targets','ops_settlements','ops_sourcing','ops_withholding'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using ((select public.ops_is_owner())) with check ((select public.ops_is_owner()))', t);
  end loop;
  foreach t in array array['ops_gonggu_events','ops_meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_read on public.%I', t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select public.ops_is_owner()))', t);
  end loop;
end $$;
revoke all on public.ops_owner, public.ops_revenue, public.ops_targets, public.ops_gonggu_events,
  public.ops_settlements, public.ops_sourcing, public.ops_withholding, public.ops_meta from anon;

-- 종료된 공구 → 정산 대기 자동 생성 (서버 동기화 후 호출)
create or replace function public.ops_create_due_settlements() returns integer
language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.ops_settlements (event_id, title, influencer, brand, product, end_date)
    select e.id, e.title, e.influencer, e.brand, e.product, e.end_date
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

-- 마감 알림 (마감 3일 전부터, 지난 건은 danger). 화면과 휴대폰 알림이 같은 뷰를 쓴다.
create or replace view public.ops_alerts with (security_invoker = true) as
with d as (select (now() at time zone 'Asia/Seoul')::date as today),
wh as (
  select date_trunc('month', s.paid_date)::date as month, count(*) as people, sum(coalesce(s.payout, 0)) as total
  from public.ops_settlements s
  where s.is_individual and s.paid_date is not null
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
-- 이번 달 10일 신고(지난달 지급분): 7~10일은 항상 알림, 10일이 지나면 대상이 있을 때만 빨간 알림
select 'withholding',
       case when d.today > m.due then 'danger' else 'warn' end,
       m.due,
       to_char(m.month, 'YYYY-MM') || ' 지급분 원천징수 신고' ||
         coalesce(' · ' || wh.people || '명', ''),
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
