// properties.js — property CRUD operations

const Properties = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb
      .from('properties')
      .select('*')
      .eq('company_id', companyId)
      .order('property_id');
    return { data, error };
  }

  async function create(companyId, fields) {
    const { data, error } = await sb
      .from('properties')
      .insert({ ...fields, company_id: companyId, active: true })
      .select()
      .single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb
      .from('properties')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  }

  async function toggleActive(id, currentActive) {
    return await update(id, { active: !currentActive });
  }

  return { getByCompany, create, update, toggleActive };
})();
