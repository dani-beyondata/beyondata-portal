// rooms.js — room categories, rooms, attribute types, room capacity calendar

const Rooms = (() => {

  // ── Categories ──────────────────────────────────────────────────
  async function getCategories(companyId) {
    const { data, error } = await sb.from('room_categories')
      .select('*').eq('company_id', companyId).order('display_name');
    return { data, error };
  }

  async function createCategory(companyId, fields) {
    const { data, error } = await sb.from('room_categories')
      .insert({ ...fields, company_id: companyId, status: 'active' }).select().single();
    return { data, error };
  }

  async function toggleCategory(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    return await sb.from('room_categories').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  }

  // ── Rooms ────────────────────────────────────────────────────────
  async function getByProperty(companyId, propertyId) {
    const { data, error } = await sb.from('rooms')
      .select('*, room_categories(raw_value, display_name)')
      .eq('company_id', companyId).eq('property_uuid', propertyId).order('raw_value');
    return { data, error };
  }

  async function create(companyId, propertyId, fields) {
    const { data, error } = await sb.from('rooms')
      .insert({ ...fields, company_id: companyId, property_uuid: propertyId, property_id: propertyId, status: 'active' })
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

  // ── Attribute Types ──────────────────────────────────────────────
  async function getAttributeTypes(companyId) {
    const { data, error } = await sb.from('room_attribute_types')
      .select('*').eq('company_id', companyId).order('attribute_name');
    return { data, error };
  }

  async function createAttributeType(companyId, fields) {
    const { data, error } = await sb.from('room_attribute_types')
      .insert({ ...fields, company_id: companyId, status: 'active' }).select().single();
    return { data, error };
  }

  async function toggleAttributeType(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    return await sb.from('room_attribute_types').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  }

  // ── Room Capacity Calendar ───────────────────────────────────────
  async function getCapacityMonth(companyId, propertyId, year, month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const { data, error } = await sb.from('room_capacity_calendar')
      .select('*')
      .eq('company_id', companyId).eq('property_uuid', propertyId)
      .gte('date', from).lte('date', to);
    return { data, error };
  }

  async function upsertCapacityMany(rows) {
    const { data, error } = await sb.from('room_capacity_calendar')
      .upsert(rows, { onConflict: 'company_id,property_uuid,room_id,date' });
    return { data, error };
  }

  return {
    getCategories, createCategory, toggleCategory,
    getByProperty, create, update, toggleRoom,
    getAttributeTypes, createAttributeType, toggleAttributeType,
    getCapacityMonth, upsertCapacityMany
  };
})();
