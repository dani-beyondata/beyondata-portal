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
  };

  // Maps a master table's key to the matching logic needed to compare
  // distinct file values against existing master rows for this company.
  const MASTER_CONFIG = {
    booking_purposes: {
      table: 'booking_purposes',
      nameColumn: 'purpose_name',
      codeColumn: 'purpose_code',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('booking_purposes')
          .select('id, purpose_code, purpose_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, value, existingRows) {
        const maxCode = existingRows.reduce((m, r) => Math.max(m, r.purpose_code || 0), 0);
        const nextCode = maxCode + 1;
        const { error } = await BookingPurposes.create(companyId, {
          purpose_code: nextCode,
          purpose_name: value,
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

    const existingByName = new Map(
      existing.map(r => [String(r[config.nameColumn]).toLowerCase().trim(), r])
    );

    document.getElementById('ms-results-count').textContent =
      `3. Review distinct values (${distinct.length} found in file)`;

    if (distinct.length === 0) {
      UI.tableEmpty('ms-results-tbody', 4, 'No non-blank values found in that column.');
      return;
    }

    tbody.innerHTML = distinct.map(([value, count]) => {
      const match = existingByName.get(value.toLowerCase().trim());
      let statusHtml, actionHtml;

      if (!match) {
        statusHtml = `<span class="badge" style="background:#fef3c7;color:#92400e">Not in master</span>`;
        actionHtml = `<button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add to master</button>`;
      } else if (match.status !== 'active') {
        statusHtml = `<span class="badge" style="background:#fee2e2;color:#991b1b">Exists, inactive</span>`;
        actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">Reactivate from the ${masterKey.replace('_',' ')} section</span>`;
      } else {
        statusHtml = `<span class="badge" style="background:#d1fae5;color:#065f46">Active in master</span>`;
        actionHtml = '';
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
        btn.disabled = true;
        btn.textContent = 'Adding...';
        try {
          await config.addValue(currentCompany.id, value, existing);
          await renderResults(masterKey, column); // refresh full table to reflect new state
        } catch (e) {
          UI.showAlert('ms-file-error', `Could not add "${value}": ${e.message}`);
          btn.disabled = false;
          btn.textContent = '+ Add to master';
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

  function handleFileSelected(file) {
    UI.hideAlert('ms-file-error');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      UI.showAlert('ms-file-error', 'Please upload a .csv file (this first version does not read .xlsx directly).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, records } = parseCSV(e.target.result);
      if (headers.length === 0) {
        UI.showAlert('ms-file-error', 'Could not find any columns in this file.');
        return;
      }
      parsedHeaders = headers;
      parsedRows = records;

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
    document.getElementById('ms-after-upload').style.display = 'none';
    UI.hideAlert('ms-file-error');

    fileInput.onchange = (e) => handleFileSelected(e.target.files[0]);

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

  return { init };
})();

function initMastersSetup() { MastersSetup.init(); }
