// onboarding.js — live activation checklist for the current company
// (system admin), organized by execution phase. Auto-verifies what the
// database can answer; manual steps persist as client_params rows
// (onboarding_* keys). Every step links to the portal section where it
// gets done. Canonical reference: checklist_activacion_cliente.md.

const Onboarding = (() => {

  const esc = (s) => escapeHtml(String(s ?? ''));

  const FASES = [
    { id: 'f0', title: 'Fase 0 — Información del cliente' },
    { id: 'f1', title: 'Fase 1 — Alta base' },
    { id: 'f2', title: 'Fase 2 — Datos al pipeline' },
    { id: 'f3', title: 'Fase 3 — Masters y configuración' },
    { id: 'f4', title: 'Fase 4 — Usuarios' },
    { id: 'f5', title: 'Fase 5 — Power BI' },
  ];

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

    // ── unified item list, in execution order ──
    // status: true (done) | false (pending) | null (not verifiable)
    // manualKey: persisted toggle · goto: portal section
    const items = [];
    const manual = (key) => params[`onboarding_${key}`] === 'done';

    items.push({ fase: 'f0', manualKey: 'fase0_info', status: manual('fase0_info'),
      label: 'Información del cliente completa',
      detail: 'Nombre, slug, PMS, nº habitaciones REAL confirmado con el cliente, módulos, ficheros de muestra' });

    items.push({ fase: 'f1', goto: 'settings', status: !!pms && !!catalog,
      label: 'PMS asignado y soportado',
      detail: pms ? `PMS: <code>${esc(pms)}</code>${catalog ? '' : ' — ⚠ sin catálogo de ETLs'}` : 'Sin PMS en la company' });

    items.push({ fase: 'f1', goto: 'properties', status: props.length > 0 && props.every(p => (p.total_rooms || 0) > 0),
      label: 'Properties con habitaciones',
      detail: props.length ? props.map(p => `${esc(p.property_id)}: ${p.total_rooms || 0} rooms`).join(' · ') : 'Sin properties' });

    let jobsOk = null, jobsDetail = 'PMS sin catálogo — no verificable';
    if (catalog) {
      const missing = [];
      for (const pr of props) for (const e of catalog.entities) {
        const j = jobs.find(x => x.entity === e.entity);
        if (!j || !j.is_active) missing.push(`${pr.property_id}/${e.entity}`);
      }
      const drift = jobs.filter(j => (j.source_system || '').toLowerCase() !== pms).length;
      jobsOk = props.length > 0 && missing.length === 0 && drift === 0;
      jobsDetail = missing.length ? `Faltan/inactivos: ${esc(missing.join(', '))}`
                 : drift ? `${drift} job(s) con PMS mismatch`
                 : `${jobs.filter(j => j.is_active).length} jobs activos, catálogo completo`;
    }
    items.push({ fase: 'f1', goto: 'pipeline', status: jobsOk,
      label: 'Pipeline jobs completos y activos', detail: jobsDetail });

    const rawMissing = Object.entries(storage.raw).filter(([, n]) => !n).map(([k]) => k);
    items.push({ fase: 'f2', goto: 'data_upload',
      status: Object.keys(storage.raw).length > 0 && rawMissing.length === 0,
      label: 'Raw subido (entidades de subida directa)',
      detail: Object.keys(storage.raw).length
        ? (rawMissing.length ? `Sin ficheros: ${esc(rawMissing.join(', '))}` : Object.entries(storage.raw).map(([k, n]) => `${esc(k)}: ${n} fichero(s)`).join(' · '))
        : 'Nada que verificar aún' });

    const goldMissing = [];
    for (const pr of props) {
      const have = storage.gold[pr.property_id] || [];
      for (const g of goldExpected) if (!have.includes(g)) goldMissing.push(`${pr.property_id}/${g}`);
    }
    items.push({ fase: 'f2', goto: 'data_upload',
      status: props.length > 0 && goldExpected.length > 0 && goldMissing.length === 0,
      label: 'Gold generado (Run ETL de todas las entidades)',
      detail: goldMissing.length ? `Faltan: ${esc(goldMissing.join(', '))}` : goldExpected.map(esc).join(' · ') });

    const hasExtras = catalog ? catalog.entities.some(e => e.entity === 'extras') : false;
    const mastersChecks = [
      ['Channel types & subtypes', nSubtypes], ['Channels', nChannels],
      ['Room categories', nRoomCats], ['Rooms', nRooms], ['Country mapping (resueltos)', nCountries],
      ...(hasExtras ? [['Extras categories', nExtCats], ['Extras catalog', nExtCatalog]] : []),
    ];
    items.push({ fase: 'f3', goto: 'masters_setup',
      status: mastersChecks.every(([, n]) => (n || 0) > 0),
      label: 'Masters poblados',
      detail: mastersChecks.map(([l, n]) => `${esc(l)}: <strong>${n ?? '?'}</strong>`).join(' · ')
        + '<div style="margin-top:2px;color:var(--text-muted)">Vacíos legítimos según PMS (no verificados aquí): booking purposes · segments · otas</div>' });

    items.push({ fase: 'f3', goto: 'availability', status: (nAvail || 0) > 0,
      label: 'Availability calendar (denominador de ocupación)',
      detail: nAvail ? `${nAvail} filas · última fecha: ${esc(availMax || '?')}` : '⛔ VACÍO — la ocupación del informe saldrá en blanco' });

    items.push({ fase: 'f3', goto: 'settings', status: !!params['occupancy_mode'],
      label: 'Occupancy mode configurado',
      detail: params['occupancy_mode'] ? `<code>${esc(params['occupancy_mode'])}</code>` : 'Pendiente en Settings' });

    items.push({ fase: 'f3', goto: 'my_plan',
      status: params['plan_active'] === 'true' && params['plan_status'] === 'approved',
      label: 'Plan activo y aprobado',
      detail: `plan_rooms: ${esc(params['plan_rooms'] || '—')} · active: ${esc(params['plan_active'] || '—')} · status: ${esc(params['plan_status'] || '—')}` });

    items.push({ fase: 'f4', goto: 'users', status: (nAdmins || 0) > 0,
      label: 'Usuario admin del cliente creado',
      detail: nAdmins ? `${nAdmins} admin(s) activos` : 'Add user con rol "Admin" (= company_admin: gestiona SOLO su company, no es system admin)' });

    items.push({ fase: 'f4', goto: 'users', manualKey: 'user_login', status: manual('user_login'),
      label: 'Login end-to-end del usuario del cliente',
      detail: 'Entrar con el usuario nuevo: dashboard con rol y company correctos' });

    items.push({ fase: 'f5', goto: 'company', manualKey: 'pbi_params', status: manual('pbi_params'),
      label: 'Power BI: parámetros configurados',
      detail: 'client_slug + property_id en Manage parameters (valores en Company → Power BI connection); sin restos de otro cliente' });

    items.push({ fase: 'f5', manualKey: 'pbi_refresh', status: manual('pbi_refresh'),
      label: 'Power BI: refresco completo en verde',
      detail: 'Native queries aprobadas · carga paralela OFF (pooler 15 conexiones)' });

    items.push({ fase: 'f5', goto: 'data_upload', manualKey: 'pbi_totals', status: manual('pbi_totals'),
      label: 'Power BI: totales verificados contra el ETL',
      detail: 'Nº reservas · producción al céntimo · nights · extras vs informes de verificación / Gold outputs' });

    items.push({ fase: 'f5', manualKey: 'publication', status: manual('publication'),
      label: 'Publicación del informe decidida/hecha',
      detail: 'Publish to web SOLO demo; datos reales → Embedded' });

    // ── render grouped by fase ──
    const done = items.filter(i => i.status === true).length;
    const groups = FASES.map(f => {
      const its = items.filter(i => i.fase === f.id);
      if (!its.length) return '';
      const fDone = its.filter(i => i.status === true).length;
      const rows = its.map(i => {
        const icon = i.status === true ? '<span class="ob-ic ob-ok">✓</span>'
                   : i.status === false ? '<span class="ob-ic ob-ko">✗</span>'
                   : '<span class="ob-ic ob-na">—</span>';
        const gotoBtn = i.goto ? `<button class="btn btn-secondary btn-sm" onclick="obGo('${i.goto}')">Ir →</button>` : '';
        const manualBtn = i.manualKey
          ? `<button class="btn ${i.status ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="obToggle('${i.manualKey}', ${!!i.status})">${i.status ? 'Desmarcar' : 'Marcar hecho'}</button>`
          : '';
        return `<div class="ob-row">${icon}
          <div class="ob-main"><strong>${esc(i.label)}</strong>${i.manualKey ? ' <span class="ob-manual">manual</span>' : ''}
            <div class="ob-detail">${i.detail}</div></div>
          <div class="ob-actions">${gotoBtn}${manualBtn}</div>
        </div>`;
      }).join('');
      return `<div class="table-wrap" style="margin-bottom:1.1rem">
        <div class="table-header"><h3>${esc(f.title)}</h3><span class="du-count-badge">${fDone}/${its.length}</span></div>
        <div class="ob-body">${rows}</div>
      </div>`;
    }).join('');

    root.innerHTML = `
      <style>
        .ob-body { padding: 0.6rem 1.5rem 0.9rem; }
        .ob-row { display:flex; gap:0.9rem; align-items:flex-start; padding:0.75rem 0; border-bottom:1px solid var(--border,#edf1f7); }
        .ob-row:last-child { border-bottom:none; }
        .ob-ic { width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:700; flex-shrink:0; margin-top:2px; }
        .ob-ok { background:#d1fae5; color:#065f46; } .ob-ko { background:#fef3c7; color:#92400e; } .ob-na { background:#f1f5f9; color:#64748b; }
        .ob-main { flex:1; }
        .ob-manual { font-size:0.66rem; font-weight:600; color:#7c3aed; background:#f3e8ff; border-radius:999px; padding:0.08rem 0.45rem; vertical-align:middle; }
        .ob-detail { font-size:0.8rem; color:var(--text-muted); margin-top:2px; }
        .ob-actions { display:flex; gap:0.4rem; flex-shrink:0; margin-top:2px; }
      </style>
      <div style="display:flex;justify-content:flex-end;margin-bottom:0.75rem">
        <span class="du-count-badge" style="font-size:0.85rem">Total: ${done}/${items.length}</span>
      </div>
      ${groups}`;
  }

  async function toggle(key, currentlyDone) {
    await Params.set(currentCompany.id, `onboarding_${key}`, currentlyDone ? '' : 'done');
    load();
  }

  return { load, toggle };
})();

function initOnboarding() { Onboarding.load(); }
function obToggle(key, done) { Onboarding.toggle(key, done); }
function obGo(section) { navTo(section); }
