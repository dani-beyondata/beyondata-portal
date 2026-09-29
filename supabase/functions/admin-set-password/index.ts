// Supabase Edge Function · admin-set-password
// POST { user_id: string, password: string }
// Auth: Bearer <supabase user JWT> of an admin. Sets another user's password
// via the admin API (service role) — something the browser must never do
// directly. Only a system_admin (any company) or a company_admin (limited to
// their own company) may reset a user.
//
// Provided by the runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy:  supabase functions deploy admin-set-password

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing token" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Who is calling?
    const { data: { user }, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !user) return json({ error: "invalid token" }, 401);

    const { data: caller, error: cErr } = await admin
      .from("profiles").select("id, role, company_id").eq("id", user.id).maybeSingle();
    if (cErr) return json({ error: "profile query failed: " + cErr.message }, 403);
    if (!caller) return json({ error: "no profile for caller" }, 403);

    const isAdmin = caller.role === "system_admin" || caller.role === "company_admin";
    if (!isAdmin) return json({ error: "forbidden: admin only" }, 403);

    // What is requested?
    const body = await req.json().catch(() => ({}));
    const targetId = String(body.user_id ?? "");
    const password = String(body.password ?? "");
    if (!targetId) return json({ error: "user_id required" }, 400);
    if (password.length < 8) return json({ error: "password must be at least 8 characters" }, 400);

    // Target must exist; a company_admin may only touch users of their own company.
    const { data: target, error: tErr } = await admin
      .from("profiles").select("id, company_id").eq("id", targetId).maybeSingle();
    if (tErr) return json({ error: "target query failed: " + tErr.message }, 403);
    if (!target) return json({ error: "target user not found" }, 404);
    if (caller.role === "company_admin" && target.company_id !== caller.company_id) {
      return json({ error: "forbidden: target not in your company" }, 403);
    }

    const { error: upErr } = await admin.auth.admin.updateUserById(targetId, { password });
    if (upErr) return json({ error: "update failed: " + upErr.message }, 400);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
