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

  // Upserts by (company_id, group_code) so re-running a default-population
  // flow updates the existing group rather than creating a duplicate with
  // the same code -- group_code is the stable identity here, not the name.
  async function upsertGroupByCode(companyId, groupCode, groupName) {
    const { data, error } = await sb.from('market_groups').upsert({
      company_id: companyId,
      group_code: groupCode,
      group_name: groupName,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,group_code' }).select().single();
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

  // Fixed group_code per continent, so this is idempotent: re-running
  // always upserts the same group rather than creating duplicates with
  // a different code for the same continent.
  const CONTINENT_GROUP_CODES = {
    'Africa': 1, 'Asia': 2, 'Europe': 3, 'North America': 4,
    'Oceania': 5, 'South America': 6, 'Antarctica': 7,
  };

  // Creates one market_groups row per continent (upserted by group_code),
  // then upserts a country_mapping row for every country in the global
  // countries table, linking it to its continent's group, targeted=true.
  // This never deletes existing rows -- it's meant as a sensible starting
  // point a client can edit from, not a destructive reset.
  async function populateDefaults(companyId) {
    const { data: countries, error: countriesError } = await getCountries();
    if (countriesError) return { error: countriesError };

    const groupIdByContinent = {};
    for (const [continent, code] of Object.entries(CONTINENT_GROUP_CODES)) {
      const { data: group, error } = await upsertGroupByCode(companyId, code, continent);
      if (error) return { error };
      groupIdByContinent[continent] = group.id;
    }

    let mappedCount = 0;
    for (const country of countries) {
      const groupId = groupIdByContinent[country.continent];
      if (!groupId) continue; // shouldn't happen, but skip rather than throw on an unmapped continent
      const { error } = await upsertMapping(companyId, country.country_code, true, groupId);
      if (error) return { error };
      mappedCount++;
    }

    return { error: null, groupCount: Object.keys(groupIdByContinent).length, mappedCount };
  }

  return { getGroups, createGroup, upsertGroupByCode, populateDefaults, toggleGroup, getCountries, getMapping, upsertMapping };
})();
