// onboarding.js — live activation checklist for the current company
// (system admin). Auto-verifies everything the database can answer;
// manual steps persist as client_params rows (onboarding_* keys).
// Canonical reference: checklist_activacion_cliente.md.

const Onboarding = (() => {

  const esc = (s) => escapeHtml(String(s ?? ''));

  const MANUAL_ITEMS = [
    { key: 'fase0_info',       fase: 'Fase 0', label: 'Información del cliente completa', detail: 'Nombre, slug, PMS, nº habitaciones REAL confirmado, módulos, ficheros de muestra' },
    { key: 'pbi_params',       fase: 'Fase 5', label: 'Power BI: parámetros configurados', detail: 'client_slug + property_id en Manage parameters; sin restos hardcodeados de otro cliente' },
    { key: 'pbi_refresh',      fase: 'Fase 5', label: 'Power BI: refresco completo en verde', detail: 'Native queries aprobadas · carga paralela OFF (pooler 15 conexiones)' },
    { key: 'pbi_totals',       fase: 'Fase 5', label: 'Power BI: totales verificados contra el ETL', detail: 'Nº reservas · producción al céntimo · nights · extras vs informes de verificación' },
    { key: 'user_login',       fase: 'Fase 4', label: 'Login end-to-end del usuario del cliente', detail: 'Dashboard carga con rol y company correctos' },
    { key: 'publication',      fase: 'Fase 5', label: 'Publicación del informe decidida/hecha', detail: 'Publish to web SOLO demo; datos reales → Embedded' },
  ];

  function row(status, fase, label, detail, extraHtml = '') {
    const icon = status === true ? '<span class="ob-ic ob-ok">✓</span>'
               : status === false ? '<span class="ob-ic ob-ko">✗</span>'
               : '<span class="ob-ic ob-na">—</span>';
    return `<div class="ob-row">
      ${icon}
      <div class="ob-main"><span class="ob-fase">${esc(fase)}</span><strong>${esc(label)}</strong>
        <div class="ob-detail">${detail}</div></div>
      ${extraHtml}
    </div>`;
  }

  async function safeCount(q) {
    try { const { count, error } = await q; return error ? null : (count ?? 0); }
    catch (e) { return null; }
  }

  async function load() {
    const root = document.getElementById('onboarding-root');
    if (currentProfile.role !== 'system_admin') {
      root.innerHTML = '<div class="empty-state">Access restricted to system admin.</div>';
      return;
    }
    root.innerHTML = '<div style="color:var(--text-muted);padding:1rem">Checking activation state against live data…</div>';

    const cid = currentCompany.id;
    const slug = (currentCompany.slug || '').toLowerCase();
    const pms = (currentCompany.pms || '').toLowerCase();
    const catalog = (PipelineAdmin.CATALOG || {})[pms];

    const [propsRes, jobsRes, paramsRes] = await Promise.all([
      sb.from('properties').select('property_id, property_name, total_rooms, active').eq('company_id', cid),
      sb.from('pipeline_jobs').select('entity, is_active, source_system, reads_from_entity').eq('client', slug).eq('source_type', 'file'),
      Params.getAll(cid),
    ]);
    const props = propsRes.data || [];
    const jobs = jobsRes.data || [];
    // Params.getAll already returns a {param_key: param_value} map in .data
    const params = paramsRes.data || {};

    // masters counts in parallel
    const [nSubtypes, nChannels, nRoomCats, nRooms, nCountries, nExtCats, nExtCatalog, nAvail, availMax, nAdmins] = await Promise.all([
      safeCount(sb.from('channel_subtypes').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'active')),
      safeCount(sb.from('channels').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'active')),
      safeCount(sb.from('room_categories').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'active')),
      safeCount(sb.from('rooms').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'active')),
      safeCount(sb.from('client_country_mapping').select('id', { count: 'exact', head: true }).eq('company_id', cid).not('country_code', 'is', null).eq('status', 'active')),
      safeCount(sb.from('extras_categories').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'active')),
      safeCount(sb.from('extras_catalog').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'active')),
      safeCount(sb.from('availability_calendar').select('id', { count: 'exact', head: true }).eq('company_id', cid)),
      (async () => { try {
        const { data } = await sb.from('availability_calendar').select('date').eq('company_id', cid).order('date', { ascending: false }).limit(1);
        return data?.[0]?.date || null; } catch (e) { return null; } })(),
      safeCount(sb.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('role', 'company_admin').eq('active', true)),
    ]);

    // storage: raw + gold per property
    const directEntities = catalog ? catalog.entities.filter(e => !e.reads_from).map(e => e.entity) : [];
    const goldExpected = catalog ? catalog.entities.map(e => e.gold.split(' (')[0]) : [];
    const storage = { raw: {}, gold: {} };
    for (const pr of props) {
      for (const ent of directEntities) {
        try {
          const { data } = await sb.storage.from('raw').list(`${slug}/${pms}/${pr.property_id}/${ent}/file`, { limit: 5 });
          storage.raw[`${pr.property_id}/${ent}`] = (data || []).filter(f => f.name && !f.name.startsWith('.')).length;
        } catch (e) { storage.raw[`${pr.property_id}/${ent}`] = null; }
      }
      try {
        const { data } = await sb.storage.from('gold').list(`${slug}/${pr.property_id}`, { limit: 20 });
        storage.gold[pr.property_id] = (data || []).map(f => f.name);
      } catch (e) { storage.gold[pr.property_id] = null; }
    }

    // ── build rows ──
    const rows = [];

    rows.push(row(!!pms && !!catalog, 'Fase 1', 'PMS asignado y soportado',
      pms ? `PMS: <code>${esc(pms)}</code>${catalog ? '' : ' — ⚠ sin catálogo de ETLs'}` : 'Sin PMS en la company (Settings → PMS)'));

    rows.push(row(props.length > 0 && props.every(p => (p.total_rooms || 0) > 0), 'Fase 1', 'Properties con habitaciones',
      props.length ? props.map(p => `${esc(p.property_id)}: ${p.total_rooms || 0} rooms`).join(' · ') : 'Sin properties'));

    let jobsOk = null, jobsDetail = 'PMS sin catálogo — no verificable';
    if (catalog) {
      const missing = [];
      for (const pr of props) for (const e of catalog.entities) {
        const j = jobs.find(x => x.entity === e.entity);
        if (!j || !j.is_active) missing.push(`${pr.property_id}/${e.entity}`);
      }
      const drift = jobs.filter(j => (j.source_system || '').toLowerCase() !== pms).length;
      jobsOk = props.length > 0 && missing.length === 0 && drift === 0;
      jobsDetail = missing.length ? `Faltan/inactivos: ${esc(missing.join(', '))} → página Pipeline`
                 : drift ? `${drift} job(s) con PMS mismatch → página Pipeline`
                 : `${jobs.filter(j => j.is_active).length} jobs activos, catálogo completo`;
    }
    rows.push(row(jobsOk, 'Fase 1', 'Pipeline jobs completos y activos', jobsDetail));

    const rawMissing = Object.entries(storage.raw).filter(([, n]) => !n).map(([k]) => k);
    rows.push(row(Object.keys(storage.raw).length > 0 && rawMissing.length === 0, 'Fase 2', 'Raw subido (entidades de subida directa)',
      Object.keys(storage.raw).length
        ? (rawMissing.length ? `Sin ficheros: ${esc(rawMissing.join(', '))}` : Object.entries(storage.raw).map(([k, n]) => `${esc(k)}: ${n} fichero(s)`).join(' · '))
        : 'Nada que verificar aún'));

    const goldMissing = [];
    for (const pr of props) {
      const have = storage.gold[pr.property_id] || [];
      for (const g of goldExpected) if (!have.includes(g)) goldMissing.push(`${pr.property_id}/${g}`);
    }
    rows.push(row(props.length > 0 && goldExpected.length > 0 && goldMissing.length === 0, 'Fase 2', 'Gold generado (todas las entidades)',
      goldMissing.length ? `Faltan: ${esc(goldMissing.join(', '))} → Run ETL` : goldExpected.map(esc).join(' · ')));

    const hasExtras = catalog ? catalog.entities.some(e => e.entity === 'extras') : false;
    const mastersChecks = [
      ['Channel types & subtypes', nSubtypes], ['Channels', nChannels],
      ['Room categories', nRoomCats], ['Rooms', nRooms], ['Country mapping (resueltos)', nCountries],
      ...(hasExtras ? [['Extras categories', nExtCats], ['Extras catalog', nExtCatalog]] : []),
    ];
    const mastersBad = mastersChecks.filter(([, n]) => !n);
    rows.push(row(mastersBad.length === 0, 'Fase 3', 'Masters poblados',
      mastersChecks.map(([l, n]) => `${esc(l)}: <strong>${n ?? '?'}</strong>`).join(' · ')
      + '<div style="margin-top:2px;color:var(--text-muted)">Vacíos legítimos (no verificados aquí): booking purposes · segments · otas según PMS</div>'));

    rows.push(row((nAvail || 0) > 0, 'Fase 3', 'Availability calendar (denominador de ocupación)',
      nAvail ? `${nAvail} filas · última fecha: ${esc(availMax || '?')}` : '⛔ VACÍO — la ocupación del informe saldrá en blanco. Sección Availability.'));

    rows.push(row(!!params['occupancy_mode'], 'Fase 3', 'Occupancy mode configurado',
      params['occupancy_mode'] ? `<code>${esc(params['occupancy_mode'])}</code>` : 'Settings → Occupancy Mode'));

    rows.push(row(params['plan_active'] === 'true' && params['plan_status'] === 'approved', 'Fase 3', 'Plan activo y aprobado',
      `plan_rooms: ${esc(params['plan_rooms'] || '—')} · active: ${esc(params['plan_active'] || '—')} · status: ${esc(params['plan_status'] || '—')}`));

    rows.push(row((nAdmins || 0) > 0, 'Fase 4', 'Usuario company_admin creado',
      nAdmins ? `${nAdmins} admin(s) activos` : 'Add user con rol company_admin'));

    // manual items with persisted toggles
    const manualRows = MANUAL_ITEMS.map(m => {
      const done = params[`onboarding_${m.key}`] === 'done';
      return row(done ? true : false, m.fase, m.label, esc(m.detail),
        `<button class="btn ${done ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="obToggle('${m.key}', ${done})">${done ? 'Desmarcar' : 'Marcar hecho'}</button>`);
    });

    const autoDone = rows.filter(r => r.includes('ob-ok')).length;
    const manualDone = manualRows.filter(r => r.includes('ob-ok')).length;

    root.innerHTML = `
      <style>
        .ob-row { display:flex; gap:0.8rem; align-items:flex-start; padding:0.65rem 0; border-bottom:1px solid var(--border,#edf1f7); }
        .ob-ic { width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:700; flex-shrink:0; margin-top:2px; }
        .ob-ok { background:#d1fae5; color:#065f46; } .ob-ko { background:#fef3c7; color:#92400e; } .ob-na { background:#f1f5f9; color:#64748b; }
        .ob-main { flex:1; } .ob-fase { display:inline-block; font-size:0.68rem; font-weight:600; color:var(--brand,#3D65A8); background:var(--brand-light,#eef3fb); border-radius:999px; padding:0.08rem 0.5rem; margin-right:0.5rem; }
        .ob-detail { font-size:0.8rem; color:var(--text-muted); margin-top:2px; }
        .ob-head { display:flex; justify-content:space-between; align-items:center; padding:0 0 0.5rem; }
      </style>
      <div class="table-wrap"><div class="table-header"><h3>Comprobaciones automáticas (datos en vivo)</h3>
        <span class="du-count-badge">${autoDone}/${rows.length}</span></div>
        <div class="pl-body">${rows.join('')}</div></div>
      <div class="table-wrap" style="margin-top:1.25rem"><div class="table-header"><h3>Pasos manuales</h3>
        <span class="du-count-badge">${manualDone}/${manualRows.length}</span></div>
        <div class="pl-body">${manualRows.join('')}
          <p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.75rem">Referencia completa del proceso: <code>checklist_activacion_cliente.md</code>. El estado manual se guarda por company.</p>
        </div></div>`;
  }

  async function toggle(key, currentlyDone) {
    await Params.set(currentCompany.id, `onboarding_${key}`, currentlyDone ? '' : 'done');
    load();
  }

  return { load, toggle };
})();

function initOnboarding() { Onboarding.load(); }
function obToggle(key, done) { Onboarding.toggle(key, done); }
