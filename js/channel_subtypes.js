// channel_subtypes.js — channel types & subtypes master CRUD

const ChannelSubtypes = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb.from('channel_subtypes')
      .select('*').eq('company_id', companyId)
      .order('type_name').order('subtype_name');
    return { data, error };
  }

  async function getActiveByCompany(companyId) {
    const { data, error } = await sb.from('channel_subtypes')
      .select('*').eq('company_id', companyId).eq('status', 'active')
      .order('type_name').order('subtype_name');
    return { data, error };
  }

  async function create(companyId, typeName, subtypeName) {
    const { data, error } = await sb.from('channel_subtypes')
      .insert({ company_id: companyId, type_name: typeName, subtype_name: subtypeName, status: 'active' })
      .select().single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb.from('channel_subtypes')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  async function toggle(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    return await update(id, { status });
  }

  return { getByCompany, getActiveByCompany, create, update, toggle };
})();
