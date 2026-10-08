create table public.client_weekly_ad_metrics (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  year integer not null,
  month integer not null,
  week integer not null,
  roas numeric,
  tacos numeric,
  daily_budget numeric,
  consumed_budget numeric,
  target_tacos numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_weekly_ad_metrics_period_valid check (year between 2000 and 2200 and month between 1 and 12),
  constraint client_weekly_ad_metrics_week_valid check (week between 1 and 5),
  constraint client_weekly_ad_metrics_values_nonnegative check (
    (roas is null or roas >= 0)
    and (tacos is null or tacos >= 0)
    and (daily_budget is null or daily_budget >= 0)
    and (consumed_budget is null or consumed_budget >= 0)
    and (target_tacos is null or target_tacos >= 0)
  ),
  constraint client_weekly_ad_metrics_percentages_valid check (
    (tacos is null or tacos <= 100)
    and (target_tacos is null or target_tacos <= 100)
  ),
  constraint client_weekly_ad_metrics_unique unique (client_id, year, month, week)
);

create index client_weekly_ad_metrics_client_period_idx
on public.client_weekly_ad_metrics (client_id, year desc, month desc);

create trigger client_weekly_ad_metrics_set_updated_at
before update on public.client_weekly_ad_metrics
for each row execute function public.set_updated_at();

alter table public.client_weekly_ad_metrics enable row level security;

grant select, insert, update, delete on table public.client_weekly_ad_metrics to service_role;

create or replace function public.save_client_weekly_ad_metrics(
  p_client_id text,
  p_year integer,
  p_month integer,
  p_weeks jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_year not between 2000 and 2200 or p_month not between 1 and 12 then
    raise exception 'Periodo invalido';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Cliente no encontrado';
  end if;
  if jsonb_typeof(p_weeks) <> 'array' or jsonb_array_length(p_weeks) <> 5 then
    raise exception 'Se requieren exactamente cinco semanas';
  end if;

  delete from public.client_weekly_ad_metrics
  where client_id = p_client_id and year = p_year and month = p_month;

  insert into public.client_weekly_ad_metrics (
    id, client_id, year, month, week, roas, tacos, daily_budget, consumed_budget, target_tacos
  )
  select
    concat('cwam_', p_client_id, '_', p_year, '_', p_month, '_', item.week),
    p_client_id,
    p_year,
    p_month,
    item.week,
    item.roas,
    item.tacos,
    item.daily_budget,
    item.consumed_budget,
    item.target_tacos
  from jsonb_to_recordset(p_weeks) as item(
    week integer,
    roas numeric,
    tacos numeric,
    daily_budget numeric,
    consumed_budget numeric,
    target_tacos numeric
  );

  if (select count(*) from public.client_weekly_ad_metrics where client_id = p_client_id and year = p_year and month = p_month) <> 5 then
    raise exception 'Las semanas deben ser unicas y estar entre 1 y 5';
  end if;
end;
$$;

revoke execute on function public.save_client_weekly_ad_metrics(text, integer, integer, jsonb) from public;
grant execute on function public.save_client_weekly_ad_metrics(text, integer, integer, jsonb) to service_role;
