// auth.js — login, logout, session management, role-based redirects

const Auth = (() => {

  async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session;
  }

  async function getProfile(userId) {
    const { data } = await sb
      .from('profiles')
      .select('*, companies(*)')
      .eq('id', userId)
      .single();
    return data;
  }

  async function login(email, password) {
    return await sb.auth.signInWithPassword({ email, password });
  }

  async function logout() {
    await sb.auth.signOut();
    sessionStorage.clear();
    window.location.href = 'index.html';
  }

  async function requireAuth() {
    const session = await getSession();
    if (!session) { window.location.href = 'index.html'; return null; }
    return session;
  }

  async function redirectAfterLogin(userId) {
    const profile = await getProfile(userId);
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
