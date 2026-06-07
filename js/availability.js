// availability.js — availability calendar CRUD

const Availability = (() => {

  async function getMonth(companyId, propertyUuid, year, month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const { data, error } = await sb.from('availability_calendar')
      .select('*')
      .eq('company_id', companyId)
      .eq('property_uuid', propertyUuid)
      .gte('date', from)
      .lte('date', to)
      .order('date');
    return { data, error };
  }

  async function upsertDay(companyId, propertyUuid, date, fields) {
    const { data, error } = await sb.from('availability_calendar')
      .upsert({
        company_id:    companyId,
        property_uuid: propertyUuid,
        date,
        ...fields,
        updated_at: new Date().toISOString()
      }, { onConflict: 'company_id,property_uuid,date' });
    return { data, error };
  }

  async function upsertMany(rows) {
    const { data, error } = await sb.from('availability_calendar')
      .upsert(rows, { onConflict: 'company_id,property_uuid,date' });
    return { data, error };
  }

  return { getMonth, upsertDay, upsertMany };
})();
