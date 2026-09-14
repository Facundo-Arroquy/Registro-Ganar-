create table public.app_users (
  id text primary key,
  email text not null unique,
  password_hash text,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_email_not_blank check (btrim(email) <> ''),
  constraint app_users_name_not_blank check (btrim(name) <> '')
);

create table public.client_statuses (
  id bigint generated always as identity primary key,
  name text not null unique,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_statuses_name_not_blank check (btrim(name) <> ''),
  constraint client_statuses_position_positive check (position > 0),
  constraint client_statuses_position_unique unique (position)
);

create table public.settings_audit (
  id bigint generated always as identity primary key,
  action text not null,
  user_id text references public.app_users(id) on delete set null,
  user_name text not null,
  created_at timestamptz not null default now(),
  constraint settings_audit_action_not_blank check (btrim(action) <> ''),
  constraint settings_audit_user_name_not_blank check (btrim(user_name) <> '')
);

create table public.clients (
  id text primary key,
  name text not null,
  company text not null,
  email text,
  owner_id text references public.app_users(id) on delete set null,
  status_id bigint not null references public.client_statuses(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_name_not_blank check (btrim(name) <> ''),
  constraint clients_company_not_blank check (btrim(company) <> ''),
  constraint clients_email_not_blank check (email is null or btrim(email) <> '')
);

create table public.boards (
  id text primary key,
  name text not null,
  color text not null default '#2b52ff',
  position integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boards_name_not_blank check (btrim(name) <> ''),
  constraint boards_color_hex check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint boards_position_positive check (position > 0)
);

create table public.board_columns (
  id text primary key,
  board_id text not null references public.boards(id) on delete cascade,
  name text not null,
  show_timer boolean not null default false,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_columns_name_not_blank check (btrim(name) <> ''),
  constraint board_columns_position_positive check (position > 0),
  constraint board_columns_board_id_id_unique unique (board_id, id),
  constraint board_columns_board_position_unique unique (board_id, position)
);

create table public.cards (
  id text primary key,
  board_id text not null references public.boards(id) on delete cascade,
  column_id text not null references public.board_columns(id) on delete restrict,
  client_id text references public.clients(id) on delete set null,
  title text not null,
  description text not null default '',
  due_date date,
  created_by text references public.app_users(id) on delete set null,
  assigned_to text references public.app_users(id) on delete set null,
  entered_column_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cards_title_not_blank check (btrim(title) <> ''),
  constraint cards_board_column_fkey foreign key (board_id, column_id)
    references public.board_columns(board_id, id) on delete restrict
);

create index clients_owner_id_idx on public.clients (owner_id);
create index clients_status_id_idx on public.clients (status_id);
create index settings_audit_user_id_idx on public.settings_audit (user_id);
create index board_columns_board_id_idx on public.board_columns (board_id);
create index cards_board_id_idx on public.cards (board_id);
create index cards_column_id_idx on public.cards (column_id);
create index cards_client_id_idx on public.cards (client_id) where client_id is not null;
create index cards_created_by_idx on public.cards (created_by) where created_by is not null;
create index cards_assigned_to_idx on public.cards (assigned_to) where assigned_to is not null;
create index cards_due_date_idx on public.cards (due_date) where due_date is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create trigger client_statuses_set_updated_at
before update on public.client_statuses
for each row execute function public.set_updated_at();

create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

create trigger boards_set_updated_at
before update on public.boards
for each row execute function public.set_updated_at();

create trigger board_columns_set_updated_at
before update on public.board_columns
for each row execute function public.set_updated_at();

create trigger cards_set_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

alter table public.app_users enable row level security;
alter table public.client_statuses enable row level security;
alter table public.settings_audit enable row level security;
alter table public.clients enable row level security;
alter table public.boards enable row level security;
alter table public.board_columns enable row level security;
alter table public.cards enable row level security;

insert into public.app_users (id, email, password_hash, name) values
  ('u1', 'ana@ejemplo.com', '******', 'Ana Gomez'),
  ('u2', 'carlos@ejemplo.com', '******', 'Carlos Ruiz');

insert into public.client_statuses (name, position) values
  ('Activo', 1),
  ('En pausa', 2),
  ('Riesgo', 3),
  ('Cerrado', 4);

insert into public.clients (id, name, company, email, owner_id, status_id) values
  ('cl1', 'Laura Martinez', 'TechCorp', 'laura@techcorp.com', 'u1', (select id from public.client_statuses where name = 'Activo')),
  ('cl2', 'Roberto Gomez', 'Global Logistics', 'roberto@globallog.com', 'u2', (select id from public.client_statuses where name = 'En pausa'));

insert into public.boards (id, name, color, position) values
  ('b1', 'Proyecto Principal', '#2b52ff', 1);

insert into public.board_columns (id, board_id, name, show_timer, position) values
  ('c1', 'b1', 'Por Hacer', false, 1),
  ('c2', 'b1', 'En Proceso', true, 2),
  ('c3', 'b1', 'Completado', false, 3);

insert into public.cards (
  id,
  board_id,
  column_id,
  client_id,
  title,
  description,
  due_date,
  created_by,
  assigned_to,
  entered_column_at
) values (
  'k1',
  'b1',
  'c2',
  'cl1',
  'Ajustar Login',
  'Integrar modulo auth y conectar base de datos',
  '2026-09-18',
  'u1',
  'u2',
  to_timestamp(1789405228701 / 1000.0)
);
