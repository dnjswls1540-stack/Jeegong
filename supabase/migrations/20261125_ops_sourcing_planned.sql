-- 상품 소싱 진행 단계에 '제안 예정'(planned) 추가 (2026-11-25 원진님 요청: 시트 진행 여부 빈칸 = 제안 예정)
alter table public.ops_sourcing drop constraint if exists ops_sourcing_stage_check;
alter table public.ops_sourcing add constraint ops_sourcing_stage_check
  check (stage in ('planned','proposed','waiting','negotiating','confirmed','hold'));
