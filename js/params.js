// params.js — client params read/write

const Params = (() => {

  async function getAll(companyId) {
    const { data, error } = await sb
      .from('client_params')
      .select('*')
      .eq('company_id', companyId);

    const map = {};
    (data || []).forEach(p => map[p.param_key] = p.param_value);
    return { data: map, error };
  }

  async function set(companyId, key, value) {
    const { data, error } = await sb
      .from('client_params')
      .upsert(
        { company_id: companyId, param_key: key, param_value: value, updated_at: new Date().toISOString() },
        { onConflict: 'company_id,param_key' }
      );
    return { data, error };
  }

  return { getAll, set };
})();
