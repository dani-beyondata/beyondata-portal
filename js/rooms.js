// rooms.js — room categories + rooms CRUD

const Rooms = (() => {

  async function getCategories(companyId) {
    const { data, error } = await sb.from('room_categories')
      .select('*').eq('company_id', companyId).order('category_name');
    return { data, error };
  }

  async function createCategory(companyId, fields) {
    const { data, error } = await sb.from('room_categories')
      .insert({ ...fields, company_id: companyId, status: 'active' }).select().single();
    return { data, error };
  }

  async function toggleCategory(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    const { data, error } = await sb.from('room_categories')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  async function getByProperty(companyId, propertyId) {
    const { data, error } = await sb.from('rooms')
      .select('*, room_categories(category_name)')
      .eq('company_id', companyId)
      .eq('property_id', propertyId)
      .order('room_code');
    return { data, error };
  }

  async function create(companyId, propertyId, fields) {
    const { data, error } = await sb.from('rooms')
      .insert({ ...fields, company_id: companyId, property_id: propertyId, status: 'active' })
      .select().single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb.from('rooms')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  async function toggleRoom(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    return await update(id, { status });
  }

  return { getCategories, createCategory, toggleCategory, getByProperty, create, update, toggleRoom };
})();
