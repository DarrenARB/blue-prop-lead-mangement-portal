-- What is still left to do on a plan item, shown in red on the project plan.
alter table public.plan_items add column if not exists remaining text;
