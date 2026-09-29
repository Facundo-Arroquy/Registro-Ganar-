-- Weekly reports
create table public.weekly_reports (
  id text primary key,
  week_label text not null,
  status text not null default 'draft',
  days_elapsed integer not null default 25,
  notes jsonb not null default '[]',
  meetings jsonb not null default '{}',
  created_by text references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Manual per-client data (revenue, units, asp)
create table public.weekly_client_data (
  id text primary key,
  weekly_report_id text not null references public.weekly_reports(id) on delete cascade,
  client_id text not null references public.clients(id) on delete cascade,
  metric_type text not null,
  current_value numeric,
  previous_value numeric,
  ytd_value numeric,
  constraint weekly_client_data_unique unique (weekly_report_id, client_id, metric_type)
);
