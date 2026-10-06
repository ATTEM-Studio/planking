create extension if not exists pgcrypto;

-- Retire v1 queue RPCs before redefining the queue contract. PostgreSQL cannot
-- CREATE OR REPLACE a function when its return row type changes.
drop function if exists public.claim_next_rank_job();
drop function if exists public.claim_rank_job(uuid);
drop function if exists public.enqueue_daily_rank_jobs();
drop function if exists public.requeue_stale_rank_jobs();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

insert into public.organizations (name, slug, status)
values ('그리온', 'grion', 'active')
on conflict (slug) do update set name = excluded.name, status = 'active';

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

-- Preserve existing PLANKING v1 slots/history when upgrading the current project.
-- Fresh Supabase projects skip this block because the legacy tables do not exist.
do $$
declare
  v_org_id uuid;
  v_legacy_client_id uuid;
begin
  select id into v_org_id from public.organizations where slug = 'grion' limit 1;

  if to_regclass('public.rank_slots') is not null then
    if exists (select 1 from public.rank_slots) then
      select id into v_legacy_client_id
      from public.clients
      where organization_id = v_org_id and name = '기존 PLANKING 가져오기'
      order by created_at
      limit 1;

      if v_legacy_client_id is null then
        insert into public.clients (organization_id, name, status)
        values (v_org_id, '기존 PLANKING 가져오기', 'active')
        returning id into v_legacy_client_id;
      end if;

      insert into public.places (client_id, naver_place_id, name, status)
      select
        v_legacy_client_id,
        rs.target_mid,
        coalesce(max(nullif(rs.place_name, '')), rs.target_mid),
        'active'
      from public.rank_slots rs
      group by rs.target_mid
      on conflict (client_id, naver_place_id)
      do update set name = excluded.name, status = 'active';

      insert into public.keywords (place_id, keyword, is_active, max_rank)
      select
        p.id,
        rs.keyword,
        bool_or(rs.active),
        300
      from public.rank_slots rs
      join public.places p
        on p.client_id = v_legacy_client_id and p.naver_place_id = rs.target_mid
      group by p.id, rs.keyword
      on conflict (place_id, keyword)
      do update set is_active = excluded.is_active;

      if to_regclass('public.rank_history') is not null then
        insert into public.rank_snapshots (
          keyword_id, rank, status, max_rank, items_scanned, pages_scanned,
          measured_at, collector_version
        )
        select
          k.id,
          h.rank,
          h.status,
          300,
          h.items_scanned,
          h.pages_scanned,
          h.measured_at,
          'legacy-planking-v1'
        from public.rank_history h
        join public.rank_slots rs on rs.id = h.slot_id
        join public.places p
          on p.client_id = v_legacy_client_id and p.naver_place_id = rs.target_mid
        join public.keywords k
          on k.place_id = p.id and k.keyword = rs.keyword
        where h.status in ('FOUND', 'OUT_OF_RANGE')
          and not exists (
            select 1 from public.rank_snapshots existing
            where existing.keyword_id = k.id
              and existing.measured_at = h.measured_at
              and existing.collector_version = 'legacy-planking-v1'
          );
      end if;

      if to_regclass('public.place_metrics_history') is not null then
        insert into public.place_metric_snapshots (
          place_id, visitor_review_count, blog_review_count, save_count_raw, measured_at
        )
        select
          p.id,
          m.visitor_review_count,
          m.blog_review_count,
          m.save_count_raw,
          m.measured_at
        from public.place_metrics_history m
        join public.places p
          on p.client_id = v_legacy_client_id and p.naver_place_id = m.target_mid
        where not exists (
          select 1 from public.place_metric_snapshots existing
          where existing.place_id = p.id and existing.measured_at = m.measured_at
        );
      end if;
    end if;
  end if;
end;
$$;

create or replace function public.is_org_staff(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner','admin','staff')
  );
$$;

create or replace function public.can_view_place(p_place_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.places p
    join public.clients c on c.id = p.client_id
    where p.id = p_place_id
      and (
        public.is_org_staff(c.organization_id)
        or exists (
          select 1 from public.client_place_access a
          where a.place_id = p.id and a.user_id = auth.uid() and a.can_view = true
        )
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

create policy organizations_select_member on public.organizations
for select using (exists (
  select 1 from public.organization_members om
  where om.organization_id = id and om.user_id = auth.uid()
));

create policy profiles_select_self on public.profiles
for select using (id = auth.uid());
create policy profiles_update_self on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

create policy organization_members_select_member on public.organization_members
for select using (user_id = auth.uid() or public.is_org_staff(organization_id));

create policy clients_select_accessible on public.clients
for select using (
  public.is_org_staff(organization_id)
  or exists (
    select 1 from public.places p
    join public.client_place_access a on a.place_id = p.id
    where p.client_id = clients.id and a.user_id = auth.uid() and a.can_view = true
  )
);

create policy places_select_accessible on public.places
for select using (public.can_view_place(id));

create policy keywords_select_accessible on public.keywords
for select using (public.can_view_place(place_id));

create policy client_place_access_select_self_or_staff on public.client_place_access
for select using (
  user_id = auth.uid()
  or exists (
    select 1 from public.places p join public.clients c on c.id = p.client_id
    where p.id = place_id and public.is_org_staff(c.organization_id)
  )
);

create policy collection_jobs_select_staff on public.collection_jobs
for select using (exists (
  select 1 from public.keywords k
  join public.places p on p.id = k.place_id
  join public.clients c on c.id = p.client_id
  where k.id = keyword_id and public.is_org_staff(c.organization_id)
));

create policy rank_snapshots_select_accessible on public.rank_snapshots
for select using (exists (
  select 1 from public.keywords k
  where k.id = keyword_id and public.can_view_place(k.place_id)
));

create policy place_metric_snapshots_select_accessible on public.place_metric_snapshots
for select using (public.can_view_place(place_id));

create policy clients_staff_write on public.clients
for all using (public.is_org_staff(organization_id)) with check (public.is_org_staff(organization_id));

create policy places_staff_write on public.places
for all using (exists (
  select 1 from public.clients c where c.id = client_id and public.is_org_staff(c.organization_id)
)) with check (exists (
  select 1 from public.clients c where c.id = client_id and public.is_org_staff(c.organization_id)
));

create policy keywords_staff_write on public.keywords
for all using (exists (
  select 1 from public.places p join public.clients c on c.id = p.client_id
  where p.id = place_id and public.is_org_staff(c.organization_id)
)) with check (exists (
  select 1 from public.places p join public.clients c on c.id = p.client_id
  where p.id = place_id and public.is_org_staff(c.organization_id)
));

create policy access_staff_write on public.client_place_access
for all using (exists (
  select 1 from public.places p join public.clients c on c.id = p.client_id
  where p.id = place_id and public.is_org_staff(c.organization_id)
)) with check (exists (
  select 1 from public.places p join public.clients c on c.id = p.client_id
  where p.id = place_id and public.is_org_staff(c.organization_id)
));

-- Base table privileges; RLS remains the authorization boundary.
grant select on public.organizations to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.organization_members to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.places to authenticated;
grant select, insert, update, delete on public.keywords to authenticated;
grant select, insert, update, delete on public.client_place_access to authenticated;
grant select on public.collection_jobs to authenticated;
grant select on public.rank_snapshots to authenticated;
grant select on public.place_metric_snapshots to authenticated;

grant all on public.organizations, public.profiles, public.organization_members,
  public.clients, public.places, public.keywords, public.client_place_access,
  public.collection_jobs, public.rank_snapshots, public.place_metric_snapshots to service_role;

create or replace function public.enqueue_scheduled_rank_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then
    raise exception 'service role required';
  end if;

  insert into public.collection_jobs(keyword_id, trigger, status)
  select k.id, 'scheduled', 'PENDING'
  from public.keywords k
  join public.places p on p.id = k.place_id
  join public.clients c on c.id = p.client_id
  where k.is_active = true and p.status = 'active' and c.status = 'active'
  on conflict (keyword_id) where status in ('PENDING','RUNNING') do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.enqueue_manual_rank_job(p_keyword_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.keywords k
  join public.places p on p.id = k.place_id
  join public.clients c on c.id = p.client_id
  where k.id = p_keyword_id and k.is_active = true;

  if v_org_id is null or not public.is_org_staff(v_org_id) then
    raise exception 'staff access required';
  end if;

  select id into v_job_id
  from public.collection_jobs
  where keyword_id = p_keyword_id and status in ('PENDING','RUNNING')
  order by created_at desc limit 1;
  if v_job_id is not null then return v_job_id; end if;

  select id into v_job_id
  from public.collection_jobs
  where keyword_id = p_keyword_id and trigger = 'manual' and created_at > now() - interval '5 minutes'
  order by created_at desc limit 1;
  if v_job_id is not null then return v_job_id; end if;

  insert into public.collection_jobs(keyword_id, trigger, status, requested_by)
  values (p_keyword_id, 'manual', 'PENDING', auth.uid())
  returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.claim_next_rank_job()
returns table(job_id uuid, keyword_id uuid, keyword text, target_place_id text, max_rank integer)
language plpgsql
security definer
set search_path = public
as $$
declare v_job uuid;
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then
    raise exception 'service role required';
  end if;

  select j.id into v_job
  from public.collection_jobs j
  where j.status = 'PENDING'
  order by j.created_at
  for update skip locked
  limit 1;

  if v_job is null then return; end if;

  update public.collection_jobs
  set status = 'RUNNING', started_at = now(), attempt_count = attempt_count + 1
  where id = v_job;

  return query
  select j.id, k.id, k.keyword, p.naver_place_id, k.max_rank
  from public.collection_jobs j
  join public.keywords k on k.id = j.keyword_id
  join public.places p on p.id = k.place_id
  where j.id = v_job;
end;
$$;

create or replace function public.finish_rank_job(
  p_job_id uuid,
  p_status text,
  p_rank integer,
  p_max_rank integer,
  p_items_scanned integer,
  p_pages_scanned integer,
  p_collector_version text,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_keyword_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then
    raise exception 'service role required';
  end if;

  select keyword_id into v_keyword_id from public.collection_jobs where id = p_job_id;
  if v_keyword_id is null then raise exception 'job not found'; end if;

  if p_status in ('FOUND','OUT_OF_RANGE') then
    insert into public.rank_snapshots(keyword_id, rank, status, max_rank, items_scanned, pages_scanned, collector_version)
    values (v_keyword_id, case when p_status = 'FOUND' then p_rank else null end, p_status, p_max_rank, p_items_scanned, p_pages_scanned, p_collector_version);
  end if;

  update public.collection_jobs
  set status = case when p_status = 'FOUND' then 'SUCCEEDED' else p_status end,
      finished_at = now(), error_code = p_error_code, error_message = p_error_message
  where id = p_job_id;
end;
$$;

-- Function execution permissions are explicit: collection workers use service_role,
-- while manual enqueue is available only to authenticated users and checks staff role.
revoke all on function public.is_org_staff(uuid) from public, anon;
grant execute on function public.is_org_staff(uuid) to authenticated, service_role;
revoke all on function public.can_view_place(uuid) from public, anon;
grant execute on function public.can_view_place(uuid) to authenticated, service_role;

revoke all on function public.enqueue_scheduled_rank_jobs() from public, anon, authenticated;
grant execute on function public.enqueue_scheduled_rank_jobs() to service_role;
revoke all on function public.claim_next_rank_job() from public, anon, authenticated;
grant execute on function public.claim_next_rank_job() to service_role;
revoke all on function public.finish_rank_job(uuid, text, integer, integer, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_rank_job(uuid, text, integer, integer, integer, integer, text, text, text) to service_role;
revoke all on function public.enqueue_manual_rank_job(uuid) from public, anon;
grant execute on function public.enqueue_manual_rank_job(uuid) to authenticated, service_role;
