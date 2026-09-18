create table public.client_links (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  url text not null,
  label text not null,
  created_at timestamptz not null default now(),
  constraint client_links_url_not_blank check (btrim(url) <> ''),
  constraint client_links_label_not_blank check (btrim(label) <> '')
);

create index client_links_client_id_idx on public.client_links (client_id);

alter table public.client_links enable row level security;
