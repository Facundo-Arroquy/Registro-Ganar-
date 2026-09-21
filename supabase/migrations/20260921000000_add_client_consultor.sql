-- Configurable consultor categories (mirrors client_statuses pattern)
create table public.client_consultors (
  id bigint generated always as identity primary key,
  name text not null unique,
  color text not null default '#388bfd',
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_consultors_name_not_blank check (btrim(name) <> ''),
  constraint client_consultors_color_hex check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint client_consultors_position_positive check (position > 0),
  constraint client_consultors_position_unique unique (position)
);

create trigger client_consultors_set_updated_at
before update on public.client_consultors
for each row execute function public.set_updated_at();

alter table public.client_consultors enable row level security;

-- Add consultor reference to clients (nullable)
alter table public.clients
  add column consultor_id bigint references public.client_consultors(id) on delete set null;

create index clients_consultor_id_idx on public.clients (consultor_id) where consultor_id is not null;

-- Seed default consultors
insert into public.client_consultors (name, color, position) values
  ('Interno', '#3fb950', 1),
  ('Externo', '#d29922', 2);
