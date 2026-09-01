// BeyonData · Edge Function export-controlling (bundled)
import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4";

// ───────── xlsx builder (inlined) ─────────
// BeyonData · Controlling Excel builder
// Pure JS (ESM). Works in Deno (Edge Function) via `import ExcelJS from "npm:exceljs@4"`
// and in Node for local tests. No DAX here: it receives already-computed rows.

const C = {
  navy: "1E3A5F", navyDeep: "152B47", brand: "3D65A8", sky: "60A5FA", gold: "E0A64E",
  ink: "1A1D24", soft: "4A4F5A", muted: "8A8F98", line: "D7DBE0", bone: "F6F4F1", boneSoft: "F7F9FC",
  green: "2F7A34", amber: "B7860B", red: "A0453D", white: "FFFFFF",
};

const FMT = {
  pct: "0.0%", eur: "#,##0.0 €", keur: '#,##0.0,"K€"', int: "#,##0", dec: "0.00",
  deltaPct: '+0.0" p.p.";-0.0" p.p.";0.0" p.p."', deltaRel: "+0.0%;-0.0%;0.0%",
};

// Semaphore thresholds — identical to the KPI cards and the HTML controlling table
function deltaColor(kind, fmt, v) {
  if (v == null || Number.isNaN(v)) return C.muted;
  const r = fmt === "pct" ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
  if (kind === "deltaTgt") {
    if (fmt === "pct") return r >= -1 ? C.green : r >= -3 ? C.amber : C.red;
    return r > -0.04 ? C.green : r >= -0.10 ? C.amber : C.red;
  }
  return r > 0 ? C.green : r < 0 ? C.red : C.muted;
}

/**
 * Pivot tidy DAX rows into blocks.
 * rows: [{section, morder, metric, lorder, line, fmt, col, value}] — col = column label (month/property) or null for totals
 * colOrder: ordered list of column labels
 * Returns: [{section, metric, fmt, lines:[{label, kind, values:{col:v}, total:v}]}]
 */
function pivot(rows, colOrder) {
  const blocks = new Map();
  for (const r of rows) {
    const bk = `${r.morder}`;
    if (!blocks.has(bk)) blocks.set(bk, { section: r.section, morder: r.morder, metric: r.metric, fmt: r.fmt, lines: new Map() });
    const b = blocks.get(bk);
    const lk = `${r.lorder}`;
    if (!b.lines.has(lk)) {
      const kind = r.line === "Δ" ? "delta" : r.line === "Δ vs Target" ? "deltaTgt" : "value";
      b.lines.set(lk, { label: r.line, lorder: r.lorder, kind, values: {}, total: null });
    }
    const L = b.lines.get(lk);
    if (r.col == null) L.total = r.value; else L.values[r.col] = r.value;
  }
  return [...blocks.values()].sort((a, b) => a.morder - b.morder).map(b => ({
    ...b, lines: [...b.lines.values()].sort((a, c) => a.lorder - c.lorder),
  }));
}

function addCover(wb, meta) {
  const ws = wb.addWorksheet("Portada", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 4 }, { width: 46 }, { width: 40 }];
  ws.mergeCells("B2:C4");
  const brand = ws.getCell("B2");
  brand.value = { richText: [
    { text: "BEYON", font: { name: "Segoe UI", size: 26, bold: true, color: { argb: C.ink } } },
    { text: "D", font: { name: "Segoe UI", size: 26, bold: true, color: { argb: C.sky } } },
    { text: "ATA", font: { name: "Segoe UI", size: 26, bold: true, color: { argb: C.sky } } },
  ] };
  brand.alignment = { vertical: "middle" };
  ws.getCell("B6").value = "Informe de controlling";
  ws.getCell("B6").font = { name: "Segoe UI", size: 20, bold: true, color: { argb: C.navy } };
  ws.getCell("B7").value = meta.company;
  ws.getCell("B7").font = { name: "Segoe UI", size: 14, color: { argb: C.soft } };
  const rowsMeta = [
    ["Generado", meta.generatedAt],
    ["Periodo", meta.period],
    ["Property", meta.property || "Todas (grupo)"],
    ["Modo de ocupación", meta.mode || "Habitaciones"],
    ["Fuente", "Modelo Power BI de BeyonData (misma lógica que el panel)"],
  ];
  let r = 10;
  for (const [k, v] of rowsMeta) {
    ws.getCell(`B${r}`).value = k; ws.getCell(`B${r}`).font = { name: "Segoe UI", size: 10, color: { argb: C.muted } };
    ws.getCell(`C${r}`).value = v; ws.getCell(`C${r}`).font = { name: "Segoe UI", size: 10, color: { argb: C.ink } };
    r++;
  }
  ws.getCell(`B${r + 1}`).value = "Hojas: Meses · Properties · Property × Mes · Datos (formato largo para tablas dinámicas)";
  ws.getCell(`B${r + 1}`).font = { name: "Segoe UI", size: 9, italic: true, color: { argb: C.muted } };
  ws.getCell(`B${r + 3}`).value = "Confidencial · preparado para uso interno del cliente · beyondata.es";
  ws.getCell(`B${r + 3}`).font = { name: "Segoe UI", size: 9, color: { argb: C.muted } };
  // top band
  for (let c = 1; c <= 3; c++) ws.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  ws.getRow(1).height = 8;
}

function styleHeader(ws, rowIdx, labels, firstColWidth) {
  const row = ws.getRow(rowIdx);
  row.height = 22;
  labels.forEach((lbl, i) => {
    const cell = row.getCell(i + 1);
    cell.value = lbl;
    cell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: C.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
    cell.alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle" };
  });
  ws.getColumn(1).width = firstColWidth;
  for (let i = 2; i <= labels.length; i++) ws.getColumn(i).width = 12.5;
}

/** Writes one controlling sheet. blocks from pivot(); cols = column labels; totalLabel e.g. "Total"/"Grupo" */
function addBlocksSheet(wb, name, title, subtitle, cols, blocks, totalLabel) {
  const safe = name.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31);   // Excel: 31 chars, sin \ / ? * [ ] :
  const ws = wb.addWorksheet(safe, { views: [{ showGridLines: false, state: "frozen", xSplit: 1, ySplit: 4 }] });
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { name: "Segoe UI", size: 14, bold: true, color: { argb: C.navy } };
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { name: "Segoe UI", size: 9, color: { argb: C.muted } };
  ws.getRow(3).height = 6;
  styleHeader(ws, 4, ["", ...cols, totalLabel], 26);
  let r = 5;
  let lastSection = null;
  for (const b of blocks) {
    if (b.section !== lastSection) {
      const cell = ws.getCell(r, 1);
      cell.value = b.section.toUpperCase();
      cell.font = { name: "Segoe UI", size: 8, bold: true, color: { argb: C.brand } };
      ws.getRow(r).height = 16;
      r++;
      lastSection = b.section;
    }
    b.lines.forEach((L, li) => {
      const row = ws.getRow(r);
      const first = li === 0;
      const lbl = row.getCell(1);
      lbl.value = first ? b.metric : `   ${L.label}`;
      lbl.font = { name: "Segoe UI", size: 10, bold: first, color: { argb: first ? C.navy : C.muted } };
      const numFmt = L.kind === "value" ? FMT[b.fmt] : (b.fmt === "pct" ? FMT.deltaPct : FMT.deltaRel);
      const writeCell = (cell, v, isTotal) => {
        cell.value = v == null ? null : v;
        cell.numFmt = numFmt;
        cell.alignment = { horizontal: "right" };
        const color = L.kind === "value" ? (first ? C.ink : C.soft) : deltaColor(L.kind, b.fmt, v);
        cell.font = { name: "Segoe UI", size: 10, bold: (first || L.kind !== "value") && !(L.kind === "value" && !first), color: { argb: color } };
        if (isTotal) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.boneSoft } };
        cell.border = { bottom: { style: "hair", color: { argb: "F0F1F3" } } };
      };
      cols.forEach((c, ci) => writeCell(row.getCell(ci + 2), L.values[c] ?? null, false));
      writeCell(row.getCell(cols.length + 2), L.total, true);
      r++;
    });
    ws.getRow(r).height = 8; // spacer
    r++;
  }
  ws.getCell(r + 1, 1).value = "Δ = variación respecto al mismo periodo del año anterior (p.p. para porcentajes). Δ vs Target = desviación sobre presupuesto. Colores: verde dentro del plan, ámbar vigilar, rojo actuar.";
  ws.getCell(r + 1, 1).font = { name: "Segoe UI", size: 8, italic: true, color: { argb: C.muted } };
  return ws;
}

function addLongSheet(wb, longRows) {
  const ws = wb.addWorksheet("Datos", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = ["Sección", "Métrica", "Línea", "Property", "Mes", "Valor"];
  styleHeader(ws, 1, headers, 18);
  ws.getColumn(2).width = 22; ws.getColumn(4).width = 22;
  longRows.forEach((x, i) => {
    const row = ws.getRow(i + 2);
    row.values = [x.section, x.metric, x.line, x.property ?? "Grupo", x.month ?? "Total", x.value];
    row.font = { name: "Segoe UI", size: 9 };
    row.getCell(6).numFmt = "0.0000";
  });
  ws.autoFilter = { from: "A1", to: `F${longRows.length + 1}` };
}

/**
 * data = {
 *   meta: {company, generatedAt, period, property, mode},
 *   monthViews: [{tab, label, cols, blocks}],          // grupo + una por hotel
 *   props:  {cols:[...property names], blocks:[...]}, // pestaña 2
 *   propMonth: {cols:[...months], blocks:[{section, metric, fmt, lines:[{label: 'Grupo'|property, kind:'value', values, total}]}]}, // pestaña 3
 *   long: [{section, metric, line, property, month, value}]
 * }
 */
async function buildControllingWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BeyonData"; wb.created = new Date();
  addCover(wb, data.meta);
  // una pestaña por vista mensual: grupo primero, luego cada hotel (equivale a filtrar por property)
  for (const v of data.monthViews) {
    const isGroup = v.tab === "Grupo";
    const title = isGroup ? "Controlling · evolución mensual" : `Controlling · ${v.label}`;
    const sub = isGroup
      ? `${data.meta.company} · ${data.meta.period} · YTD, año anterior, desviaciones y presupuesto`
      : `${v.label} · ${data.meta.period}`;
    addBlocksSheet(wb, v.tab, title, sub, v.cols, v.blocks, "Total");
  }
  addBlocksSheet(wb, "Properties", "Controlling · comparativa por property", `${data.meta.company} · ${data.meta.period}`, data.props.cols, data.props.blocks, "Grupo");
  addBlocksSheet(wb, "Property x Mes", "Controlling · property × mes (YTD)", `${data.meta.company} · ${data.meta.period} · solo valores de este año`, data.propMonth.cols, data.propMonth.blocks, "Total");
  addLongSheet(wb, data.long);
  return wb;
}

const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// ───────── edge function ─────────
// Supabase Edge Function · export-controlling
// POST { company_id?: string, property?: string | null }
// Auth: Bearer <supabase user JWT>. Returns an .xlsx built from the published Power BI model
// through the Execute Queries REST API (single source of truth = the model's DAX measures).
//
// Secrets (supabase secrets set …):
//   PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET
// Provided by the runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Power BI ──────────────────────────────────────────────────────────
async function pbiToken(): Promise<string> {
  const tenant = Deno.env.get("PBI_TENANT_ID")!;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: Deno.env.get("PBI_CLIENT_ID")!,
    client_secret: Deno.env.get("PBI_CLIENT_SECRET")!,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  });
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", body });
  if (!r.ok) throw new Error(`AAD token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

type Row = Record<string, unknown>;
async function dax(token: string, workspace: string, dataset: string, query: string): Promise<Row[]> {
  const r = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${workspace}/datasets/${dataset}/executeQueries`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
  });
  if (!r.ok) throw new Error(`executeQueries: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.results?.[0]?.tables?.[0]?.rows ?? [];
}

const CTRL_COLS = `CtrlRows[Section], CtrlRows[MOrder], CtrlRows[Metric], CtrlRows[LOrder], CtrlRows[Line], CtrlRows[Fmt]`;
const BASE_FILTERS = `FILTER ( ALL ( 'calendar'[date] ), 'calendar'[date] <= TODAY () ), TREATAS ( { "CurrentYear" }, 'calendar'[Year_Tag] )`;
const q = (groupBy: string, extraFilters: string) =>
  `EVALUATE SUMMARIZECOLUMNS ( ${CTRL_COLS}${groupBy ? ", " + groupBy : ""}, ${BASE_FILTERS}${extraFilters ? ", " + extraFilters : ""}, "Value", [Ctrl Amount] )`;

const pick = (r: Row, k: string) => r[k] as never;
function tidy(r: Row, col: string | null) {
  return {
    section: String(pick(r, "CtrlRows[Section]")), morder: Number(pick(r, "CtrlRows[MOrder]")),
    metric: String(pick(r, "CtrlRows[Metric]")), lorder: Number(pick(r, "CtrlRows[LOrder]")),
    line: String(pick(r, "CtrlRows[Line]")), fmt: String(pick(r, "CtrlRows[Fmt]")),
    col, value: pick(r, "[Value]") == null ? null : Number(pick(r, "[Value]")),
  };
}
const monthLabel = (r: Row) => MONTHS_ES[Number(r["calendar[monthNumber]"]) - 1];
const propLabel = (r: Row) => String(r["properties[property_name]"]);
const daxStr = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ── Handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing token" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: { user }, error: uErr } = await sb.auth.getUser(jwt);
    if (uErr || !user) return json({ error: "invalid token" }, 401);

    const { data: profile, error: pErr } = await sb
      .from("profiles").select("*, companies(*)").eq("id", user.id).maybeSingle();
    if (pErr) return json({ error: "profile query failed: " + pErr.message }, 403);
    if (!profile) return json({ error: `no profile row for user ${user.id}` }, 403);

    const body = await req.json().catch(() => ({}));
    const companyId = profile.role === "system_admin" && body.company_id ? body.company_id : profile.company_id;
    const property: string | null = body.property || null;

    const { data: company } = await sb.from("companies").select("id, name, pbi_workspace_id, pbi_dataset_id").eq("id", companyId).single();
    if (!company?.pbi_workspace_id || !company?.pbi_dataset_id) return json({ error: "Power BI dataset not configured for this company" }, 400);

    const token = await pbiToken();
    const run = (groupBy: string, extra = "") => dax(token, company.pbi_workspace_id, company.pbi_dataset_id, q(groupBy, extra));
    const propF = property ? `TREATAS ( { ${daxStr(property)} }, 'properties'[property_name] )` : "";
    const ytdF = `TREATAS ( { "YTD" }, CtrlRows[Line] )`;
    const join = (...f: string[]) => f.filter(Boolean).join(", ");

    // lista de properties de esta company (para una pestaña por hotel)
    const propRowsList = (await run(`'properties'[property_name]`)).map(r => propLabel(r));
    const propNames = [...new Set(propRowsList)].sort();

    // Tab 1 · vistas mensuales: grupo + una por property (a menos que el usuario pidiera una property concreta)
    const wantViews = property ? [property] : propNames;
    const monthViews = [];
    // vista de grupo (o de la property pedida)
    {
      const gm = (await run(`'calendar'[monthNumber]`, propF)).map(r => tidy(r, monthLabel(r)));
      const gmt = (await run(``, propF)).map(r => tidy(r, null));
      const cols = [...new Set(gm.map(r => r.col))].sort((a, b) => MONTHS_ES.indexOf(a) - MONTHS_ES.indexOf(b));
      monthViews.push({ tab: property ? property : "Grupo", label: property || company.name, cols, blocks: pivot([...gm, ...gmt], cols) });
    }
    // una pestaña por hotel (solo en la vista de grupo)
    if (!property) {
      for (const pn of wantViews) {
        const pf = `TREATAS ( { ${daxStr(pn)} }, 'properties'[property_name] )`;
        const hm = (await run(`'calendar'[monthNumber]`, pf)).map(r => tidy(r, monthLabel(r)));
        const hmt = (await run(``, pf)).map(r => tidy(r, null));
        const cols = [...new Set(hm.map(r => r.col))].sort((a, b) => MONTHS_ES.indexOf(a) - MONTHS_ES.indexOf(b));
        monthViews.push({ tab: pn, label: pn, cols, blocks: pivot([...hm, ...hmt], cols) });
      }
    }
    // para la hoja Datos (formato largo) usamos la vista de grupo
    const m = monthViews[0].blocks.flatMap(bl => bl.lines.flatMap(L =>
      Object.entries(L.values).map(([col, value]) => ({ section: bl.section, metric: bl.metric, line: L.label, col, value }))));
    // Tab 2 · properties (+ group)
    const p = (await run(`'properties'[property_name]`)).map(r => tidy(r, propLabel(r)));
    const pt = (await run(``)).map(r => tidy(r, null));  // grupo
    // Tab 3 · property × month, YTD only (+ group row, per-property totals, grand total)
    const pm = (await run(`'properties'[property_name], 'calendar'[monthNumber]`, ytdF)).map(r => ({ ...tidy(r, monthLabel(r)), line: propLabel(r), lorder: 1 }));
    const pmG = (await run(`'calendar'[monthNumber]`, ytdF)).map(r => ({ ...tidy(r, monthLabel(r)), line: "Grupo", lorder: 0 }));
    const pmT = (await run(`'properties'[property_name]`, ytdF)).map(r => ({ ...tidy(r, null), line: propLabel(r), lorder: 1 }));
    const pmGT = (await run(``, ytdF)).map(r => ({ ...tidy(r, null), line: "Grupo", lorder: 0 }));

    const months = monthViews[0].cols as string[];
    const props = [...new Set(p.map(r => r.col as string))].sort();
    // pestaña 3: una línea por property → lorder distinto por property para que pivot no las mezcle
    const propIdx = (name: string) => name === "Grupo" ? 0 : 1 + props.indexOf(name);
    const pm3 = [...pm, ...pmG, ...pmT, ...pmGT].map(r => ({ ...r, lorder: propIdx(r.line) }));

    const now = new Date();
    const data = {
      meta: {
        company: company.name,
        generatedAt: now.toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }),
        period: `YTD ${now.getFullYear()} (1 ene – ${now.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Madrid" })})`,
        property: property, mode: "Según configuración del informe",
      },
      monthViews,
      props: { cols: props, blocks: pivot([...p, ...pt], props) },
      propMonth: { cols: months, blocks: pivot(pm3, months).map((b: { lines: { kind: string }[] }) => ({ ...b, lines: b.lines.map(L => ({ ...L, kind: "value" })) })) },
      long: [
        ...m.map(r => ({ section: r.section, metric: r.metric, line: r.line, property: property || null, month: r.col, value: r.value })),
        ...p.map(r => ({ section: r.section, metric: r.metric, line: r.line, property: r.col, month: null, value: r.value })),
      ],
    };

    const wb = await buildControllingWorkbook(ExcelJS, data);
    const buf = await wb.xlsx.writeBuffer();
    const fname = `BeyonData_Controlling_${company.name.replace(/[^\w-]+/g, "_")}_${now.toISOString().slice(0, 10)}.xlsx`;
    return new Response(buf, {
      headers: {
        ...CORS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
