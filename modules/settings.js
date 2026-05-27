// modules/settings.js

window.appSettings = {};
window.roleLabels  = { admin: 'Admin', coordinator: 'Koordinator', teacher: 'Trainer', member: 'Mitglied' };

// Sofort beim Script-Load aufrufen – funktioniert auch ohne Authentifizierung,
// sofern die Firestore-Regel für settings/global public read erlaubt.
(async function applyBrandingEarly() {
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    if (!doc.exists) return;
    _applyBrandingData(doc.data());
  } catch (e) {
    // Kein Fehler – Firestore-Regeln erlauben möglicherweise keinen anonymen Zugriff.
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

/**
 * Gibt die konfigurierte Bestätigungs-Zeitfenster-Einstellung zurück.
 * Standard: 120 Minuten nach Terminende.
 * Nach Ablauf dieses Zeitfensters sind Buttons "Teilnahme bestätigen" / "Abmelden"
 * für Mitglieder nicht mehr verfügbar; ausstehende Bestätigungen gelten als unentschuldigt.
 */
function getConfirmationWindowMinutes() {
  return window.appSettings?.confirmationWindowMinutes ?? 120;
}

/**
 * Gibt zurück ob ein Termin noch im Bestätigungs-Zeitfenster liegt.
 * @param {Date} eventEndTime - Endzeit des Termins
 * @returns {boolean}
 */
function isInConfirmationWindow(eventEndTime) {
  if (!eventEndTime) return false;
  const windowMs = getConfirmationWindowMinutes() * 60 * 1000;
  return (Date.now() - eventEndTime.getTime()) <= windowMs;
}
