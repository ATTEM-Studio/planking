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

create index if not exists rank_jobs_status_requested_at_idx
  on public.rank_jobs(status, requested_at);

create index if not exists rank_history_slot_measured_date_idx
  on public.rank_history(slot_id, measured_date desc);
