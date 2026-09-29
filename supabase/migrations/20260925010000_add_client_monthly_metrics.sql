-- Historical monthly metrics per client (revenue, units, asp)
create table public.client_monthly_metrics (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  year integer not null,
  month integer not null,
  metric_type text not null,   -- 'revenue', 'units', 'asp'
  value numeric,
  constraint client_monthly_metrics_unique unique (client_id, year, month, metric_type)
);
