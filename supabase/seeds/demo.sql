-- Demo seed: a walkthrough's worth of content owned by one real account, on
-- top of the development seed (dev.sql), which it needs.
--
--   pnpm db:seed:hosted --demo <username>
--
-- scripts/seed.cjs writes the username in for __DEMO_OWNER__ and runs it;
-- docs/demo.md says what's in it and the walkthrough it was made for. For the
-- local stack and the hosted dev project only, like dev.sql.
--
-- What the account gets:
--
--   a '97 Defender 110, a public project with five parts inside it, their
--   details, Contributors, Linked products and a log;
--   a house, Unlisted, with a furnace, an air conditioner and a water heater
--   inside it, a log on each, and a tune-up Timberline Homes proposed after
--   scanning the AC's sticker, waiting to be approved;
--   seven photo posts, two of them from its business profile, with tags on
--   them, likes, comments and a repost;
--   messages from Marcus Hale and Timberline Homes;
--   Physical Tags for the truck, the house, the furnace, the AC and the
--   business, and two blank ones to link during the demo.
--
-- The account's business profile is the one it already has, or a new one if
-- it has none (an account holds at most one). While its name is still its
-- username, it becomes Swoop Garage, with a garage's bio and avatar.
--
-- Re-running is safe: fixed ids and natural keys, and an insert skips what is
-- there. Every demo row's id starts dea0, so docs/demo.md's removal deletes by
-- that prefix and leaves the rest of the account alone.

do $demo$
begin
  -- ─── Helpers, for this session only ───────────────────────────────────

  -- Fixed ids, one prefix per kind: dea0c000-…-000000000001 is demo post 1.
  create or replace function pg_temp.demo_id(kind text, n int) returns uuid
  language sql immutable as $fn$
    select (
      'dea0' || case kind
        when 'business' then 'b' when 'post' then 'c' when 'product' then 'd'
        when 'project' then 'e' when 'comment' then 'f' when 'message' then '5'
        when 'media' then '6' when 'tag' then '7' when 'detail' then '8' when 'log' then '9'
      end || '000-0000-4000-8000-' || lpad(n::text, 12, '0')
    )::uuid
  $fn$;

  -- The dev seed's ids, to reach its businesses and products.
  create or replace function pg_temp.seed_id(kind text, n int) returns uuid
  language sql immutable as $fn$
    select (
      '5eed0' || case kind when 'business' then 'b' when 'product' then 'd' when 'tag' then '7' when 'project' then 'e' end
      || '00-0000-4000-8000-' || lpad(n::text, 12, '0')
    )::uuid
  $fn$;

  create or replace function pg_temp.photo(picsum_id int, aspect numeric default 1, width int default 1080) returns text
  language sql immutable as $fn$
    select format('https://picsum.photos/id/%s/%s/%s', picsum_id, width, round(width / aspect))
  $fn$;

  create or replace function pg_temp.days_ago(days numeric) returns timestamptz
  language sql stable as $fn$
    select now() - make_interval(secs => days * 86400)
  $fn$;

  -- A profile by its username. The dev seed has to be loaded first.
  create or replace function pg_temp.profile_named(p_username text) returns uuid
  language plpgsql stable as $fn$
  declare
    v_id uuid;
  begin
    select id into v_id from public.profiles where lower(username) = lower(p_username);
    if v_id is null then
      raise exception 'No profile is called %. Load the dev seed first (pnpm db:seed), and check the --demo username.', p_username;
    end if;
    return v_id;
  end;
  $fn$;

  create or replace function pg_temp.demo_post(
    n int, author uuid, p_days_ago numeric, p_content text, picsum_id int, aspect numeric, interest text
  ) returns void
  language sql as $fn$
    insert into public.posts (id, user_id, content, image_url, media_type, media_aspect_ratio, interest_slug, created_at)
    values (
      pg_temp.demo_id('post', n), author, p_content, pg_temp.photo(picsum_id, aspect), 'image', aspect,
      interest, pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing
  $fn$;

  create or replace function pg_temp.demo_project(
    n int, owner uuid, p_name text, p_type text, p_description text, picsum_id int, p_year text,
    p_public boolean, p_unlisted boolean, parent int, interest text, p_days_ago numeric
  ) returns void
  language sql as $fn$
    insert into public.projects (id, owner_profile_id, name, project_type, description, cover_url, year,
                                 is_public, unlisted, parent_project_id, interest_slug, created_at, updated_at)
    values (
      pg_temp.demo_id('project', n), owner, p_name, p_type, p_description,
      case when picsum_id is not null then pg_temp.photo(picsum_id, 4.0 / 3) end, p_year,
      p_public, p_unlisted, case when parent is not null then pg_temp.demo_id('project', parent) end,
      interest, pg_temp.days_ago(p_days_ago), pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing
  $fn$;

  create or replace function pg_temp.demo_comment(
    n int, post_n int, author uuid, p_days_ago numeric, p_content text, reply_to int default null
  ) returns void
  language sql as $fn$
    insert into public.comments (id, post_id, user_id, parent_id, content, created_at)
    values (
      pg_temp.demo_id('comment', n), pg_temp.demo_id('post', post_n), author,
      case when reply_to is not null then pg_temp.demo_id('comment', reply_to) end,
      p_content, pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing
  $fn$;

  create or replace function pg_temp.demo_message(
    n int, sender uuid, receiver uuid, p_days_ago numeric, p_text text, p_seen boolean
  ) returns void
  language sql as $fn$
    insert into public.messages (id, sender_id, receiver_id, text, type, seen, created_at)
    values (pg_temp.demo_id('message', n), sender, receiver, p_text, 'text', p_seen, pg_temp.days_ago(p_days_ago))
    on conflict (id) do nothing
  $fn$;

  -- A Physical Tag with a fixed short code: <tag host>/t/DemoRig2. At most one
  -- destination; none makes a blank tag, to link during the demo.
  create or replace function pg_temp.demo_physical_tag(
    n int, owner uuid, p_short_code text, p_name text,
    dest_profile uuid default null, dest_project int default null
  ) returns void
  language sql as $fn$
    insert into public.tags (id, owner_profile_id, tag_type, format, name, short_code, dest_profile_id, dest_project_id)
    values (
      pg_temp.demo_id('tag', n), owner, 'physical', 'qr', p_name, p_short_code, dest_profile,
      case when dest_project is not null then pg_temp.demo_id('project', dest_project) end
    ) on conflict (id) do nothing
  $fn$;

  -- A tag on a demo photo post, at x% across and y% down, owned by its author.
  create or replace function pg_temp.demo_embedded_tag(
    n int, host_post int, x numeric, y numeric,
    dest_profile uuid default null, dest_product uuid default null, dest_project int default null
  ) returns void
  language sql as $fn$
    insert into public.tags (id, owner_profile_id, tag_type, host_post_id, tag_x_pct, tag_y_pct,
                             dest_profile_id, dest_product_id, dest_project_id)
    select
      pg_temp.demo_id('tag', n), p.user_id, 'embedded', p.id, x, y, dest_profile, dest_product,
      case when dest_project is not null then pg_temp.demo_id('project', dest_project) end
    from public.posts p
    where p.id = pg_temp.demo_id('post', host_post)
    on conflict (id) do nothing
  $fn$;

  -- ─── The demo ─────────────────────────────────────────────────────────

  declare
    me      uuid := pg_temp.profile_named('__DEMO_OWNER__');
    account uuid := (select user_id from public.profiles where id = me);
    garage  uuid;

    -- From the dev seed
    riley      uuid := pg_temp.profile_named('riley.overland');
    marcus     uuid := pg_temp.profile_named('marcus.hale');
    nora       uuid := pg_temp.profile_named('nora.lee');
    jordan     uuid := pg_temp.profile_named('jordan.trails');
    theo       uuid := pg_temp.profile_named('theo.frames');
    leo        uuid := pg_temp.profile_named('leo.vance');
    timberline uuid := pg_temp.seed_id('business', 1);
    ridgeline  uuid := pg_temp.seed_id('business', 2);
    lumen      uuid := pg_temp.seed_id('business', 4);
    roof_rack  uuid := pg_temp.seed_id('product', 1);
    light_bar  uuid := pg_temp.seed_id('product', 2);
    recovery   uuid := pg_temp.seed_id('product', 3);
    pendant    uuid := pg_temp.seed_id('product', 12);
  begin
    -- The account's business profile: the one it has, or a new one.
    select id into garage from public.profiles where user_id = account and profile_type = 'business';
    if garage is null then
      insert into public.profiles (id, user_id, profile_type, username, full_name, created_at)
      values (pg_temp.demo_id('business', 1), account, 'business', left('__DEMO_OWNER__', 13) || '.garage',
              left('__DEMO_OWNER__', 13) || '.garage', pg_temp.days_ago(45))
      on conflict (id) do nothing;
      garage := pg_temp.demo_id('business', 1);
    end if;

    -- Dressed as a garage while its name is still its username. A business
    -- its owner has named is left as it is.
    update public.profiles
    set full_name = 'Swoop Garage',
        bio = 'Land Rover restorations and overland builds, one truck at a time.',
        avatar_url = pg_temp.photo(1071, 1, 400)
    where id = garage and (full_name is null or full_name = username);

    insert into public.business_profiles (profile_id, category, website, location)
    values (garage, 'Vehicle restoration', 'https://example.com/garage', 'Bend, OR')
    on conflict (profile_id) do nothing;
    update public.business_profiles
    set category = 'Vehicle restoration', location = 'Bend, OR'
    where profile_id = garage and category is null;

    insert into public.products (id, business_profile_id, name, description, category, price_cents, created_at, updated_at)
    values (pg_temp.demo_id('product', 1), garage, 'Winch mount plate',
            '3/8 in steel, gusseted, for a Defender 90 or 110 bumper. Made to order.', 'Fabrication', 42000,
            pg_temp.days_ago(20), pg_temp.days_ago(20))
    on conflict (id) do nothing;
    insert into public.product_media (id, product_id, url, sort_order)
    values (pg_temp.demo_id('media', 1), pg_temp.demo_id('product', 1), pg_temp.photo(491), 0)
    on conflict (id) do nothing;

    -- ── The Defender, and its parts inside it ──
    perform pg_temp.demo_project(1, me, '''97 Defender 110', 'Vehicle build',
      'A 1997 Land Rover Defender 110, brought back one part at a time.', 514, '1997', true, false, null, 'vehicle-builds', 40);
    perform pg_temp.demo_project(2, me, 'Suspension lift', 'Suspension', 'Two inches, new springs and shocks all round.', 551, '2026', true, false, 1, null, 22);
    perform pg_temp.demo_project(3, me, 'Roof rack', 'Exterior', 'Ridgeline''s low-profile platform.', null, '2026', true, false, 1, null, 15);
    perform pg_temp.demo_project(4, me, 'Winch', 'Recovery', 'A 10,000 lb winch on a mount made in the garage.', 491, '2026', true, false, 1, null, 8);
    perform pg_temp.demo_project(5, me, 'Light bar', 'Electrical', 'A 40-inch bar on the rack, on its own switch.', null, '2026', true, false, 1, null, 12);
    perform pg_temp.demo_project(6, me, 'Interior refit', 'Interior', 'Seats, dash and a lot of sound deadening. Under way.', 605, '2026', true, false, 1, null, 9);

    -- ── The house, Unlisted, and what's in it ──
    perform pg_temp.demo_project(7, me, 'Our house', 'Home', 'What''s in it, and everything done to it.', 946, '1958', false, true, null, 'custom-homes', 30);
    perform pg_temp.demo_project(8, me, 'Furnace', 'HVAC', null, null, '2021', false, true, 7, null, 29);
    perform pg_temp.demo_project(9, me, 'Air conditioner', 'HVAC', null, null, '2019', false, true, 7, null, 29);
    perform pg_temp.demo_project(10, me, 'Water heater', 'Plumbing', null, null, '2016', false, true, 7, null, 29);

    insert into public.project_details (id, project_id, label, kind, value, sort_order)
    select pg_temp.demo_id('detail', d.n), pg_temp.demo_id('project', d.project), d.label, d.kind, d.value, d.sort_order
    from (values
      (1, 1, 'Make', 'text', 'Land Rover', 0),
      (2, 1, 'Model', 'text', 'Defender 110', 1),
      (3, 1, 'Engine', 'text', '300Tdi, 2.5 L diesel', 2),
      (4, 1, 'Odometer (mi)', 'number', '142310', 3),
      (5, 1, 'Bought', 'date', to_char(pg_temp.days_ago(40), 'YYYY-MM-DD'), 4),
      (6, 2, 'Lift (in)', 'number', '2', 0),
      (7, 2, 'Fitted', 'date', to_char(pg_temp.days_ago(21), 'YYYY-MM-DD'), 1),
      (8, 2, 'Odometer at fitting (mi)', 'number', '142050', 2),
      (9, 3, 'Load rating (lb)', 'number', '300', 0),
      (10, 3, 'Fitted', 'date', to_char(pg_temp.days_ago(14), 'YYYY-MM-DD'), 1),
      (11, 4, 'Rated pull (lb)', 'number', '10000', 0),
      (12, 4, 'Line', 'text', 'Synthetic, 80 ft', 1),
      (13, 4, 'Fitted', 'date', to_char(pg_temp.days_ago(2), 'YYYY-MM-DD'), 2),
      (14, 5, 'Wiring', 'text', 'Relay, fuse and a switch on the dash', 0),
      (15, 7, 'Year built', 'number', '1958', 0),
      (16, 7, 'Square feet', 'number', '1920', 1),
      (17, 7, 'Moved in', 'date', to_char(pg_temp.days_ago(30), 'YYYY-MM-DD'), 2),
      (18, 8, 'Make', 'text', 'Northwind', 0),
      (19, 8, 'Model number', 'text', 'NW-80E', 1),
      (20, 8, 'Filter size', 'text', '16x25x1', 2),
      (21, 8, 'Installed', 'date', '2021-10-05', 3),
      (22, 8, 'Warranty until', 'date', '2031-10-05', 4),
      (23, 8, 'Manual', 'link', 'https://example.com/manuals/nw-80e', 5),
      (24, 9, 'Make', 'text', 'Coolfront', 0),
      (25, 9, 'Model number', 'text', 'CF-36X', 1),
      (26, 9, 'Size (tons)', 'number', '3', 2),
      (27, 9, 'Refrigerant', 'text', 'R-410A', 3),
      (28, 9, 'Filter size', 'text', '20x25x1', 4),
      (29, 9, 'Installed', 'date', '2019-06-12', 5),
      (30, 10, 'Capacity (gal)', 'number', '50', 0),
      (31, 10, 'Last flushed', 'date', to_char(pg_temp.days_ago(120), 'YYYY-MM-DD'), 1)
    ) as d(n, project, label, kind, value, sort_order)
    on conflict (id) do nothing;

    insert into public.contributors (project_id, contributor_profile_id, role)
    select pg_temp.demo_id('project', c.project), c.profile, c.role
    from (values
      (1, ridgeline, 'Supplier'), (1, marcus, 'Mechanic'), (1, garage, 'Restoration'),
      (2, marcus, 'Fitted it'), (3, ridgeline, 'Supplier'), (4, garage, 'Made the mount'),
      (7, lumen, 'Lighting'), (8, timberline, 'Services it')
    ) as c(project, profile, role)
    on conflict do nothing;

    insert into public.project_products (project_id, product_id)
    select pg_temp.demo_id('project', l.project), l.product
    from (values
      (1, roof_rack), (1, light_bar), (1, recovery), (3, roof_rack), (5, light_bar),
      (4, pg_temp.demo_id('product', 1)), (7, pendant)
    ) as l(project, product)
    on conflict do nothing;

    -- Logs. A Contributor's entry publishes at once; Timberline's AC tune-up
    -- waits for approval, because Timberline isn't Linked to the AC and
    -- scanned its sticker to propose it (below).
    insert into public.project_log_entries (id, project_id, occurred_on, title, notes, cost_cents, currency,
                                            performed_by_profile_id, author_profile_id, status, created_at, updated_at)
    select pg_temp.demo_id('log', l.n), pg_temp.demo_id('project', l.project), pg_temp.days_ago(l.days)::date,
           l.title, l.notes, l.cost_cents, 'USD', l.who, l.who, l.status, pg_temp.days_ago(l.days), pg_temp.days_ago(l.days)
    from (values
      -- The Defender
      (1, 1, 40, 'Bought her', '142,000 miles, two owners, one very tired suspension.', 1850000, me, 'published'),
      (2, 1, 33, 'Oil, filters and a coolant flush', null, 14500, me, 'published'),
      (3, 1, 26, 'New all-terrain tires', 'Five, so the spare matches.', 128000, me, 'published'),
      (4, 2, 21, 'Fitted the lift', 'Springs, shocks and longer brake lines. Aligned after.', 165000, marcus, 'published'),
      (5, 3, 14, 'Fitted the rack', 'Six mounting points, no drilling.', 89900, ridgeline, 'published'),
      (6, 5, 12, 'Wired the light bar', null, 6500, me, 'published'),
      (7, 4, 7, 'Winch mount, first try', 'The plate flexed under load. Back to the drawing board.', 3800, me, 'published'),
      (8, 4, 2, 'Winch mount, round two', '3/8 in plate, gusseted. No flex at full pull.', 42000, garage, 'published'),
      -- The house
      (9, 7, 30, 'Moved in', null, null, me, 'published'),
      (10, 7, 1, 'Pendant over the dining table', 'Brass shade, 2700K, on a dimmer.', 26000, lumen, 'published'),
      (11, 8, (current_date - date '2021-10-05'), 'Installed the furnace', 'Replaced a 1990s unit. Ten years on parts.', 640000, timberline, 'published'),
      (12, 8, 380, 'Annual service', 'Cleaned the burners and checked the igniter.', 18000, timberline, 'published'),
      (13, 8, 95, 'Changed the filter', null, 2400, me, 'published'),
      (14, 8, 18, 'Annual service', 'Cleaned the burners and replaced the flame sensor.', 18500, timberline, 'published'),
      (15, 8, 6, 'Changed the filter', null, 2400, me, 'published'),
      (16, 9, 400, 'Recharged the refrigerant', 'From the previous owner''s records.', 32000, me, 'published'),
      (17, 9, 1, 'Spring tune-up', 'Cleaned the coil, checked the charge and the capacitor. All in spec.', 14500, timberline, 'proposed'),
      (18, 10, 120, 'Flushed the tank', null, null, me, 'published')
    ) as l(n, project, days, title, notes, cost_cents, who, status)
    on conflict (id) do nothing;

    insert into public.project_log_media (id, entry_id, url, sort_order)
    values (pg_temp.demo_id('media', 2), pg_temp.demo_id('log', 8), pg_temp.photo(491, 4.0 / 3), 0)
    on conflict (id) do nothing;

    -- ── Physical Tags ──
    perform pg_temp.demo_physical_tag(1, me, 'DemoRig2', 'Dash sticker', dest_project => 1);
    perform pg_temp.demo_physical_tag(2, me, 'DemoHaus', 'Front door', dest_project => 7);
    perform pg_temp.demo_physical_tag(3, me, 'DemoFurn', 'Furnace sticker', dest_project => 8);
    perform pg_temp.demo_physical_tag(4, me, 'DemoAirC', 'AC unit sticker', dest_project => 9);
    perform pg_temp.demo_physical_tag(5, garage, 'DemoShop', 'Shop door', dest_profile => garage);
    perform pg_temp.demo_physical_tag(6, me, 'DemoNew2', 'Spare sticker');
    perform pg_temp.demo_physical_tag(7, me, 'DemoNew3', 'Spare sticker');

    -- Timberline scanned the AC's sticker, which let it read the AC and
    -- propose the tune-up above.
    insert into public.scans (tag_id, scanner_profile_id, scanned_at)
    select pg_temp.demo_id('tag', 4), timberline, pg_temp.days_ago(1)
    where not exists (
      select 1 from public.scans where tag_id = pg_temp.demo_id('tag', 4) and scanner_profile_id = timberline
    );
    insert into public.project_tag_grants (tag_id, profile_id, granted_at)
    values (pg_temp.demo_id('tag', 4), timberline, pg_temp.days_ago(1))
    on conflict do nothing;

    -- The account's own Scan History: three of the dev seed's tags.
    insert into public.scans (tag_id, scanner_profile_id, scanned_at)
    select pg_temp.seed_id('tag', s.tag), me, pg_temp.days_ago(s.days)
    from (values (2, 16), (5, 9), (4, 3)) as s(tag, days)
    where not exists (
      select 1 from public.scans where tag_id = pg_temp.seed_id('tag', s.tag) and scanner_profile_id = me
    );

    -- ── Posts, with tags on them ──
    perform pg_temp.demo_post(1, me, 38, 'Picked her up. 1997 Defender 110, 142k on the clock and one very tired suspension. #defender #overland', 514, 4.0 / 3, 'vehicle-builds');
    perform pg_temp.demo_post(2, me, 20, 'Shakedown run after the lift. Nothing rattled that wasn''t already rattling. #overland', 551, 1.5, 'vehicle-builds');
    perform pg_temp.demo_post(3, me, 9, 'Interior''s next. That dash has seen things.', 605, 4.0 / 3, 'vehicle-builds');
    perform pg_temp.demo_post(4, me, 2, 'Winch mount, round two. This one doesn''t flex. #garageday', 491, 1, 'vehicle-builds');
    perform pg_temp.demo_post(5, me, 1, 'New light over the dining table, from @lumen.works. Dimmer next.', 625, 4.0 / 3, 'custom-homes');
    perform pg_temp.demo_post(6, garage, 5, 'In the shop this month: a ''97 Defender 110. Lift, rack, winch, and a mount we made for it. #defender', 1070, 4.0 / 3, 'vehicle-builds');
    perform pg_temp.demo_post(7, garage, 16, 'Not everything that comes through is a Land Rover. This one''s in for brakes and a lot of chrome polish.', 1071, 4.0 / 3, 'vehicle-builds');

    perform pg_temp.demo_embedded_tag(101, 1, 58, 46, dest_project => 3);
    perform pg_temp.demo_embedded_tag(102, 1, 74, 84, dest_project => 2);
    perform pg_temp.demo_embedded_tag(103, 1, 16, 78, dest_project => 4);
    perform pg_temp.demo_embedded_tag(104, 1, 40, 62, dest_profile => ridgeline);
    perform pg_temp.demo_embedded_tag(105, 2, 50, 55, dest_project => 2);
    perform pg_temp.demo_embedded_tag(106, 4, 50, 50, dest_product => pg_temp.demo_id('product', 1));
    perform pg_temp.demo_embedded_tag(107, 5, 52, 18, dest_product => pendant);
    perform pg_temp.demo_embedded_tag(108, 6, 50, 50, dest_project => 1);

    -- ── Around them ──
    insert into public.follows (follower_id, followed_id, created_at)
    select f.who, f.whom, pg_temp.days_ago(f.days)
    from (values
      (riley, me, 37), (marcus, me, 36), (ridgeline, me, 36), (theo, me, 20), (nora, me, 18), (timberline, me, 18),
      (riley, garage, 15), (marcus, garage, 15)
    ) as f(who, whom, days)
    on conflict do nothing;

    perform pg_temp.demo_comment(1, 1, marcus, 37.5, 'A 300Tdi. That engine will outlive both of us.');
    perform pg_temp.demo_comment(2, 1, me, 37.4, 'That''s the plan.', reply_to => 1);
    perform pg_temp.demo_comment(3, 1, riley, 37, 'Rack next?');
    perform pg_temp.demo_comment(4, 1, ridgeline, 36.8, 'Bring her by. Our platform fits the 110 with no drilling.', reply_to => 3);
    perform pg_temp.demo_comment(5, 2, jordan, 19.5, 'Where is this? I need that road.');
    perform pg_temp.demo_comment(6, 2, me, 19.4, 'East of Bend, the old forest road. Washboard the whole way.', reply_to => 5);
    perform pg_temp.demo_comment(7, 4, marcus, 1.6, 'Gussets were the right call.');
    perform pg_temp.demo_comment(8, 5, leo, 0.6, 'Looks right at 2700K. Enjoy it.');
    perform pg_temp.demo_comment(9, 5, nora, 0.4, 'That room came out great.');
    perform pg_temp.demo_comment(10, 6, riley, 4.5, 'Saw this one on the road last week. Sounds great.');

    insert into public.likes (post_id, user_id, created_at)
    select pg_temp.demo_id('post', l.post), l.who, least(p.created_at + interval '2 hours', now())
    from (values
      (1, riley), (1, marcus), (1, ridgeline), (1, theo), (1, jordan), (1, nora),
      (2, riley), (2, jordan), (2, theo), (2, ridgeline),
      (3, marcus), (3, theo),
      (4, marcus), (4, riley), (4, ridgeline),
      (5, leo), (5, lumen), (5, nora), (5, timberline), (5, theo),
      (6, riley), (6, marcus), (6, me),
      (7, theo)
    ) as l(post, who)
    join public.posts p on p.id = pg_temp.demo_id('post', l.post)
    on conflict do nothing;

    insert into public.reposts (post_id, user_id, created_at)
    values (pg_temp.demo_id('post', 1), riley, pg_temp.days_ago(36))
    on conflict do nothing;

    insert into public.saves (profile_id, saved_product_id, saved_project_id, saved_post_id, saved_profile_id)
    values
      (riley, null, pg_temp.demo_id('project', 1), null, null),
      (marcus, null, null, pg_temp.demo_id('post', 4), null),
      (me, roof_rack, null, null, null),
      (me, null, pg_temp.seed_id('project', 1), null, null)
    on conflict do nothing;

    -- Messages: Marcus about the rack, and Timberline about the furnace.
    perform pg_temp.demo_message(1, marcus, me, 16, 'Rack''s in. Bring her by Thursday and we''ll fit it.', true);
    perform pg_temp.demo_message(2, me, marcus, 15.9, 'Thursday works. Morning?', true);
    perform pg_temp.demo_message(3, marcus, me, 15.8, '8am. Coffee''s on us.', true);
    perform pg_temp.demo_message(4, timberline, me, 1.2, 'Hi! We were out for the AC tune-up today. Logged it on your house, ready for you to approve.', false);
    perform pg_temp.demo_message(5, timberline, me, 1.1, 'Your furnace filter is due again in about two months.', false);
  end;
end;
$demo$;
