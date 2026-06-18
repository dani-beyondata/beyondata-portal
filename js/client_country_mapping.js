// client_country_mapping.js — per-company raw country text -> ISO code CRUD

const ClientCountryMapping = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb
      .from('client_country_mapping')
      .select('*')
      .eq('company_id', companyId)
      .order('raw_value');
    return { data, error };
  }

  async function create(companyId, fields) {
    const { data, error } = await sb
      .from('client_country_mapping')
      .insert({ ...fields, company_id: companyId })
      .select().single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb
      .from('client_country_mapping')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { data, error };
  }

  return { getByCompany, create, update };
})();
