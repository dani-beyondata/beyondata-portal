// data_upload.js — upload client source files to the Supabase `raw` bucket.
// Path (plain segments, no '=' which Supabase download rejects):
//   {client}/{source}/{property}/{entity}/file/{filename}
//
// The source segment is NOT user-selectable: it comes from the company's PMS
// (companies.pms), so files always land where the pipeline expects them.
// Entities offered for upload/Run ETL come from the client's active
// pipeline_jobs (with a static fallback if the table can't be read).

const DataUpload = (() => {

  const RAW_BUCKET = 'raw';
  const PERIOD_RE = /_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.(xlsx|xls|csv)$/i;
  const NAME_RE = /^([A-Za-z]+_\d{3})_([a-z]+)_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.(xlsx|xls|csv)$/i;

  let existingNames = new Set();
  let jobs = [];              // active file jobs for this client (from pipeline_jobs)
  let jobsLoaded = false;
  let pendingRenames = [];    // files awaiting the rename assistant

  // Local helpers (escapeHtml is global; escapeAttr is not defined in dashboard)
  const escAttr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function currentClientCode() {
    const code = currentCompany.slug
        || (currentCompany.name || 'client').replace(/[^a-zA-Z0-9]+/g, '');
    return code.toLowerCase();
  }

  function currentPms() {
    return (currentCompany.pms || 'mews').toLowerCase();
  }

  function pmsLabel() {
    const labels = { mews: 'Mews', littlehotelier: 'Little Hotelier' };
    return labels[currentPms()] || currentPms();
  }

  function sel() {
    return {
      source: currentPms(),
      pcode:  document.getElementById('du-property').value,
      entity: document.getElementById('du-entity').value,
    };
  }

  function prefix() {
    const { source, pcode, entity } = sel();
    return `${currentClientCode()}/${source}/${pcode}/${entity}/file`;
  }

  function buildPath(filename) { return `${prefix()}/${filename}`; }

  function fmtSize(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function periodOf(filename) {
    const m = filename.match(PERIOD_RE);
    return m ? `${m[1]} → ${m[2]}` : '—';
  }

  function updatePathHint() {
    document.getElementById('du-path-hint').textContent = `${RAW_BUCKET}/${prefix()}/`;
    const srcEl = document.getElementById('du-source-display');
    if (srcEl) srcEl.textContent = pmsLabel();
  }

  // ── pipeline_jobs: which entities exist for this client ────────────────
  async function loadJobs() {
    jobs = []; jobsLoaded = false;
    try {
      const { data, error } = await sb.from('pipeline_jobs')
        .select('entity, reads_from_entity, source_system, is_active, source_type')
        .eq('client', currentClientCode())
        .eq('source_type', 'file')
        .eq('is_active', true);
      if (!error && data && data.length) { jobs = data; jobsLoaded = true; }
    } catch (e) { /* fall through to fallback */ }

    if (!jobsLoaded) {
      // Fallback: static catalog per PMS (kept in sync with the runner's ETL_MAP)
      const catalog = {
        mews: [
          { entity: 'reservations', reads_from_entity: null },
          { entity: 'nights',       reads_from_entity: 'reservations' },
          { entity: 'extras',       reads_from_entity: 'reservations' },
        ],
        littlehotelier: [
          { entity: 'reservations', reads_from_entity: null },
          { entity: 'nights',       reads_from_entity: 'reservations' },
        ],
      };
      jobs = catalog[currentPms()] || catalog.mews;
    }

    renderEntityOptions();
    renderRunEntities();
  }

  // Upload targets = entities whose files are uploaded directly (no reads_from).
  // Entities with reads_from consume another entity's raw files, so offering
  // them as upload destinations would create dead uploads the runner ignores.
  function uploadEntities() {
    const direct = jobs.filter(j => !j.reads_from_entity).map(j => j.entity);
    return [...new Set(direct)];
  }

  function allEntities() {
    return [...new Set(jobs.map(j => j.entity))];
  }

  function renderEntityOptions() {
    const el = document.getElementById('du-entity');
    const prev = el.value;
    const ents = uploadEntities();
    el.innerHTML = ents.map(e =>
      `<option value="${escAttr(e)}">${escapeHtml(e.charAt(0).toUpperCase() + e.slice(1))}</option>`
    ).join('');
    if (ents.includes(prev)) el.value = prev;
  }

  function renderRunEntities() {
    const wrap = document.getElementById('du-run-entities');
    if (!wrap) return;
    const ents = allEntities();
    wrap.innerHTML = ents.map(e => `
      <label class="du-run-entity">
        <input type="checkbox" value="${escAttr(e)}" checked>
        <span>${escapeHtml(e)}</span>
      </label>`).join('');
  }

  function selectedRunEntities() {
    const wrap = document.getElementById('du-run-entities');
    if (!wrap) return allEntities();
    return Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
  }

  // ── properties / listings ──────────────────────────────────────────────
  async function loadProperties() {
    const selEl = document.getElementById('du-property');
    const { data, error } = await sb.from('properties')
      .select('property_id, property_name')
      .eq('company_id', currentCompany.id)
      .order('property_id');
    if (error || !data?.length) {
      selEl.innerHTML = '<option value="">No properties found</option>';
      return;
    }
    selEl.innerHTML = data.map(p =>
      `<option value="${p.property_id}">${p.property_id}${p.property_name ? ' — ' + p.property_name : ''}</option>`
    ).join('');
    updatePathHint();
    listFiles(); listGold();
  }

  async function listFiles() {
    updatePathHint();
    const { pcode } = sel();
    const tbody = document.getElementById('du-files-tbody');
    const countEl = document.getElementById('du-browser-count');
    existingNames = new Set();
    if (!pcode) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted)">Select a property…</td></tr>';
      countEl.textContent = '';
      return;
    }
    const { data, error } = await sb.storage.from(RAW_BUCKET)
      .list(prefix(), { limit: 200, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:#dc2626">${escapeHtml(error.message)}</td></tr>`;
      countEl.textContent = '';
      return;
    }
    const files = (data || []).filter(f =>
      f.name && !f.name.startsWith('.') && /\.(xlsx|xls|csv)$/i.test(f.name)
    );
    files.forEach(f => existingNames.add(f.name.toLowerCase()));
    countEl.textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'empty';

    if (!files.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted)">No files yet for this selection.</td></tr>';
      return;
    }
    tbody.innerHTML = files.map(f => {
      const size = fmtSize(f.metadata?.size);
      const when = f.updated_at ? new Date(f.updated_at).toLocaleString() : '—';
      const full = `${prefix()}/${f.name}`;
      return `<tr>
        <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(f.name)}</td>
        <td style="font-size:0.8rem">${periodOf(f.name)}</td>
        <td>${size}</td>
        <td style="font-size:0.8rem">${when}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="duDeleteFile('${escAttr(full)}')">Delete</button></td>
      </tr>`;
    }).join('');
  }

  // ── filename validation + rename assistant ─────────────────────────────
  function validateFilename(entity, filename) {
    const { pcode } = sel();
    const m = filename.match(NAME_RE);
    if (!m) return { ok: false };
    if (m[1].toUpperCase() !== String(pcode).toUpperCase()) return { ok: false };
    if (m[2].toLowerCase() !== String(entity).toLowerCase()) return { ok: false };
    if (m[3] > m[4]) return { ok: false, message: `Start ${m[3]} is after end ${m[4]}.` };
    return { ok: true, start: m[3], end: m[4] };
  }

  function extOf(filename) {
    const m = filename.match(/\.(xlsx|xls|csv)$/i);
    return m ? m[1].toLowerCase() : null;
  }

  function generatedName(idx) {
    const item = pendingRenames[idx];
    const { pcode, entity } = sel();
    const start = document.getElementById(`du-rn-start-${idx}`)?.value || '';
    const end = document.getElementById(`du-rn-end-${idx}`)?.value || '';
    if (!start || !end) return null;
    return `${pcode}_${entity}_${start}_to_${end}.${item.ext}`;
  }

  function refreshRenamePreview(idx) {
    const prevEl = document.getElementById(`du-rn-preview-${idx}`);
    const btn = document.getElementById(`du-rn-btn-${idx}`);
    const name = generatedName(idx);
    const start = document.getElementById(`du-rn-start-${idx}`)?.value || '';
    const end = document.getElementById(`du-rn-end-${idx}`)?.value || '';
    if (!name) {
      prevEl.textContent = 'Pick the date range the file covers…';
      prevEl.style.color = 'var(--text-muted)';
      btn.disabled = true;
      return;
    }
    if (start > end) {
      prevEl.textContent = `Start ${start} is after end ${end}.`;
      prevEl.style.color = '#dc2626';
      btn.disabled = true;
      return;
    }
    prevEl.textContent = name;
    prevEl.style.color = '';
    btn.disabled = false;
  }

  function renderRenamePanel() {
    const panel = document.getElementById('du-rename-panel');
    if (!pendingRenames.length) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="du-rename-head">
        <strong>Rename assistant</strong>
        <span class="du-run-hint">These files don't follow the required naming. Pick the date range each file covers and we'll rename them on upload — the original file on your computer is untouched.</span>
      </div>` +
      pendingRenames.map((item, idx) => item.done ? '' : `
      <div class="du-rename-row" id="du-rn-row-${idx}">
        <div class="du-rn-file"><span class="du-stg-name">${escapeHtml(item.file.name)}</span>
          <span style="color:var(--text-muted);font-size:0.78rem">${fmtSize(item.file.size)}</span></div>
        <div class="du-rn-dates">
          <label>From <input type="date" id="du-rn-start-${idx}" onchange="duRenamePreview(${idx})"></label>
          <label>To <input type="date" id="du-rn-end-${idx}" onchange="duRenamePreview(${idx})"></label>
        </div>
        <div class="du-rn-out">
          <code id="du-rn-preview-${idx}" style="color:var(--text-muted)">Pick the date range the file covers…</code>
          <button class="btn btn-primary btn-sm" id="du-rn-btn-${idx}" disabled onclick="duRenameUpload(${idx})">Upload renamed</button>
        </div>
      </div>`).join('');
  }

  async function renameUpload(idx) {
    const item = pendingRenames[idx];
    const name = generatedName(idx);
    if (!item || !name) return;
    const btn = document.getElementById(`du-rn-btn-${idx}`);
    btn.disabled = true; btn.textContent = 'Uploading…';
    const { error } = await sb.storage.from(RAW_BUCKET).upload(buildPath(name), item.file, {
      upsert: true,
      contentType: item.file.type || 'application/octet-stream',
    });
    if (error) {
      btn.disabled = false; btn.textContent = 'Upload renamed';
      UI.showAlert('du-error', `${name}: ${error.message}`);
      return;
    }
    item.done = true;
    const row = document.getElementById(`du-rn-row-${idx}`);
    if (row) row.innerHTML = `<div class="du-rn-file"><span class="du-stg-name">${escapeHtml(item.file.name)}</span>
      <span class="du-stg-status" style="color:#16a34a">✓ uploaded as <code>${escapeHtml(name)}</code></span></div>`;
    UI.showAlert('du-success', 'Upload complete.', 'success');
    listFiles();
    if (pendingRenames.every(p => p.done)) {
      setTimeout(() => { pendingRenames = []; renderRenamePanel(); }, 4000);
    }
  }

  // ── staging + upload ───────────────────────────────────────────────────
  async function stageAndUpload(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const { pcode, entity } = sel();
    UI.hideAlert('du-error'); UI.hideAlert('du-success');
    if (!pcode) { UI.showAlert('du-error', 'Select a property first.'); return; }

    const staged = document.getElementById('du-staged');
    staged.style.display = 'flex';
    staged.innerHTML = '';
    pendingRenames = [];

    let anyUploaded = false;
    for (const file of files) {
      const ext = extOf(file.name);
      const check = ext ? validateFilename(entity, file.name) : { ok: false, message: 'Unsupported file type.' };

      if (!check.ok) {
        if (!ext) {
          const row = document.createElement('div');
          row.className = 'du-staged-item';
          row.innerHTML = `<span class="du-stg-name">${escapeHtml(file.name)}</span>
            <span class="du-stg-status" style="color:#dc2626">✗ Only .xlsx / .xls / .csv files are supported.</span>`;
          staged.appendChild(row);
        } else {
          // Send to the rename assistant instead of rejecting
          pendingRenames.push({ file, ext, done: false });
        }
        continue;
      }

      const exists = existingNames.has(file.name.toLowerCase());
      const row = document.createElement('div');
      row.className = 'du-staged-item';
      row.innerHTML = `<span class="du-stg-name">${escapeHtml(file.name)}</span>
        <span style="color:var(--text-muted);font-size:0.78rem">${fmtSize(file.size)}</span>
        <span class="du-stg-status" style="color:${exists ? '#d97706' : '#16a34a'}">${exists ? '⚠ already exists — will overwrite' : '✓ new'}</span>`;
      staged.appendChild(row);

      const path = buildPath(file.name);
      const { error } = await sb.storage.from(RAW_BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type || 'application/octet-stream',
      });
      const statusSpan = row.querySelector('.du-stg-status');
      if (error) {
        statusSpan.style.color = '#dc2626';
        statusSpan.textContent = `✗ ${error.message}`;
      } else {
        statusSpan.style.color = '#16a34a';
        statusSpan.textContent = exists ? '✓ overwritten' : '✓ uploaded';
        anyUploaded = true;
      }
    }

    if (!staged.children.length) staged.style.display = 'none';
    renderRenamePanel();

    if (anyUploaded) {
      UI.showAlert('du-success', 'Upload complete.', 'success');
      listFiles();
    }
  }

  async function deleteFile(fullPath) {
    const name = fullPath.split('/').pop();
    if (!confirm(`Permanently delete "${name}"?\n\nYou can re-upload it from your PMS export if needed.`)) return;
    const { error } = await sb.storage.from(RAW_BUCKET).remove([fullPath]);
    if (error) { UI.showAlert('du-error', error.message); return; }
    UI.showAlert('du-success', `Deleted "${name}".`, 'success');
    listFiles();
  }

  // ── gold outputs ───────────────────────────────────────────────────────
  const GOLD_BUCKET = 'gold';
  const GOLD_FILES = ['reservations_clean.csv', 'nights_clean.csv', 'extras_clean.csv', 'extras_master.csv'];

  async function listGold() {
    const { pcode } = sel();
    const tbody = document.getElementById('du-gold-tbody');
    const countEl = document.getElementById('du-gold-count');
    if (!pcode) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Select a property…</td></tr>';
      countEl.textContent = '';
      return;
    }
    const goldPrefix = `${currentClientCode()}/${pcode}`;
    const { data, error } = await sb.storage.from(GOLD_BUCKET)
      .list(goldPrefix, { limit: 100 });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="4" style="color:#dc2626">${escapeHtml(error.message)}</td></tr>`;
      countEl.textContent = '';
      return;
    }
    const files = (data || []).filter(f => f.name && GOLD_FILES.includes(f.name));
    countEl.textContent = files.length ? `${files.length} generated` : 'none yet';
    if (!files.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">No gold outputs yet. Upload raw files and click Run ETL.</td></tr>';
      return;
    }
    // order them consistently
    const ordered = GOLD_FILES.map(n => files.find(f => f.name === n)).filter(Boolean);
    tbody.innerHTML = ordered.map(f => {
      const size = fmtSize(f.metadata?.size);
      const when = f.updated_at ? new Date(f.updated_at).toLocaleString() : '—';
      return `<tr data-gold="${escAttr(f.name)}">
        <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(f.name)}</td>
        <td class="du-gold-rows" style="color:var(--text-muted)">counting…</td>
        <td>${size}</td>
        <td style="font-size:0.8rem">${when}</td>
      </tr>`;
    }).join('');

    // Count rows by downloading each gold CSV (small, cached by browser).
    for (const f of ordered) {
      const path = `${goldPrefix}/${f.name}`;
      try {
        const { data: blob, error: dlErr } = await sb.storage.from(GOLD_BUCKET).download(path);
        const cell = tbody.querySelector(`tr[data-gold="${f.name}"] .du-gold-rows`);
        if (dlErr || !blob) { if (cell) cell.textContent = '—'; continue; }
        const text = await blob.text();
        // rows = non-empty lines minus header
        const lines = text.split('\n').filter(l => l.trim().length).length;
        const rows = Math.max(0, lines - 1);
        if (cell) { cell.textContent = rows.toLocaleString(); cell.style.color = ''; }
      } catch (e) {
        const cell = tbody.querySelector(`tr[data-gold="${f.name}"] .du-gold-rows`);
        if (cell) cell.textContent = '—';
      }
    }
  }

  // ── Run ETL ────────────────────────────────────────────────────────────
  async function runETL() {
    const btn = document.getElementById('du-run-etl-btn');
    const statusEl = document.getElementById('du-run-status');
    const progress = document.getElementById('du-run-progress');
    const progTitle = document.getElementById('du-run-progress-title');
    const progDetail = document.getElementById('du-run-progress-detail');
    const client = currentClientCode();

    const expectedEntities = selectedRunEntities();
    if (!expectedEntities.length) {
      statusEl.style.display = 'block';
      statusEl.className = 'alert error';
      statusEl.textContent = 'Select at least one entity to process.';
      return;
    }

    btn.disabled = true;
    btn.textContent = '▶ Triggering…';
    statusEl.style.display = 'none';

    // Baseline: how many SUCCESS runs exist right now, so we can detect new ones.
    const sinceIso = new Date().toISOString();

    try {
      const FN_URL = 'https://lsqwjthckecvuwlxtgnk.supabase.co/functions/v1/trigger-etl';
      const resp = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ client, entities: expectedEntities }),
      });
      const data = await resp.json();
      if (!(resp.ok && data.ok)) {
        statusEl.style.display = 'block';
        statusEl.className = 'alert error';
        statusEl.textContent = `Could not start ETL: ${data.error || resp.status}${data.detail ? ' — ' + data.detail : ''}`;
        btn.disabled = false; btn.textContent = '▶ Run ETL';
        return;
      }

      // Triggered — begin polling pipeline_runs for completion.
      progress.style.display = 'flex';
      progTitle.textContent = 'Running ETL in the cloud…';
      progDetail.textContent = 'Starting up (this takes ~1–2 minutes). Watching for results…';
      btn.textContent = '▶ Running…';

      let elapsed = 0;
      const poll = setInterval(async () => {
        elapsed += 5;
        const { data: runs } = await sb.from('pipeline_runs')
          .select('entity, status, started_at, finished_at')
          .gte('started_at', sinceIso)
          .order('started_at', { ascending: false })
          .limit(20);

        const done = (runs || []).filter(r => r.status === 'SUCCESS').map(r => r.entity);
        const failed = (runs || []).filter(r => r.status === 'FAILED');
        const uniqDone = [...new Set(done)].filter(e => expectedEntities.includes(e));

        progDetail.textContent =
          `Completed: ${uniqDone.length ? uniqDone.join(', ') : '…'} ` +
          `(${uniqDone.length}/${expectedEntities.length}) · ${elapsed}s elapsed`;

        const allDone = expectedEntities.every(e => uniqDone.includes(e));
        if (allDone || elapsed >= 180) {
          clearInterval(poll);
          progress.style.display = 'none';
          statusEl.style.display = 'block';
          btn.disabled = false; btn.textContent = '▶ Run ETL';
          if (allDone) {
            statusEl.className = 'alert success';
            statusEl.textContent = `✓ ETL finished for "${client}" (${expectedEntities.join(', ')}). Gold outputs updated.`;
            listFiles(); listGold();
          } else if (failed.length) {
            statusEl.className = 'alert error';
            statusEl.textContent = `Some steps failed: ${failed.map(f => f.entity).join(', ')}. Check the pipeline logs.`;
            listGold();
          } else {
            statusEl.className = 'alert';
            statusEl.textContent = `Still running after ${elapsed}s. Check GitHub Actions or refresh shortly.`;
          }
        }
      }, 5000);

    } catch (e) {
      progress.style.display = 'none';
      statusEl.style.display = 'block';
      statusEl.className = 'alert error';
      statusEl.textContent = `Could not reach the pipeline function: ${e.message}`;
      btn.disabled = false; btn.textContent = '▶ Run ETL';
    }
  }

  function init() {
    loadJobs();
    loadProperties();
    const relist = () => {
      document.getElementById('du-staged').style.display='none';
      pendingRenames = []; renderRenamePanel();
      listFiles(); listGold();
    };
    document.getElementById('du-property').onchange = relist;
    document.getElementById('du-entity').onchange   = relist;

    const dz = document.getElementById('du-dropzone');
    const input = document.getElementById('du-file');
    dz.onclick = () => input.click();
    input.onchange = () => { if (input.files.length) stageAndUpload(input.files); input.value = ''; };
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files.length) stageAndUpload(e.dataTransfer.files);
    });

    document.getElementById('du-run-etl-btn').onclick = runETL;
  }

  return { init, listFiles, deleteFile, renameUpload, refreshRenamePreview };
})();

function duDeleteFile(path) { DataUpload.deleteFile(path); }
function duRenameUpload(idx) { DataUpload.renameUpload(idx); }
function duRenamePreview(idx) { DataUpload.refreshRenamePreview(idx); }
