-- Development seed: made-up people, businesses and content, so the app has
-- something to show. For the local stack and the hosted dev project only.
--
--   pnpm db:seed           the local stack
--   pnpm db:seed:hosted    the hosted dev project, and nothing else
--
-- scripts/seed.cjs runs it; docs/seed-data.md says what's in it. Production
-- starts empty and must stay that way: never run this against it.
--
-- It is one statement, so it all goes in or none of it does: `supabase db
-- query` runs a file as a single prepared statement. The helpers are
-- created first, in this session's pg_temp, and the data goes in a nested
-- block whose declarations run after them.
--
-- Re-running is safe. Every row has a fixed id or a natural key, and an
-- insert skips what is already there, so a second run changes nothing.
--
-- Every seed account's id starts 5eed0a00-, and everything else hangs off
-- those accounts, so this removes all of it:
--
--   delete from auth.users where id::text like '5eed0a00-%';
--
-- Photos are hot-linked from picsum.photos by fixed id, so every run shows the
-- same pictures and nothing is uploaded to storage.
--
-- Nobody can sign in as a seed account: each password is a random value that
-- is never kept. Set one by hand to act as a seed profile (docs/seed-data.md).

do $seed$
begin
  -- ─── Helpers, for this session only ───────────────────────────────────

  -- Fixed ids, one prefix per kind: 5eed0a00-…-000000000001 is account 1.
  create or replace function pg_temp.seed_id(kind text, n int) returns uuid
  language sql immutable as $fn$
    select (
      '5eed0' || case kind
        when 'account' then 'a' when 'business' then 'b' when 'post' then 'c'
        when 'product' then 'd' when 'project' then 'e' when 'comment' then 'f'
        when 'media' then '6' when 'tag' then '7' when 'detail' then '8' when 'log' then '9'
      end || '00-0000-4000-8000-' || lpad(n::text, 12, '0')
    )::uuid
  $fn$;

  -- A picsum photo by id, `width` wide and cropped to width / aspect.
  create or replace function pg_temp.photo(picsum_id int, aspect numeric default 1, width int default 1080) returns text
  language sql immutable as $fn$
    select format('https://picsum.photos/id/%s/%s/%s', picsum_id, width, round(width / aspect))
  $fn$;

  -- Avatars show small, so they load small.
  create or replace function pg_temp.avatar(picsum_id int) returns text
  language sql immutable as $fn$
    select pg_temp.photo(picsum_id, 1, 400)
  $fn$;

  create or replace function pg_temp.days_ago(days numeric) returns timestamptz
  language sql stable as $fn$
    select now() - make_interval(secs => days * 86400)
  $fn$;

  -- An account and its individual profile, which public.handle_new_user makes
  -- from the metadata. Returns the profile's id.
  create or replace function pg_temp.seed_account(
    n int, p_username text, p_full_name text, p_bio text, p_avatar int, p_days_ago numeric
  ) returns uuid
  language plpgsql as $fn$
  declare
    v_user uuid := pg_temp.seed_id('account', n);
    v_email text := p_username || '@example.com';
    v_profile uuid;
  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), pg_temp.days_ago(p_days_ago),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object('username', p_username, 'full_name', p_full_name, 'avatar_url', pg_temp.avatar(p_avatar)),
      pg_temp.days_ago(p_days_ago), pg_temp.days_ago(p_days_ago),
      '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', pg_temp.days_ago(p_days_ago), pg_temp.days_ago(p_days_ago)
    ) on conflict (provider_id, provider) do nothing;

    select id into strict v_profile
    from public.profiles
    where user_id = v_user and profile_type = 'individual';

    update public.profiles set bio = p_bio, created_at = pg_temp.days_ago(p_days_ago) where id = v_profile;
    return v_profile;
  end;
  $fn$;

  -- A business profile on account `owner`, with its business fields.
  create or replace function pg_temp.seed_business(
    n int, owner int, p_username text, p_full_name text, p_bio text, p_avatar int,
    p_category text, p_location text, p_verified boolean, p_days_ago numeric
  ) returns uuid
  language plpgsql as $fn$
  declare
    v_profile uuid := pg_temp.seed_id('business', n);
  begin
    insert into public.profiles (id, user_id, profile_type, username, full_name, bio, avatar_url, is_verified, created_at)
    values (
      v_profile, pg_temp.seed_id('account', owner), 'business', p_username, p_full_name, p_bio,
      pg_temp.avatar(p_avatar), p_verified, pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing;

    insert into public.business_profiles (profile_id, category, website, location)
    values (v_profile, p_category, 'https://example.com/' || split_part(p_username, '.', 1), p_location)
    on conflict (profile_id) do nothing;
    return v_profile;
  end;
  $fn$;

  -- A post: a photo post when `picsum_id` is given, a text post otherwise.
  create or replace function pg_temp.seed_post(
    n int, author uuid, p_days_ago numeric, p_content text,
    picsum_id int default null, aspect numeric default 1, interest text default null
  ) returns void
  language sql as $fn$
    insert into public.posts (id, user_id, content, image_url, media_type, media_aspect_ratio, interest_slug, created_at)
    values (
      pg_temp.seed_id('post', n), author, p_content,
      case when picsum_id is not null then pg_temp.photo(picsum_id, aspect) end,
      case when picsum_id is not null then 'image' else 'text' end,
      case when picsum_id is not null then aspect end,
      interest, pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing
  $fn$;

  create or replace function pg_temp.seed_product(
    n int, business uuid, p_name text, p_description text, p_category text, p_price_cents int,
    picsum_id int, p_days_ago numeric
  ) returns void
  language sql as $fn$
    insert into public.products (id, business_profile_id, name, description, category, price_cents, created_at, updated_at)
    values (
      pg_temp.seed_id('product', n), business, p_name, p_description, p_category, p_price_cents,
      pg_temp.days_ago(p_days_ago), pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing;

    -- A product's photo shares its product's number.
    insert into public.product_media (id, product_id, url, sort_order)
    values (pg_temp.seed_id('media', n), pg_temp.seed_id('product', n), pg_temp.photo(picsum_id), 0)
    on conflict (id) do nothing;
  $fn$;

  create or replace function pg_temp.seed_project(
    n int, owner uuid, p_name text, p_type text, p_description text, picsum_id int,
    interest text, p_days_ago numeric
  ) returns void
  language sql as $fn$
    insert into public.projects (id, owner_profile_id, name, project_type, description, cover_url, year, interest_slug, created_at, updated_at)
    values (
      pg_temp.seed_id('project', n), owner, p_name, p_type, p_description, pg_temp.photo(picsum_id, 4.0 / 3),
      extract(year from pg_temp.days_ago(p_days_ago))::text, interest,
      pg_temp.days_ago(p_days_ago), pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing
  $fn$;

  create or replace function pg_temp.seed_comment(
    n int, post_n int, author uuid, p_days_ago numeric, p_content text, reply_to int default null
  ) returns void
  language sql as $fn$
    insert into public.comments (id, post_id, user_id, parent_id, content, created_at)
    values (
      pg_temp.seed_id('comment', n), pg_temp.seed_id('post', post_n), author,
      case when reply_to is not null then pg_temp.seed_id('comment', reply_to) end,
      p_content, pg_temp.days_ago(p_days_ago)
    ) on conflict (id) do nothing
  $fn$;

  -- A Physical Tag with a fixed short code, so its link is known in advance:
  -- <tag host>/t/SeedHome. Exactly one of the destinations is given.
  create or replace function pg_temp.seed_physical_tag(
    n int, owner uuid, p_short_code text, p_name text,
    dest_profile uuid default null, dest_product int default null,
    dest_project int default null, dest_post int default null
  ) returns void
  language sql as $fn$
    insert into public.tags (id, owner_profile_id, tag_type, format, name, short_code,
                             dest_profile_id, dest_product_id, dest_project_id, dest_post_id)
    values (
      pg_temp.seed_id('tag', n), owner, 'physical', 'qr', p_name, p_short_code, dest_profile,
      case when dest_product is not null then pg_temp.seed_id('product', dest_product) end,
      case when dest_project is not null then pg_temp.seed_id('project', dest_project) end,
      case when dest_post is not null then pg_temp.seed_id('post', dest_post) end
    ) on conflict (id) do nothing
  $fn$;

  -- An Embedded Tag: a point on a photo post, owned by the post's author.
  create or replace function pg_temp.seed_embedded_tag(
    n int, host_post int, x numeric, y numeric,
    dest_profile uuid default null, dest_product int default null,
    dest_project int default null, dest_post int default null
  ) returns void
  language sql as $fn$
    insert into public.tags (id, owner_profile_id, tag_type, host_post_id, tag_x_pct, tag_y_pct,
                             dest_profile_id, dest_product_id, dest_project_id, dest_post_id)
    select
      pg_temp.seed_id('tag', n), p.user_id, 'embedded', p.id, x, y, dest_profile,
      case when dest_product is not null then pg_temp.seed_id('product', dest_product) end,
      case when dest_project is not null then pg_temp.seed_id('project', dest_project) end,
      case when dest_post is not null then pg_temp.seed_id('post', dest_post) end
    from public.posts p
    where p.id = pg_temp.seed_id('post', host_post)
    on conflict (id) do nothing
  $fn$;

  -- ─── The seed ─────────────────────────────────────────────────────────

  declare
    -- People
    maya   uuid := pg_temp.seed_account(1, 'maya.builds', 'Maya Chen', 'Weekend builder. Cabins, decks and whatever fits in the garage.', 64, 60);
    jordan uuid := pg_temp.seed_account(2, 'jordan.trails', 'Jordan Reyes', 'Trail runner and gear nerd. Up before the sun.', 177, 58);
    sam    uuid := pg_temp.seed_account(3, 'sam.studio', 'Sam Okafor', 'Light, glass and large installs.', 65, 55);
    riley  uuid := pg_temp.seed_account(4, 'riley.overland', 'Riley Brooks', 'Two old trucks, one bus, no patience.', 22, 52);
    casey  uuid := pg_temp.seed_account(5, 'casey.makes', 'Casey Morgan', 'Workshop notes, mostly sawdust.', 237, 50);
    theo   uuid := pg_temp.seed_account(6, 'theo.frames', 'Theo Park', 'Photographer. I shoot what my friends build.', 91, 48);
    nora   uuid := pg_temp.seed_account(7, 'nora.lee', 'Nora Lee', 'Builder at Timberline Homes.', 129, 62);
    marcus uuid := pg_temp.seed_account(8, 'marcus.hale', 'Marcus Hale', 'Runs the shop at Ridgeline Overland.', 200, 61);
    priya  uuid := pg_temp.seed_account(9, 'priya.nair', 'Priya Nair', 'Founder, Ironform Supply.', 40, 59);
    leo    uuid := pg_temp.seed_account(10, 'leo.vance', 'Leo Vance', 'Lighting designer at Lumen Works.', 219, 57);

    -- Businesses, each on its owner's account
    timberline uuid := pg_temp.seed_business(1, 7, 'timberline.homes', 'Timberline Homes',
      'Custom homes and cabins in central Oregon. Built to last, built to be lived in.', 263, 'Home builder', 'Bend, OR', true, 62);
    ridgeline uuid := pg_temp.seed_business(2, 8, 'ridgeline.overland', 'Ridgeline Overland',
      'Racks, lights and recovery gear, fitted in our shop.', 278, 'Vehicle outfitter', 'Moab, UT', false, 61);
    ironform uuid := pg_temp.seed_business(3, 9, 'ironform.supply', 'Ironform Supply',
      'Gear for long days outside.', 17, 'Outdoor gear', 'Boulder, CO', true, 59);
    lumen uuid := pg_temp.seed_business(4, 10, 'lumen.works', 'Lumen Works',
      'Lighting design for shops, stages and night markets.', 56, 'Lighting studio', 'Austin, TX', false, 57);

    pair uuid[];
  begin
    -- Posts. Vehicle builds
    perform pg_temp.seed_post(1, riley, 2, 'Finally got the ''71 bus back on the road. New brakes, same questionable paint. #vanlife #overland', 183, 1.5, 'vehicle-builds');
    perform pg_temp.seed_post(2, ridgeline, 5, 'Customer drop-off: a 1939 coupe in for a full suspension refresh. She''s staying the winter. #restomod', 111, 0.8, 'vehicle-builds');
    perform pg_temp.seed_post(3, riley, 9, 'Two Jags, one lift, all of Saturday. #garageday', 133, 1, 'vehicle-builds');
    perform pg_temp.seed_post(4, riley, 14, 'Shakedown run before the long trip. Nothing fell off. #overland', 314, 0.8, 'vehicle-builds');
    perform pg_temp.seed_post(5, ridgeline, 18, 'The pass is open again. Tested the new roof rack at 70 with no whistle. #overland', 191, 1.5, 'vehicle-builds');
    perform pg_temp.seed_post(6, marcus, 21, 'Found this in a parts yard. Not buying it. Probably buying it.', 45, 1, 'vehicle-builds');
    -- Custom homes
    perform pg_temp.seed_post(7, timberline, 1, 'Cedar cabin handover this week. Reclaimed siding, new everything else. #cabin #customhome', 76, 0.8, 'custom-homes');
    perform pg_temp.seed_post(8, maya, 3, 'Kitchen window is in. The morning light was the whole point.', 305, 0.8, 'custom-homes');
    perform pg_temp.seed_post(9, timberline, 7, 'Three townhouses, one canal, a lot of permits. Facade work starts Monday.', 164, 1.5, 'custom-homes');
    perform pg_temp.seed_post(10, nora, 12, 'Kept the original door. Nine coats of paint came off to get here. #restoration', 78, 0.8, 'custom-homes');
    perform pg_temp.seed_post(11, maya, 16, 'Old window frame, new greenhouse wall. Almost free. #diy', 208, 1, 'custom-homes');
    perform pg_temp.seed_post(12, timberline, 20, 'Reading nook, finished. Built-in bench under the window.', 311, 0.8, 'custom-homes');
    -- Fitness and gear
    perform pg_temp.seed_post(13, jordan, 1, '5:40am and nobody else on the ridge. #trailrunning', 173, 0.8, 'fitness-and-gear');
    perform pg_temp.seed_post(14, ironform, 4, 'Everyday carry, trail edition. Everything here is in the Ironform kit. #gear', 26, 1, 'fitness-and-gear');
    perform pg_temp.seed_post(15, jordan, 8, 'Twenty miles, two liters of water, one wrong turn.', 29, 0.8, 'fitness-and-gear');
    perform pg_temp.seed_post(16, ironform, 13, 'Packing list for the fall range trip. What are we missing?', 36, 1, 'fitness-and-gear');
    perform pg_temp.seed_post(17, priya, 17, 'Rest day. The shoes disagree.', 103, 1.5, 'fitness-and-gear');
    perform pg_temp.seed_post(18, jordan, 23, 'Cross-training, or falling down in public. #skate', 281, 1, 'fitness-and-gear');
    -- Art and installations
    perform pg_temp.seed_post(19, lumen, 2, 'Night market install: 400 meters of festoon lights, zero ladders dropped. #lighting', 195, 0.8, 'art-and-installations');
    perform pg_temp.seed_post(20, sam, 6, 'Bottle wall, day three. The afternoon sun does all the work. #installation', 90, 0.8, 'art-and-installations');
    perform pg_temp.seed_post(21, sam, 10, 'Scouting a space for the spring show. That roof!', 134, 1, 'art-and-installations');
    perform pg_temp.seed_post(22, lumen, 15, 'Stage wash for the Friday show. Rigged in four hours. #lighting', 158, 1.5, 'art-and-installations');
    perform pg_temp.seed_post(23, theo, 19, 'Shot for @sam.studio''s studio sale.', 104, 0.8, 'art-and-installations');
    perform pg_temp.seed_post(24, sam, 25, 'Every part of a 1952 typewriter, laid out for the next piece.', 252, 1, 'art-and-installations');
    -- DIY projects
    perform pg_temp.seed_post(25, casey, 3, 'Pegboard wall, finally. Everything has a place, for about a week. #workshop', 284, 0.8, 'diy-projects');
    perform pg_temp.seed_post(26, casey, 11, 'Pallet wood, sanded. It''s becoming a bench or firewood, not sure yet. #diy', 143, 1, 'diy-projects');
    perform pg_temp.seed_post(27, maya, 22, 'Neighbor''s trike: new wheels and a coat of red. #diy', 146, 0.8, 'diy-projects');
    perform pg_temp.seed_post(28, casey, 27, 'Rebuilt every spoke on this by hand. Never again. Probably again.', 99, 1, 'diy-projects');
    -- Retail displays
    perform pg_temp.seed_post(29, lumen, 4, 'Window refresh for Juniper Café: brass rail, trailing plants, warm 2700K. #retail', 163, 0.8, 'retail-displays');
    perform pg_temp.seed_post(30, theo, 9, 'Counter display at Juniper Café, lit by @lumen.works.', 225, 1, 'retail-displays');
    perform pg_temp.seed_post(31, leo, 26, 'Morning walk past the shop fronts. Every one of these windows could be lit better.', 212, 0.8, 'retail-displays');
    -- Text posts
    perform pg_temp.seed_post(32, theo, 0.2, 'Anyone in Bend need photos of a finished build this month? I have a few open days.');
    perform pg_temp.seed_post(33, casey, 7, 'Hot take: pocket screws are fine. #diy');
    perform pg_temp.seed_post(34, maya, 15, 'Question for builders: what finish do you put on exterior cedar?');

    -- Products, one photo each
    perform pg_temp.seed_product(1, ridgeline, 'Roof rack platform', 'Low-profile aluminum platform. Fits most mid-size trucks and vans.', 'Racks', 89900, 182, 40);
    perform pg_temp.seed_product(2, ridgeline, 'Trail light bar', '40-inch LED bar with a spot and flood pattern.', 'Lighting', 34900, 265, 38);
    perform pg_temp.seed_product(3, ridgeline, 'Recovery kit', 'Straps, shackles and a snatch block in a roll-up bag.', 'Recovery', 18900, 60, 36);
    perform pg_temp.seed_product(4, timberline, 'Reclaimed cedar siding', 'Salvaged western red cedar, milled and sealed. Priced per bundle of 40 square feet.', 'Siding', 124000, 307, 45);
    perform pg_temp.seed_product(5, timberline, 'Walnut slab table', 'Live-edge black walnut on a blackened steel base. Seats eight.', 'Furniture', 340000, 42, 44);
    perform pg_temp.seed_product(6, timberline, 'Handmade brick', 'Wood-fired clay brick, sold by the pallet.', 'Masonry', 95000, 210, 43);
    perform pg_temp.seed_product(7, ironform, 'Everyday carry kit', 'Watch, light, knife and a phone case that survives the trail.', 'Kits', 24900, 26, 35);
    perform pg_temp.seed_product(8, ironform, 'Trail skate deck', 'Maple deck with soft wheels for gravel paths.', 'Skate', 13900, 157, 34);
    perform pg_temp.seed_product(9, ironform, 'Insulated camp mug', 'Keeps coffee hot through a long first climb.', 'Drinkware', 3200, 30, 33);
    perform pg_temp.seed_product(10, lumen, 'Festoon light string', '15 meters, 20 warm bulbs, rated for outdoors.', 'Lighting', 8900, 195, 32);
    perform pg_temp.seed_product(11, lumen, 'Lantern post light', 'Cast-iron post lantern with a dimmable warm lamp.', 'Lighting', 42000, 232, 31);
    perform pg_temp.seed_product(12, lumen, 'Brass pendant lamp', 'Spun brass shade, 2700K, for counters and windows.', 'Lighting', 26000, 137, 30);

    -- Projects, with their Contributors and Linked products
    perform pg_temp.seed_project(1, timberline, 'Lakeside Cabin', 'Residential build', 'A two-bedroom cedar cabin on the lake, clad in reclaimed siding.', 76, 'custom-homes', 28);
    perform pg_temp.seed_project(2, timberline, 'Canal Townhouses', 'Renovation', 'Three canal-side townhouses, with new facades and interiors.', 164, 'custom-homes', 24);
    perform pg_temp.seed_project(3, riley, '''71 Bus Revival', 'Vehicle build', 'Brakes, wiring, a roof rack and a lot of rust repair on a 1971 bus.', 183, 'vehicle-builds', 26);
    perform pg_temp.seed_project(4, lumen, 'Night Market Lights', 'Installation', 'A festoon canopy and post lanterns for a weekly night market.', 232, 'art-and-installations', 20);
    perform pg_temp.seed_project(5, lumen, 'Juniper Café Window', 'Retail display', 'A window refresh with a brass rail, trailing plants and warm light.', 163, 'retail-displays', 12);
    perform pg_temp.seed_project(6, sam, 'Bottle Wall', 'Installation', 'A wall of recovered glass bottles that catches the afternoon sun.', 90, 'art-and-installations', 9);

    insert into public.contributors (project_id, contributor_profile_id, role)
    select pg_temp.seed_id('project', c.project), c.profile, c.role
    from (values
      (1, maya, 'Carpentry'), (1, lumen, 'Lighting'), (1, theo, 'Photography'),
      (2, casey, 'Joinery'),
      (3, ridgeline, 'Supplier'), (3, marcus, 'Mechanic'),
      (4, sam, 'Design'), (4, theo, 'Photography'),
      (5, sam, 'Styling'), (5, theo, 'Photography'),
      (6, casey, 'Fabrication')
    ) as c(project, profile, role)
    on conflict do nothing;

    insert into public.project_products (project_id, product_id)
    select pg_temp.seed_id('project', l.project), pg_temp.seed_id('product', l.product)
    from (values (1, 5), (1, 4), (1, 12), (2, 6), (3, 1), (3, 2), (4, 10), (4, 11), (5, 12)) as l(project, product)
    on conflict do nothing;

    -- Physical Tags, with codes to open without printing: <tag host>/t/SeedHome
    perform pg_temp.seed_physical_tag(1, timberline, 'SeedHome', 'Yard sign', dest_profile => timberline);
    perform pg_temp.seed_physical_tag(2, ridgeline, 'SeedRig2', 'Shop door', dest_profile => ridgeline);
    perform pg_temp.seed_physical_tag(3, ironform, 'SeedGear', 'Shelf tag', dest_product => 7);
    perform pg_temp.seed_physical_tag(4, lumen, 'SeedLamp', 'Display tag', dest_product => 10);
    perform pg_temp.seed_physical_tag(5, timberline, 'SeedCabn', 'Job site board', dest_project => 1);
    perform pg_temp.seed_physical_tag(6, lumen, 'SeedPost', 'Market poster', dest_post => 19);

    -- A home record (ONE-134, 137, 140, 141, 143): Maya's house, Unlisted,
    -- with the furnace and water heater inside it, their details, a log, and
    -- tags to open them by. Timberline installed the furnace and services
    -- it; Lumen Works scanned the house's tag and proposed an entry, which
    -- waits for Maya.
    insert into public.projects (id, owner_profile_id, name, project_type, description, cover_url, year,
                                 is_public, unlisted, parent_project_id, interest_slug, created_at, updated_at)
    values
      (pg_temp.seed_id('project', 7), maya, 'Maple Street House', 'Home',
       'Our house: what''s in it, and everything done to it.', pg_temp.photo(305, 4.0 / 3), '1962',
       false, true, null, 'custom-homes', pg_temp.days_ago(40), pg_temp.days_ago(40))
    on conflict (id) do nothing;
    insert into public.projects (id, owner_profile_id, name, project_type, description, cover_url, year,
                                 is_public, unlisted, parent_project_id, interest_slug, created_at, updated_at)
    values
      (pg_temp.seed_id('project', 8), maya, 'Furnace', 'HVAC', null, null, '2023',
       false, true, pg_temp.seed_id('project', 7), null, pg_temp.days_ago(39), pg_temp.days_ago(39)),
      (pg_temp.seed_id('project', 9), maya, 'Water heater', 'Plumbing', null, null, '2019',
       false, true, pg_temp.seed_id('project', 7), null, pg_temp.days_ago(39), pg_temp.days_ago(39))
    on conflict (id) do nothing;

    insert into public.contributors (project_id, contributor_profile_id, role)
    values (pg_temp.seed_id('project', 8), timberline, 'Installed it')
    on conflict do nothing;

    insert into public.project_details (id, project_id, label, kind, value, sort_order)
    select pg_temp.seed_id('detail', d.n), pg_temp.seed_id('project', d.project), d.label, d.kind, d.value, d.sort_order
    from (values
      (1, 7, 'Year built', 'number', '1962', 0),
      (2, 7, 'Square feet', 'number', '1840', 1),
      (3, 8, 'Make', 'text', 'Northwind', 0),
      (4, 8, 'Model number', 'text', 'NW-80E', 1),
      (5, 8, 'Filter size', 'text', '16x25x1', 2),
      (6, 8, 'Installed', 'date', '2023-11-14', 3),
      (7, 8, 'Warranty until', 'date', '2033-11-14', 4),
      (8, 8, 'Manual', 'link', 'https://example.com/manuals/nw-80e', 5),
      (9, 9, 'Capacity (gal)', 'number', '50', 0),
      (10, 9, 'Last flushed', 'date', '2026-06-02', 1)
    ) as d(n, project, label, kind, value, sort_order)
    on conflict (id) do nothing;

    perform pg_temp.seed_physical_tag(7, maya, 'SeedHaus', 'Front door', dest_project => 7);
    perform pg_temp.seed_physical_tag(8, maya, 'SeedFurn', 'Furnace sticker', dest_project => 8);

    -- Lumen Works opened the house's tag, which let it read the house and propose.
    insert into public.scans (tag_id, scanner_profile_id, scanned_at)
    select pg_temp.seed_id('tag', 7), lumen, pg_temp.days_ago(2)
    where not exists (
      select 1 from public.scans where tag_id = pg_temp.seed_id('tag', 7) and scanner_profile_id = lumen
    );
    insert into public.project_tag_grants (tag_id, profile_id, granted_at)
    values (pg_temp.seed_id('tag', 7), lumen, pg_temp.days_ago(2))
    on conflict do nothing;

    insert into public.project_log_entries (id, project_id, occurred_on, title, notes, cost_cents, currency,
                                            performed_by_profile_id, author_profile_id, status, created_at, updated_at)
    select pg_temp.seed_id('log', l.n), pg_temp.seed_id('project', l.project), pg_temp.days_ago(l.days)::date,
           l.title, l.notes, l.cost_cents, 'USD', l.who, l.who, l.status, pg_temp.days_ago(l.days), pg_temp.days_ago(l.days)
    from (values
      (1, 8, 330, 'Installed the furnace', 'Replaced the old unit. Ten years on parts.', 640000, timberline, 'published'),
      (2, 8, 35, 'Annual service', 'Cleaned the burners and checked the igniter.', 18000, timberline, 'published'),
      (3, 8, 10, 'Changed the filter', null, 2400, maya, 'published'),
      (4, 9, 126, 'Flushed the tank', null, null, maya, 'published'),
      (5, 7, 2, 'Installed under-cabinet lights', 'Warm white, on a dimmer.', 42000, lumen, 'proposed')
    ) as l(n, project, days, title, notes, cost_cents, who, status)
    on conflict (id) do nothing;

    -- Embedded tags on photo posts
    perform pg_temp.seed_embedded_tag(101, 1, 55, 28, dest_product => 1);
    perform pg_temp.seed_embedded_tag(102, 1, 40, 70, dest_project => 3);
    perform pg_temp.seed_embedded_tag(103, 7, 50, 55, dest_project => 1);
    perform pg_temp.seed_embedded_tag(104, 14, 42, 48, dest_product => 7);
    perform pg_temp.seed_embedded_tag(105, 19, 35, 25, dest_product => 10);
    perform pg_temp.seed_embedded_tag(106, 19, 70, 62, dest_profile => sam);
    perform pg_temp.seed_embedded_tag(107, 29, 50, 50, dest_project => 5);
    perform pg_temp.seed_embedded_tag(108, 29, 30, 20, dest_product => 12);
    perform pg_temp.seed_embedded_tag(109, 30, 50, 45, dest_profile => lumen);
    perform pg_temp.seed_embedded_tag(110, 8, 50, 40, dest_profile => timberline);
    perform pg_temp.seed_embedded_tag(111, 20, 50, 50, dest_project => 6);
    perform pg_temp.seed_embedded_tag(112, 21, 60, 40, dest_post => 20);
    perform pg_temp.seed_embedded_tag(113, 23, 50, 50, dest_profile => sam);

    -- Follows
    foreach pair slice 1 in array array[
      [maya, timberline], [maya, lumen], [maya, casey], [maya, sam], [maya, theo], [maya, nora],
      [jordan, ironform], [jordan, riley], [jordan, theo], [jordan, priya],
      [sam, lumen], [sam, theo], [sam, casey], [sam, maya], [sam, leo],
      [riley, ridgeline], [riley, marcus], [riley, jordan], [riley, theo],
      [casey, maya], [casey, sam], [casey, timberline], [casey, ridgeline],
      [theo, sam], [theo, lumen], [theo, timberline], [theo, maya], [theo, riley], [theo, jordan],
      [nora, timberline], [nora, maya], [nora, theo],
      [marcus, ridgeline], [marcus, riley],
      [priya, ironform], [priya, jordan],
      [leo, lumen], [leo, sam], [leo, theo],
      [timberline, maya], [timberline, lumen], [ridgeline, riley], [ironform, jordan], [lumen, sam], [lumen, theo]
    ] loop
      insert into public.follows (follower_id, followed_id, created_at)
      values (pair[1], pair[2], pg_temp.days_ago(30))
      on conflict do nothing;
    end loop;

    -- Comments, and replies to them
    perform pg_temp.seed_comment(1, 1, marcus, 1.8, 'That rack sits lower than I expected. Nice.');
    perform pg_temp.seed_comment(2, 1, riley, 1.7, 'Took two tries to get the height right.', reply_to => 1);
    perform pg_temp.seed_comment(3, 7, maya, 0.8, 'The siding came out beautiful.');
    perform pg_temp.seed_comment(4, 13, priya, 0.9, 'Which trail is this?');
    perform pg_temp.seed_comment(5, 13, jordan, 0.85, 'Tumalo ridge, the north loop.', reply_to => 4);
    perform pg_temp.seed_comment(6, 19, sam, 1.9, 'Worth every meter.');
    perform pg_temp.seed_comment(7, 20, theo, 5.5, 'Coming by Thursday to shoot this.');
    perform pg_temp.seed_comment(8, 25, maya, 2.5, 'Stealing this layout.');
    perform pg_temp.seed_comment(9, 29, theo, 3.8, 'Photos are up on my profile.');
    perform pg_temp.seed_comment(10, 9, casey, 6.5, 'Good luck with the permits.');
    perform pg_temp.seed_comment(11, 34, nora, 14.5, 'Penetrating oil, and a fresh coat every two years.');
    perform pg_temp.seed_comment(12, 34, maya, 14.4, 'Thank you! Doing that this weekend.', reply_to => 11);
    perform pg_temp.seed_comment(13, 2, riley, 4.6, 'Save me a spot on the lift.');
    perform pg_temp.seed_comment(14, 24, casey, 24, 'How long did it take to take apart?');
    perform pg_temp.seed_comment(15, 24, sam, 23.9, 'Two evenings and one very small screwdriver.', reply_to => 14);

    -- Likes: each seed profile likes about two in five of the others' posts,
    -- chosen by a hash so every run picks the same ones.
    insert into public.likes (post_id, user_id, created_at)
    select p.id, pr.id, least(p.created_at + interval '3 hours', now())
    from public.posts p
    join public.profiles pr on pr.user_id::text like '5eed0a00-%' and pr.id <> p.user_id
    where p.id::text like '5eed0c00-%'
      and abs(hashtext(p.id::text || pr.id::text)) % 5 < 2
    on conflict do nothing;

    -- Reposts
    insert into public.reposts (post_id, user_id, created_at)
    select pg_temp.seed_id('post', r.post), r.profile, pg_temp.days_ago(r.days)
    from (values (20, theo, 5), (7, maya, 0.5), (14, jordan, 3), (19, sam, 1.5)) as r(post, profile, days)
    on conflict do nothing;

    -- Saves, one of each kind
    insert into public.saves (profile_id, saved_product_id, saved_project_id, saved_post_id, saved_profile_id)
    values
      (jordan, pg_temp.seed_id('product', 7), null, null, null),
      (riley, pg_temp.seed_id('product', 2), null, null, null),
      (sam, pg_temp.seed_id('product', 10), null, null, null),
      (maya, null, pg_temp.seed_id('project', 1), null, null),
      (casey, null, pg_temp.seed_id('project', 6), null, null),
      (nora, null, null, pg_temp.seed_id('post', 8), null),
      (priya, null, null, pg_temp.seed_id('post', 13), null),
      (theo, null, null, null, lumen)
    on conflict do nothing;
  end;
end;
$seed$;
