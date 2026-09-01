// Supabase Edge Function · export-controlling
// POST { company_id?: string, property?: string | null }
// Auth: Bearer <supabase user JWT>. Returns an .xlsx built from the published Power BI model
// through the Execute Queries REST API (single source of truth = the model's DAX measures).
//
// Secrets (supabase secrets set …):
//   PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET
// Provided by the runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4";
import { buildControllingWorkbook, pivot, MONTHS_ES } from "./xlsx_builder.js";

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

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: uErr } = await sb.auth.getUser(jwt);
    if (uErr || !user) return json({ error: "invalid token" }, 401);

    const { data: profile } = await sb.from("profiles").select("company_id, role").eq("id", user.id).single();
    if (!profile) return json({ error: "no profile" }, 403);

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
