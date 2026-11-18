# reeldrop Tee Vote

A one-page, mobile-first vote on the six black-tee versions of the **We're reeldrop** design:
coloured Lolo, 3D pop-out, mixed-media world, shooting a reel, "this is fine", and approve / reject.

Live: https://souradip121.github.io/reeldrop-tee-vote/

## How it works

1. Pick your name from the dropdown (Piyush, Souradip, Baivab, Aishi, Piuli, Samiran).
2. See one design at a time and tap **Like** or **Dislike** (or swipe the picture, or use ← →).
3. Review all six, change any, then **Submit**. After submitting, the vote is locked.
4. You then see your own vote and the results so far. Nobody sees scores before submitting.

Progress is kept on the phone, so closing the page mid-way and coming back resumes where you were.
Anyone who opens the link can pick any name that hasn't voted yet: there is no password.

## Supabase

Project `nkcmgcunnrqulocdwgxr`. The ballot lives in `public.tee_vote2_*` (see `supabase/ballot.sql`);
voters come from `public.tee_vote_voters`. Tables have row-level security on and no policies, so the
publishable key in `assets/config.js` can only call:

| Function | Does |
|---|---|
| `tee_vote2_status()` | names (and who has voted), design list; never scores |
| `tee_vote2_submit(voter, votes)` | saves a complete ballot once, then locks that voter |
| `tee_vote2_results(voter)` | scores and names, only for a voter who has submitted (or once closed) |

`supabase/schema.sql` holds the earlier tabbed votes (`tee_vote_votes`, `tee_vote_ab`); those tables
are kept as history and are no longer used by the page.

Useful SQL (Supabase SQL editor):

```sql
-- close voting (results then show to everyone)
update public.tee_vote2_settings set closed = true where id = 1;
-- let one person vote again
delete from public.tee_vote2_submissions where voter = 'piyush';
-- start the whole vote over
delete from public.tee_vote2_submissions;
```

## Files

- `index.html`, `assets/app.js`, `assets/style.css`: the page (no build step)
- `assets/designs.js`: the six designs
- `assets/img/v3-*.jpg`: black-tee mockups
