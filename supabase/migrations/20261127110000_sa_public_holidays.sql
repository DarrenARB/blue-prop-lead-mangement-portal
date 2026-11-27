-- South African public holidays, so campaigns can skip them.
-- Regular ones are worked out automatically (Public Holidays Act: fixed dates, Good Friday and Family Day from
-- Easter, and the Sunday rule: a holiday on a Sunday moves the day off to the Monday). One-off days the
-- government declares (e.g. an election day) are added by an admin in Rules, and a regular day can be switched off.

create table if not exists public.holiday_overrides (
  day date primary key,
  name text not null check (length(name) between 1 and 80),
  kind text not null default 'extra' check (kind in ('extra', 'skip')), -- extra = one-off holiday; skip = ignore an automatic one
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.holiday_overrides enable row level security;
create policy holiday_read on public.holiday_overrides for select to authenticated using (public.is_active_user());
create policy holiday_write on public.holiday_overrides for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Easter Sunday (anonymous Gregorian algorithm)
create or replace function public.easter_sunday(y int) returns date
language plpgsql immutable set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451; mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(y, mo, dy);
end $$;

create or replace function public.sa_public_holidays(p_from date, p_to date)
returns table (day date, name text, kind text)
language sql stable security definer set search_path = public as $$
  with yrs as (select generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y),
  base as (
    select make_date(y, m, d) as day, n as name from yrs cross join (values
      (1, 1, 'New Year’s Day'), (3, 21, 'Human Rights Day'), (4, 27, 'Freedom Day'), (5, 1, 'Workers’ Day'),
      (6, 16, 'Youth Day'), (8, 9, 'National Women’s Day'), (9, 24, 'Heritage Day'), (12, 16, 'Day of Reconciliation'),
      (12, 25, 'Christmas Day'), (12, 26, 'Day of Goodwill')) v(m, d, n)
    union all select public.easter_sunday(y) - 2, 'Good Friday' from yrs
    union all select public.easter_sunday(y) + 1, 'Family Day' from yrs
  ),
  auto as (
    select day, name from base
    union all -- Sunday rule
    select day + 1, name || ' (observed)' from base where extract(isodow from day) = 7
  )
  select a.day, a.name, 'auto' from auto a
   where a.day between p_from and p_to
     and not exists (select 1 from public.holiday_overrides o where o.day = a.day and o.kind = 'skip')
  union all
  select o.day, o.name, 'extra' from public.holiday_overrides o
   where o.kind = 'extra' and o.day between p_from and p_to
  order by 1;
$$;
revoke execute on function public.sa_public_holidays(date, date) from public, anon;
grant execute on function public.sa_public_holidays(date, date) to authenticated;

-- company default; each campaign can switch it off in its schedule (schedule.skip_holidays)
alter table public.settings add column if not exists skip_public_holidays boolean not null default true;
