create table public.recurring_tasks (
  id text primary key,
  board_id text not null references public.boards(id) on delete cascade,
  client_id text references public.clients(id) on delete set null,
  title text not null,
  description text not null default '',
  assigned_to text references public.app_users(id) on delete set null,
  created_by text references public.app_users(id) on delete set null,
  start_date date not null,
  end_date date,
  active boolean not null default true,
  generated_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_tasks_title_not_blank check (btrim(title) <> ''),
  constraint recurring_tasks_date_range_valid check (end_date is null or end_date >= start_date),
  constraint recurring_tasks_generated_range_valid check (generated_through is null or generated_through >= start_date - 1)
);

create table public.recurring_task_days (
  recurring_task_id text not null references public.recurring_tasks(id) on delete cascade,
  weekday smallint not null,
  column_id text not null references public.board_columns(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (recurring_task_id, weekday),
  constraint recurring_task_days_weekday_valid check (weekday between 1 and 7)
);

alter table public.cards
  add column recurring_task_id text references public.recurring_tasks(id) on delete set null,
  add column occurrence_date date;

alter table public.cards
  add constraint cards_recurring_occurrence_complete
    check (
      (recurring_task_id is null and occurrence_date is null)
      or (recurring_task_id is not null and occurrence_date is not null)
    ),
  add constraint cards_recurring_occurrence_unique unique (recurring_task_id, occurrence_date);

create index recurring_tasks_board_id_idx on public.recurring_tasks (board_id);
create index recurring_tasks_client_id_idx on public.recurring_tasks (client_id) where client_id is not null;
create index recurring_tasks_assigned_to_idx on public.recurring_tasks (assigned_to) where assigned_to is not null;
create index recurring_tasks_active_generation_idx
  on public.recurring_tasks (active, start_date, generated_through)
  where active;
create index recurring_task_days_column_id_idx on public.recurring_task_days (column_id);
create index cards_recurring_task_id_idx on public.cards (recurring_task_id) where recurring_task_id is not null;

create trigger recurring_tasks_set_updated_at
before update on public.recurring_tasks
for each row execute function public.set_updated_at();

alter table public.recurring_tasks enable row level security;
alter table public.recurring_task_days enable row level security;

grant select, insert, update, delete on public.recurring_tasks to service_role;
grant select, insert, update, delete on public.recurring_task_days to service_role;
