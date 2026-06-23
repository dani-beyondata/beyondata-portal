// masters_setup.js — upload a reservations export, find values missing
// from this company's master catalogs, add them with one click.
//
// BASIC VERSION SCOPE (intentional, to be extended later):
//   - CSV only (the gold ETL output is already CSV, no Excel parsing needed)
//   - one master only: booking_purposes
//   - the uploaded file is parsed in-browser and never sent anywhere except
//     the eventual Supabase insert for values you explicitly approve --
//     nothing is stored, no upload endpoint, the file is forgotten on
//     navigating away or re-uploading
//   - column to read is chosen by you from a dropdown, with a best-guess
//     preselection based on column name matching

const MastersSetup = (() => {

  // Maps a master table's key (as used in the <select>) to a best-guess
  // column name to preselect when that master is chosen. This is just a
  // convenience guess, not a contract -- the user can always pick a
  // different column.
  const COLUMN_GUESS = {
    booking_purposes: ['booking_purpose_id', 'booking_purpose', 'purpose'],
    segments: ['segment_id', 'segment'],
    client_country_mapping: ['client_country', 'country', 'nationality'],
    room_categories: ['room_category_raw', 'space_category', 'category', 'room_category'],
    rooms: ['room_code_raw', 'room_code', 'room_number'],
    extras_catalog: ['raw_value', 'product', 'extra', 'product_name'],
  };

  // Maps a master table's key to the matching logic needed to compare
  // distinct file values against existing master rows for this company.
  // Matching always happens against raw_value -- the literal text the
  // source file contains -- never against display_name, since display_name
  // is the cleaned-up label we choose to show in reports and may not match
  // the file's wording at all.
  //
  // actionType controls how "Add to master" is presented:
  //   'text'           -- free-text display name input (booking_purposes, segments)
  //   'country_select' -- a dropdown of real ISO countries (client_country_mapping),
  //                        since the target value must be a valid FK, not arbitrary text
  const MASTER_CONFIG = {
    booking_purposes: {
      table: 'booking_purposes',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('booking_purposes')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await BookingPurposes.create(companyId, {
          raw_value: rawValue,
          display_name: displayName,
        });
        if (error) throw error;
      },
    },
    segments: {
      table: 'segments',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('segments')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await Segments.create(companyId, {
          raw_value: rawValue,
          display_name: displayName,
        });
        if (error) throw error;
      },
    },
    client_country_mapping: {
      table: 'client_country_mapping',
      matchColumn: 'raw_value',
      actionType: 'country_select',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('client_country_mapping')
          .select('id, raw_value, country_code, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      // displayValue here is the chosen country_code, not free text
      async addValue(companyId, rawValue, countryCode) {
        const { error } = await ClientCountryMapping.create(companyId, {
          raw_value: rawValue,
          country_code: countryCode,
        });
        if (error) throw error;
      },
    },
    // room_categories: matches against space_category from the nights gold file.
    // NOTE: this uses the current DB schema (category_name as the match field,
    // no raw_value column yet). When room_categories is migrated to the
    // raw_value/display_name pattern (same as booking_purposes/segments),
    // switch matchColumn to 'raw_value' and update fetchExisting + addValue.
    room_categories: {
      table: 'room_categories',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('room_categories')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await sb.from('room_categories').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
          status: 'active',
        });
        if (error) throw error;
      },
    },
    // rooms: matches room_code_raw against rooms.raw_value. When adding,
    // looks up room_category_raw from the same file row and pre-assigns
    // category_id by matching against the registered room_categories.
    // The property_uuid is derived from the file's property_id column
    // matched against the company's registered properties.
    rooms: {
      table: 'rooms',
      matchColumn: 'raw_value',
      actionType: 'room',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('rooms')
          .select('id, raw_value, display_name, status, category_id')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName, extraFields) {
        // extraFields: { category_id, beds_per_room, property_uuid }
        const { error } = await sb.from('rooms').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
          category_id: extraFields?.category_id || null,
          beds_per_room: extraFields?.beds_per_room || 1,
          property_uuid: extraFields?.property_uuid || null,
          property_id: extraFields?.property_id || null,
          status: 'active',
        });
        if (error) throw error;
      },
    },
    // extras_catalog: matches raw product names from extras_master.csv against
    // extras_catalog.raw_value. actionType 'extras' shows display name + category
    // inputs inline. Subcategory, timing, and amount are set in the Extras tab after.
    extras_catalog: {
      table: 'extras_catalog',
      matchColumn: 'raw_value',
      actionType: 'extras',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('extras_catalog')
          .select('id, raw_value, display_name, category, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName, extraFields) {
        const { error } = await sb.from('extras_catalog').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
          category: extraFields?.category || 'UNCATEGORISED',
          charge_timing: 'during_stay',
          default_amount: 0,
          status: 'active',
        });
        if (error) throw error;
      },
    },
  };

  let parsedRows = null;   // array of objects, one per CSV row
  let parsedHeaders = null;

  // --- minimal CSV parser -------------------------------------------------
  // Handles the common cases pandas.to_csv() produces: comma-separated,
  // double-quote-wrapped fields containing commas, and "" as an escaped
  // quote inside a quoted field. Not a general-purpose RFC4180 parser, but
  // sufficient for our own ETL output.
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') {
          if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
          row = []; field = '';
        } else if (c === '\r') { /* skip, \n handles the newline */ }
        else { field += c; }
      }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

    if (rows.length === 0) return { headers: [], records: [] };
    const headers = rows[0];
    const records = rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
    return { headers, records };
  }

  function guessColumn(masterKey, headers) {
    const guesses = COLUMN_GUESS[masterKey] || [];
    for (const g of guesses) {
      const hit = headers.find(h => h.toLowerCase() === g.toLowerCase());
      if (hit) return hit;
    }
    return headers[0] || null;
  }

  function computeDistinctValues(records, column) {
    const counts = new Map();
    for (const r of records) {
      let v = r[column];
      if (v === undefined || v === null) v = '';
      v = String(v).trim();
      if (v === '' || v.toLowerCase() === 'nan') continue; // skip blank/NaN
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]); // most frequent first
  }

  // First-pass country guess: exact name match first, then "one name
  // contains the other" as a looser fallback (catches cases like
  // "United States of America" containing "united states"). This is
  // intentionally simple -- it only pre-selects a suggestion in the
  // dropdown, never auto-saves, so a wrong guess costs nothing beyond
  // picking a different option before clicking Add.
  function guessCountryCode(rawValue, countryOptions) {
    const needle = rawValue.toLowerCase().trim();
    const exact = countryOptions.find(c => c.country_name.toLowerCase().trim() === needle);
    if (exact) return exact.country_code;

    const contains = countryOptions.find(c => {
      const name = c.country_name.toLowerCase().trim();
      return needle.includes(name) || name.includes(needle);
    });
    if (contains) return contains.country_code;

    return null;
  }

  async function renderResults(masterKey, column) {
    const tbody = document.getElementById('ms-results-tbody');
    UI.tableLoading('ms-results-tbody', 4);

    const config = MASTER_CONFIG[masterKey];
    const distinct = computeDistinctValues(parsedRows, column);

    let existing;
    try {
      existing = await config.fetchExisting(currentCompany.id);
    } catch (e) {
      UI.tableEmpty('ms-results-tbody', 4, `Error loading existing master data: ${e.message}`);
      return;
    }

    // Only fetch the countries list when actually needed (country_select type)
    let countryOptions = [];
    if (config.actionType === 'country_select') {
      const { data, error } = await Countries.getAll();
      if (error) {
        UI.tableEmpty('ms-results-tbody', 4, `Error loading countries list: ${error.message}`);
        return;
      }
      countryOptions = data || [];
    }

    // For extras: fetch registered categories for the dropdown
    let extrasCategories = [];
    if (config.actionType === 'extras') {
      const { data: cats } = await sb.from('extras_categories')
        .select('raw_value, display_name')
        .eq('company_id', currentCompany.id)
        .eq('status', 'active')
        .order('display_name');
      extrasCategories = cats || [];
    }
    // beds_per_room_derived, property_id} from the parsed file rows, so we
    // can show a pre-assigned category suggestion for each room.
    let roomInfoMap = new Map();
    let registeredCategories = [];
    let propertyUuidMap = new Map(); // property_id string -> property UUID
    if (config.actionType === 'room') {
      parsedRows.forEach(r => {
        const name = String(r['room_code_raw'] || '').trim();
        if (name && !roomInfoMap.has(name)) {
          roomInfoMap.set(name, {
            room_category_raw: String(r['room_category_raw'] || '').trim(),
            beds_per_room: parseInt(r['beds_per_room_derived']) || 1,
            property_id: String(r['property_id'] || '').trim(),
          });
        }
      });
      // Fetch registered room_categories to resolve category_id
      const { data: cats } = await sb.from('room_categories')
        .select('id, raw_value, display_name').eq('company_id', currentCompany.id);
      registeredCategories = cats || [];
      // Fetch registered properties to resolve property_uuid
      const { data: props } = await sb.from('properties')
        .select('id, property_id').eq('company_id', currentCompany.id);
      (props || []).forEach(p => propertyUuidMap.set(p.property_id, p.id));
    }

    const existingByValue = new Map(
      existing.map(r => [String(r[config.matchColumn]).toLowerCase().trim(), r])
    );

    // A value is "resolved" if it has a match that's both active and
    // actually complete (a country mapping with no country_code yet is
    // not resolved, even though a row technically exists for it).
    function isResolved(value) {
      const match = existingByValue.get(value.toLowerCase().trim());
      if (!match) return false;
      if (config.actionType === 'country_select') {
        return !!match.country_code && match.status === 'active';
      }
      return match.status === 'active';
    }

    const showUnresolvedOnly = document.getElementById('ms-unresolved-only')?.checked;
    const visibleDistinct = showUnresolvedOnly
      ? distinct.filter(([value]) => !isResolved(value))
      : distinct;

    document.getElementById('ms-results-count').textContent = showUnresolvedOnly
      ? `3. Review distinct values (${visibleDistinct.length} unresolved of ${distinct.length} found in file)`
      : `3. Review distinct values (${distinct.length} found in file)`;

    if (distinct.length === 0) {
      UI.tableEmpty('ms-results-tbody', 4, 'No non-blank values found in that column.');
      return;
    }
    if (visibleDistinct.length === 0) {
      UI.tableEmpty('ms-results-tbody', 4, 'Nothing unresolved -- every value in this file is already mapped.');
      return;
    }

    function buildCountryOptionsHtml(guessedCode) {
      return countryOptions.map(c =>
        `<option value="${escapeAttr(c.country_code)}" ${c.country_code === guessedCode ? 'selected' : ''}>${escapeHtml(c.country_name)} (${c.country_code})</option>`
      ).join('');
    }

    tbody.innerHTML = visibleDistinct.map(([value, count]) => {
      const match = existingByValue.get(value.toLowerCase().trim());
      let statusHtml, actionHtml;

      if (!match) {
        statusHtml = `<span class="badge" style="background:#fef3c7;color:#92400e">Not in master</span>`;

        if (config.actionType === 'country_select') {
          // The matched value must be a real ISO code (FK constraint), so
          // this is a dropdown of actual countries, never free text. We
          // pre-select a best-guess match by name so the common case
          // (raw value already looks like a country name) just needs a
          // confirming click, but the guess is never auto-saved.
          const guessedCode = guessCountryCode(value, countryOptions);
          const guessedCountry = countryOptions.find(c => c.country_code === guessedCode);
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center">
              <select data-role="country-select" data-value="${escapeAttr(value)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:200px">
                <option value="" ${guessedCode ? '' : 'selected'}>Select country...</option>
                ${buildCountryOptionsHtml(guessedCode)}
              </select>
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
              ${guessedCountry ? `<span style="color:var(--text-muted);font-size:0.8rem">suggested</span>` : ''}
            </div>`;
        } else if (config.actionType === 'room') {
          // Pre-assign category from the file's room_category_raw column,
          // matched against registered room_categories. Show the suggested
          // category and beds count derived from the file, plus a display
          // name input. User just confirms and clicks Add.
          const info = roomInfoMap.get(value) || {};
          const suggestedCat = registeredCategories.find(
            c => c.raw_value === info.room_category_raw
          );
          const catLabel = suggestedCat
            ? `<span style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(suggestedCat.display_name || suggestedCat.raw_value)}</span>`
            : `<span style="font-size:0.8rem;color:#dc2626">Category not registered yet</span>`;
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
              <input type="text" placeholder="Display name"
                     data-role="display-name-input" data-value="${escapeAttr(value)}"
                     data-category-id="${escapeAttr(suggestedCat?.id || '')}"
                     data-beds="${info.beds_per_room || 1}"
                     data-property-id="${escapeAttr(info.property_id || '')}"
                     style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:150px"
                     value="${escapeAttr(value)}">
              ${catLabel}
              <span style="font-size:0.8rem;color:var(--text-muted)">${info.beds_per_room || 1} bed(s)</span>
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
            </div>`;
        } else if (config.actionType === 'extras') {
          const catOptions = extrasCategories.length
            ? extrasCategories.map(c => `<option value="${escapeAttr(c.raw_value)}">${escapeHtml(c.display_name)}</option>`).join('')
            : '<option value="UNCATEGORISED">UNCATEGORISED</option>';
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
              <input type="text" placeholder="Display name"
                     data-role="display-name-input" data-value="${escapeAttr(value)}"
                     style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:150px"
                     value="${escapeAttr(value)}">
              <select data-role="extra-category" data-value="${escapeAttr(value)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px">
                ${catOptions}
              </select>
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
            </div>`;
        } else {
          // Two-step add: the raw value is fixed (it's exactly what the file
          // contains), but the display name is a judgment call -- ask for it
          // inline rather than guessing or reusing the raw text silently.
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center">
              <input type="text" placeholder="Display name to show in reports"
                     data-role="display-name-input" data-value="${escapeAttr(value)}"
                     style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:180px">
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
            </div>`;
        }
      } else if (config.actionType === 'country_select') {
        // A row needs attention if it has no country_code yet, OR it was
        // previously deactivated (e.g. fixed in the Markets tab after a
        // mismapping) -- both cases route back into the resolve flow.
        if (!match.country_code || match.status !== 'active') {
          statusHtml = match.status !== 'active'
            ? `<span class="badge" style="background:#fee2e2;color:#991b1b">Inactive -- needs review</span>`
            : `<span class="badge" style="background:#fef3c7;color:#92400e">Seen, not resolved</span>`;
          const guessedCode = guessCountryCode(value, countryOptions);
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center">
              <select data-role="country-select" data-value="${escapeAttr(value)}" data-existing-id="${escapeAttr(match.id)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:200px">
                <option value="" ${guessedCode ? '' : 'selected'}>Select country...</option>
                ${buildCountryOptionsHtml(guessedCode)}
              </select>
              <button class="btn btn-primary btn-sm" data-action="resolve" data-value="${escapeAttr(value)}" data-existing-id="${escapeAttr(match.id)}">+ Save</button>
            </div>`;
        } else {
          const countryLabel = countryOptions.find(c => c.country_code === match.country_code);
          statusHtml = `<span class="badge" style="background:#d1fae5;color:#065f46">Mapped</span>`;
          actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">${countryLabel ? escapeHtml(countryLabel.country_name) : match.country_code}</span>`;
        }
      } else if (match.status !== 'active') {
        statusHtml = `<span class="badge" style="background:#fee2e2;color:#991b1b">Exists, inactive</span>`;
        actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">Reactivate from the ${masterKey.replace('_',' ')} section</span>`;
      } else {
        statusHtml = `<span class="badge" style="background:#d1fae5;color:#065f46">Active in master</span>`;
        const extraInfo = config.actionType === 'extras' && match.category
          ? ` · ${escapeHtml(match.category)}`
          : '';
        actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">Shown as "${escapeHtml(match.display_name)}"${extraInfo}</span>`;
      }

      return `
        <tr>
          <td>${escapeHtml(value)}</td>
          <td>${count}</td>
          <td>${statusHtml}</td>
          <td>${actionHtml}</td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-action="add"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const value = btn.getAttribute('data-value');
        const row = btn.closest('tr');

        let secondValue;
        let inputEl;
        let extraFields = null;
        if (config.actionType === 'country_select') {
          inputEl = row.querySelector('select[data-role="country-select"]');
          secondValue = inputEl.value;
          if (!secondValue) {
            inputEl.style.borderColor = '#dc2626';
            return;
          }
        } else {
          inputEl = row.querySelector('input[data-role="display-name-input"]');
          secondValue = inputEl.value.trim();
          if (!secondValue) {
            inputEl.style.borderColor = '#dc2626';
            inputEl.placeholder = 'Required before adding';
            return;
          }
          // For rooms, pass the pre-assigned category, beds, and property
          if (config.actionType === 'room') {
            extraFields = {
              category_id: inputEl.dataset.categoryId || null,
              beds_per_room: parseInt(inputEl.dataset.beds) || 1,
              property_id: inputEl.dataset.propertyId || null,
              property_uuid: propertyUuidMap.get(inputEl.dataset.propertyId) || null,
            };
          } else if (config.actionType === 'extras') {
            const catEl = row.querySelector('select[data-role="extra-category"]');
            extraFields = { category: catEl?.value || 'UNCATEGORISED' };
          }
        }

        btn.disabled = true;
        inputEl.disabled = true;
        btn.textContent = 'Adding...';
        try {
          await config.addValue(currentCompany.id, value, secondValue, extraFields);
          await renderResults(masterKey, column); // refresh full table to reflect new state
        } catch (e) {
          UI.showAlert('ms-file-error', `Could not add "${value}": ${e.message}`);
          btn.disabled = false;
          inputEl.disabled = false;
          btn.textContent = '+ Add';
        }
      });
    });

    // "resolve" handles the case where a raw_value row already exists
    // (seen before, e.g. inserted with no country_code) and just needs its
    // country_code filled in via update rather than a fresh insert.
    tbody.querySelectorAll('button[data-action="resolve"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const existingId = btn.getAttribute('data-existing-id');
        const row = btn.closest('tr');
        const select = row.querySelector('select[data-role="country-select"]');
        const countryCode = select.value;
        if (!countryCode) {
          select.style.borderColor = '#dc2626';
          return;
        }
        btn.disabled = true;
        select.disabled = true;
        btn.textContent = 'Saving...';
        try {
          const { error } = await ClientCountryMapping.update(existingId, { country_code: countryCode, status: 'active' });
          if (error) throw error;
          await renderResults(masterKey, column);
        } catch (e) {
          UI.showAlert('ms-file-error', `Could not save: ${e.message}`);
          btn.disabled = false;
          select.disabled = false;
          btn.textContent = '+ Save';
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // --- property pre-check --------------------------------------------------
  // The gold ETL output always stamps a property_id column on every row
  // (from the filename, not from anything the user picks). If that code
  // isn't already a registered property for this company, the rest of
  // Masters Setup doesn't make sense to run yet -- block and offer to add
  // the property first, reusing the existing Properties tab's add-property
  // modal rather than building a second one.
  async function checkProperties(records) {
    const banner = document.getElementById('ms-property-banner');
    banner.style.display = 'none';
    banner.innerHTML = '';

    if (!records.some(r => 'property_id' in r)) return true; // no such column, nothing to check

    const fileCodes = new Set(
      records.map(r => String(r['property_id'] || '').trim()).filter(Boolean)
    );
    if (fileCodes.size === 0) return true;

    const { data, error } = await Properties.getByCompany(currentCompany.id);
    if (error) {
      UI.showAlert('ms-file-error', `Could not check properties: ${error.message}`);
      return false;
    }
    const existingCodes = new Set((data || []).map(p => p.property_id));
    const missing = [...fileCodes].filter(code => !existingCodes.has(code));

    if (missing.length === 0) return true;

    banner.style.display = 'block';
    banner.innerHTML = `
      <div class="alert error show" style="margin-bottom:1rem">
        This file references ${missing.length} property code(s) not yet registered for this company:
        ${missing.map(escapeHtml).join(', ')}.
        Add the missing property before reviewing master values below.
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem">
        ${missing.map(code => `
          <button class="btn btn-primary btn-sm" data-action="add-property" data-code="${escapeAttr(code)}">
            + Add property "${escapeHtml(code)}"
          </button>
        `).join('')}
      </div>`;

    banner.querySelectorAll('button[data-action="add-property"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code');
        document.getElementById('prop-id').value = code;
        document.getElementById('prop-name').value = '';
        document.getElementById('prop-city').value = '';
        document.getElementById('prop-country').value = '';
        document.getElementById('prop-rooms').value = '';
        document.getElementById('prop-beds').value = '';
        UI.hideAlert('prop-error');
        UI.openModal('modal-property');
      });
    });

    return false;
  }

  // Re-run the property check after the Add Property modal saves, since the
  // existing handler in dashboard.html doesn't know Masters Setup exists.
  // We don't touch that handler -- instead, watch for the modal closing and
  // re-check from here, which keeps the two features decoupled.
  function watchPropertyModalClose() {
    const modal = document.getElementById('modal-property');
    if (!modal || modal._msWatched) return;
    modal._msWatched = true;
    const observer = new MutationObserver(() => {
      const isOpen = modal.classList.contains('show');
      if (!isOpen && parsedRows) {
        checkProperties(parsedRows).then(ok => {
          if (ok) {
            document.getElementById('ms-after-upload').style.display = 'block';
            const masterSelect = document.getElementById('ms-master-select');
            const columnSelect = document.getElementById('ms-column-select');
            renderResults(masterSelect.value, columnSelect.value);
          }
        });
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function handleFileSelected(file) {
    UI.hideAlert('ms-file-error');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      UI.showAlert('ms-file-error', 'Please upload a .csv file (this first version does not read .xlsx directly).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const { headers, records } = parseCSV(e.target.result);
      if (headers.length === 0) {
        UI.showAlert('ms-file-error', 'Could not find any columns in this file.');
        return;
      }
      parsedHeaders = headers;
      parsedRows = records;

      watchPropertyModalClose();
      const propertiesOk = await checkProperties(records);
      if (!propertiesOk) {
        document.getElementById('ms-after-upload').style.display = 'none';
        return; // block here until the missing property is added
      }

      const masterSelect = document.getElementById('ms-master-select');
      const columnSelect = document.getElementById('ms-column-select');
      columnSelect.innerHTML = headers.map(h => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join('');

      const guessed = guessColumn(masterSelect.value, headers);
      if (guessed) columnSelect.value = guessed;
      document.getElementById('ms-column-hint').textContent =
        guessed ? `Preselected "${guessed}" as the likely match for this master.` : '';

      document.getElementById('ms-after-upload').style.display = 'block';
      renderResults(masterSelect.value, columnSelect.value);
    };
    reader.onerror = () => UI.showAlert('ms-file-error', 'Could not read the file.');
    reader.readAsText(file);
  }

  // Masters available per file type.
  // 'reservations' file: booking_purposes, segments, client_country_mapping
  // 'nights' file: room_categories (space_category column)
  const MASTERS_BY_FILE_TYPE = {
    reservations: [
      { value: 'booking_purposes',       label: 'Booking Purposes' },
      { value: 'segments',               label: 'Segments' },
      { value: 'client_country_mapping', label: 'Client Country Mapping' },
    ],
    nights: [
      { value: 'room_categories', label: 'Room Categories' },
      { value: 'rooms',           label: 'Rooms' },
    ],
    extras: [
      { value: 'extras_catalog', label: 'Extras' },
    ],
  };

  let currentFileType = 'reservations';

  function init() {
    const fileInput = document.getElementById('ms-file-input');
    const masterSelect = document.getElementById('ms-master-select');
    const columnSelect = document.getElementById('ms-column-select');

    // Reset visible state every time the section loads, since we never
    // persist the uploaded file -- re-entering this tab should feel like
    // starting fresh, not silently keeping stale data around.
    parsedRows = null;
    parsedHeaders = null;
    fileInput.value = '';
    currentFileType = 'reservations';
    document.getElementById('ms-after-upload').style.display = 'none';
    document.getElementById('ms-property-banner').style.display = 'none';
    document.getElementById('ms-unresolved-only').checked = false;
    document.getElementById('ms-upload-label').textContent = '1. Upload reservations file';
    document.getElementById('ms-tab-reservations').classList.add('active');
    document.getElementById('ms-tab-nights').classList.remove('active');
    document.getElementById('ms-tab-extras')?.classList.remove('active');
    UI.hideAlert('ms-file-error');
    updateMasterOptions();

    fileInput.onchange = (e) => handleFileSelected(e.target.files[0]);

    document.getElementById('ms-unresolved-only').onchange = () => {
      if (!parsedRows) return;
      renderResults(masterSelect.value, columnSelect.value);
    };

    masterSelect.onchange = () => {
      if (!parsedHeaders) return;
      const guessed = guessColumn(masterSelect.value, parsedHeaders);
      if (guessed) columnSelect.value = guessed;
      document.getElementById('ms-column-hint').textContent =
        guessed ? `Preselected "${guessed}" as the likely match for this master.` : '';
      renderResults(masterSelect.value, columnSelect.value);
    };

    columnSelect.onchange = () => {
      if (!parsedRows) return;
      renderResults(masterSelect.value, columnSelect.value);
    };
  }

  function updateMasterOptions() {
    const masterSelect = document.getElementById('ms-master-select');
    const options = MASTERS_BY_FILE_TYPE[currentFileType] || [];
    masterSelect.innerHTML = options.map(o =>
      `<option value="${o.value}">${o.label}</option>`
    ).join('');
  }

  return { init, switchFileType(type) {
    currentFileType = type;
    parsedRows = null;
    parsedHeaders = null;
    const fileInput = document.getElementById('ms-file-input');
    fileInput.value = '';
    document.getElementById('ms-after-upload').style.display = 'none';
    document.getElementById('ms-property-banner').style.display = 'none';
    document.getElementById('ms-unresolved-only').checked = false;
    UI.hideAlert('ms-file-error');
    const labels = { reservations: '1. Upload reservations file', nights: '1. Upload nights file', extras: '1. Upload extras master file' };
    document.getElementById('ms-upload-label').textContent = labels[type] || '1. Upload file';
    ['reservations','nights','extras'].forEach(t => {
      document.getElementById(`ms-tab-${t}`)?.classList.toggle('active', t === type);
    });
    updateMasterOptions();
  }};
})();

function initMastersSetup() { MastersSetup.init(); }
function msSwitchFileType(type) { MastersSetup.switchFileType(type); }
