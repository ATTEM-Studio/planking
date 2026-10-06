create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','staff','client')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  naver_place_id text not null,
  name text not null,
  place_url text,
  address text,
  category text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  unique (client_id, naver_place_id)
);

create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  keyword text not null,
  is_active boolean not null default true,
  max_rank integer not null default 100 check (max_rank between 1 and 300),
  created_at timestamptz not null default now(),
  unique (place_id, keyword)
);

create table if not exists public.client_place_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  can_view boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table if not exists public.collection_jobs (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  trigger text not null check (trigger in ('scheduled','manual','retry')),
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','SUCCEEDED','OUT_OF_RANGE','BLOCKED','TIMEOUT','PARSE_ERROR','FAILED')),
  attempt_count integer not null default 0,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text
);

create unique index if not exists collection_jobs_one_active_per_keyword
  on public.collection_jobs(keyword_id)
  where status in ('PENDING','RUNNING');

create index if not exists collection_jobs_queue_idx
  on public.collection_jobs(status, created_at)
  where status = 'PENDING';

create table if not exists public.rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  rank integer,
  status text not null check (status in ('FOUND','OUT_OF_RANGE')),
  max_rank integer not null check (max_rank between 1 and 300),
  items_scanned integer not null default 0 check (items_scanned >= 0),
  pages_scanned integer not null default 0 check (pages_scanned >= 0),
  measured_at timestamptz not null default now(),
  collector_version text not null,
  check ((status = 'FOUND' and rank is not null and rank between 1 and max_rank) or (status = 'OUT_OF_RANGE' and rank is null))
);

create index if not exists rank_snapshots_keyword_measured_idx
  on public.rank_snapshots(keyword_id, measured_at desc);

create table if not exists public.place_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  visitor_review_count integer,
  blog_review_count integer,
  save_count_raw text,
  measured_at timestamptz not null default now()
);

create or replace function public.is_org_staff(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members om where om.organization_id = p_organization_id and om.user_id = auth.uid() and om.role in ('owner','admin','staff'));
$$;

create or replace function public.can_view_place(p_place_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.places p join public.clients c on c.id = p.client_id
    where p.id = p_place_id and (
      public.is_org_staff(c.organization_id)
      or exists (select 1 from public.client_place_access a where a.place_id = p.id and a.user_id = auth.uid() and a.can_view = true)
    )
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.places enable row level security;
alter table public.keywords enable row level security;
alter table public.client_place_access enable row level security;
alter table public.collection_jobs enable row level security;
alter table public.rank_snapshots enable row level security;
alter table public.place_metric_snapshots enable row level security;

create policy organizations_select_member on public.organizations for select using (exists (select 1 from public.organization_members om where om.organization_id = id and om.user_id = auth.uid()));
create policy profiles_select_self on public.profiles for select using (id = auth.uid());
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy organization_members_select_member on public.organization_members for select using (exists (select 1 from public.organization_members mine where mine.organization_id = organization_members.organization_id and mine.user_id = auth.uid()));
create policy clients_select_accessible on public.clients for select using (public.is_org_staff(organization_id) or exists (select 1 from public.places p join public.client_place_access a on a.place_id = p.id where p.client_id = clients.id and a.user_id = auth.uid() and a.can_view = true));
create policy places_select_accessible on public.places for select using (public.can_view_place(id));
create policy keywords_select_accessible on public.keywords for select using (public.can_view_place(place_id));
create policy client_place_access_select_self_or_staff on public.client_place_access for select using (user_id = auth.uid() or exists (select 1 from public.places p join public.clients c on c.id = p.client_id where p.id = place_id and public.is_org_staff(c.organization_id)));
create policy collection_jobs_select_staff on public.collection_jobs for select using (exists (select 1 from public.keywords k join public.places p on p.id = k.place_id join public.clients c on c.id = p.client_id where k.id = keyword_id and public.is_org_staff(c.organization_id)));
create policy rank_snapshots_select_accessible on public.rank_snapshots for select using (exists (select 1 from public.keywords k where k.id = keyword_id and public.can_view_place(k.place_id)));
create policy place_metric_snapshots_select_accessible on public.place_metric_snapshots for select using (public.can_view_place(place_id));
create policy clients_staff_write on public.clients for all using (public.is_org_staff(organization_id)) with check (public.is_org_staff(organization_id));
create policy places_staff_write on public.places for all using (exists (select 1 from public.clients c where c.id = client_id and public.is_org_staff(c.organization_id))) with check (exists (select 1 from public.clients c where c.id = client_id and public.is_org_staff(c.organization_id)));
create policy keywords_staff_write on public.keywords for all using (exists (select 1 from public.places p join public.clients c on c.id = p.client_id where p.id = place_id and public.is_org_staff(c.organization_id))) with check (exists (select 1 from public.places p join public.clients c on c.id = p.client_id where p.id = place_id and public.is_org_staff(c.organization_id)));
create policy access_staff_write on public.client_place_access for all using (exists (select 1 from public.places p join public.clients c on c.id = p.client_id where p.id = place_id and public.is_org_staff(c.organization_id))) with check (exists (select 1 from public.places p join public.clients c on c.id = p.client_id where p.id = place_id and public.is_org_staff(c.organization_id)));

create or replace function public.enqueue_scheduled_rank_jobs()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then raise exception 'service role required'; end if;
  insert into public.collection_jobs(keyword_id, trigger, status)
  select k.id, 'scheduled', 'PENDING' from public.keywords k join public.places p on p.id = k.place_id join public.clients c on c.id = p.client_id
  where k.is_active = true and p.status = 'active' and c.status = 'active'
  on conflict (keyword_id) where status in ('PENDING','RUNNING') do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.enqueue_manual_rank_job(p_keyword_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_job_id uuid; v_org_id uuid;
begin
  select c.organization_id into v_org_id from public.keywords k join public.places p on p.id = k.place_id join public.clients c on c.id = p.client_id where k.id = p_keyword_id and k.is_active = true;
  if v_org_id is null or not public.is_org_staff(v_org_id) then raise exception 'staff access required'; end if;
  select id into v_job_id from public.collection_jobs where keyword_id = p_keyword_id and status in ('PENDING','RUNNING') order by created_at desc limit 1;
  if v_job_id is not null then return v_job_id; end if;
  select id into v_job_id from public.collection_jobs where keyword_id = p_keyword_id and trigger = 'manual' and created_at > now() - interval '5 minutes' order by created_at desc limit 1;
  if v_job_id is not null then return v_job_id; end if;
  insert into public.collection_jobs(keyword_id, trigger, status, requested_by) values (p_keyword_id, 'manual', 'PENDING', auth.uid()) returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.claim_next_rank_job()
returns table(job_id uuid, keyword_id uuid, keyword text, target_place_id text, max_rank integer)
language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then raise exception 'service role required'; end if;
  select j.id into v_job from public.collection_jobs j where j.status = 'PENDING' order by j.created_at for update skip locked limit 1;
  if v_job is null then return; end if;
  update public.collection_jobs set status = 'RUNNING', started_at = now(), attempt_count = attempt_count + 1 where id = v_job;
  return query select j.id, k.id, k.keyword, p.naver_place_id, k.max_rank from public.collection_jobs j join public.keywords k on k.id = j.keyword_id join public.places p on p.id = k.place_id where j.id = v_job;
end;
$$;

create or replace function public.finish_rank_job(p_job_id uuid, p_status text, p_rank integer, p_max_rank integer, p_items_scanned integer, p_pages_scanned integer, p_collector_version text, p_error_code text default null, p_error_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_keyword_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then raise exception 'service role required'; end if;
  select keyword_id into v_keyword_id from public.collection_jobs where id = p_job_id;
  if v_keyword_id is null then raise exception 'job not found'; end if;
  if p_status in ('FOUND','OUT_OF_RANGE') then
    insert into public.rank_snapshots(keyword_id, rank, status, max_rank, items_scanned, pages_scanned, collector_version)
    values (v_keyword_id, case when p_status = 'FOUND' then p_rank else null end, p_status, p_max_rank, p_items_scanned, p_pages_scanned, p_collector_version);
  end if;
  update public.collection_jobs set status = case when p_status = 'FOUND' then 'SUCCEEDED' else p_status end, finished_at = now(), error_code = p_error_code, error_message = p_error_message where id = p_job_id;
end;
$$;
