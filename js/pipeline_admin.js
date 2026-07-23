// pipeline_admin.js — system-admin view of the data pipeline configuration.
//
// One screen answering: which ETLs exist per PMS (the code catalog), which
// jobs each company has configured in pipeline_jobs, what's missing, and
// what's drifted (job PMS != company PMS). Lets the system admin toggle
// jobs and create the missing ones from the catalog — no SQL needed.
//
// The catalog below MUST stay in sync with the runner's ETL_MAP
// (beyondata-pipeline/runner/run_file_etl.py). It is intentionally
// hardcoded: it describes what the CODE supports, which only changes
// when new ETLs are shipped.

const PipelineAdmin = (() => {

  const CATALOG = {
    mews: {
      label: 'Mews',
      entities: [
        { entity: 'reservations', etl: 'mews_reservations_etl',  gold: 'reservations_clean.csv', reads_from: null,           pattern: '*_reservations_*.xlsx' },
        { entity: 'nights',       etl: 'mews_nights_etl',        gold: 'nights_clean.csv',       reads_from: 'reservations', pattern: '*_reservations_*.xlsx' },
        { entity: 'extras',       etl: 'mews_extras_master_etl', gold: 'extras_master.csv',      reads_from: 'reservations', pattern: '*_reservations_*.xlsx' },
      ],
    },
    littlehotelier: {
      label: 'Little Hotelier',
      entities: [
        { entity: 'reservations', etl: 'littlehotelier_reservations_etl', gold: 'reservations_clean.csv', reads_from: null,           pattern: '*_reservations_*.csv' },
        { entity: 'nights',       etl: 'littlehotelier_nights_etl',       gold: 'nights_clean.csv',       reads_from: 'reservations', pattern: '*_reservations_*.csv' },
        { entity: 'extras',       etl: 'littlehotelier_extras_etl',       gold: 'extras_clean.csv (+ extras_master.csv)', reads_from: null, pattern: '*_extras_*.csv' },
      ],
    },
  };

  const esc = (s) => escapeHtml(String(s ?? ''));

  let companiesCache = [];
  let propertiesCache = [];
  let jobsCache = [];

  async function load() {
    const root = document.getElementById('pipeline-root');
    if (currentProfile.role !== 'system_admin') {
      root.innerHTML = '<div class="empty-state">Access restricted to system admin.</div>';
      return;
    }
    root.innerHTML = '<div style="color:var(--text-muted);padding:1rem">Loading pipeline configuration…</div>';

    const [cRes, pRes, jRes] = await Promise.all([
      sb.from('companies').select('id, name, slug, pms, active').order('name'),
      sb.from('properties').select('property_id, property_name, company_id, active'),
      sb.from('pipeline_jobs').select('*').order('client').order('pcode').order('entity'),
    ]);
    if (cRes.error || pRes.error || jRes.error) {
      root.innerHTML = `<div class="alert error" style="display:block">Could not load: ${esc((cRes.error||pRes.error||jRes.error).message)}<br>
        <span style="font-size:0.8rem">If this mentions permissions, the pipeline_jobs write/read policies may be missing.</span></div>`;
      return;
    }
    companiesCache = cRes.data || [];
    propertiesCache = pRes.data || [];
    jobsCache = jRes.data || [];

    root.innerHTML = scopedStyles() + renderCatalog() + renderCompanies();
  }

  function scopedStyles() {
    return `<style>
      .pl-body { padding: 1rem 1.25rem 1.25rem; }
      .pl-body .pl-hint { margin: 0 0 0.9rem; }
      .pl-table { border: 1px solid var(--border,#e4e9f2); border-radius: 8px; overflow: hidden; margin-top: 0.35rem; }
      .pl-company > .pl-body, details.pl-company > .pl-body { padding: 0; }
    </style>`;
  }

  // ── Card 1: what the pipeline code supports ────────────────────────────
  function renderCatalog() {
    const blocks = Object.entries(CATALOG).map(([pms, def]) => `
      <div class="pl-catalog-pms" style="min-width:0;margin-bottom:1.1rem">
        <div class="pl-pms-badge">${esc(def.label)}</div>
        <div class="pl-table"><table>
          <thead><tr><th>Entity</th><th>ETL script</th><th>Gold output</th><th>Reads raw from</th></tr></thead>
          <tbody>
            ${def.entities.map(e => `
              <tr>
                <td>${esc(e.entity)}</td>
                <td style="font-family:monospace;font-size:0.78rem">${esc(e.etl)}.py</td>
                <td style="font-family:monospace;font-size:0.78rem">${esc(e.gold)}</td>
                <td>${e.reads_from ? `<span class="pl-reads">↳ ${esc(e.reads_from)} files</span>` : '<span class="pl-direct">direct upload</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`).join('');
    return `
      <div class="table-wrap" style="margin-bottom:1.25rem">
        <div class="table-header"><h3>ETL catalog (what the code supports)</h3>
          <span class="du-count-badge">${Object.keys(CATALOG).length} PMS</span></div>
        <div class="pl-body">
          <p class="pl-hint">This mirrors the runner's ETL_MAP in <code>beyondata-pipeline</code>. Adding a new entity or PMS means shipping a new ETL script first — then it can be configured for companies below.</p>
          <div class="pl-catalog" style="display:block">${blocks}</div>
        </div>
      </div>`;
  }

  // ── Card 2: per-company job configuration ──────────────────────────────
  function renderCompanies() {
    const fileJobs = jobsCache.filter(j => j.source_type === 'file');
    const apiJobs = jobsCache.filter(j => j.source_type !== 'file');

    const currentId = (typeof currentCompany !== 'undefined' && currentCompany) ? currentCompany.id : null;
    const ordered = [...companiesCache].sort((a, b) =>
      (a.id === currentId ? -1 : 0) - (b.id === currentId ? -1 : 0));

    const cards = ordered.map(c => {
      const pms = (c.pms || '').toLowerCase();
      const def = CATALOG[pms];
      const slug = (c.slug || '').toLowerCase();
      const props = propertiesCache.filter(p => p.company_id === c.id);

      if (!def) {
        return `<div class="pl-company">
          <div class="pl-company-head"><strong>${esc(c.name)}</strong>
            <span class="pl-pms-badge pl-warn">PMS "${esc(c.pms)}" has no ETL catalog</span></div>
        </div>`;
      }

      const propBlocks = props.length ? props.map(p => {
        const jobs = fileJobs.filter(j => (j.client || '').toLowerCase() === slug && j.pcode === p.property_id);
        const rows = def.entities.map(e => {
          const job = jobs.find(j => j.entity === e.entity);
          if (!job) {
            return `<tr class="pl-missing">
              <td>${esc(e.entity)}</td>
              <td colspan="3" style="color:var(--text-muted)">not configured — Run ETL won't offer it</td>
              <td><span class="pl-badge pl-off">missing</span></td>
              <td><button class="btn btn-primary btn-sm"
                onclick="plCreateJob('${esc(slug)}','${esc(p.property_id)}','${esc(pms)}','${esc(e.entity)}')">Create job</button></td>
            </tr>`;
          }
          const drift = (job.source_system || '').toLowerCase() !== pms;
          const goldInfo = e.gold ? `<div style="color:var(--text-muted);font-size:0.7rem;margin-top:2px">→ ${esc(e.gold)}</div>` : '';
          return `<tr>
            <td>${esc(job.entity)}</td>
            <td style="font-family:monospace;font-size:0.78rem">${esc(job.etl_name || '—')}${goldInfo}</td>
            <td style="font-family:monospace;font-size:0.78rem">${esc(job.file_pattern || '—')}</td>
            <td>${job.reads_from_entity ? `<span class="pl-reads">↳ ${esc(job.reads_from_entity)}</span>` : '<span class="pl-direct">direct</span>'}
              ${drift ? `<span class="pl-badge pl-warn" title="Job source_system is '${esc(job.source_system)}' but the company PMS is '${esc(pms)}' — the runner will use the wrong ETL">PMS mismatch</span>` : ''}</td>
            <td><span class="pl-badge ${job.is_active ? 'pl-on' : 'pl-off'}">${job.is_active ? 'active' : 'inactive'}</span></td>
            <td><button class="btn btn-secondary btn-sm"
              onclick="plToggleJob(${Number(job.job_id)}, ${job.is_active ? 'false' : 'true'})">${job.is_active ? 'Deactivate' : 'Activate'}</button></td>
          </tr>`;
        }).join('');

        const extraJobs = jobs.filter(j => !def.entities.some(e => e.entity === j.entity));
        const extraRows = extraJobs.map(j => `
          <tr>
            <td>${esc(j.entity)}</td>
            <td colspan="3"><span class="pl-badge pl-warn">entity not in the ${esc(def.label)} catalog — the runner will skip it</span></td>
            <td><span class="pl-badge ${j.is_active ? 'pl-on' : 'pl-off'}">${j.is_active ? 'active' : 'inactive'}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="plToggleJob(${Number(j.job_id)}, ${j.is_active ? 'false' : 'true'})">${j.is_active ? 'Deactivate' : 'Activate'}</button></td>
          </tr>`).join('');

        return `<div class="pl-property">
          <div class="pl-property-head">${esc(p.property_id)}${p.property_name ? ' — ' + esc(p.property_name) : ''}</div>
          <div class="pl-table"><table>
            <thead><tr><th>Entity</th><th>ETL</th><th>File pattern</th><th>Reads from</th><th>Status</th><th></th></tr></thead>
            <tbody>${rows}${extraRows}</tbody>
          </table></div>
        </div>`;
      }).join('') : '<p class="pl-hint">No properties yet — create one in Properties first; jobs hang from a property.</p>';

      const myJobs = fileJobs.filter(j => (j.client || '').toLowerCase() === slug);
      const nActive = myJobs.filter(j => j.is_active).length;
      const expected = props.length * def.entities.length;
      const nMissing = Math.max(0, expected - myJobs.length);
      const nDrift = myJobs.filter(j => (j.source_system || '').toLowerCase() !== pms).length;
      const isCurrent = c.id === currentId;

      const headInner = `
          <strong>${esc(c.name)}</strong>
          <code style="font-size:0.75rem">${esc(slug)}</code>
          <span class="pl-pms-badge">${esc(def.label)}</span>
          ${isCurrent ? '<span class="pl-badge pl-on">current company</span>' : ''}
          ${c.active === false ? '<span class="pl-badge pl-off">company inactive</span>' : ''}
          <span class="pl-summary">${nActive} active job${nActive === 1 ? '' : 's'}${nMissing ? ` · <span style="color:#92400e">${nMissing} missing</span>` : ''}${nDrift ? ` · <span style="color:#dc2626">${nDrift} PMS mismatch</span>` : ''}</span>`;

      if (isCurrent) {
        return `<div class="pl-company" style="border-color:var(--brand,#3D65A8)">
          <div class="pl-company-head">${headInner}</div>
          ${propBlocks}
        </div>`;
      }
      return `<details class="pl-company">
        <summary class="pl-company-head" style="cursor:pointer;list-style:none">${headInner}
          <span style="margin-left:auto;color:var(--text-muted);font-size:0.75rem">click to expand</span></summary>
        ${propBlocks}
      </details>`;
    }).join('');

    const apiNote = apiJobs.length ? `<p class="pl-hint" style="margin-top:0.75rem">ℹ ${apiJobs.length} API-type job(s) exist in pipeline_jobs (e.g. legacy tests). They are not managed here — the file runner ignores them.</p>` : '';

    return `
      <div class="table-wrap">
        <div class="table-header"><h3>Companies &amp; configured jobs</h3>
          <span class="du-count-badge">${companiesCache.length} companies</span></div>
        <div class="pl-body">
          <p class="pl-hint">Each row is a pipeline job: "for this company + property + entity, process uploaded files with this ETL". The Run ETL selector in Data Upload offers exactly the <em>active</em> entities listed here.</p>
          ${cards}
          ${apiNote}
        </div>
      </div>`;
  }

  // ── Actions ────────────────────────────────────────────────────────────
  async function toggleJob(jobId, newActive) {
    const { error } = await sb.from('pipeline_jobs')
      .update({ is_active: newActive })
      .eq('job_id', jobId);
    if (error) { alert('Could not update job: ' + error.message); return; }
    load();
  }

  async function createJob(slug, pcode, pms, entity) {
    const def = CATALOG[pms];
    const e = def?.entities.find(x => x.entity === entity);
    if (!e) { alert('Entity not in catalog.'); return; }
    if (!confirm(`Create the "${entity}" job for ${slug} / ${pcode} (${def.label})?`)) return;
    const { error } = await sb.from('pipeline_jobs').insert({
      is_active: true,
      source_type: 'file',
      trigger_type: 'UPLOAD',
      source_system: pms,
      client: slug,
      pcode: pcode,
      entity: e.entity,
      file_pattern: e.pattern,
      etl_name: e.etl,
      reads_from_entity: e.reads_from,
    });
    if (error) { alert('Could not create job: ' + error.message); return; }
    load();
  }

  return { load, toggleJob, createJob };
})();

function plToggleJob(jobId, newActive) { PipelineAdmin.toggleJob(jobId, newActive); }
function plCreateJob(slug, pcode, pms, entity) { PipelineAdmin.createJob(slug, pcode, pms, entity); }
