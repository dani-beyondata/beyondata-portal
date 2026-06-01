/* layout.css — topbar, sidebar, main layout */

/* Top bar */
.topbar {
  background: var(--white);
  border-bottom: 1px solid var(--border);
  padding: 0 1.5rem;
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 50;
}

.topbar-left  { display: flex; align-items: center; gap: 1rem; }
.topbar-right { display: flex; align-items: center; gap: 0.75rem; }

.brand-name {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--brand);
  letter-spacing: -0.02em;
}

.brand-name span { color: var(--text); }

.company-pill {
  font-size: 0.8rem;
  background: var(--brand-light);
  color: var(--brand);
  padding: 0.2rem 0.75rem;
  border-radius: 20px;
  font-weight: 500;
}

.user-label {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.role-pill {
  font-family: 'DM Mono', monospace;
  font-size: 0.68rem;
  background: #ede9fe;
  color: #7c3aed;
  padding: 0.2rem 0.6rem;
  border-radius: 20px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Page layout */
.layout {
  display: flex;
  margin-top: var(--topbar-h);
  min-height: calc(100vh - var(--topbar-h));
}

/* Sidebar */
.sidebar {
  width: var(--sidebar-w);
  background: var(--white);
  border-right: 1px solid var(--border);
  padding: 1.5rem 0;
  position: fixed;
  top: var(--topbar-h);
  left: 0;
  bottom: 0;
  overflow-y: auto;
}

.nav-section { margin-bottom: 1.5rem; }

.nav-section-label {
  font-family: 'DM Mono', monospace;
  font-size: 0.62rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 0 1.25rem;
  margin-bottom: 0.35rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 1.25rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s;
  border-left: 2px solid transparent;
  user-select: none;
}

.nav-item:hover { color: var(--text); background: var(--bg); }

.nav-item.active {
  color: var(--brand);
  background: var(--brand-light);
  border-left-color: var(--brand);
  font-weight: 500;
}

.nav-icon { font-size: 1rem; width: 18px; text-align: center; }

/* Main content area */
.content {
  margin-left: var(--sidebar-w);
  flex: 1;
  padding: 2rem;
  max-width: calc(100vw - var(--sidebar-w));
}

/* Section visibility */
.section { display: none; }
.section.active { display: block; }

/* Section header */
.section-header { margin-bottom: 1.75rem; }

.section-header h2 {
  font-size: 1.3rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.section-header p {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

/* Action bar above tables */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.action-bar h3 {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-muted);
}

/* Login page centering */
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.login-wrap { width: 100%; max-width: 420px; padding: 2rem; }

.login-brand { text-align: center; margin-bottom: 2.5rem; }

.login-brand .brand-name { font-size: 1.75rem; }

.login-brand .brand-sub {
  font-family: 'DM Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.3rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.login-footer {
  text-align: center;
  margin-top: 1.5rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

/* Company select page */
.companies-page { max-width: 960px; margin: 3rem auto; padding: 0 2rem; }

.page-header { margin-bottom: 2rem; }
.page-header h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
.page-header p  { color: var(--text-muted); margin-top: 0.3rem; font-size: 0.9rem; }
