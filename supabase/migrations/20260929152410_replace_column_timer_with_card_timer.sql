drop trigger if exists cards_accumulate_client_time_bank on public.cards;
drop trigger if exists cards_accumulate_deleted_time_bank on public.cards;
drop function if exists public.accumulate_client_time_bank();
drop function if exists public.accumulate_deleted_card_time_bank();

alter table public.cards
  add column timer_status text not null default 'idle',
  add column timer_elapsed_seconds bigint not null default 0,
  add column timer_started_at timestamptz,
  add constraint cards_timer_status_valid check (timer_status in ('idle', 'running', 'paused', 'finished')),
  add constraint cards_timer_elapsed_seconds_nonnegative check (timer_elapsed_seconds >= 0),
  add constraint cards_timer_started_at_consistent check ((timer_status = 'running') = (timer_started_at is not null));

create or replace function public.control_card_timer(p_card_id text, p_action text)
returns public.cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  card public.cards;
  elapsed_since_start bigint;
  final_elapsed bigint;
begin
  select * into card from public.cards where id = p_card_id for update;
  if not found then raise exception 'Tarjeta no encontrada'; end if;

  if p_action = 'start' and card.timer_status = 'idle' then
    update public.cards set timer_status = 'running', timer_started_at = clock_timestamp()
    where id = p_card_id returning * into card;
  elsif p_action = 'pause' and card.timer_status = 'running' then
    elapsed_since_start := greatest(floor(extract(epoch from (clock_timestamp() - card.timer_started_at)))::bigint, 0);
    update public.cards
    set timer_status = 'paused', timer_elapsed_seconds = timer_elapsed_seconds + elapsed_since_start, timer_started_at = null
    where id = p_card_id returning * into card;
  elsif p_action = 'resume' and card.timer_status = 'paused' then
    update public.cards set timer_status = 'running', timer_started_at = clock_timestamp()
    where id = p_card_id returning * into card;
  elsif p_action = 'finish' and card.timer_status in ('running', 'paused') then
    elapsed_since_start := case when card.timer_status = 'running'
      then greatest(floor(extract(epoch from (clock_timestamp() - card.timer_started_at)))::bigint, 0)
      else 0 end;
    final_elapsed := card.timer_elapsed_seconds + elapsed_since_start;
    update public.cards
    set timer_status = 'finished', timer_elapsed_seconds = final_elapsed, timer_started_at = null
    where id = p_card_id returning * into card;
    if card.client_id is not null then
      update public.clients set time_bank_seconds = time_bank_seconds + final_elapsed where id = card.client_id;
    end if;
  else
    raise exception 'Accion % invalida para un cronometro en estado %', p_action, card.timer_status;
  end if;
  return card;
end;
$$;

revoke execute on function public.control_card_timer(text, text) from public;
grant execute on function public.control_card_timer(text, text) to service_role;

create or replace function public.reset_client_time_bank(p_client_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.clients set time_bank_seconds = 0 where id = p_client_id;
end;
$$;

alter table public.board_columns drop column show_timer;
alter table public.cards drop column entered_column_at;
