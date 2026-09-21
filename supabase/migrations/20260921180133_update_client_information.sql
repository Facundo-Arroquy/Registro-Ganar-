begin;

create temporary table client_information_updates (
  company text primary key,
  contact_name text,
  emails text,
  status_name text not null,
  owner_name text,
  complexity_name text,
  ad_status_name text,
  meeting_day smallint,
  meeting_time time,
  meeting_frequency smallint,
  meli_user text
) on commit drop;

insert into client_information_updates (
  company,
  contact_name,
  emails,
  status_name,
  owner_name,
  complexity_name,
  ad_status_name,
  meeting_day,
  meeting_time,
  meeting_frequency,
  meli_user
) values
  ('Nimasa (Somos Mudi)', 'Eliana Ronsisvalli', null, 'Plan Activo', 'Facundo Arroquy', 'Alta', 'SI', 2, '10:00', 7, 'pilar.wim@gmail.com | Wim2025-'),
  ('BeePremium', 'Tobias', null, 'Plan Activo', 'Francisca Garcia', 'Baja', 'SI', null, null, null, 'f.arroquy@klearprofit.com | Wim2025-'),
  ('Deposity', 'Tobias', null, 'Plan Activo', 'Francisca Garcia', 'Baja', 'SI', 1, '11:00', 15, 'pcampagnolle@klearprofit.com | Wim2025-'),
  ('Verden', 'Iván Kersenblat', E'ivan@verden.com.ar\nivanker9@gmail.com\nadmin1@verden.com.ar', 'Plan Activo', 'Facundo Arroquy', 'Alta', 'SI', 2, '11:00', 7, 'fgarcia@klearprofit.com | Wim2025-'),
  ('Oxi Mercedes', 'Celina', E'pontoncelina@gmail.com\noximercedes1@gmail.com', 'Plan Activo', 'Francisca Garcia', 'Media', 'Solo control', 4, '11:00', 7, 'oxiklear@gmail.com | Wim2025-'),
  ('EVW', 'Giani', null, 'Plan Activo', 'Facundo Arroquy', null, null, null, null, null, null),
  ('TM Representaciones', 'Federico', E'fcastelnovo94@gmail.com\nfedeortiz14@outlook.com', 'Plan Activo', 'Facundo Arroquy', 'Baja', 'NO', null, null, 15, 'kleartmrep@gmail.com | Wim2025-'),
  ('Vajillaar', 'Lucas', null, 'FreeTrial', 'Francisca Garcia', 'Media', null, null, null, null, null),
  ('DPK', 'Gonzalo', null, 'FreeTrial', 'Facundo Arroquy', null, null, null, null, null, null),
  ('Ferreteria express', 'Victor', null, 'FreeTrial', 'Facundo Arroquy', null, null, null, null, null, null),
  ('Di Napoli', 'Natalia', null, 'FreeTrial', 'Francisca Garcia', null, null, null, null, null, null),
  ('Leder', 'Nicolas', null, 'FreeTrial', 'Facundo Arroquy', null, null, null, null, null, null),
  ('Ferremix', null, null, 'FreeTrial', 'Francisca Garcia', null, null, null, null, null, null),
  ('Picca', null, null, 'FreeTrial', null, null, null, null, null, null, null),
  ('Ferromar', 'Alejandro', null, 'FreeTrial', 'Francisca Garcia', 'Media', null, null, null, null, 'klearferromar@gmail.com | Wim2025-'),
  ('OnlineStore', 'Horacio', 'horacio@onlinestore.com.ar', 'FreeTrial', 'Facundo Arroquy', 'Media', 'SI', null, null, null, 'Colaboradorklear@gmail.com | Wim2025-'),
  ('Bulonera Brandsen', 'Leandro', null, 'FreeTrial', 'Francisca Garcia', 'Media', 'SI', null, null, null, 'bulonerabrandsen.klear@gmail.com | Wim2025-'),
  ('Luxury Diamond', 'Pablo', null, 'FreeTrial', 'Facundo Arroquy', 'Media', 'SI', null, null, null, null),
  ('Ferrimaq', 'Cecilia', null, 'FreeTrial', 'Francisca Garcia', 'Media', null, null, null, null, null),
  ('Elisabeth Co', 'Pablo', null, 'FreeTrial', 'Facundo Arroquy', 'Media', 'SI', null, null, null, null),
  ('Cazala', 'Gustavo | Tomás', null, 'Off', 'Facundo Arroquy', 'Baja', 'SI', 2, '13:00', 15, 'p.arroquy@klearprofit.com | Wim2025-'),
  ('Tienda Objetos', 'Pablo', 'pablo@tiendaobjetos.com.ar', 'Off', 'Francisca Garcia', 'Alta', 'Solo control', 2, '15:00', 7, 'cguillani@klearprofit.com | Wim2025-');

do $$
declare
  invalid_companies text;
  missing_references text;
begin
  select string_agg(invalid.company, ', ' order by invalid.company)
    into invalid_companies
  from (
    select source.company
    from client_information_updates source
    left join public.clients client
      on lower(btrim(client.company)) = lower(btrim(source.company))
    group by source.company
    having count(client.id) <> 1
  ) invalid;

  if invalid_companies is not null then
    raise exception 'Clientes inexistentes o duplicados: %', invalid_companies;
  end if;

  select string_agg(source.company, ', ' order by source.company)
    into missing_references
  from client_information_updates source
  left join public.client_statuses status on lower(status.name) = lower(source.status_name)
  left join public.app_users owner on lower(owner.name) = lower(source.owner_name)
  left join public.complexities complexity on lower(complexity.name) = lower(source.complexity_name)
  left join public.ad_statuses ad_status on lower(ad_status.name) = lower(source.ad_status_name)
  where status.id is null
     or (source.owner_name is not null and owner.id is null)
     or (source.complexity_name is not null and complexity.id is null)
     or (source.ad_status_name is not null and ad_status.id is null);

  if missing_references is not null then
    raise exception 'Faltan estados, responsables, complejidades o publicidades para: %', missing_references;
  end if;
end
$$;

update public.clients client
set
  company = source.company,
  name = coalesce(source.contact_name, client.name),
  email = source.emails,
  owner_id = owner.id,
  status_id = status.id,
  complexity_id = complexity.id,
  ad_status_id = ad_status.id,
  meeting_day = source.meeting_day,
  meeting_time = source.meeting_time,
  meeting_frequency = source.meeting_frequency,
  meli_user = source.meli_user
from client_information_updates source
join public.client_statuses status on lower(status.name) = lower(source.status_name)
left join public.app_users owner on lower(owner.name) = lower(source.owner_name)
left join public.complexities complexity on lower(complexity.name) = lower(source.complexity_name)
left join public.ad_statuses ad_status on lower(ad_status.name) = lower(source.ad_status_name)
where lower(btrim(client.company)) = lower(btrim(source.company));

do $$
begin
  if (select count(*) from client_information_updates) <> 22 then
    raise exception 'Se esperaban 22 actualizaciones de clientes';
  end if;
end
$$;

commit;
