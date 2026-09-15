// extras_categories.js — extras category master CRUD (two levels:
// rows without parent_id are categories, rows with parent_id are subcategories)

const ExtrasCategories = (() => {

  async function getByCompany(companyId) {
    const { data, error } = await sb.from('extras_categories')
      .select('*').eq('company_id', companyId)
      .order('category_name');
    return { data, error };
  }

  async function create(companyId, categoryName, parentId) {
    const { data, error } = await sb.from('extras_categories')
      .insert({ company_id: companyId, category_name: categoryName,
                parent_id: parentId || null, status: 'active' })
      .select().single();
    return { data, error };
  }

  async function update(id, categoryName, parentId) {
    const fields = { category_name: categoryName, updated_at: new Date().toISOString() };
    if (parentId !== undefined) fields.parent_id = parentId || null;
    const { data, error } = await sb.from('extras_categories')
      .update(fields).eq('id', id);
    return { data, error };
  }

  // Subcategories follow their parent: an active subcategory hanging off a
  // deactivated category would still be offered in the pickers.
  async function toggle(id, currentStatus) {
    const status = currentStatus === 'active' ? 'inactive' : 'active';
    const ts     = new Date().toISOString();

    const { error } = await sb.from('extras_categories')
      .update({ status, updated_at: ts }).eq('id', id);
    if (error) return { error };

    const { error: childError } = await sb.from('extras_categories')
      .update({ status, updated_at: ts }).eq('parent_id', id);
    return { error: childError };
  }

  return { getByCompany, create, update, toggle };
})();
