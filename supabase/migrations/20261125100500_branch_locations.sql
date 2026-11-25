alter table public.branches
  add column address text,
  add column suburb text,
  add column city text,
  add column province text,
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add column icon text not null default 'office',
  add column color text not null default 'blue',
  add column radius_km int not null default 10 check (radius_km between 1 and 200);
