alter table public.rank_jobs
  drop constraint if exists rank_jobs_status_check;

alter table public.rank_jobs
  add constraint rank_jobs_status_check check (
    status in ('PENDING','RUNNING','SUCCESS','OUT_OF_RANGE','INCOMPLETE','BLOCKED','TIMEOUT','FAILED')
  );
