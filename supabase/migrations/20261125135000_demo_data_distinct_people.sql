-- Each agent gets a different group of demo people, so sets don't look like duplicates. Super Admins get no demo leads.
create or replace function public.load_demo_data() returns int
language plpgsql security definer set search_path = public as $$
declare
  a record; ai int := 0; agents uuid[] := '{}'; agent_names text[] := '{}'; first text;
  c_run uuid; c_draft uuid; c_end uuid; ct uuid; conv uuid; up uuid; i int; n int := 0;
  -- first, last, suburb, reply, score, reason, opt_out, unread, hot(manual)
  -- three groups of eight with the same mix of replies (keen, wants a call, asking, later, unsure, opt-out, referral, valuation)
  pool text[][] := array[
    ['Thandi','Mokoena','Durbanville','Yes please, a valuation would be great. Is Saturday morning possible?','92','Asks for a valuation and suggests a time.','f','t','f'],
    ['Riaan','Smit','Durbanville','We are thinking of selling next month, can you call me after 5?','95','Plans to sell next month and asks for a call.','f','t','f'],
    ['Aisha','Patel','Table View','How much did the house on Pine Street go for?','74','Interested; asking about recent sales nearby.','f','t','f'],
    ['Pieter','van Wyk','Bellville','Maybe later in the year, we are not ready to sell yet.','38','Not ready now; open to talking later in the year.','f','f','f'],
    ['Nomsa','Dlamini','Parklands','Thanks, who is this?','45','Polite but unsure who is messaging.','f','f','f'],
    ['Johan','Botha','Brackenfell','Not interested, please stop messaging me.','3','Clearly not interested and asked to stop.','t','f','f'],
    ['Lerato','Khumalo','Milnerton','My sister is looking to buy in the area, can I pass on your number?','62','Referral: a family member may want to buy.','f','f','t'],
    ['Sipho','Ndlovu','Kraaifontein','What would my 3 bedroom be worth roughly?','81','Asks what their home is worth.','f','f','f'],
    ['Karen','Steyn','Somerset West','Saturday works for a valuation, what time suits you?','93','Ready for a valuation this Saturday.','f','t','f'],
    ['Mandla','Sithole','Strand','We want to sell before December. Please phone me tomorrow morning.','96','Wants to sell before December; asks for a call.','f','t','f'],
    ['Priya','Govender','Gordon''s Bay','What did number 12 in our street sell for?','76','Asking about a recent sale on their street.','f','t','f'],
    ['Willem','Pretorius','Stellenbosch','Not this year, maybe after the kids finish school.','35','Not ready yet; possibly next year.','f','f','f'],
    ['Busi','Ntuli','Kuils River','Sorry, how did you get my number?','40','Unsure and asking where the number came from.','f','f','f'],
    ['Gert','Swanepoel','Blackheath','Nie belangstel nie, moenie my weer kontak nie.','2','Not interested and asked not to be contacted (Afrikaans).','t','f','f'],
    ['Fatima','Isaacs','Bellville','My neighbour is thinking of selling, can I share your details?','64','Referral: a neighbour may want to sell.','f','f','t'],
    ['Craig','Meyer','Durbanville','Roughly what is a 4 bedroom in our area worth now?','82','Asks what their home is worth.','f','f','f'],
    ['Naledi','Molefe','Pinelands','Yes, a valuation would help. I am free on Thursday afternoon.','91','Wants a valuation and offers a time.','f','t','f'],
    ['Jaco','du Toit','Goodwood','We are relocating in January, can you call me this week?','94','Relocating soon and asks for a call.','f','t','f'],
    ['Yusuf','Davids','Rondebosch','Do you have recent sales for our complex?','73','Interested in recent sales nearby.','f','t','f'],
    ['Elsa','Venter','Plattekloof','Possibly next year, we are still deciding.','36','Undecided; maybe next year.','f','f','f'],
    ['Sizwe','Mabaso','Edgemead','Who am I speaking to?','44','Unsure who is messaging.','f','f','f'],
    ['Lindiwe','Cele','Bothasig','Remove me from your list please.','3','Asked to be removed.','t','f','f'],
    ['Ruan','Botes','Tygervalley','My parents want to downsize, may I pass your number on?','63','Referral: parents may want to downsize.','f','f','t'],
    ['Amanda','Ferreira','Welgemoed','What would a 3 bed townhouse fetch here?','80','Asks what their home is worth.','f','f','f']];
  extra_pool text[][] := array[
    ['Michelle','Jacobs','Durbanville'],['Andre','Fourie','Bellville'],['Zanele','Mthembu','Parklands'],['Kevin','Naidoo','Table View'],['Liezl','Coetzee','Brackenfell'],['Themba','Zulu','Milnerton'],
    ['Sarah','Daniels','Strand'],['Pieter','Louw','Somerset West'],['Thembi','Khoza','Kuils River'],['Ashwin','Pillay','Gordon''s Bay'],['Marike','Nel','Stellenbosch'],['Lunga','Dube','Blackheath'],
    ['Tanya','Hendricks','Pinelands'],['Johan','Visser','Goodwood'],['Nandi','Zwane','Rondebosch'],['Reza','Adams','Plattekloof'],['Hannelie','Kotze','Edgemead'],['Bongani','Shabalala','Bothasig']];
  people text[][]; extra text[][]; g int;
  states text[] := array['delivered','read','read','sent','failed','delivered'];
  phone text;
begin
  if not public.is_fin_link() then raise exception 'Only Super Admins can load demo data'; end if;
  perform public.clear_demo_data();

  for a in select id, full_name from public.profiles where role = 'agent' and status = 'active' order by created_at loop
    ai := ai + 1; agents := agents || a.id; agent_names := agent_names || a.full_name;
    first := split_part(a.full_name, ' ', 1);
    g := (ai - 1) % 3; -- which group of people this agent gets
    people := pool[g * 8 + 1 : g * 8 + 8];
    extra := extra_pool[g * 6 + 1 : g * 6 + 6];

    insert into public.campaigns (agent_id, name, goal, status, wizard_step, is_demo, launched_at, brief, schedule)
    values (a.id, '[Demo] ' || (array['Durbanville valuations','Helderberg valuations','Southern suburbs valuations'])[g + 1], 'valuation', 'running', 5, true, now() - interval '9 days',
      '{"goal":"valuation","tone":"friendly","audience":"Homeowners in Durbanville and surrounds","offer":"A free valuation and recent sales nearby"}',
      '{"days":[1,2,3,4,5],"start":"08:00","end":"17:30","timezone":"Africa/Johannesburg"}') returning id into c_run;
    insert into public.campaigns (agent_id, name, goal, status, wizard_step, is_demo, brief, schedule)
    values (a.id, '[Demo] New listings – ' || (array['Bellville','Strand','Pinelands'])[g + 1], 'listings', 'draft', 3, true,
      '{"goal":"listings","tone":"professional","audience":"Owners in Bellville who bought over 5 years ago","offer":"An honest view on what their home could sell for"}', '{}') returning id into c_draft;
    insert into public.campaigns (agent_id, name, goal, status, wizard_step, is_demo, launched_at, brief, schedule)
    values (a.id, '[Demo] ' || (array['Winter rentals','Student rentals','Holiday rentals'])[g + 1], 'rental', 'ended', 5, true, now() - interval '40 days', '{"goal":"rental","tone":"friendly"}', '{}') returning id into c_end;

    insert into public.campaign_messages (campaign_id, position, body, delay_days) values
      (c_run, 1, 'Hi {{firstName}}, it''s ' || first || ' from Blue PROP. Homes in {{suburb}} have been selling quickly this year. Would a free, no-obligation valuation of your home be useful?', 0),
      (c_run, 2, 'Hi {{firstName}}, just following up. Happy to share what similar homes near you sold for recently, no strings attached. ' || first, 2),
      (c_run, 3, 'Last message from me, {{firstName}}. If now isn''t the right time, reply STOP and I won''t message again. ' || first, 4),
      (c_draft, 1, 'Hi {{firstName}}, ' || first || ' from Blue PROP here. Buyers are asking about homes in {{suburb}}. Have you thought about what yours could sell for?', 0),
      (c_draft, 2, 'Hi {{firstName}}, I''ve put together a short list of recent sales near you. Would you like me to send it?', 3),
      (c_draft, 3, '', 4),
      (c_end, 1, 'Hi {{firstName}}, ' || first || ' from Blue PROP. Are you looking for a rental this winter?', 0),
      (c_end, 2, 'Just checking in, {{firstName}}. We have a few new rentals listed this week.', 2),
      (c_end, 3, 'Last one from me, {{firstName}}. Reply STOP and I won''t message again.', 4);

    -- people who replied: conversation, messages, AI score, hot lead
    for i in 1 .. array_length(people, 1) loop
      phone := '+2700' || lpad(ai::text, 2, '0') || lpad(i::text, 5, '0');
      insert into public.contacts (phone_e164, first_name, last_name, suburb, email, is_demo, extra)
      values (phone, people[i][1], people[i][2], people[i][3], lower(people[i][1] || '.' || replace(people[i][2], ' ', '')) || '@example.com', true, '{"demo": true}')
      returning id into ct;
      insert into public.leads (campaign_id, contact_id, agent_id, state, current_step, last_event_at, created_at)
      values (c_run, ct, a.id, 'replied', case when i % 3 = 0 then 2 else 1 end, now() - (i * 3 || ' hours')::interval, now() - interval '9 days');
      insert into public.conversations (contact_id, agent_id, campaign_id, last_message_at, last_preview, last_direction, unread, score, score_reason, opt_out, scored_at, is_sample)
      values (ct, a.id, c_run, now() - (i * 3 || ' hours')::interval, people[i][4], 'in', people[i][8] = 't', people[i][5]::int, people[i][6], people[i][7] = 't', now() - (i * 3 || ' hours')::interval, true)
      returning id into conv;
      insert into public.messages (conversation_id, agent_id, campaign_id, direction, body, step, status, sent_at) values
        (conv, a.id, c_run, 'out', 'Hi ' || people[i][1] || ', it''s ' || first || ' from Blue PROP. Homes in ' || people[i][3] || ' have been selling quickly this year. Would a free, no-obligation valuation of your home be useful?', 1, 'read', now() - interval '9 days');
      if i % 3 = 0 then
        insert into public.messages (conversation_id, agent_id, campaign_id, direction, body, step, status, sent_at) values
          (conv, a.id, c_run, 'out', 'Hi ' || people[i][1] || ', just following up. Happy to share what similar homes near you sold for recently, no strings attached. ' || first, 2, 'read', now() - interval '7 days');
      end if;
      insert into public.messages (conversation_id, agent_id, campaign_id, direction, body, sent_at)
      values (conv, a.id, c_run, 'in', people[i][4], now() - (i * 3 || ' hours')::interval);
      insert into public.ai_scores (conversation_id, agent_id, score, reason, opt_out, model) values (conv, a.id, people[i][5]::int, people[i][6], people[i][7] = 't', 'demo');
      if people[i][5]::int >= 70 and people[i][7] = 'f' then
        insert into public.hot_leads (conversation_id, contact_id, agent_id, campaign_id, source, active, exported_at)
        values (conv, ct, a.id, c_run, 'ai', true, case when i = 8 then now() - interval '1 day' end);
      elsif people[i][9] = 't' then
        insert into public.hot_leads (conversation_id, contact_id, agent_id, campaign_id, source, active, note, changed_by)
        values (conv, ct, a.id, c_run, 'manual', true, people[i][6], a.id);
      end if;
      if people[i][7] = 't' then
        insert into public.dnc (phone_e164, name, reason, source, needs_review, added_by_name, is_demo)
        values (phone, people[i][1] || ' ' || people[i][2], people[i][6], 'ai_opt_out', true, 'AI (opt-out spotted)', true);
      end if;
      -- the same people sit in the draft too (ready to send) – except the one on Do Not Contact
      if i <= 5 then insert into public.leads (campaign_id, contact_id, agent_id, state) values (c_draft, ct, a.id, 'ready'); end if;
      if i in (1, 4) then insert into public.leads (campaign_id, contact_id, agent_id, state, current_step, last_event_at) values (c_end, ct, a.id, 'stopped', 3, now() - interval '30 days'); end if;
    end loop;

    -- people who haven't replied yet (still being messaged)
    for i in 1 .. array_length(extra, 1) loop
      phone := '+2700' || lpad(ai::text, 2, '0') || lpad((100 + i)::text, 5, '0');
      insert into public.contacts (phone_e164, first_name, last_name, suburb, is_demo, extra)
      values (phone, extra[i][1], extra[i][2], extra[i][3], true, '{"demo": true}') returning id into ct;
      insert into public.leads (campaign_id, contact_id, agent_id, state, current_step, last_event_at, created_at)
      values (c_run, ct, a.id, states[i], case when i % 2 = 0 then 2 else 1 end, now() - (i || ' days')::interval, now() - interval '9 days');
    end loop;

    -- a lead upload on the draft, with some rows left out
    insert into public.uploads (campaign_id, filename, total_rows, added, rejected, created_by)
    values (c_draft, 'bellville-owners-demo.csv', 12, 5, '{"invalid_number":3,"duplicate":2,"dnc":1,"already_in_campaign":1}', a.id) returning id into up;
    insert into public.upload_rejections (upload_id, row_no, phone_raw, name, reason, detail) values
      (up, 4, '082 555', 'Peter Adams', 'invalid_number', null),
      (up, 7, '021 555 0199', 'Office line', 'invalid_number', null),
      (up, 9, 'n/a', 'Grace Mokoena', 'invalid_number', null),
      (up, 11, '+27 00 ' || lpad(ai::text, 2, '0') || ' 00001', people[1][1] || ' ' || people[1][2], 'duplicate', 'Appears more than once in this file'),
      (up, 12, '+27 00 ' || lpad(ai::text, 2, '0') || ' 00002', people[2][1] || ' ' || people[2][2], 'duplicate', 'Appears more than once in this file'),
      (up, 6, '+27 00 ' || lpad(ai::text, 2, '0') || ' 00006', people[6][1] || ' ' || people[6][2], 'dnc', 'On the Do Not Contact list'),
      (up, 3, '+27 00 ' || lpad(ai::text, 2, '0') || ' 00003', people[3][1] || ' ' || people[3][2], 'already_in_campaign', null);

    -- a manual Do Not Contact entry
    insert into public.dnc (phone_e164, name, reason, source, added_by, added_by_name, is_demo)
    values ('+2700' || lpad(ai::text, 2, '0') || '09001', (array['Hendrik Kruger','Anton Joubert','Rashida Salie'])[g + 1], 'Asked by phone not to be contacted', 'manual', a.id, a.full_name, true);

    -- dates: overdue, today, coming up, a birthday and a lease
    insert into public.key_dates (agent_id, contact_id, type, due_on, note, yearly, is_demo)
    select a.id, c.id, x.type, x.due_on, x.note, x.yearly, true
      from (values
        ('00001', 'followup', current_date, 'Confirm the valuation time they suggested', false),
        ('00002', 'followup', current_date - 2, 'Promised to call them back about selling', false),
        ('00003', 'birthday', current_date + 3, null, true),
        ('00008', 'followup', current_date + 5, 'Send comparable sales for a 3 bedroom', false),
        ('00004', 'anniversary', current_date + 20, 'Bought in 2019', true)
      ) as x(suffix, type, due_on, note, yearly)
      join public.contacts c on c.phone_e164 = '+2700' || lpad(ai::text, 2, '0') || x.suffix;
    insert into public.key_dates (agent_id, title, type, due_on, note, is_demo)
    values (a.id, (array['Sipho Ndlovu (tenant), 7 Oak Lane','Carla Botha (tenant), 22 Main Road','Kagiso Moloi (tenant), 5 Vine Street'])[g + 1], 'lease', current_date + 45, 'Lease ends – offer to help find the next place', true);
    n := n + 1;
  end loop;

  -- Shotgun: when there are two or more agents, the second agent tries to add someone the first is talking to
  if array_length(agents, 1) >= 2 then
    for i in 1 .. 2 loop
      insert into public.shotgun (contact_id, holder_agent_id, holder_campaign_id, last_contacted_at, tried_agent_id, tried_campaign_id, tried_at, free_from, outcome, resolved_at)
      select c.id, agents[1], (select id from public.campaigns where agent_id = agents[1] and is_demo and status = 'running' limit 1),
             now() - interval '3 days', agents[2], (select id from public.campaigns where agent_id = agents[2] and is_demo and status = 'draft' limit 1),
             now() - (i || ' hours')::interval, (current_date + interval '3 months')::date,
             case when i = 2 then 'kept' end, case when i = 2 then now() - interval '1 hour' end
        from public.contacts c where c.phone_e164 = '+270001' || lpad((i + 3)::text, 5, '0');
    end loop;
  end if;

  update public.settings set demo_loaded_at = now() where id = 1;
  return n;
end $$;

