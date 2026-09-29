alter table public.weekly_reports enable row level security;
alter table public.weekly_client_data enable row level security;
alter table public.client_monthly_metrics enable row level security;

grant select, insert, update, delete on table public.weekly_reports to service_role;
grant select, insert, update, delete on table public.weekly_client_data to service_role;
grant select, insert, update, delete on table public.client_monthly_metrics to service_role;

alter table public.weekly_reports
  add constraint weekly_reports_status_valid
  check (status in ('draft', 'final')) not valid,
  add constraint weekly_reports_days_elapsed_valid
  check (days_elapsed between 0 and 31) not valid;

alter table public.weekly_client_data
  add constraint weekly_client_data_metric_type_valid
  check (metric_type in ('revenue', 'units', 'asp')) not valid;

alter table public.client_monthly_metrics
  add constraint client_monthly_metrics_year_valid
  check (year between 2000 and 2200) not valid,
  add constraint client_monthly_metrics_month_valid
  check (month between 1 and 12) not valid,
  add constraint client_monthly_metrics_type_valid
  check (metric_type in ('revenue', 'units', 'asp')) not valid;

alter table public.weekly_reports validate constraint weekly_reports_status_valid;
alter table public.weekly_reports validate constraint weekly_reports_days_elapsed_valid;
alter table public.weekly_client_data validate constraint weekly_client_data_metric_type_valid;
alter table public.client_monthly_metrics validate constraint client_monthly_metrics_year_valid;
alter table public.client_monthly_metrics validate constraint client_monthly_metrics_month_valid;
alter table public.client_monthly_metrics validate constraint client_monthly_metrics_type_valid;

create index if not exists weekly_reports_created_at_idx
  on public.weekly_reports (created_at desc);
