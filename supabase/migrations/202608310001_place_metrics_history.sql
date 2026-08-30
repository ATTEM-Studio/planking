create table if not exists public.place_metrics_history (
  id uuid primary key default gen_random_uuid(),
  target_mid text not null,
  measured_date date not null,
  visitor_review_count integer,
  blog_review_count integer,
  save_count_raw text,
  measured_at timestamptz not null default now(),
  unique (target_mid, measured_date)
);

create index if not exists place_metrics_history_target_mid_date_idx
  on public.place_metrics_history (target_mid, measured_date desc);

alter table public.place_metrics_history enable row level security;

revoke all on table public.place_metrics_history from anon;
revoke all on table public.place_metrics_history from authenticated;
grant all on table public.place_metrics_history to service_role;
