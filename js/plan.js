// plan.js — client plan (modules + rooms) read/write via client_params
// Stores everything as params so no new Supabase table is needed.
//   plan_rooms          -> "40"
//   plan_active         -> JSON: {"ventas":true,"pl":false,...}
//   plan_requested      -> JSON: same shape (what the client asked for)
//   plan_status         -> "none" | "pending" | "approved"
//   plan_requested_at   -> ISO date

const Plan = (() => {

  const MODULE_KEYS = ['ventas', 'pl', 'forecast', 'extras', 'markets', 'consultoria'];

  function emptyModules() {
    // ventas is the base module: always active
    return { ventas: true, pl: false, forecast: false, extras: false, markets: false, consultoria: false };
  }

  function parseModules(str) {
    if (!str) return emptyModules();
    try {
      const obj = typeof str === 'string' ? JSON.parse(str) : str;
      const base = emptyModules();
      MODULE_KEYS.forEach(k => { if (typeof obj[k] === 'boolean') base[k] = obj[k]; });
      base.ventas = true; // enforce base always on
      return base;
    } catch (e) {
      return emptyModules();
    }
  }

  async function get(companyId) {
    const { data, error } = await sb
      .from('client_params')
      .select('param_key, param_value')
      .eq('company_id', companyId)
      .in('param_key', ['plan_rooms', 'plan_active', 'plan_requested', 'plan_status', 'plan_requested_at']);

    const map = {};
    (data || []).forEach(p => map[p.param_key] = p.param_value);

    return {
      data: {
        rooms: parseInt(map.plan_rooms) || 40,
        active: parseModules(map.plan_active),
        requested: parseModules(map.plan_requested),
        status: map.plan_status || 'none',
        requestedAt: map.plan_requested_at || null
      },
      error
    };
  }

  async function setParam(companyId, key, value) {
    return await sb
      .from('client_params')
      .upsert(
        { company_id: companyId, param_key: key, param_value: value, updated_at: new Date().toISOString() },
        { onConflict: 'company_id,param_key' }
      );
  }

  // Client submits a change request (does NOT change active plan)
  async function requestChange(companyId, rooms, modules) {
    const now = new Date().toISOString();
    const r1 = await setParam(companyId, 'plan_rooms', String(rooms));
    const r2 = await setParam(companyId, 'plan_requested', JSON.stringify(modules));
    const r3 = await setParam(companyId, 'plan_status', 'pending');
    const r4 = await setParam(companyId, 'plan_requested_at', now);
    const error = r1.error || r2.error || r3.error || r4.error || null;
    return { error };
  }

  // Admin approves: requested -> active, status back to none
  async function approve(companyId, modules) {
    const r1 = await setParam(companyId, 'plan_active', JSON.stringify(modules));
    const r2 = await setParam(companyId, 'plan_status', 'approved');
    const error = r1.error || r2.error || null;
    return { error };
  }

  return { get, requestChange, approve, emptyModules, MODULE_KEYS };
})();
