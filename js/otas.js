// otas.js — OTA catalog CRUD operations

const Otas = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb
      .from('otas')
      .select('*')
      .eq('company_id', companyId)
      .order('ota_name');
    return { data, error };
  }

  async function create(companyId, fields) {
    const { data, error } = await sb
      .from('otas')
      .insert({ ...fields, company_id: companyId })
      .select()
      .single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb
      .from('otas')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { data, error };
  }

  return { getByCompany, create, update };
})();
