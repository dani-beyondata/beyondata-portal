// booking_purposes.js — booking purposes catalog CRUD

const BookingPurposes = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb
      .from('booking_purposes')
      .select('*')
      .eq('company_id', companyId)
      .order('display_name');
    return { data, error };
  }

  async function create(companyId, fields) {
    const { data, error } = await sb
      .from('booking_purposes')
      .insert({ ...fields, company_id: companyId, status: 'active' })
      .select().single();
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb
      .from('booking_purposes')
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
