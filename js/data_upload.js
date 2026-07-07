// data_upload.js — upload client source files to the Supabase `raw` bucket.
// Path (plain segments, no '=' which Supabase download rejects):
//   {client}/{source}/{property}/{entity}/file/{filename}

const DataUpload = (() => {

  const RAW_BUCKET = 'raw';
  const PERIOD_RE = /_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.(xlsx|xls|csv)$/i;
  const PERIOD_REQUIRED = ['reservations', 'nights', 'extras'];

  let existingNames = new Set();

  // Local helpers (escapeHtml is global; escapeAttr is not defined in dashboard)
  const escAttr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function currentClientCode() {
    const code = currentCompany.slug
        || (currentCompany.name || 'client').replace(/[^a-zA-Z0-9]+/g, '');
    return code.toLowerCase();
  }

  function sel() {
    return {
      source: document.getElementById('du-source').value,
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
  }

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

  function validateFilename(entity, filename) {
    if (!PERIOD_REQUIRED.includes(entity)) return { ok: true };
    const m = filename.match(PERIOD_RE);
    if (!m) return { ok: false, message:
      `Must include a date range like "..._2026-01-01_to_2026-01-31.xlsx".` };
    if (m[1] > m[2]) return { ok: false, message: `Start ${m[1]} is after end ${m[2]}.` };
    return { ok: true, start: m[1], end: m[2] };
  }

  async function stageAndUpload(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const { pcode, entity } = sel();
    UI.hideAlert('du-error'); UI.hideAlert('du-success');
    if (!pcode) { UI.showAlert('du-error', 'Select a property first.'); return; }

    const staged = document.getElementById('du-staged');
    staged.style.display = 'flex';
    staged.innerHTML = '';

    let anyUploaded = false;
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'du-staged-item';
      const check = validateFilename(entity, file.name);
      const exists = existingNames.has(file.name.toLowerCase());

      let statusHtml, canUpload = true;
      if (!check.ok) {
        statusHtml = `<span class="du-stg-status" style="color:#dc2626">✗ ${escapeHtml(check.message)}</span>`;
        canUpload = false;
      } else if (exists) {
        statusHtml = `<span class="du-stg-status" style="color:#d97706">⚠ already exists — will overwrite</span>`;
      } else {
        statusHtml = `<span class="du-stg-status" style="color:#16a34a">✓ new</span>`;
      }
      row.innerHTML = `<span class="du-stg-name">${escapeHtml(file.name)}</span>
        <span style="color:var(--text-muted);font-size:0.78rem">${fmtSize(file.size)}</span>
        ${statusHtml}`;
      staged.appendChild(row);

      if (!canUpload) continue;

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

    if (anyUploaded) {
      UI.showAlert('du-success', 'Upload complete.', 'success');
      listFiles();
    }
  }

  async function deleteFile(fullPath) {
    const name = fullPath.split('/').pop();
    if (!confirm(`Permanently delete "${name}"?\n\nYou can re-upload it from Mews if needed.`)) return;
    const { error } = await sb.storage.from(RAW_BUCKET).remove([fullPath]);
    if (error) { UI.showAlert('du-error', error.message); return; }
    UI.showAlert('du-success', `Deleted "${name}".`, 'success');
    listFiles();
  }

  const GOLD_BUCKET = 'gold';
  const GOLD_FILES = ['reservations_clean.csv', 'nights_clean.csv', 'extras_master.csv'];

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

  async function runETL() {
    const btn = document.getElementById('du-run-etl-btn');
    const statusEl = document.getElementById('du-run-status');
    const progress = document.getElementById('du-run-progress');
    const progTitle = document.getElementById('du-run-progress-title');
    const progDetail = document.getElementById('du-run-progress-detail');
    const client = currentClientCode();

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
        body: JSON.stringify({ client }),
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

      const expectedEntities = ['reservations', 'nights', 'extras'];
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
        const uniqDone = [...new Set(done)];

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
            statusEl.textContent = `✓ ETL finished for "${client}". Gold outputs updated.`;
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
    loadProperties();
    const relist = () => { document.getElementById('du-staged').style.display='none'; listFiles(); listGold(); };
    document.getElementById('du-source').onchange   = relist;
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

  return { init, listFiles, deleteFile };
})();

function duDeleteFile(path) { DataUpload.deleteFile(path); }
