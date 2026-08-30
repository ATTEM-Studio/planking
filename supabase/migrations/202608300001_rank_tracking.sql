create table if not exists public.rank_slots (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  target_mid text not null,
  place_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint rank_slots_keyword_target_mid_key unique (keyword, target_mid)
);

create table if not exists public.rank_jobs (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.rank_slots(id) on delete cascade,
  status text not null default 'PENDING',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempt_count integer not null default 0,
  error_code text,
  error_message text,
  constraint rank_jobs_status_check check (
    status in ('PENDING','RUNNING','SUCCESS','OUT_OF_RANGE','BLOCKED','TIMEOUT','FAILED')
  )
);

create table if not exists public.rank_history (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.rank_slots(id) on delete cascade,
  measured_date date not null,
  rank integer,
  status text not null,
  pages_scanned integer not null default 0,
  items_scanned integer not null default 0,
  measured_at timestamptz not null default now(),
  constraint rank_history_rank_check check (rank is null or rank between 1 and 300),
  constraint rank_history_status_check check (status in ('FOUND','OUT_OF_RANGE')),
  constraint rank_history_slot_date_key unique (slot_id, measured_date)
);

alter table public.rank_slots enable row level security;
alter table public.rank_jobs enable row level security;
alter table public.rank_history enable row level security;

revoke all on table public.rank_slots from anon;
revoke all on table public.rank_slots from authenticated;
revoke all on table public.rank_jobs from anon;
revoke all on table public.rank_jobs from authenticated;
revoke all on table public.rank_history from anon;
revoke all on table public.rank_history from authenticated;

grant all on table public.rank_slots to service_role;
grant all on table public.rank_jobs to service_role;
grant all on table public.rank_history to service_role;

create index if not exists rank_jobs_status_requested_at_idx
  on public.rank_jobs(status, requested_at);

create index if not exists rank_history_slot_measured_date_idx
  on public.rank_history(slot_id, measured_date desc);

create or replace function public.claim_next_rank_job()
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
  where j.status = 'PENDING'
  order by j.requested_at asc, j.id asc
  for update skip locked
  limit 1;

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
   returning j.* into claimed;

  return query
  select claimed.id, claimed.slot_id, s.keyword, s.target_mid
    from public.rank_slots s
   where s.id = claimed.slot_id;
end;
$$;

revoke all on function public.claim_next_rank_job() from public;
revoke all on function public.claim_next_rank_job() from anon;
revoke all on function public.claim_next_rank_job() from authenticated;
grant execute on function public.claim_next_rank_job() to service_role;
