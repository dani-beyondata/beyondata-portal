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
    // Isolated client: signUp here does NOT touch the admin's session in `sb`
    const temp = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { data: authData, error: authError } = await temp.auth.signUp({ email, password });
    if (authError) return { data: null, error: authError };
    if (!authData.user) return { data: null, error: { message: 'Auth user was not created.' } };

    // Insert the profile as the (still logged-in) admin.
    // Allowed by the profiles_admin_manage RLS policy.
    const { data, error } = await sb
      .from('profiles')
      .insert({
        id: authData.user.id,
        company_id: companyId,
        role,
        full_name: fullName,
        active: true
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: { message: `Profile insert failed (auth user ${email} was created — retry or contact support): ${error.message}` } };
    }
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
