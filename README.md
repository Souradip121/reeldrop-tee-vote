# reeldrop Tee Vote

A mobile-first voting page for the 13 reeldrop x Lolo tee designs. Each voter gives every design a
like (+1) or a dislike (−1). Scores, the top three and who voted which way are live on the homepage.

Live: https://souradip121.github.io/reeldrop-tee-vote/

## How voting works

- Six voters: Piyush, Souradip, Baivab, Aishi, Piuli, Samiran. Each has a private link
  (`…/#v=<name>&k=<code>`). Opening it once signs that phone in; the code is then hidden from the address bar.
- Anyone without a link sees the live scores but can't vote.
- Votes save as you tap. Tap your current vote again to clear it.

## Supabase

Project `nkcmgcunnrqulocdwgxr`. Everything lives in `public.tee_vote_*` (see `supabase/schema.sql`).
The tables have row-level security on and no policies, so the publishable key in `assets/config.js`
can only call three functions:

| Function | Who | Does |
|---|---|---|
| `tee_vote_results()` | anyone | scores, names, each voter's progress |
| `tee_vote_me(voter, code)` | a voter | checks the code, returns their votes |
| `tee_vote_set(voter, code, design, value)` | a voter | sets +1 / −1 / 0 on one design |

Codes are stored only as SHA-256 hashes. The voter seed (`supabase/seed_voters.sql`) and the links
(`voter-links.txt`) are kept out of git.

Useful SQL (Supabase SQL editor):

```sql
-- close voting (buttons disable, page shows final scores)
update public.tee_vote_settings set closed = true where id = 1;
-- reopen
update public.tee_vote_settings set closed = false where id = 1;
-- wipe all votes
delete from public.tee_vote_votes;
```

## Files

- `index.html`, `assets/app.js`, `assets/style.css`: the page (no build step)
- `assets/designs.js`: the 13 designs
- `assets/img/`: mockups (pair, white tee, black tee per design)
