# Export a Excel · configuración (una sola vez)

## 1 · App en Azure AD (entidad de servicio)
1. portal.azure.com → **Microsoft Entra ID → Registros de aplicaciones → Nuevo registro**. Nombre: `beyondata-pbi-export`. Tipo de cuenta: solo este directorio. Sin URI de redirección. Registrar.
2. Apunta **Id. de aplicación (cliente)** y **Id. de directorio (inquilino)**.
3. **Certificados y secretos → Nuevo secreto de cliente** (24 meses). Copia el **Valor** ahora mismo (no vuelve a mostrarse).
4. No añadas permisos de API delegados: no hacen falta para Execute Queries con entidad de servicio.

## 2 · Power BI · permitir entidades de servicio
1. app.powerbi.com → ⚙ **Portal de administración → Configuración del inquilino**.
2. **Configuración de desarrollador → "Permitir que las entidades de servicio usen las API de Power BI"** → Habilitado. Aplicar a un grupo de seguridad concreto (crea en Entra un grupo `pbi-service-principals` y mete la app). Guardar.
3. Misma pantalla: **"Dataset Execute Queries REST API"** → Habilitado.
4. Espera ~15 min a que propaguen.

## 3 · Acceso al workspace
Workspace de cd_sales → **Administrar acceso → Agregar** → busca `beyondata-pbi-export` → rol **Visor** (con "Build" implícito para consultas; si falla, usa **Colaborador**).

## 4 · GUIDs
En el Service, abre el modelo semántico **cd_sales**: la URL es `…/groups/<WORKSPACE_ID>/datasets/<DATASET_ID>/details`. Guárdalos en `companies` (SQL adjunto) o desde la tarjeta *Power BI embed* del portal.

## 5 · Supabase
```bash
supabase secrets set PBI_TENANT_ID=<tenant> PBI_CLIENT_ID=<client> PBI_CLIENT_SECRET=<secret>
# desde la raíz del repo del portal (o cualquier carpeta con supabase/functions/export-controlling/index.ts + xlsx_builder.js)
supabase functions deploy export-controlling --no-verify-jwt   # la función valida el JWT por sí misma
```
Estructura esperada:
```
supabase/functions/export-controlling/index.ts
supabase/functions/export-controlling/xlsx_builder.js
```

## 6 · Prueba
En el portal, Mi Dashboard → **📥 Excel**. Si falla, el mensaje de error de la función dice si es token AAD (paso 1-2), permisos (paso 3) o dataset no configurado (paso 4).

## Límites y notas
- Execute Queries: 100.000 filas por consulta, 120 consultas/min — sobra.
- Requiere el dataset en workspace Pro/PPU (ya lo es). Sin RLS no hay nada más que configurar.
- El Excel usa `[Ctrl Amount]` y `CtrlRows`: cualquier métrica que añadas a CtrlRows aparece sola en el Excel.
