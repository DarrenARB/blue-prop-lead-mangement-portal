-- A campaign's start date can't be in the past (South African date) or more than a year away.
-- Checked only when the date itself changes, so a draft whose date has since passed can still be edited
-- (the Review step asks for a new date before launch).
create or replace function public.campaign_start_date_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  d text := nullif(new.schedule->>'start_date', '');
  today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if d is null then return new; end if;
  if tg_op = 'UPDATE' and d is not distinct from nullif(old.schedule->>'start_date', '') then return new; end if;
  if d !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'That start date isn''t a valid date.' using errcode = '22007'; end if;
  if d::date < today then raise exception 'The start date can''t be in the past.' using errcode = '22008'; end if;
  if d::date > today + interval '1 year' then raise exception 'The start date can''t be more than a year away.' using errcode = '22008'; end if;
  return new;
end $$;

drop trigger if exists campaign_start_date_guard on public.campaigns;
create trigger campaign_start_date_guard before insert or update of schedule on public.campaigns
  for each row execute function public.campaign_start_date_guard();

-- clear the one impossible date saved before this guard existed
update public.campaigns set schedule = schedule - 'start_date'
where status = 'draft' and nullif(schedule->>'start_date', '') is not null
  and (schedule->>'start_date')::date < (now() at time zone 'Africa/Johannesburg')::date;
