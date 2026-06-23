// extras_categories.js — extras category master CRUD

const ExtrasCategories = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb.from('extras_categories')
      .select('*').eq('company_id', companyId)
      .order('display_name');
    return { data, error };
  }

  async function create(companyId, fields) {
    const { data, error } = await sb.from('extras_categories')
      .insert({ ...fields, company_id: companyId, status: 'active' })
      .select().single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb.from('extras_categories')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  async function toggle(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    return await update(id, { status });
  }

  return { getByCompany, create, update, toggle };
})();
