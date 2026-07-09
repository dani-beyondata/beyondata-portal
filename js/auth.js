// auth.js — login, logout, session management, role-based redirects

const Auth = (() => {

  async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session;
  }

  async function getProfile(userId) {
    const { data, error } = await sb
      .from('profiles')
      .select('*, companies(*)')
      .eq('id', userId)
      .single();
    if (error) console.error('getProfile error:', error);
    return data;
  }

  async function login(email, password) {
    console.log('Attempting login for:', email);
    const result = await sb.auth.signInWithPassword({ email, password });
    console.log('Login result:', result.error ? result.error.message : 'success');
    return result;
  }

  async function logout() {
    await sb.auth.signOut();
    sessionStorage.clear();
    window.location.href = 'login.html';
  }

  async function requireAuth() {
    const session = await getSession();
    if (!session) { window.location.href = 'login.html'; return null; }
    return session;
  }

  async function redirectAfterLogin(userId) {
    const profile = await getProfile(userId);
    console.log('Profile loaded:', profile);
    if (!profile) return null;
    if (profile.role === 'system_admin') {
      window.location.href = 'company-select.html';
    } else {
      window.location.href = 'dashboard.html';
    }
    return profile;
  }

  return { getSession, getProfile, login, logout, requireAuth, redirectAfterLogin };
})();
