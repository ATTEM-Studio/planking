create or replace function public.enqueue_daily_rank_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
begin
  insert into public.rank_jobs (slot_id, status)
  select s.id, 'PENDING'
  from public.rank_slots s
  where s.active = true
    and not exists (
      select 1
      from public.rank_history h
      where h.slot_id = s.id
        and h.measured_date = today_kst
    )
    and not exists (
      select 1
      from public.rank_jobs j
      where j.slot_id = s.id
        and (
          j.status in ('PENDING','RUNNING')
          or (j.requested_at at time zone 'Asia/Seoul')::date = today_kst
        )
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.enqueue_daily_rank_jobs() from public;
revoke all on function public.enqueue_daily_rank_jobs() from anon;
revoke all on function public.enqueue_daily_rank_jobs() from authenticated;
grant execute on function public.enqueue_daily_rank_jobs() to service_role;
