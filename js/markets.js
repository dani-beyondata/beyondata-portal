// markets.js — market groups + country mapping CRUD

const Markets = (() => {

  async function getGroups(companyId) {
    const { data, error } = await sb.from('market_groups')
      .select('*').eq('company_id', companyId).order('group_code');
    return { data, error };
  }

  async function createGroup(companyId, fields) {
    const { data, error } = await sb.from('market_groups')
      .insert({ ...fields, company_id: companyId, status: 'active' }).select().single();
    return { data, error };
  }

  async function toggleGroup(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    const { data, error } = await sb.from('market_groups')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  async function getCountries() {
    const { data, error } = await sb.from('countries')
      .select('*').order('continent').order('country_name');
    return { data, error };
  }

  async function getMapping(companyId) {
    const { data, error } = await sb.from('country_mapping')
      .select('*, market_groups(group_name)')
      .eq('company_id', companyId);
    return { data, error };
  }

  async function upsertMapping(companyId, countryCode, targeted, marketGroupId) {
    const { data, error } = await sb.from('country_mapping').upsert({
      company_id: companyId,
      country_code: countryCode,
      targeted,
      market_group_id: marketGroupId || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'company_id,country_code' });
    return { data, error };
  }

  return { getGroups, createGroup, toggleGroup, getCountries, getMapping, upsertMapping };
})();
