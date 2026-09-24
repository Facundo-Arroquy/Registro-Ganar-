create table public.calendar_availability (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  valid_from date not null,
  valid_to date,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_availability_weekday_valid check (weekday between 1 and 7),
  constraint calendar_availability_time_range_valid check (end_time > start_time),
  constraint calendar_availability_date_range_valid check (valid_to is null or valid_to >= valid_from)
);

create table public.calendar_availability_exceptions (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  exception_date date not null,
  start_time time,
  end_time time,
  unavailable boolean not null default false,
  note text not null default '',
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_availability_exceptions_mode_valid check (
    (unavailable and start_time is null and end_time is null)
    or (not unavailable and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create table public.calendar_events (
  id text primary key,
  title text not null,
  client_id text references public.clients(id) on delete set null,
  starts_at timestamptz not null,
  duration_minutes integer not null,
  notes text not null default '',
  recurrence_unit text,
  recurrence_interval integer,
  recurrence_until date,
  created_by text references public.app_users(id) on delete set null,
  updated_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_title_not_blank check (btrim(title) <> ''),
  constraint calendar_events_duration_valid check (duration_minutes between 5 and 1440),
  constraint calendar_events_recurrence_valid check (
    (recurrence_unit is null and recurrence_interval is null and recurrence_until is null)
    or (
      recurrence_unit in ('day', 'week')
      and recurrence_interval between 1 and 365
      and (recurrence_until is null or recurrence_until >= (starts_at at time zone 'America/Argentina/Buenos_Aires')::date)
    )
  )
);

create table public.calendar_event_users (
  event_id text not null references public.calendar_events(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.calendar_event_exceptions (
  id text primary key,
  event_id text not null references public.calendar_events(id) on delete cascade,
  occurrence_starts_at timestamptz not null,
  replacement_starts_at timestamptz,
  replacement_duration_minutes integer,
  cancelled boolean not null default false,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_event_exceptions_unique unique (event_id, occurrence_starts_at),
  constraint calendar_event_exceptions_replacement_valid check (
    (cancelled and replacement_starts_at is null and replacement_duration_minutes is null)
    or (
      not cancelled
      and replacement_starts_at is not null
      and (replacement_duration_minutes is null or replacement_duration_minutes between 5 and 1440)
    )
  )
);

create index calendar_availability_user_dates_idx
  on public.calendar_availability (user_id, valid_from, valid_to, weekday);
create index calendar_availability_created_by_idx
  on public.calendar_availability (created_by) where created_by is not null;
create index calendar_availability_exceptions_user_date_idx
  on public.calendar_availability_exceptions (user_id, exception_date);
create index calendar_availability_exceptions_created_by_idx
  on public.calendar_availability_exceptions (created_by) where created_by is not null;
create index calendar_events_starts_at_idx on public.calendar_events (starts_at);
create index calendar_events_client_id_idx
  on public.calendar_events (client_id) where client_id is not null;
create index calendar_events_created_by_idx
  on public.calendar_events (created_by) where created_by is not null;
create index calendar_events_updated_by_idx
  on public.calendar_events (updated_by) where updated_by is not null;
create index calendar_event_users_user_id_idx on public.calendar_event_users (user_id);
create index calendar_event_exceptions_event_occurrence_idx
  on public.calendar_event_exceptions (event_id, occurrence_starts_at);
create index calendar_event_exceptions_created_by_idx
  on public.calendar_event_exceptions (created_by) where created_by is not null;

create trigger calendar_availability_set_updated_at
before update on public.calendar_availability
for each row execute function public.set_updated_at();

create trigger calendar_availability_exceptions_set_updated_at
before update on public.calendar_availability_exceptions
for each row execute function public.set_updated_at();

create trigger calendar_events_set_updated_at
before update on public.calendar_events
for each row execute function public.set_updated_at();

create trigger calendar_event_exceptions_set_updated_at
before update on public.calendar_event_exceptions
for each row execute function public.set_updated_at();

alter table public.calendar_availability enable row level security;
alter table public.calendar_availability_exceptions enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_users enable row level security;
alter table public.calendar_event_exceptions enable row level security;

grant select, insert, update, delete on public.calendar_availability to service_role;
grant select, insert, update, delete on public.calendar_availability_exceptions to service_role;
grant select, insert, update, delete on public.calendar_events to service_role;
grant select, insert, update, delete on public.calendar_event_users to service_role;
grant select, insert, update, delete on public.calendar_event_exceptions to service_role;
