alter table public.client_statuses
add column if not exists color text not null default '#388bfd';

alter table public.client_statuses
drop constraint if exists client_statuses_color_hex;

alter table public.client_statuses
add constraint client_statuses_color_hex
check (color ~ '^#[0-9a-fA-F]{6}$');

update public.client_statuses
set color = case name
  when 'Activo' then '#3fb950'
  when 'En pausa' then '#d29922'
  when 'Riesgo' then '#f85149'
  when 'Cerrado' then '#8b949e'
  else color
end;
