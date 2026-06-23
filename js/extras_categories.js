// extras_categories.js — extras category master CRUD

const ExtrasCategories = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb.from('extras_categories')
      .select('*').eq('company_id', companyId)
      .order('category_name');
    return { data, error };
  }

  async function create(companyId, categoryName) {
    const { data, error } = await sb.from('extras_categories')
      .insert({ company_id: companyId, category_name: categoryName, status: 'active' })
      .select().single();
    return { data, error };
  }

  async function update(id, categoryName) {
    const { data, error } = await sb.from('extras_categories')
      .update({ category_name: categoryName, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  async function toggle(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    const { data, error } = await sb.from('extras_categories')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  return { getByCompany, create, update, toggle };
})();
