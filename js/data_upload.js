// data_upload.js — upload client source files to the Supabase `raw` bucket.
// Path convention:
//   client={client_code}/source={source}/property={pcode}/entity={entity}/via=file/{filename}
// Overwrite-by-period: the stored filename keeps the original name, so re-uploading
// the same period's file overwrites it (upsert=true).

const DataUpload = (() => {

  const RAW_BUCKET = 'raw';

  function currentClientCode() {
    // Companies already have a unique `slug` (e.g. 'tch') — use it for storage paths.
    return currentCompany.slug
        || (currentCompany.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function buildPath(source, pcode, entity, filename) {
    const client = currentClientCode();
    return `client=${client}/source=${source}/property=${pcode}/entity=${entity}/via=file/${filename}`;
  }

  async function loadProperties() {
    const sel = document.getElementById('du-property');
    const { data, error } = await sb.from('properties')
      .select('property_id, property_name')
      .eq('company_id', currentCompany.id)
      .order('property_id');
    if (error || !data?.length) {
      sel.innerHTML = '<option value="">No properties found</option>';
      return;
    }
    sel.innerHTML = data.map(p =>
      `<option value="${p.property_id}">${p.property_id}${p.property_name ? ' — ' + p.property_name : ''}</option>`
    ).join('');
    listFiles();
  }

  async function listFiles() {
    const source   = document.getElementById('du-source').value;
    const pcode    = document.getElementById('du-property').value;
    const entity   = document.getElementById('du-entity').value;
    const tbody    = document.getElementById('du-files-tbody');
    if (!pcode) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted)">Select a property…</td></tr>'; return; }

    const client = currentClientCode();
    const prefix = `client=${client}/source=${source}/property=${pcode}/entity=${entity}/via=file`;
    const { data, error } = await sb.storage.from(RAW_BUCKET).list(prefix, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
    if (error) { tbody.innerHTML = `<tr><td colspan="5" style="color:#dc2626">${error.message}</td></tr>`; return; }
    if (!data?.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted)">No files yet for this selection.</td></tr>'; return; }

    tbody.innerHTML = data.filter(f => f.name && f.id !== null).map(f => {
      const when = f.updated_at ? new Date(f.updated_at).toLocaleString() : '—';
      return `<tr>
        <td>${pcode}</td>
        <td>${entity}</td>
        <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(f.name)}</td>
        <td>${when}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="duDeleteFile('${escapeAttr(prefix + '/' + f.name)}')">Delete</button></td>
      </tr>`;
    }).join('');
  }

  // Entities whose filenames must contain a parseable date-range period.
  // Pattern: ..._YYYY-MM-DD_to_YYYY-MM-DD.xlsx
  const PERIOD_RE = /_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.(xlsx|xls|csv)$/i;
  const PERIOD_REQUIRED = ['reservations', 'nights', 'extras'];

  function validateFilename(entity, filename) {
    if (!PERIOD_REQUIRED.includes(entity)) return { ok: true };
    const m = filename.match(PERIOD_RE);
    if (!m) {
      return { ok: false, message:
        `Filename must include a date range like "..._2026-01-01_to_2026-01-31.xlsx". ` +
        `Got "${filename}". Rename the file and try again.` };
    }
    // sanity: start <= end
    if (m[1] > m[2]) {
      return { ok: false, message: `Start date ${m[1]} is after end date ${m[2]} in the filename.` };
    }
    return { ok: true, start: m[1], end: m[2] };
  }

  async function upload() {
    const source = document.getElementById('du-source').value;
    const pcode  = document.getElementById('du-property').value;
    const entity = document.getElementById('du-entity').value;
    const fileEl = document.getElementById('du-file');
    const file   = fileEl.files[0];

    UI.hideAlert('du-error'); UI.hideAlert('du-success');
    if (!pcode)  { UI.showAlert('du-error', 'Select a property first.'); return; }
    if (!file)   { UI.showAlert('du-error', 'Choose a file to upload.'); return; }

    const check = validateFilename(entity, file.name);
    if (!check.ok) { UI.showAlert('du-error', check.message); return; }

    const path = buildPath(source, pcode, entity, file.name);
    UI.setLoading('du-upload-btn', true, 'Upload to raw bucket');

    const { error } = await sb.storage.from(RAW_BUCKET).upload(path, file, {
      upsert: true,               // overwrite-by-period: same filename replaces
      contentType: file.type || 'application/octet-stream',
    });

    UI.setLoading('du-upload-btn', false, 'Upload to raw bucket');
    if (error) { UI.showAlert('du-error', error.message); return; }

    const periodMsg = check.start ? ` (period ${check.start} → ${check.end})` : '';
    UI.showAlert('du-success', `Uploaded "${file.name}"${periodMsg}`, 'success');
    fileEl.value = '';
    listFiles();
  }

  async function deleteFile(fullPath) {
    if (!confirm('Delete this file from the raw bucket?')) return;
    const { error } = await sb.storage.from(RAW_BUCKET).remove([fullPath]);
    if (error) { UI.showAlert('du-error', error.message); return; }
    listFiles();
  }

  function init() {
    loadProperties();
    document.getElementById('du-source').onchange   = listFiles;
    document.getElementById('du-property').onchange = listFiles;
    document.getElementById('du-entity').onchange   = listFiles;
    document.getElementById('du-upload-btn').onclick = upload;
  }

  return { init, listFiles, deleteFile };
})();

function duDeleteFile(path) { DataUpload.deleteFile(path); }
