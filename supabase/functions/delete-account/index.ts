// "Delete my data": removes the signed-in student's account. Every table references
// auth.users with ON DELETE CASCADE, so their deadlines and capture events go with it.
import { admin, cors, json, userFrom } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const db = admin();
  const user = await userFrom(req, db);
  if (!user) return json({ error: 'not_signed_in' }, 401);
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return json({ error: 'server_error' }, 500);
  return json({ deleted: true });
});
