create or replace function public.claim_rank_job(p_job_id uuid)
returns table (
  job_id uuid,
  slot_id uuid,
  keyword text,
  target_mid text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.rank_jobs%rowtype;
begin
  select j.*
    into claimed
  from public.rank_jobs j
  where j.id = p_job_id
    and j.status = 'PENDING'
  for update;

  if not found then
    return;
  end if;

  update public.rank_jobs j
     set status = 'RUNNING',
         started_at = now(),
         attempt_count = j.attempt_count + 1,
         error_code = null,
         error_message = null
   where j.id = claimed.id
     and j.status = 'PENDING'
   returning j.* into claimed;

  if not found then
    return;
  end if;

  return query
  select claimed.id, claimed.slot_id, s.keyword, s.target_mid
    from public.rank_slots s
   where s.id = claimed.slot_id;
end;
$$;

revoke all on function public.claim_rank_job(uuid) from public;
revoke all on function public.claim_rank_job(uuid) from anon;
revoke all on function public.claim_rank_job(uuid) from authenticated;
grant execute on function public.claim_rank_job(uuid) to service_role;

create or replace function public.enqueue_daily_rank_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  measurement_date_kst date := ((now() at time zone 'Asia/Seoul') - interval '14 hours')::date;
begin
  insert into public.rank_jobs (slot_id, status)
  select s.id, 'PENDING'
  from public.rank_slots s
  where s.active = true
    and not exists (
      select 1
      from public.rank_history h
      where h.slot_id = s.id
        and h.measured_date = measurement_date_kst
    )
    and not exists (
      select 1
      from public.rank_jobs j
      where j.slot_id = s.id
        and (
          j.status in ('PENDING','RUNNING')
          or ((j.requested_at at time zone 'Asia/Seoul') - interval '14 hours')::date = measurement_date_kst
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
