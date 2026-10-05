create table public.client_consultor_assignments (
  client_id text not null references public.clients(id) on delete cascade,
  consultor_id bigint not null references public.client_consultors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, consultor_id)
);

create index client_consultor_assignments_consultor_id_idx
on public.client_consultor_assignments (consultor_id);

alter table public.client_consultor_assignments enable row level security;

grant select, insert, update, delete
on table public.client_consultor_assignments
to service_role;

insert into public.client_consultor_assignments (client_id, consultor_id)
select id, consultor_id
from public.clients
where consultor_id is not null
on conflict do nothing;
