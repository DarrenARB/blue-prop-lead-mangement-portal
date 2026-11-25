-- Super Admins can load / clear clearly-labelled sample conversations to preview the inbox before real replies arrive.
-- Sample contacts use +27 00 000 000x numbers (not real mobiles) and are tagged extra.sample = true.
create or replace function public.clear_inbox_samples() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_fin_link() then raise exception 'Only Super Admins can clear sample data'; end if;
  delete from public.key_dates where contact_id in (select id from public.contacts where extra->>'sample' = 'true');
  delete from public.campaigns where brief->>'sample' = 'true';
  delete from public.contacts where extra->>'sample' = 'true';
end $$;

create or replace function public.load_inbox_samples() returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); camp uuid; i int; conv uuid; ct uuid;
  people text[][] := array[
    ['Thandi','Mokoena','Durbanville','Yes please, a valuation would be great. Is Saturday morning possible?','92','Asks for a valuation and suggests a time.','f'],
    ['Pieter','van Wyk','Bellville','Maybe later in the year, we are not ready to sell yet.','38','Not ready now; open to talking later in the year.','f'],
    ['Aisha','Patel','Table View','How much did the house on Pine Street go for?','74','Interested; asking about recent sales nearby.','f'],
    ['Johan','Botha','Brackenfell','Please stop messaging me.','2','Asked not to be messaged again.','t'],
    ['Nomsa','Dlamini','Parklands','Thanks, who is this?','45','Polite but unsure who is messaging.','f'],
    ['Riaan','Smit','Durbanville','We are thinking of selling next month, can you call me?','95','Plans to sell next month and asks for a call.','f']];
begin
  if not public.is_fin_link() then raise exception 'Only Super Admins can load sample data'; end if;
  perform public.clear_inbox_samples();
  insert into public.campaigns (agent_id, name, goal, status, wizard_step, launched_at, brief)
  values (me, 'Sample – inbox preview', 'valuation', 'ended', 5, now() - interval '5 days', '{"sample": true}') returning id into camp;
  for i in 1 .. array_length(people, 1) loop
    insert into public.contacts (phone_e164, first_name, last_name, suburb, extra)
    values ('+2700000000' || i, people[i][1], people[i][2], people[i][3], '{"sample": true}')
    on conflict (phone_e164) do update set first_name = excluded.first_name returning id into ct;
    insert into public.leads (campaign_id, contact_id, agent_id, state, current_step, last_event_at) values (camp, ct, me, 'replied', 1, now() - (i || ' hours')::interval);
    insert into public.conversations (contact_id, agent_id, campaign_id, last_message_at, last_preview, last_direction, unread, score, score_reason, opt_out, scored_at, is_sample)
    values (ct, me, camp, now() - (i || ' hours')::interval, people[i][4], 'in', i in (1, 3, 6), people[i][5]::int, people[i][6], people[i][7] = 't', now() - (i || ' hours')::interval, true)
    returning id into conv;
    insert into public.messages (conversation_id, agent_id, campaign_id, direction, body, step, status, sent_at) values
      (conv, me, camp, 'out', 'Hi ' || people[i][1] || ', it''s Darren from Blue PROP. We''ve had a lot of interest from buyers in ' || people[i][3] || ' lately. Would a free, no-obligation valuation of your home be useful?', 1, 'read', now() - interval '2 days'),
      (conv, me, camp, 'in', people[i][4], null, null, now() - (i || ' hours')::interval);
    if people[i][5]::int >= 70 then
      insert into public.hot_leads (conversation_id, contact_id, agent_id, campaign_id, source, active) values (conv, ct, me, camp, 'ai', true);
    end if;
  end loop;
  insert into public.key_dates (agent_id, contact_id, type, due_on, note)
    select me, c.id, 'followup', current_date, 'Call about Saturday valuation' from public.contacts c where c.phone_e164 = '+27000000001';
  insert into public.key_dates (agent_id, contact_id, type, due_on, note, yearly)
    select me, c.id, 'birthday', current_date + 3, null, true from public.contacts c where c.phone_e164 = '+27000000003';
  insert into public.key_dates (agent_id, contact_id, type, due_on, note)
    select me, c.id, 'followup', current_date - 2, 'Promised to send recent sales in Bellville' from public.contacts c where c.phone_e164 = '+27000000002';
  return array_length(people, 1);
end $$;
revoke execute on function public.load_inbox_samples(), public.clear_inbox_samples() from public, anon;
grant execute on function public.load_inbox_samples(), public.clear_inbox_samples() to authenticated;
