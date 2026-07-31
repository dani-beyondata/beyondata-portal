// corporations.js — Corporations (business accounts) catalog CRUD operations

const Corporations = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb
      .from('corporations')
      .select('*')
      .eq('company_id', companyId)
      .order('display_name');
    return { data, error };
  }

  async function create(companyId, fields) {
    const { data, error } = await sb
      .from('corporations')
      .insert({ ...fields, company_id: companyId })
      .select()
      .single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb
      .from('corporations')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { data, error };
  }

  async function toggleStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    return await update(id, { status: newStatus });
  }

  return { getByCompany, create, update, toggleStatus };
})();
