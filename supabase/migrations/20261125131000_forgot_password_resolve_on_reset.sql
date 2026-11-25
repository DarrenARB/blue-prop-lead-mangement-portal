-- Requests are marked done by admin-users reset_password; the broader trigger is removed.
drop trigger if exists resolve_password_help on public.profiles;
drop function if exists public.resolve_password_help();
