create table public.client_owner_assignments (
  client_id text not null references public.clients(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

create index client_owner_assignments_user_id_idx
on public.client_owner_assignments (user_id);

alter table public.client_owner_assignments enable row level security;

grant select, insert, update, delete
on table public.client_owner_assignments
to service_role;

insert into public.client_owner_assignments (client_id, user_id)
select id, owner_id
from public.clients
where owner_id is not null
on conflict do nothing;
