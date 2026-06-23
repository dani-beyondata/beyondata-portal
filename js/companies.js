// companies.js — company CRUD operations

const Companies = (() => {

  async function getAll() {
    const { data, error } = await sb
      .from('companies')
      .select('*, properties(count)')
      .order('name');
    return { data, error };
  }

  async function getById(id) {
    const { data, error } = await sb
      .from('companies')
      .select('*')
      .eq('id', id)
      .single();
    return { data, error };
  }

  async function create(name, slug) {
    const { data, error } = await sb
      .from('companies')
      .insert({ name, slug, active: true, occupancy_mode: 2 })
      .select()
      .single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb
      .from('companies')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  }

  return { getAll, getById, create, update };
})();
