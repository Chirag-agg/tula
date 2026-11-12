# Tula backend (Supabase)

| Path | What it does |
| --- | --- |
| `migrations/20261112000000_init.sql` | `deadlines` (backup copy of each deadline), `capture_events` (counts only, for pilot metrics), `extract_usage` (daily cap). Row-level security on all three; every row is deleted with its account |
| `functions/extract` | Reads a notice (text, screenshot or PDF) with Gemini and returns proposed deadlines. Signed-in users only, 100 reads per day by default. The notice is never stored or logged |
| `functions/delete-account` | Deletes the signed-in student's account and, by cascade, all their rows |

## Deploy

From the repo root:

```bash
npx supabase link
```

```bash
npx supabase db push
```

```bash
npx supabase secrets set GEMINI_API_KEY=your-key GEMINI_MODEL=gemini-2.5-flash-lite
```

```bash
npx supabase functions deploy extract
```

```bash
npx supabase functions deploy delete-account
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. Optional: `EXTRACT_DAILY_CAP` (default 100).

Check the model name against Google's current list before launch; the default may have been renamed. The model sits behind this one function, so changing it is one secret.

## Pilot metrics

Run in the SQL editor (as the project owner):

```sql
-- captures per active student per week, and the share saved without edits
select date_trunc('week', at) as week,
       count(distinct user_id) as students,
       round(count(*)::numeric / nullif(count(distinct user_id), 0), 1) as captures_per_student,
       round(100 * (1 - sum(edited)::numeric / nullif(sum(saved + merged), 0)), 0) as pct_saved_without_edits
from public.capture_events
group by 1 order by 1;
```

```sql
-- students still capturing in week 4 of the pilot (set the start date)
with s as (select user_id, min(at) as first_at from public.capture_events group by 1)
select count(*) filter (where exists (
         select 1 from public.capture_events e
         where e.user_id = s.user_id and e.at >= s.first_at + interval '21 days' and e.at < s.first_at + interval '28 days'))
       * 100.0 / count(*) as pct_capturing_in_week_4
from s;
```

## Not verified yet

The functions were written against the documented Supabase and Gemini APIs but haven't been deployed or run: there is no Supabase project or Gemini key yet. Deno isn't installed locally, so they haven't been type-checked either.
