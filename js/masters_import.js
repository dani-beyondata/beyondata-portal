// masters_import.js — import the masters Excel back and apply inserts/updates.
// Matches rows by their natural key (usually raw_value). Rows present in the DB
// but missing from the Excel are optionally deactivated (never hard-deleted).

const MastersImport = (() => {


  // ── Helpers for the two-level extras category master ────────────────
  const catKey = (parent, name) =>
    `${String(parent || '').trim().toLowerCase()}|${String(name || '').trim().toLowerCase()}`;

  // Accepts 10, "10", "10%" or 0.10 and returns the stored fraction, or null
  // when it is missing or outside the Spanish VAT rates.
  function parseVat(raw) {
    if (raw === '' || raw === null || raw === undefined) return null;
    let v = parseFloat(String(raw).replace('%', '').replace(',', '.').trim());
    if (isNaN(v)) return null;
    if (v > 1) v = v / 100;
    v = Math.round(v * 100) / 100;
    return [0, 0.04, 0.10, 0.21].some(a => Math.abs(a - v) < 1e-9) ? v : null;
  }

  // Shared by both extras sheets. declaredRoots / declaredSubs hold the names
  // the workbook itself is about to create, so the Extras sheet can reference a
  // category that only exists in the Extras Categories sheet of the same file.
  async function buildCategoryContext(companyId, workbook) {
    const { data, error } = await sb.from('extras_categories')
      .select('id, category_name, parent_id').eq('company_id', companyId);
    if (error) throw new Error('extras_categories: ' + error.message);

    const rows        = data || [];
    const nameById    = new Map(rows.map(c => [c.id, c.category_name]));
    const rootIdByName = new Map();
    const subIdByPath  = new Map();
    rows.forEach(c => {
      if (!c.parent_id) rootIdByName.set(String(c.category_name).toLowerCase(), c.id);
    });
    rows.forEach(c => {
      if (c.parent_id) subIdByPath.set(catKey(nameById.get(c.parent_id) || '', c.category_name), c.id);
    });

    const declaredRoots = new Set();
    const declaredSubs  = new Set();
    const sheet = workbook && workbook.Sheets['Extras Categories'];
    if (sheet) {
      XLSX.utils.sheet_to_json(sheet, { defval: '' }).forEach(r => {
        const name   = String(r['Category name'] || '').trim();
        const parent = String(r['Parent category'] || '').trim();
        if (!name) return;
        if (parent) declaredSubs.add(catKey(parent, name));
        else        declaredRoots.add(name.toLowerCase());
      });
    }
    return { rows, nameById, rootIdByName, subIdByPath, declaredRoots, declaredSubs };
  }

  // Sheet definitions: how Excel columns map back to DB fields.
  // key: columns identifying the row; fields: updatable columns.
  const SHEETS = {
    'Channels': {
      table: 'channels',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name:    (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        channel_type:    (r['Type'] || '').trim() || 'indirect',
        channel_subtype: (r['Subtype'] || '').trim() || 'ota',
        rate_type:       ((r['Rate type'] || 'gross').trim().toLowerCase() === 'net') ? 'net' : 'gross',
        avg_cost_pct:    parseFloat(String(r['Avg commission %'] || '0').replace('%','')) / 100 || 0,
        status:          (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Channel Types': {
      table: 'channel_subtypes',
      key: r => `${(r['Type']||'').trim()}|${(r['Subtype']||'').trim()}`,
      keyColumn: null, // composite — handled specially
      composite: ['type_name', 'subtype_name'],
      fromRow: r => ({ type_name: (r['Type']||'').trim(), subtype_name: (r['Subtype']||'').trim() }),
      toFields: r => ({
        status: (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'OTAs': {
      table: 'otas',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Segments': {
      table: 'segments',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Booking Purposes': {
      table: 'booking_purposes',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Room Categories': {
      table: 'room_categories',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Rooms': {
      table: 'rooms',
      key: r => `${(r['Property']||'').trim()}|${(r['Room code']||'').trim()}`,
      keyColumn: null,
      composite: ['property_id', 'raw_value'],
      fromRow: r => ({ property_id: (r['Property']||'').trim(), raw_value: (r['Room code']||'').trim() }),
      toFields: r => ({
        display_name:  (r['Room name'] || '').trim() || (r['Room code'] || '').trim(),
        beds_per_room: parseInt(r['Beds']) || 1,
        status:        (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
      // category by name resolved at apply time
      categoryColumn: 'Category',
      noInsert: true, // rooms need property_uuid — only update existing
    },
    // Two levels: a row with 'Parent category' filled is a subcategory. The key
    // has to carry the parent, because a subcategory may share its name with a
    // category (CD has PARKING under PARKING).
    'Extras Categories': {
      table: 'extras_categories',
      buildContext: buildCategoryContext,
      key: r => catKey((r['Parent category'] || '').trim(), (r['Category name'] || '').trim()),
      rowIsValid: r => !!(r['Category name'] || '').trim(),
      existingKey: (e, ctx) => catKey(e.parent_id ? (ctx.nameById.get(e.parent_id) || '') : '', e.category_name || ''),
      insertBase: (r, ctx) => {
        const parentName = (r['Parent category'] || '').trim();
        return {
          category_name: (r['Category name'] || '').trim(),
          parent_id: parentName ? (ctx.rootIdByName.get(parentName.toLowerCase()) || null) : null,
        };
      },
      validateRow: (r, ctx) => {
        const parentName = (r['Parent category'] || '').trim();
        if (!parentName) return null;
        if (!ctx.rootIdByName.has(parentName.toLowerCase()) &&
            !ctx.declaredRoots.has(parentName.toLowerCase())) {
          return `parent category "${parentName}" does not exist`;
        }
        return null;
      },
      toFields: r => ({
        status: (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    // Category and subcategory travel by name and are resolved to ids. Unknown
    // names are rejected, never created: that is what the Extras Categories
    // sheet is for, and it is processed before this one.
    'Extras': {
      table: 'extras_catalog',
      buildContext: buildCategoryContext,
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      validateRow: (r, ctx) => {
        const cat = (r['Category'] || '').trim();
        const sub = (r['Subcategory'] || '').trim();
        if (!cat) return 'category is required';
        const known = ctx.rootIdByName.has(cat.toLowerCase()) || ctx.declaredRoots.has(cat.toLowerCase());
        if (!known) return `category "${cat}" is not in the Extras Categories master`;
        if (sub) {
          const knownSub = ctx.subIdByPath.has(catKey(cat, sub)) || ctx.declaredSubs.has(catKey(cat, sub));
          if (!knownSub) return `subcategory "${sub}" does not exist under "${cat}"`;
        }
        const vat = parseVat(r['VAT %']);
        if (vat === null) return 'VAT % is required (0, 4, 10 or 21)';
        return null;
      },
      // Resolved against a freshly read catalog at apply time, so categories
      // created by the previous sheet are already visible.
      resolveRefs: (r, ctx) => {
        const cat = (r['Category'] || '').trim();
        const sub = (r['Subcategory'] || '').trim();
        const categoryId = ctx.rootIdByName.get(cat.toLowerCase());
        if (!categoryId) return { error: `category "${cat}" not found` };
        const out = { category_id: categoryId, subcategory_id: null };
        if (sub) {
          const subId = ctx.subIdByPath.get(catKey(cat, sub));
          if (!subId) return { error: `subcategory "${sub}" not found under "${cat}"` };
          out.subcategory_id = subId;
        }
        return { fields: out };
      },
      toFields: r => ({
        display_name:     (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        unit_price_gross: r['Unit price (gross)'] === '' || r['Unit price (gross)'] == null
                            ? null : parseFloat(String(r['Unit price (gross)']).replace(',', '.')),
        vat_rate:         parseVat(r['VAT %']),
        revenue_timing:   ['at_arrival','per_night','at_checkout']
                            .includes(String(r['Revenue timing'] || '').trim())
                              ? String(r['Revenue timing']).trim() : 'at_arrival',
        is_passthrough:   ['yes','y','true','1','si','sí']
                            .includes(String(r['Pass-through'] || '').trim().toLowerCase()),
        status:           (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Country Mapping': {
      table: 'client_country_mapping',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        country_code: (r['ISO country'] || '').trim().toUpperCase() || null,
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    // 'Market Groups' intentionally not importable (countries list is managed in the Markets tab)
  };

  function shallowDiff(existing, fields) {
    return Object.keys(fields).some(k => {
      const a = existing[k], b = fields[k];
      if (typeof b === 'number') return Math.abs((parseFloat(a) || 0) - b) > 1e-9;
      return String(a ?? '') !== String(b ?? '');
    });
  }

  // Parse workbook → plan of changes. Returns {sheets: [{name, inserts, updates, unchanged, skipped}]}
  async function buildPlan(workbook, companyId) {
    const plan = [];
    for (const [sheetName, cfg] of Object.entries(SHEETS)) {
      if (!workbook.SheetNames.includes(sheetName)) continue;
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      const isValid = cfg.rowIsValid || (r => !!cfg.key(r));
      const validRows = rows.filter(isValid);
      if (!validRows.length) continue;

      let ctx = null;
      if (cfg.buildContext) {
        try { ctx = await cfg.buildContext(companyId, workbook); }
        catch (e) { plan.push({ name: sheetName, error: e.message }); continue; }
      }

      const { data: existing, error } = await sb.from(cfg.table).select('*').eq('company_id', companyId);
      if (error) { plan.push({ name: sheetName, error: error.message }); continue; }

      const byKey = new Map();
      (existing || []).forEach(e => {
        const k = cfg.existingKey
          ? cfg.existingKey(e, ctx)
          : (cfg.composite
              ? cfg.composite.map(c => String(e[c] ?? '').trim()).join('|')
              : String(e[cfg.keyColumn] ?? '').trim());
        byKey.set(k.toLowerCase(), e);
      });

      const inserts = [], updates = [], skipped = [];
      let unchanged = 0;
      for (const r of validRows) {
        // A row that cannot be applied is reported by name instead of being
        // dropped quietly or blowing up the whole sheet.
        const reason = cfg.validateRow ? cfg.validateRow(r, ctx) : null;
        if (reason) { skipped.push({ key: cfg.key(r), reason }); continue; }

        const k = cfg.key(r).toLowerCase();
        const match = byKey.get(k);
        const fields = cfg.toFields(r);
        if (!match) {
          if (cfg.noInsert) continue;
          inserts.push({ row: r, fields });
        } else if (shallowDiff(match, fields)) {
          updates.push({ id: match.id, row: r, fields, existing: match });
        } else {
          unchanged++;
        }
      }
      plan.push({ name: sheetName, cfg, inserts, updates, unchanged, skipped });
    }
    return plan;
  }

  async function applyPlan(plan, companyId) {
    const results = [];
    for (const sheet of plan) {
      if (sheet.error || (!sheet.inserts?.length && !sheet.updates?.length)) continue;
      const cfg = sheet.cfg;
      let ok = 0, failed = 0, firstError = null;
      const rowErrors = [];

      // Rebuilt here, not reused from the plan: the sheet processed just before
      // this one may have created the categories this one references.
      let ctx = null;
      if (cfg.buildContext) {
        try { ctx = await cfg.buildContext(companyId, null); }
        catch (e) { results.push({ name: sheet.name, ok: 0, failed: 1, firstError: e.message }); continue; }
      }

      // Resolve room categories by name once, if needed
      let catByName = null;
      if (cfg.categoryColumn) {
        const { data: cats } = await sb.from('room_categories')
          .select('id, raw_value, display_name').eq('company_id', companyId);
        catByName = new Map();
        (cats || []).forEach(c => {
          if (c.display_name) catByName.set(c.display_name.toLowerCase(), c.id);
          if (c.raw_value)    catByName.set(c.raw_value.toLowerCase(), c.id);
        });
      }

      for (const u of sheet.updates) {
        const fields = { ...u.fields, updated_at: new Date().toISOString() };
        if (catByName) {
          const catName = String(u.row[cfg.categoryColumn] || '').trim().toLowerCase();
          if (catName && catByName.has(catName)) fields.category_id = catByName.get(catName);
        }
        if (cfg.resolveRefs) {
          const res = cfg.resolveRefs(u.row, ctx);
          if (res.error) { failed++; rowErrors.push(`${cfg.key(u.row)}: ${res.error}`); continue; }
          Object.assign(fields, res.fields);
        }
        const { error } = await sb.from(cfg.table).update(fields).eq('id', u.id);
        if (error) { failed++; firstError = firstError || error.message; } else ok++;
      }

      // Parents before children, so a subcategory can reference a category
      // created in this same run.
      const ordered = cfg.insertBase
        ? [...sheet.inserts].sort((a, b) =>
            (String(a.row['Parent category'] || '') ? 1 : 0) - (String(b.row['Parent category'] || '') ? 1 : 0))
        : sheet.inserts;

      for (const i of ordered) {
        if (cfg.insertBase && cfg.buildContext) ctx = await cfg.buildContext(companyId, null);
        const base = cfg.insertBase
          ? cfg.insertBase(i.row, ctx)
          : (cfg.composite ? cfg.fromRow(i.row) : { [cfg.keyColumn]: cfg.key(i.row) });
        const extra = {};
        if (cfg.resolveRefs) {
          const res = cfg.resolveRefs(i.row, ctx);
          if (res.error) { failed++; rowErrors.push(`${cfg.key(i.row)}: ${res.error}`); continue; }
          Object.assign(extra, res.fields);
        }
        const { error } = await sb.from(cfg.table).insert({ company_id: companyId, ...base, ...i.fields, ...extra });
        if (error) { failed++; firstError = firstError || error.message; } else ok++;
      }
      results.push({ name: sheet.name, ok, failed, firstError: firstError || rowErrors[0] || null, rowErrors });
    }
    return results;
  }

  return { buildPlan, applyPlan };
})();
