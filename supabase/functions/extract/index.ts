// Reads a notice (text, screenshot or PDF) and returns proposed deadlines.
// The app re-checks every date with its own resolver and shows a confirm card;
// nothing is saved here and the notice itself is never stored or logged.
import { admin, cors, json, userFrom } from '../_shared/auth.ts';

const AREAS = ['Assignment', 'Internship / jobs', 'Hackathon', 'Fees / forms', 'Community', 'Personal'];
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_TEXT = 8000;
const MAX_FILE_B64 = 7_000_000; // about 5 MB of file
const DAILY_CAP = Number(Deno.env.get('EXTRACT_DAILY_CAP') ?? 100);
const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function prompt(now: string, weekday: string, hasFile: boolean) {
  return `You pull deadlines out of a notice that an Indian college student received (class WhatsApp groups, Classroom, email, Unstop).
It may be English or Hinglish.${hasFile ? ' The notice is in the attached screenshot or PDF; any text below is extra context.' : ''}
Now: ${weekday} ${now.replace('T', ' ')} (the student's local time).
Reply with only a JSON array, one item per distinct deadline or task. Each item:
{"title": short action starting with a verb, max 70 chars,
 "when": the date and time words copied exactly from the notice (e.g. "Friday 5 pm", "kal tak", "12/11 EOD"), or "" if none are given,
 "due": your reading of that as "YYYY-MM-DDTHH:mm" local time, or "" if there is no date or it is vague,
 "submit": what to submit and where, max 80 chars, or "",
 "link": a URL copied exactly from the notice, or "",
 "imp": 1|2|3 (3 = can't be undone: internship or scholarship forms, offers, fees, registrations, exams; 2 = graded coursework; 1 = low stakes),
 "effort": "S"|"M"|"L" (S under 30 min, M about an hour, L 2+ hours),
 "area": one of ${JSON.stringify(AREAS)}}
Do not invent deadlines, dates or links that are not in the notice. If there are none, reply [].
Example: [{"title":"Submit ML lab record","when":"Friday 5 pm","due":"2026-11-13T17:00","submit":"Upload on Classroom","link":"","imp":2,"effort":"M","area":"Assignment"}]`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const db = admin();
  const user = await userFrom(req, db);
  if (!user) return json({ error: 'not_signed_in' }, 401);

  let body: { text?: unknown; file?: { mimeType?: unknown; data?: unknown }; now?: unknown; weekday?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : '';
  const f = body.file;
  const file =
    f && typeof f.data === 'string' && typeof f.mimeType === 'string' && FILE_TYPES.includes(f.mimeType)
      ? { mimeType: f.mimeType, data: f.data }
      : null;
  if (f && !file) return json({ error: 'unsupported_file' }, 415);
  if (file && file.data.length > MAX_FILE_B64) return json({ error: 'file_too_large' }, 413);
  if (!text.trim() && !file) return json({ error: 'empty' }, 400);
  const now = typeof body.now === 'string' && LOCAL_ISO.test(body.now) ? body.now : null;
  const weekday = typeof body.weekday === 'string' ? body.weekday.slice(0, 12) : '';
  if (!now) return json({ error: 'bad_request' }, 400);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'not_configured' }, 503);

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count, error: countErr } = await db
    .from('extract_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('at', since);
  if (countErr) return json({ error: 'server_error' }, 500);
  if ((count ?? 0) >= DAILY_CAP) return json({ error: 'rate_limited' }, 429);
  await db.from('extract_usage').insert({ user_id: user.id, input: file ? (file.mimeType === 'application/pdf' ? 'pdf' : 'image') : 'text' });

  const parts: unknown[] = [{ text: prompt(now, weekday, !!file) }];
  if (file) parts.push({ inline_data: { mime_type: file.mimeType, data: file.data } });
  if (text.trim()) parts.push({ text: `Notice:\n${text}` });

  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return json({ error: 'model_unavailable' }, 502);
  }
  if (res.status === 429) return json({ error: 'rate_limited' }, 429);
  if (!res.ok) {
    console.error('model error', res.status); // status only: never log the notice
    return json({ error: 'model_unavailable' }, 502);
  }
  const out = await res.json();
  const raw: string = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  let items: unknown;
  try {
    items = JSON.parse(raw);
  } catch {
    const m = /\[[\s\S]*\]/.exec(raw);
    try {
      items = m ? JSON.parse(m[0]) : [];
    } catch {
      items = [];
    }
  }
  if (!Array.isArray(items) && items && typeof items === 'object' && Array.isArray((items as { items?: unknown }).items)) {
    items = (items as { items: unknown[] }).items;
  }
  const list = (Array.isArray(items) ? items : []).filter((x) => x && typeof x === 'object').slice(0, 25);
  return json({ items: list, model: MODEL });
});
