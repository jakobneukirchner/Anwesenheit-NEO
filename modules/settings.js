// modules/settings.js

window.appSettings = {};
window.roleLabels  = { admin: 'Admin', coordinator: 'Koordinator', teacher: 'Trainer', member: 'Mitglied' };

// Sofort beim Script-Load aufrufen – funktioniert auch ohne Authentifizierung,
// sofern die Firestore-Regel für settings/global public read erlaubt.
// Fehler werden still ignoriert (z.B. wenn Regeln strict sind),
// dann wird das Branding nach dem Login via auth.js nachgeladen.
(async function applyBrandingEarly() {
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    if (!doc.exists) return;
    _applyBrandingData(doc.data());
  } catch (e) {
    // Kein Fehler ausgeben – Firestore-Regeln erlauben möglicherweise keinen anonymen Zugriff.
    // Branding wird nach dem Login in auth.js nachgeladen.
  }
})();

async function applyBranding() {
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    if (!doc.exists) return;
    _applyBrandingData(doc.data());
  } catch (e) {
    // still
  }
}

function _applyBrandingData(data) {
  window.appSettings = { ...window.appSettings, ...data };

  if (data.roleLabels) window.roleLabels = { ...window.roleLabels, ...data.roleLabels };

  if (data.brandingTitle) {
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = data.brandingTitle;
    document.title = data.brandingTitle;
  }
  if (data.logoUrl) {
    const logoEl = document.getElementById('app-logo');
    if (logoEl) logoEl.style.backgroundImage = `url('${data.logoUrl}')`;
  }
  if (data.faviconUrl) {
    let link = document.querySelector("link[rel='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = data.faviconUrl;
  }
}
