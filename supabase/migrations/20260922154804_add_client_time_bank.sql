alter table public.clients
  add column time_bank_seconds bigint not null default 0,
  add constraint clients_time_bank_seconds_nonnegative check (time_bank_seconds >= 0);

create or replace function public.accumulate_client_time_bank()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tracked_column boolean;
  elapsed_seconds bigint;
begin
  if old.column_id is not distinct from new.column_id
     and old.client_id is not distinct from new.client_id then
    return new;
  end if;

  select show_timer into tracked_column
  from public.board_columns
  where id = old.column_id;

  if coalesce(tracked_column, false) and old.client_id is not null then
    elapsed_seconds := greatest(floor(extract(epoch from (now() - old.entered_column_at)))::bigint, 0);
    update public.clients
    set time_bank_seconds = time_bank_seconds + elapsed_seconds
    where id = old.client_id;
  end if;

  new.entered_column_at := now();
  return new;
end;
$$;

create or replace function public.accumulate_deleted_card_time_bank()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tracked_column boolean;
  elapsed_seconds bigint;
begin
  select show_timer into tracked_column
  from public.board_columns
  where id = old.column_id;

  if coalesce(tracked_column, false) and old.client_id is not null then
    elapsed_seconds := greatest(floor(extract(epoch from (now() - old.entered_column_at)))::bigint, 0);
    update public.clients
    set time_bank_seconds = time_bank_seconds + elapsed_seconds
    where id = old.client_id;
  end if;

  return old;
end;
$$;

create trigger cards_accumulate_client_time_bank
before update of column_id, client_id on public.cards
for each row execute function public.accumulate_client_time_bank();

create trigger cards_accumulate_deleted_time_bank
before delete on public.cards
for each row execute function public.accumulate_deleted_card_time_bank();

create or replace function public.reset_client_time_bank(p_client_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.clients
  set time_bank_seconds = 0
  where id = p_client_id;

  update public.cards as card
  set entered_column_at = now()
  from public.board_columns as board_column
  where card.column_id = board_column.id
    and board_column.show_timer
    and card.client_id = p_client_id;
end;
$$;

revoke execute on function public.reset_client_time_bank(text) from public;
grant execute on function public.reset_client_time_bank(text) to service_role;
