create table public.notifications (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  card_id text not null references public.cards(id) on delete cascade,
  board_id text not null references public.boards(id) on delete cascade,
  card_title text not null default '',
  board_name text not null default '',
  actor_name text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_read_idx
on public.notifications (user_id, read);

alter table public.notifications enable row level security;

grant select, insert, update, delete
on table public.notifications
to service_role;
