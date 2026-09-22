// reports.js — Reports section: raw data downloads + analytical reports.
// Reuses what already exists: signed URLs for gold CSVs, the export-controlling
// edge function, and MastersExport for the masters workbook.
const Reports = (() => {
  let sb, currentCompany, currentProfile;

  // gold files the client is allowed to pull, mapped to their bucket names
  const GOLD_FILES = {
    'gold-reservations': 'reservations_clean.csv',
    'gold-nights':       'nights_clean.csv',
    'gold-extras':       'extras_enriched.csv',
  };

  function clientCode() {
    const code = currentCompany.slug || (currentCompany.name || 'client').replace(/[^a-zA-Z0-9]+/g, '');
    return code.toLowerCase();
  }

  function err(msg) {
    const el = document.getElementById('reports-error');
    if (!el) return;
    el.style.display = 'block'; el.textContent = msg;
    setTimeout(() => { el.style.display = 'none'; }, 6000);
  }

  async function downloadGold(name) {
    const path = `${clientCode()}/${name}`;
    const { data, error } = await sb.storage.from('gold').createSignedUrl(path, 60, { download: name });
    if (error || !data?.signedUrl) { err(`No se pudo generar el enlace: ${error?.message || 'sin URL'}`); return; }
    window.location.href = data.signedUrl;
  }

  async function downloadControlling() {
    const session = await Auth.getSession();
    if (!session) { err('Sesión caducada. Vuelve a iniciar sesión.'); return; }
    const propSel = document.getElementById('reports-property');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/export-controlling`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ company_id: currentCompany?.id, property: propSel ? (propSel.value || null) : null }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const fname = (cd.match(/filename="([^"]+)"/) || [])[1] || 'BeyonData_Controlling.xlsx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  async function handle(report, btn) {
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳';
    try {
      if (GOLD_FILES[report]) await downloadGold(GOLD_FILES[report]);
      else if (report === 'masters') await MastersExport.exportAll(currentCompany.id, currentCompany.name);
      else if (report === 'controlling') await downloadControlling();
    } catch (e) {
      err('No se pudo generar el informe: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  }

  async function loadProperties() {
    const sel = document.getElementById('reports-property');
    if (!sel) return;
    const { data } = await sb.from('properties').select('property_name').eq('company_id', currentCompany.id).order('property_name');
    sel.innerHTML = '<option value="">Todas (grupo)</option>' +
      (data || []).map(p => `<option value="${p.property_name}">${p.property_name}</option>`).join('');
  }

  function init(deps) {
    currentCompany = deps.currentCompany; currentProfile = deps.currentProfile;
    loadProperties();
    document.querySelectorAll('.rep-btn:not([disabled])').forEach(btn => {
      const report = btn.dataset.report;
      if (!report) return;
      btn.addEventListener('click', () => handle(report, btn));
    });
  }

  return { init };
})();
