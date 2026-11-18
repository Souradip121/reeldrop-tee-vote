-- reeldrop tee vote, one-page ballot: the six black-tee versions of "We're reeldrop"
-- (replaces the tabbed votes in schema.sql; those tables are kept as history).
-- Each voter picks their name, rates every design +1 / -1, and submits once. After that the ballot is locked.
-- Results are only returned to someone who has submitted (or once voting is closed).
-- Tables are tee_vote2_*; RLS on with no policies, so the publishable key can only call the three functions below.
-- Voters come from public.tee_vote_voters (defined in schema.sql).

create table if not exists public.tee_vote2_designs (
  id    text primary key,
  title text not null,
  sort  smallint not null
);

create table if not exists public.tee_vote2_submissions (
  voter        text primary key references public.tee_vote_voters (id) on delete cascade,
  submitted_at timestamptz not null default now()
);

create table if not exists public.tee_vote2_ballots (
  voter  text not null references public.tee_vote2_submissions (voter) on delete cascade,
  design text not null references public.tee_vote2_designs (id) on delete cascade,
  value  smallint not null check (value in (-1, 1)),
  primary key (voter, design)
);

create table if not exists public.tee_vote2_settings (
  id     smallint primary key default 1 check (id = 1),
  closed boolean not null default false
);
insert into public.tee_vote2_settings (id) values (1) on conflict (id) do nothing;

alter table public.tee_vote2_designs     enable row level security;
alter table public.tee_vote2_submissions enable row level security;
alter table public.tee_vote2_ballots     enable row level security;
alter table public.tee_vote2_settings    enable row level security;
revoke all on public.tee_vote2_designs, public.tee_vote2_submissions, public.tee_vote2_ballots, public.tee_vote2_settings
  from anon, authenticated;

insert into public.tee_vote2_designs (id, title, sort) values
  ('14-were-coloured',       'Coloured Lolo',       1),
  ('15-were-3d-popout',      '3D pop-out',          2),
  ('16-were-world',          'Mixed-media world',   3),
  ('17-were-reel',           'Shooting a reel',     4),
  ('18-were-this-is-fine',   'This is fine',        5),
  ('19-were-approve-reject', 'Approve / reject',    6)
on conflict (id) do update set title = excluded.title, sort = excluded.sort;
-- the ballot is only these six (black tee); drop any other designs
delete from public.tee_vote2_designs where id not in
  ('14-were-coloured', '15-were-3d-popout', '16-were-world', '17-were-reel', '18-were-this-is-fine', '19-were-approve-reject');

-- public: who can still vote, and how many designs there are (no scores)
create or replace function public.tee_vote2_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'closed', (select s.closed from public.tee_vote2_settings s where s.id = 1),
    'designs', (select coalesce(jsonb_agg(d.id order by d.sort), '[]'::jsonb) from public.tee_vote2_designs d),
    'voters', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', v.id, 'name', v.display_name,
                 'submitted', exists (select 1 from public.tee_vote2_submissions s where s.voter = v.id))
               order by v.display_name), '[]'::jsonb)
               from public.tee_vote_voters v));
$$;

-- submit a whole ballot at once: p_votes = {"<design id>": 1 | -1, ...} covering every design. Locks the voter.
create or replace function public.tee_vote2_submit(p_voter text, p_votes jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id text := lower(trim(p_voter));
  n_designs int := (select count(*) from public.tee_vote2_designs);
begin
  if not exists (select 1 from public.tee_vote_voters v where v.id = v_id) then
    raise exception 'Unknown voter.';
  end if;
  if (select s.closed from public.tee_vote2_settings s where s.id = 1) then
    raise exception 'Voting is closed.';
  end if;
  if exists (select 1 from public.tee_vote2_submissions s where s.voter = v_id) then
    raise exception 'This vote has already been submitted and can''t be changed.';
  end if;
  if jsonb_typeof(p_votes) <> 'object'
     or (select count(*) from jsonb_each_text(p_votes)) <> n_designs
     or exists (select 1 from jsonb_each_text(p_votes) e where e.key not in (select d.id from public.tee_vote2_designs d))
     or exists (select 1 from jsonb_each_text(p_votes) e where e.value not in ('1', '-1')) then
    raise exception 'Rate every design with a like or a dislike before submitting.';
  end if;
  insert into public.tee_vote2_submissions (voter) values (v_id);
  insert into public.tee_vote2_ballots (voter, design, value)
    select v_id, e.key, e.value::smallint from jsonb_each_text(p_votes) e;
  return public.tee_vote2_results(v_id);
end;
$$;

-- results, only for a voter who has submitted (or for anyone once voting is closed)
create or replace function public.tee_vote2_results(p_voter text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id text := lower(trim(coalesce(p_voter, '')));
begin
  if not (select s.closed from public.tee_vote2_settings s where s.id = 1)
     and not exists (select 1 from public.tee_vote2_submissions s where s.voter = v_id) then
    raise exception 'Submit your vote to see the results.';
  end if;
  return jsonb_build_object(
    'closed', (select s.closed from public.tee_vote2_settings s where s.id = 1),
    'submitted', (select coalesce(jsonb_agg(v.display_name order by v.display_name), '[]'::jsonb)
                  from public.tee_vote2_submissions s join public.tee_vote_voters v on v.id = s.voter),
    'voters', (select count(*) from public.tee_vote_voters),
    'mine', (select coalesce(jsonb_object_agg(b.design, b.value), '{}'::jsonb)
             from public.tee_vote2_ballots b where b.voter = v_id),
    'designs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id,
               'up',   (select count(*) from public.tee_vote2_ballots b where b.design = d.id and b.value = 1),
               'down', (select count(*) from public.tee_vote2_ballots b where b.design = d.id and b.value = -1),
               'ups',  (select coalesce(jsonb_agg(v.display_name order by v.display_name), '[]'::jsonb)
                        from public.tee_vote2_ballots b join public.tee_vote_voters v on v.id = b.voter
                        where b.design = d.id and b.value = 1),
               'downs', (select coalesce(jsonb_agg(v.display_name order by v.display_name), '[]'::jsonb)
                        from public.tee_vote2_ballots b join public.tee_vote_voters v on v.id = b.voter
                        where b.design = d.id and b.value = -1))
             order by d.sort), '[]'::jsonb)
      from public.tee_vote2_designs d));
end;
$$;

revoke all on function public.tee_vote2_status() from public;
revoke all on function public.tee_vote2_submit(text, jsonb) from public;
revoke all on function public.tee_vote2_results(text) from public;
grant execute on function public.tee_vote2_status() to anon, authenticated;
grant execute on function public.tee_vote2_submit(text, jsonb) to anon, authenticated;
grant execute on function public.tee_vote2_results(text) to anon, authenticated;

-- Close voting (then results show to everyone):  update public.tee_vote2_settings set closed = true where id = 1;
-- Let one person vote again:                      delete from public.tee_vote2_submissions where voter = 'piyush';
