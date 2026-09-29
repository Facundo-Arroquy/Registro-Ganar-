create table public.client_comments (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  content text not null,
  created_by text references public.app_users(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_comments_content_not_blank check (btrim(content) <> ''),
  constraint client_comments_content_length check (char_length(content) <= 10000),
  constraint client_comments_author_name_not_blank check (btrim(author_name) <> '')
);

create index client_comments_client_created_at_idx
  on public.client_comments (client_id, created_at desc);

create trigger client_comments_set_updated_at
before update on public.client_comments
for each row execute function public.set_updated_at();

alter table public.client_comments enable row level security;

grant select, insert, update, delete on table public.client_comments to service_role;
