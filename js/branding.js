// branding.js — per-company white-label color engine.
//
// The client gives up to TWO colours (a primary/accent and a dark/header
// colour). From those we DERIVE the full palette (light tint, dark variant,
// readable text-on-colour by luminance) and inject it as CSS variables on the
// document root. Every `var(--brand*)` rule in the portal then repaints — the
// stylesheets themselves are never edited at runtime.
//
// Rule: system_admin ALWAYS sees the default BeyonData palette (the :root
// values in base.css). Only a non-admin user of a company that has a
// brand_primary set gets that company's colours.

const Branding = (() => {

  // ── pure colour math ──────────────────────────────────────────────
  function hexToRgb(hex) {
    if (!hex) return null;
    let h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    const c = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  // mix toward white; t=0 keeps the colour, t=1 is pure white
  function mixWhite(rgb, t) {
    return {
      r: rgb.r + (255 - rgb.r) * t,
      g: rgb.g + (255 - rgb.g) * t,
      b: rgb.b + (255 - rgb.b) * t
    };
  }

  // darken toward black; t=0 keeps the colour, t=1 is pure black
  function darken(rgb, t) {
    return { r: rgb.r * (1 - t), g: rgb.g * (1 - t), b: rgb.b * (1 - t) };
  }

  // relative luminance (sRGB, WCAG formula)
  function luminance(rgb) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
  }

  // pick black or white text so it stays readable on `rgb`
  function textOn(rgb) {
    return luminance(rgb) > 0.5 ? '#111827' : '#ffffff';
  }

  // ── derive the full palette from up to 2 client colours ───────────
  // primaryHex is required; darkHex is optional (falls back to a darkened
  // primary). Returns null on an invalid primary.
  function derive(primaryHex, darkHex) {
    const p = hexToRgb(primaryHex);
    if (!p) return null;
    const d = hexToRgb(darkHex) || darken(p, 0.20);
    const light = mixWhite(p, 0.88);
    const heroStart = darken(d, 0.15);
    // When the header colour is bright, its text/controls must be dark, not white.
    const headerBright = textOn(d) === '#111827';
    return {
      brand:        rgbToHex(p.r, p.g, p.b),
      brandLight:   rgbToHex(light.r, light.g, light.b),
      brandDark:    rgbToHex(d.r, d.g, d.b),
      brandOn:      textOn(p),                       // text on a --brand fill
      topbarBg:     rgbToHex(d.r, d.g, d.b),         // header bar = dark colour
      topbarOn:     textOn(d),                       // main header text/logo
      topbarOnSoft:     headerBright ? 'rgba(0,0,0,0.72)'  : 'rgba(255,255,255,0.85)',
      topbarCtrlBg:     headerBright ? 'rgba(0,0,0,0.06)'  : 'rgba(255,255,255,0.12)',
      topbarCtrlBorder: headerBright ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.20)',
      heroStart:    rgbToHex(heroStart.r, heroStart.g, heroStart.b),
      heroEnd:      rgbToHex(p.r, p.g, p.b)
    };
  }

  // ── apply a palette to an element's inline style (default: :root) ──
  function apply(pal, el) {
    if (!pal) return;
    const t = (el || document.documentElement).style;
    t.setProperty('--brand',        pal.brand);
    t.setProperty('--brand-light',  pal.brandLight);
    t.setProperty('--brand-dark',   pal.brandDark);
    t.setProperty('--brand-on',     pal.brandOn);
    t.setProperty('--topbar-bg',    pal.topbarBg);
    t.setProperty('--topbar-on',    pal.topbarOn);
    t.setProperty('--topbar-on-soft',     pal.topbarOnSoft);
    t.setProperty('--topbar-ctrl-bg',     pal.topbarCtrlBg);
    t.setProperty('--topbar-ctrl-border', pal.topbarCtrlBorder);
    t.setProperty('--hero-start',   pal.heroStart);
    t.setProperty('--hero-end',     pal.heroEnd);
  }

  // remove overrides so an element falls back to the :root defaults
  function clear(el) {
    const t = (el || document.documentElement).style;
    ['--brand', '--brand-light', '--brand-dark', '--brand-on',
     '--topbar-bg', '--topbar-on', '--topbar-on-soft', '--topbar-ctrl-bg',
     '--topbar-ctrl-border', '--hero-start', '--hero-end']
      .forEach(v => t.removeProperty(v));
  }

  // ── bootstrap entry point ─────────────────────────────────────────
  // Applies the company palette for a non-admin user. Returns true if a
  // custom palette was applied, false if the default was kept.
  function applyForCompany(company, profile) {
    if (!company || !profile) return false;
    if (profile.role === 'system_admin') return false;   // admin keeps BeyonData
    if (!company.brand_primary) return false;             // company not branded
    const pal = derive(company.brand_primary, company.brand_dark);
    if (!pal) return false;
    apply(pal, document.documentElement);
    if (document.body) document.body.classList.add('has-brand');
    return true;
  }

  // Replace the "BEYONDATA" wordmark in the topbar with the company's logo,
  // for a non-admin user of a branded company. Admin keeps the wordmark.
  function applyLogo(company, profile) {
    if (!company || !profile || profile.role === 'system_admin') return false;
    if (!company.brand_logo_url) return false;
    const el = document.getElementById('topbar-brand');
    if (!el) return false;
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:11px';
    const img = document.createElement('img');
    img.src = company.brand_logo_url;
    img.alt = company.name || 'logo';
    img.style.cssText = 'height:34px;max-width:190px;object-fit:contain;display:block';
    wrap.appendChild(img);
    const firma = document.createElement('span');
    firma.style.cssText = 'display:flex;flex-direction:column;line-height:1.05;white-space:nowrap';
    firma.innerHTML =
      '<span style="font-size:7px;letter-spacing:1.5px;text-transform:uppercase;color:var(--topbar-on-soft)">powered by</span>' +
      '<span style="font-size:12px;font-weight:800;letter-spacing:0.2px">' +
        '<span style="color:var(--topbar-on)">BEYON</span><span style="color:#60a5fa">DATA</span>' +
      '</span>';
    wrap.appendChild(firma);
    el.appendChild(wrap);
    return true;
  }

  return { hexToRgb, rgbToHex, textOn, luminance, derive, apply, clear, applyForCompany, applyLogo };
})();
