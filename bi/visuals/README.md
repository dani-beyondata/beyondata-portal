# Visual `p1_ctrl` — "Metrics by Month" como MATRIZ

Sustituye la tabla HTML `p1_ctrl` de la página 1 por una **matriz nativa** del BI,
aprovechando la extensión de *formato por eje (fila)* + *total desde el SQL*
(`feat/bi-matrix-axis-format`).

## Qué cambia
- Antes: visual `type:"html"` con una `<table>` dibujada a mano desde el SQL.
- Ahora: visual `type:"matrix"`. El SQL devuelve **formato largo** (una fila por
  métrica·línea × mes), y la matriz pivota, da formato por fila y ordena columnas.

## Forma del SQL (una fila por celda)
Columnas: `row` (etiqueta `Métrica · Línea`), `col` (mes `Ene`…`Nov` o `Total`),
`colOrd` (1..11, 99=Total), `v` (número), `fmt` (formato de ESA fila:
`pct1`/`pp`/`eur`/`keur`/`int`/`dec`), `arrow` (true en filas Δ).
- 10 métricas × {YTD, LYTD, Δ YoY} + {Target, Δ vs Target} sólo donde `tgt=1`
  → **42 filas × 12 columnas = 504 celdas**.
- La columna **Total** no es la suma del motor (va `autoTotal:false`): se calcula
  en el SQL con el agregado correcto por métrica (**avg** en %/€/ratio, **sum** en
  conteos y K€), por eso Ocupación·Total = 56,8 % (media) y Prod.Total·Total = 2.071 K€ (suma).

## Ajustes del visual (ya vienen en el JSON)
- `fmtAxis:"row"` → **imprescindible**: sólo en modo *fila* la matriz respeta el
  `fmt`/`arrow` que trae cada fila del SQL. En `off` usaría un formato global.
- `autoTotal:false` → no añade fila/columna Total propia (el Total viene del SQL).
- `sortable:false`, `sortRows:"none"` → mantiene el orden del SQL (`roword, colOrd`).
- `fmt:"int"` es sólo el *fallback*; cada fila manda con su propio `fmt`.

## Cómo aplicarlo
El dashboard vive en Supabase (`bi_dashboards.doc`, jsonb), no en el repo. Para cambiarlo:
1. En el BI en modo editor, borra el visual HTML `p1_ctrl` de la página 1 y añade uno
   de tipo **Matriz** en la misma posición (x16 y1064 w1256 h1180), pega el SQL de
   `p1_ctrl_matrix.sql`, y en el editor pon *Formato por eje → Por fila* y desmarca
   *Añadir Total propio*. Guarda.
2. O, si editas el jsonb directamente, sustituye el objeto `p1_ctrl` de la página 1
   por el de `p1_ctrl_matrix.json`.

## Dos decisiones pendientes (tuyas)
1. **Target = CY × 0,95 (placeholder).** No hay tabla de objetivos; el Target y el
   "Δ vs Target" se derivan del real. Por eso "Δ vs Target" sale casi plano
   (+5,3 % en las métricas €/conteo; en Ocupación varía porque va en p.p.).
   Cuando tengas objetivos reales, se enchufan en el CTE `body`/`tot` (ramas
   `target`/`dtarget`).
2. **Enteros grandes con `int` se abrevian** (Bednights total = "55,3 K", meses sin
   abreviar). Es el mismo criterio que las KPI card de Bednights. Si prefieres el
   total en entero completo ("55.331"), cambia esas filas a `fmt='dec'` en el SQL.
