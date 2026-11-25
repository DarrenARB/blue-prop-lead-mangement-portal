-- Where a lead lives, so messages can mention it: a unit in a complex, or a street number and street.
alter table public.contacts add column if not exists unit text;
alter table public.contacts add column if not exists complex text;
alter table public.contacts add column if not exists street_number text;
alter table public.contacts add column if not exists street text;

-- "unit 12 in Red Complex" / "Red Complex" / "14 Oak Street" / null — what {{address}} becomes in a message.
-- Keep in step with contactAddress() in src/lib/format.js.
create or replace function public.contact_address(p_unit text, p_complex text, p_number text, p_street text) returns text
language sql immutable as $$
  select case
    when nullif(trim(p_complex), '') is not null then
      case when nullif(trim(p_unit), '') is not null then 'unit ' || regexp_replace(trim(p_unit), '^(unit|flat|apt\.?|apartment)\s*', '', 'i') || ' in ' || trim(p_complex) else trim(p_complex) end
    when nullif(trim(p_street), '') is not null then trim(concat_ws(' ', nullif(trim(p_number), ''), trim(p_street)))
    else null
  end
$$;
