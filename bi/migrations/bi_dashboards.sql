-- BeyonData · BI — dashboard compartido entre admins (reemplaza el localStorage por navegador)
-- Córrelo en el SQL editor de Supabase. Idempotente.

create table if not exists public.bi_dashboards (
  company_id  uuid primary key,
  doc         jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.bi_dashboards enable row level security;

-- Lectura: system_admin (cualquier company) o company_admin de su propia company
drop policy if exists bi_dash_select on public.bi_dashboards;
create policy bi_dash_select on public.bi_dashboards
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role = 'system_admin'
                   or (p.role = 'company_admin' and p.company_id = bi_dashboards.company_id)))
  );

-- Escritura (insert / update / delete): mismo criterio
drop policy if exists bi_dash_write on public.bi_dashboards;
create policy bi_dash_write on public.bi_dashboards
  for all to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role = 'system_admin'
                   or (p.role = 'company_admin' and p.company_id = bi_dashboards.company_id)))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role = 'system_admin'
                   or (p.role = 'company_admin' and p.company_id = bi_dashboards.company_id)))
  );

grant select, insert, update, delete on public.bi_dashboards to authenticated;
