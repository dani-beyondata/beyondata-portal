// extras_catalog.js — extras catalog CRUD

const ExtrasCatalog = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb.from('extras_catalog')
      .select('*').eq('company_id', companyId)
      .order('category').order('extra_code');
    return { data, error };
  }

  async function create(companyId, fields) {
    const { data, error } = await sb.from('extras_catalog')
      .insert({ ...fields, company_id: companyId, status: 'active' })
      .select().single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb.from('extras_catalog')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  async function toggleStatus(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    return await update(id, { status });
  }

  return { getByCompany, create, update, toggleStatus };
})();
