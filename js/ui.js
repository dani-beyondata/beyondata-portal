// ui.js — shared UI helpers: modals, alerts, badges, loading states

const UI = (() => {

  function showAlert(elId, message, type = 'error') {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = message;
    el.className = `alert ${type} show`;
  }

  function hideAlert(elId) {
    const el = document.getElementById(elId);
    if (el) el.classList.remove('show');
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
    // Clear any alerts inside
    el?.querySelectorAll('.alert').forEach(a => a.classList.remove('show'));
  }

  function setLoading(btnId, loading, defaultText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Saving...' : defaultText;
  }

  function badge(text, type) {
    return `<span class="badge badge-${type}">${text}</span>`;
  }

  function statusBadge(active) {
    return badge(active ? 'Active' : 'Inactive', active ? 'active' : 'inactive');
  }

  function roleBadge(role) {
    const map = {
      system_admin: ['System Admin', 'system'],
      company_admin: ['Admin', 'admin'],
      company_user: ['User', 'user']
    };
    const [label, type] = map[role] || ['Unknown', 'inactive'];
    return badge(label, type);
  }

  function sourceBadge(source) {
    return badge(source, source === 'api' ? 'api' : 'upload');
  }

  function tableLoading(tbodyId, cols) {
    const tbody = document.getElementById(tbodyId);
    if (tbody) tbody.innerHTML = `<tr><td colspan="${cols}" class="td-center td-muted">Loading...</td></tr>`;
  }

  function tableEmpty(tbodyId, cols, message = 'No data yet.') {
    const tbody = document.getElementById(tbodyId);
    if (tbody) tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty-state">${message}</div></td></tr>`;
  }

  function mono(text) {
    return `<code class="mono">${text}</code>`;
  }

  return {
    showAlert, hideAlert, openModal, closeModal,
    setLoading, badge, statusBadge, roleBadge, sourceBadge,
    tableLoading, tableEmpty, mono
  };
})();

// Make closeModal global for inline onclick handlers
function closeModal(id) { UI.closeModal(id); }
