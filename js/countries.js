// countries.js — system-wide countries table (system admin only)

const Countries = (() => {

  async function getAll() {
    const { data, error } = await sb.from('countries')
      .select('*').order('continent').order('country_name');
    return { data, error };
  }

  async function update(id, fields) {
    const { data, error } = await sb.from('countries')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    return { data, error };
  }

  return { getAll, update };
})();
