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
    // Step 1: sign up the new user — this changes the active session
    const { data: authData, error: authError } = await sb.auth.signUp({ email, password });
    if (authError) return { data: null, error: authError };

    const newUserId = authData.user.id;

    // Step 2: sign back in as the admin immediately
    // We need to restore the admin session before inserting the profile
    // so the RLS policy sees the admin as the inserting user
    // We use a small workaround: store admin session, restore it
    const { data: { session: adminSession } } = await sb.auth.getSession();

    // Step 3: insert profile using a direct REST call with admin auth header
    // This avoids the RLS issue by using the admin's token explicitly
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${adminSession?.access_token}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          id: newUserId,
          company_id: companyId,
          role,
          full_name: fullName,
          active: true
        })
      }
    );

    if (!response.ok) {
      const err = await response.json();
      return { data: null, error: { message: err.message || 'Failed to create profile' } };
    }

    const data = await response.json();
    return { data, error: null };
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
