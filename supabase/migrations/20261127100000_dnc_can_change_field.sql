-- Lets the Do Not Contact page ask, per row, whether the signed-in person may keep or undo it
-- (select=*,can_change), so buttons only appear where the server will accept them.
create or replace function public.can_change(d public.dnc) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_remove_dnc(d.id);
$$;
revoke execute on function public.can_change(public.dnc) from public, anon;
grant execute on function public.can_change(public.dnc) to authenticated;

-- clearer refusal when someone tries anyway
create or replace function public.confirm_dnc(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.dnc; nm text;
begin
  if not public.can_remove_dnc(p_id) then
    raise exception 'Only the agent whose lead this is, their Branch Owner or an admin can check this entry.';
  end if;
  update public.dnc set needs_review = false, reviewed_at = now(), reviewed_by = auth.uid() where id = p_id returning * into r;
  select full_name into nm from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, type, summary, data) values (auth.uid(), nm, 'dnc', 'Confirmed the AI’s Do Not Contact for ' || coalesce(r.name, 'number ending ' || right(r.phone_e164, 4)), to_jsonb(r));
end $$;
