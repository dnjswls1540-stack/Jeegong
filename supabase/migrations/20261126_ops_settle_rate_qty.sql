-- 인플루언서 정산: 인플루언서 수수료율(%)·판매 수량 칸 추가 (2026-11-26 원진님 요청, 자동 계산 없이 직접 입력)
alter table public.ops_settlements add column if not exists influencer_rate numeric(5,2);
alter table public.ops_settlements add column if not exists quantity integer;
