# Tula backend (Supabase)

| Path | What it does |
| --- | --- |
| `migrations/20261112000000_init.sql` | `deadlines` (backup copy of each deadline), `capture_events` (counts only, for pilot metrics), `extract_usage` (daily cap). Row-level security on all three; every row is deleted with its account |
| `functions/extract` | Reads a notice (text, screenshot or PDF) with Gemini 3.5 Flash-Lite and returns proposed deadlines. Signed-in users only, 100 reads per day by default. The notice is never stored or logged |
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
npx supabase secrets set GEMINI_API_KEY=your-key
```

```bash
npx supabase functions deploy extract
```

```bash
npx supabase functions deploy delete-account
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

Optional secrets:

| Secret | Default | Use |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Google's current small model (checked 12 Nov 2026). Switch here when Google moves on |
| `GEMINI_API_VERSION` | `v1beta` | Google also offers a stable `v1` Interactions endpoint |
| `EXTRACT_DAILY_CAP` | `100` | Notices one student can have read per day |

**Turn on billing for the Gemini key before real students use it.** On the free tier Google may use the content to improve its products; the privacy policy promises it won't.

### How extract calls Gemini

It uses the **Interactions API** (`POST /v1beta/interactions`), which Google recommends for new projects, with:
- `store: false`, so Google keeps no copy of the notice
- a JSON schema in `response_format`, so the model can only answer in the shape the app expects
- screenshots sent as `image` input and PDFs as `document` input

The app still re-checks every date with its own resolver before showing the confirm card.

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

## Tests

The extract function runs against a fake Supabase and a fake model, so the tests need no keys or network. They cover sign-in, text and screenshot requests, odd model output, the daily cap, input checks and model failures.

```bash
cd supabase/functions && npx deno@2 test --allow-env extract/
```

## Not verified yet

Nothing has been deployed, because there is no Supabase project or Gemini key yet. Real sign-in, row-level security and the actual Gemini response format will only be proven against a live project.
