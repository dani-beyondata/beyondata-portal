// pms_catalog.js — PMS catalog (global, not per company)

const PmsCatalog = (() => {

  async function getActive() {
    const { data, error } = await sb
      .from('pms_catalog')
      .select('*')
      .eq('status', 'active')
      .order('display_name');
    return { data, error };
  }

  return { getActive };
})();
