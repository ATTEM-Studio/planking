-- The open internal dashboard sends this RPC through the server-side service role.
-- Keep authenticated staff checks for normal access while allowing that trusted path.
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

  if v_org_id is null or (
    coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    and not public.is_org_staff(v_org_id)
  ) then
    raise exception 'staff access required';
  end if;

  select id into v_job_id
  from public.collection_jobs
  where keyword_id = p_keyword_id and status in ('PENDING', 'RUNNING')
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

revoke all on function public.enqueue_manual_rank_job(uuid) from public, anon;
grant execute on function public.enqueue_manual_rank_job(uuid) to authenticated, service_role;
