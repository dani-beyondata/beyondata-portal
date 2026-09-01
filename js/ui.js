// ui.js — shared UI helpers: modals, alerts, badges, loading states

const UI = (() => {

  function showAlert(elId, message, type) {
    const el = document.getElementById(elId);
    if (!el) return;
    // si no se especifica el tipo, dedúcelo del id (…-success / …-error / …-warning)
    if (!type) {
      type = /success/i.test(elId) ? 'success'
           : /warn/i.test(elId)    ? 'warning'
           : 'error';
    }
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

  // ── Toasts: floating notifications ──────────────────────────────
  function ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  const TOAST_ICONS = {
    success: '<path d="M20 6L9 17l-5-5"/>',
    error:   '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
    info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
  };

  function toast(message, type = 'info', duration = 4000) {
    const container = ensureToastContainer();
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML =
      `<span class="toast-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[type] || TOAST_ICONS.info}</svg></span>` +
      `<span class="toast-msg">${message}</span>` +
      `<button class="toast-close" aria-label="Cerrar">&times;</button>`;
    container.appendChild(el);

    // trigger enter animation
    requestAnimationFrame(() => el.classList.add('show'));

    let timer = null;
    const remove = () => {
      el.classList.remove('show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      // fallback in case transitionend doesn't fire
      setTimeout(() => el.remove(), 400);
    };
    const start = () => { timer = setTimeout(remove, duration); };
    el.querySelector('.toast-close').addEventListener('click', () => { clearTimeout(timer); remove(); });
    // pause on hover
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start);
    start();
    return el;
  }

  const Toast = {
    success: (m, d) => toast(m, 'success', d),
    error:   (m, d) => toast(m, 'error', d ?? 5000),
    info:    (m, d) => toast(m, 'info', d)
  };

  return {
    showAlert, hideAlert, openModal, closeModal,
    setLoading, badge, statusBadge, roleBadge, sourceBadge,
    tableLoading, tableEmpty, mono, toast, Toast
  };
})();

// Make closeModal global for inline onclick handlers
function closeModal(id) { UI.closeModal(id); }
// Global Toast shortcut
const Toast = UI.Toast;
