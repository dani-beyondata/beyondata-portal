// users.js — user management operations

const Users = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb
      .from('profiles')
      .select('id, full_name, role, active, created_at')
      .eq('company_id', companyId)
      .order('created_at');
    return { data, error };
  }

  async function create(companyId, email, password, fullName, role) {
    // Step 1: create auth user
    const { data: authData, error: authError } = await sb.auth.signUp({ email, password });
    if (authError) return { data: null, error: authError };

    // Step 2: create profile
    const { data, error } = await sb.from('profiles').insert({
      id: authData.user.id,
      company_id: companyId,
      role,
      full_name: fullName,
      active: true
    }).select().single();

    return { data, error };
  }

  async function toggleActive(id, currentActive) {
    const { data, error } = await sb
      .from('profiles')
      .update({ active: !currentActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { data, error };
  }

  async function updateRole(id, role) {
    const { data, error } = await sb
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { data, error };
  }

  return { getByCompany, create, toggleActive, updateRole };
})();
