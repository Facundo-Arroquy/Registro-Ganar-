alter table public.clients
  add column if not exists meli_password text,
  add column if not exists vs_category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_meli_password_not_blank'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_meli_password_not_blank
      check (meli_password is null or btrim(meli_password) <> '');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_vs_category_not_blank'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_vs_category_not_blank
      check (vs_category is null or btrim(vs_category) <> '');
  end if;
end
$$;

-- The previous UI stored Mercado Libre access as "usuario | clave" in meli_user.
-- Preserve those credentials while moving them to separate attributes.
update public.clients
set
  meli_password = nullif(btrim(substr(meli_user, strpos(meli_user, ' | ') + 3)), ''),
  meli_user = nullif(btrim(substr(meli_user, 1, strpos(meli_user, ' | ') - 1)), '')
where strpos(meli_user, ' | ') > 0;
