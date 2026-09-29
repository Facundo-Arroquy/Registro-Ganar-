create table public.client_weekly_metrics (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  year integer not null,
  month integer not null,
  week integer not null,
  revenue numeric not null default 0,
  units numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_weekly_metrics_period_valid check (year between 2000 and 2200 and month between 1 and 12),
  constraint client_weekly_metrics_week_valid check (week between 1 and 5),
  constraint client_weekly_metrics_values_nonnegative check (revenue >= 0 and units >= 0),
  constraint client_weekly_metrics_units_integer check (units = trunc(units)),
  constraint client_weekly_metrics_unique unique (client_id, year, month, week)
);

create table public.client_month_progress (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  year integer not null,
  month integer not null,
  days_covered integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_month_progress_period_valid check (year between 2000 and 2200 and month between 1 and 12),
  constraint client_month_progress_days_valid check (days_covered between 0 and 31),
  constraint client_month_progress_unique unique (client_id, year, month)
);

create trigger client_weekly_metrics_set_updated_at
before update on public.client_weekly_metrics
for each row execute function public.set_updated_at();

create trigger client_month_progress_set_updated_at
before update on public.client_month_progress
for each row execute function public.set_updated_at();

alter table public.client_weekly_metrics enable row level security;
alter table public.client_month_progress enable row level security;

grant select, insert, update, delete on table public.client_weekly_metrics to service_role;
grant select, insert, update, delete on table public.client_month_progress to service_role;

create or replace function public.save_client_weekly_metrics(
  p_client_id text,
  p_year integer,
  p_month integer,
  p_days_covered integer,
  p_weeks jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  total_revenue numeric;
  total_units numeric;
begin
  if p_year not between 2000 and 2200 or p_month not between 1 and 12 then
    raise exception 'Periodo invalido';
  end if;
  if p_days_covered < 0 or p_days_covered > extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day')) then
    raise exception 'Dias contemplados invalidos';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Cliente no encontrado';
  end if;
  if jsonb_typeof(p_weeks) <> 'array' or jsonb_array_length(p_weeks) <> 5 then
    raise exception 'Se requieren exactamente cinco semanas';
  end if;

  delete from public.client_weekly_metrics
  where client_id = p_client_id and year = p_year and month = p_month;

  insert into public.client_weekly_metrics (id, client_id, year, month, week, revenue, units)
  select
    concat('cwm_', p_client_id, '_', p_year, '_', p_month, '_', item.week),
    p_client_id,
    p_year,
    p_month,
    item.week,
    item.revenue,
    item.units
  from jsonb_to_recordset(p_weeks) as item(week integer, revenue numeric, units numeric);

  if (select count(*) from public.client_weekly_metrics where client_id = p_client_id and year = p_year and month = p_month) <> 5 then
    raise exception 'Las semanas deben ser unicas y estar entre 1 y 5';
  end if;

  insert into public.client_month_progress (id, client_id, year, month, days_covered)
  values (concat('cmp_', p_client_id, '_', p_year, '_', p_month), p_client_id, p_year, p_month, p_days_covered)
  on conflict (client_id, year, month)
  do update set days_covered = excluded.days_covered;

  select coalesce(sum(revenue), 0), coalesce(sum(units), 0)
  into total_revenue, total_units
  from public.client_weekly_metrics
  where client_id = p_client_id and year = p_year and month = p_month;

  insert into public.client_monthly_metrics (id, client_id, year, month, metric_type, value)
  values
    (concat('cmm_', p_client_id, '_', p_year, '_', p_month, '_revenue'), p_client_id, p_year, p_month, 'revenue', total_revenue),
    (concat('cmm_', p_client_id, '_', p_year, '_', p_month, '_units'), p_client_id, p_year, p_month, 'units', total_units)
  on conflict (client_id, year, month, metric_type)
  do update set value = excluded.value;

  delete from public.client_monthly_metrics
  where client_id = p_client_id and year = p_year and month = p_month and metric_type = 'asp';
end;
$$;

revoke execute on function public.save_client_weekly_metrics(text, integer, integer, integer, jsonb) from public;
grant execute on function public.save_client_weekly_metrics(text, integer, integer, integer, jsonb) to service_role;
