create table public.general_links (
  id text primary key,
  url text not null,
  label text not null,
  created_at timestamptz not null default now(),
  constraint general_links_url_not_blank check (btrim(url) <> ''),
  constraint general_links_label_not_blank check (btrim(label) <> '')
);

alter table public.general_links enable row level security;
