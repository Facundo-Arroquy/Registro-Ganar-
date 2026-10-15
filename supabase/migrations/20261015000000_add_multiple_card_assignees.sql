create table public.card_assignee_assignments (
  card_id text not null references public.cards(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

create index card_assignee_assignments_user_id_idx
on public.card_assignee_assignments (user_id);

alter table public.card_assignee_assignments enable row level security;

grant select, insert, update, delete
on table public.card_assignee_assignments
to service_role;

insert into public.card_assignee_assignments (card_id, user_id)
select id, assigned_to
from public.cards
where assigned_to is not null and assigned_to <> ''
on conflict do nothing;
