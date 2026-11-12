// Runs the extract function against a fake Supabase and a fake model; no network, no keys.
//   cd supabase/functions && deno test --allow-env extract/
import { assertEquals, assertMatch } from 'jsr:@std/assert@1';

const SUPABASE = 'http://supabase.test';
Deno.env.set('SUPABASE_URL', SUPABASE);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');
Deno.env.set('GEMINI_API_KEY', 'gemini-test');
Deno.env.set('EXTRACT_DAILY_CAP', '3');

/** What the fakes saw and will answer. */
const world = {
  usageToday: 0,
  usageInserts: [] as unknown[],
  modelText: '[]',
  modelStatus: 200,
  modelBodies: [] as any[],
  modelHeaders: [] as Headers[],
};

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin === SUPABASE && url.pathname === '/auth/v1/user') {
    return req.headers.get('Authorization') === 'Bearer good-token'
      ? jsonRes({ id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 's@example.edu' })
      : jsonRes({ msg: 'invalid JWT' }, 401);
  }
  if (url.origin === SUPABASE && url.pathname === '/rest/v1/extract_usage') {
    if (req.method === 'HEAD' || req.method === 'GET') {
      return new Response(null, { status: 200, headers: { 'Content-Range': `*/${world.usageToday}` } });
    }
    if (req.method === 'POST') {
      world.usageInserts.push(await req.json());
      return new Response(null, { status: 201 });
    }
  }
  if (url.hostname === 'generativelanguage.googleapis.com') {
    world.modelBodies.push(await req.json());
    world.modelHeaders.push(req.headers);
    return jsonRes({ candidates: [{ content: { parts: [{ text: world.modelText }] } }] }, world.modelStatus);
  }
  throw new Error(`unexpected fetch ${req.method} ${req.url}`);
};

let handler!: (req: Request) => Promise<Response>;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: typeof handler) => {
  handler = h;
  return { finished: Promise.resolve(), shutdown: async () => {} };
};
await import('./index.ts');

const NOW = { now: '2026-11-11T14:05', weekday: 'Wednesday' };
const call = (body: unknown, token = 'good-token') =>
  handler(
    new Request('http://fn.test/extract', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const reset = () => {
  world.usageToday = 0;
  world.usageInserts = [];
  world.modelText = '[]';
  world.modelStatus = 200;
  world.modelBodies = [];
  world.modelHeaders = [];
};

Deno.test('rejects a request without a valid sign-in', async () => {
  reset();
  const r = await call({ text: 'x', ...NOW }, 'bad-token');
  assertEquals(r.status, 401);
  assertEquals((await r.json()).error, 'not_signed_in');
  assertEquals(world.modelBodies.length, 0);
});

Deno.test('reads a text notice and returns the model items', async () => {
  reset();
  world.modelText = JSON.stringify([{ title: 'Submit ML lab record', when: 'Friday 5 pm', due: '2026-11-13T17:00' }]);
  const r = await call({ text: 'ML lab record submission by Friday 5 pm', ...NOW });
  assertEquals(r.status, 200);
  const body = await r.json();
  assertEquals(body.items, [{ title: 'Submit ML lab record', when: 'Friday 5 pm', due: '2026-11-13T17:00' }]);
  assertEquals(world.usageInserts, [{ user_id: 'user-1', input: 'text' }]);
  // key goes in a header, never the URL; the notice and the student's clock reach the prompt
  assertEquals(world.modelHeaders[0].get('x-goog-api-key'), 'gemini-test');
  const parts = world.modelBodies[0].contents[0].parts;
  assertMatch(parts[0].text, /Now: Wednesday 2026-11-11 14:05/);
  assertMatch(parts[parts.length - 1].text, /ML lab record submission by Friday 5 pm/);
  assertEquals(world.modelBodies[0].generationConfig.responseMimeType, 'application/json');
});

Deno.test('sends a screenshot as inline data', async () => {
  reset();
  const r = await call({ file: { mimeType: 'image/png', data: 'aGVsbG8=' }, ...NOW });
  assertEquals(r.status, 200);
  const parts = world.modelBodies[0].contents[0].parts;
  assertEquals(parts[1], { inline_data: { mime_type: 'image/png', data: 'aGVsbG8=' } });
  assertEquals(world.usageInserts, [{ user_id: 'user-1', input: 'image' }]);
});

Deno.test('accepts model output wrapped in an object or in prose', async () => {
  reset();
  world.modelText = JSON.stringify({ items: [{ title: 'A' }] });
  assertEquals((await (await call({ text: 'x', ...NOW })).json()).items, [{ title: 'A' }]);
  world.modelText = 'Here you go:\n[{"title":"B"}]\nDone.';
  assertEquals((await (await call({ text: 'x', ...NOW })).json()).items, [{ title: 'B' }]);
  world.modelText = 'not json at all';
  assertEquals((await (await call({ text: 'x', ...NOW })).json()).items, []);
});

Deno.test('caps reads per day', async () => {
  reset();
  world.usageToday = 3;
  const r = await call({ text: 'x', ...NOW });
  assertEquals(r.status, 429);
  assertEquals(world.modelBodies.length, 0);
});

Deno.test('refuses bad input before calling the model', async () => {
  reset();
  assertEquals((await call({ file: { mimeType: 'application/zip', data: 'x' }, ...NOW })).status, 415);
  assertEquals((await call({ file: { mimeType: 'image/png', data: 'x'.repeat(7_000_001) }, ...NOW })).status, 413);
  assertEquals((await call({ text: '   ', ...NOW })).status, 400);
  assertEquals((await call({ text: 'x', now: 'tomorrow' })).status, 400);
  assertEquals((await call('{not json')).status, 400);
  assertEquals(world.modelBodies.length, 0);
  assertEquals(world.usageInserts.length, 0);
});

Deno.test('reports a model failure without leaking details', async () => {
  reset();
  world.modelStatus = 500;
  const r = await call({ text: 'x', ...NOW });
  assertEquals(r.status, 502);
  assertEquals(await r.json(), { error: 'model_unavailable' });
});

Deno.test('does not count a read when the server has no model key', async () => {
  reset();
  Deno.env.delete('GEMINI_API_KEY');
  try {
    const r = await call({ text: 'x', ...NOW });
    assertEquals(r.status, 503);
    assertEquals(world.usageInserts.length, 0);
  } finally {
    Deno.env.set('GEMINI_API_KEY', 'gemini-test');
  }
});
