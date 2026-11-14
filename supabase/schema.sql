-- reeldrop tee vote: Supabase schema.
-- Every voter gives every design a thumbs up (+1) or thumbs down (-1); scores are public.
-- All tables are prefixed tee_vote_ and have row-level security ON with no policies, so the public
-- (publishable / anon) key cannot read or write them directly. The page only calls three
-- SECURITY DEFINER functions: tee_vote_results (public), tee_vote_me and tee_vote_set (both need
-- the voter's private code). Codes are never stored, only SHA-256 hashes. Voters are seeded separately.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tee_vote_designs (
  id    text primary key,
  title text not null,
  sort  smallint not null
);

create table if not exists public.tee_vote_voters (
  id           text primary key,          -- lowercase first name, e.g. 'piyush'
  display_name text not null,
  code_hash    text not null              -- hex sha256 of the voter's private code
);

create table if not exists public.tee_vote_votes (
  voter      text not null references public.tee_vote_voters (id) on delete cascade,
  design     text not null references public.tee_vote_designs (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (voter, design)
);

create table if not exists public.tee_vote_settings (
  id     smallint primary key default 1 check (id = 1),
  closed boolean not null default false
);
insert into public.tee_vote_settings (id) values (1) on conflict (id) do nothing;

alter table public.tee_vote_designs  enable row level security;
alter table public.tee_vote_voters   enable row level security;
alter table public.tee_vote_votes    enable row level security;
alter table public.tee_vote_settings enable row level security;
revoke all on public.tee_vote_designs, public.tee_vote_voters, public.tee_vote_votes, public.tee_vote_settings
  from anon, authenticated;

insert into public.tee_vote_designs (id, title, sort) values
  ('01-feature-tiles',         'reeldrop features',      1),
  ('02-heart-of-the-feed',     'Heart of the Feed',      2),
  ('03-schedule-anywhere',     'Schedule Anywhere',      3),
  ('04-self-care-sunday',      'Self Care Sunday',       4),
  ('05-content-creator',       'Content Creator',        5),
  ('06-whats-on-the-feed',     'What''s on the feed?',   6),
  ('07-reels-on-autopilot',    'Reels on autopilot',     7),
  ('08-growth-club',           'Growth Club',            8),
  ('09-were-reeldrop',         'We''re reeldrop',        9),
  ('10-the-work-is-scheduled', 'The work is scheduled', 10),
  ('11-creator-culture',       'creator CULTURE',       11),
  ('12-creator-guide',         'Creator Guide',         12),
  ('13-reel-classic',          'Reel Classic',          13)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;

-- internal: does this code belong to this voter?
create or replace function public.tee_vote_check(p_voter text, p_code text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tee_vote_voters v
    where v.id = lower(trim(p_voter))
      and v.code_hash = encode(extensions.digest(trim(coalesce(p_code, '')), 'sha256'), 'hex')
  );
$$;

-- public: every design's up / down / net score, who voted which way, and each voter's progress
create or replace function public.tee_vote_results()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'closed', (select s.closed from public.tee_vote_settings s where s.id = 1),
    'total', (select count(*) from public.tee_vote_designs),
    'voters', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.display_name,
               'rated', (select count(*) from public.tee_vote_votes x where x.voter = v.id))
             order by v.display_name), '[]'::jsonb)
      from public.tee_vote_voters v),
    'designs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id,
               'up',   (select count(*) from public.tee_vote_votes x where x.design = d.id and x.value = 1),
               'down', (select count(*) from public.tee_vote_votes x where x.design = d.id and x.value = -1),
               'ups',  (select coalesce(jsonb_agg(v.display_name order by v.display_name), '[]'::jsonb)
                        from public.tee_vote_votes x join public.tee_vote_voters v on v.id = x.voter
                        where x.design = d.id and x.value = 1),
               'downs', (select coalesce(jsonb_agg(v.display_name order by v.display_name), '[]'::jsonb)
                        from public.tee_vote_votes x join public.tee_vote_voters v on v.id = x.voter
                        where x.design = d.id and x.value = -1))
             order by d.sort), '[]'::jsonb)
      from public.tee_vote_designs d)
  );
$$;

-- voter: who am I and how did I vote? -> {"id","name","votes":{"<design>": 1 | -1}}
create or replace function public.tee_vote_me(p_voter text, p_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id text := lower(trim(p_voter));
begin
  if not public.tee_vote_check(p_voter, p_code) then
    raise exception 'This voting link is not valid.' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'id', v_id,
    'name', (select v.display_name from public.tee_vote_voters v where v.id = v_id),
    'votes', (select coalesce(jsonb_object_agg(x.design, x.value), '{}'::jsonb)
              from public.tee_vote_votes x where x.voter = v_id));
end;
$$;

-- voter: set my vote on one design: 1 = up, -1 = down, 0 = clear. Returns fresh results.
create or replace function public.tee_vote_set(p_voter text, p_code text, p_design text, p_value int)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id text := lower(trim(p_voter));
begin
  if not public.tee_vote_check(p_voter, p_code) then
    raise exception 'This voting link is not valid.' using errcode = '28000';
  end if;
  if (select s.closed from public.tee_vote_settings s where s.id = 1) then
    raise exception 'Voting is closed.';
  end if;
  if not exists (select 1 from public.tee_vote_designs d where d.id = p_design) then
    raise exception 'Unknown design.';
  end if;
  if p_value = 0 then
    delete from public.tee_vote_votes where voter = v_id and design = p_design;
  elsif p_value in (-1, 1) then
    insert into public.tee_vote_votes (voter, design, value, updated_at)
      values (v_id, p_design, p_value, now())
    on conflict (voter, design) do update set value = excluded.value, updated_at = now();
  else
    raise exception 'A vote must be 1, -1 or 0.';
  end if;
  return public.tee_vote_results();
end;
$$;

revoke all on function public.tee_vote_check(text, text) from public, anon, authenticated;
revoke all on function public.tee_vote_results() from public;
revoke all on function public.tee_vote_me(text, text) from public;
revoke all on function public.tee_vote_set(text, text, text, int) from public;
grant execute on function public.tee_vote_results() to anon, authenticated;
grant execute on function public.tee_vote_me(text, text) to anon, authenticated;
grant execute on function public.tee_vote_set(text, text, text, int) to anon, authenticated;

-- To close voting later:  update public.tee_vote_settings set closed = true where id = 1;
