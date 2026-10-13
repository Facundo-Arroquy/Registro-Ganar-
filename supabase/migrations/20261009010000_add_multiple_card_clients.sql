create table public.card_client_assignments (
  card_id text not null references public.cards(id) on delete cascade,
  client_id text not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, client_id)
);

create index card_client_assignments_client_id_idx
on public.card_client_assignments (client_id);

alter table public.card_client_assignments enable row level security;

grant select, insert, update, delete
on table public.card_client_assignments
to service_role;

insert into public.card_client_assignments (card_id, client_id)
select id, client_id
from public.cards
where client_id is not null and client_id <> ''
on conflict do nothing;
