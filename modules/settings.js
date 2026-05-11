// modules/settings.js

window.appSettings = {};
window.roleLabels  = { admin: 'Admin', coordinator: 'Koordinator', teacher: 'Trainer', member: 'Mitglied' };

async function applyBranding() {
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    if (!doc.exists) return;
    const data = doc.data();
    window.appSettings = data;

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
  } catch (e) {
    // Firestore noch nicht verfügbar (vor Login) – still ignorieren
  }
}
