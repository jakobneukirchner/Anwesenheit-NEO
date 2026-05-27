// modules/settings.js

window.appSettings = {};
window.roleLabels  = { admin: 'Admin', coordinator: 'Koordinator', teacher: 'Trainer', member: 'Mitglied' };

// Sofort beim Script-Load aufrufen
(async function applyBrandingEarly() {
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    if (!doc.exists) return;
    _applyBrandingData(doc.data());
  } catch (e) {
    // Firestore-Regeln erlauben möglicherweise keinen anonymen Zugriff.
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
 * Gibt das konfigurierte Bestätigungs-Zeitfenster in Minuten zurück.
 *
 * Semantik:
 *   - Negative Werte: Fenster endet X Minuten VOR Terminbeginn
 *     Beispiel: -30 = Mitglieder müssen spätestens 30 Min vor Start bestätigen
 *   - Positive Werte: Fenster endet X Minuten NACH Terminbeginn
 *     Beispiel: 60 = Mitglieder können bis 60 Min nach Start bestätigen
 *   - 0 = genau zum Terminbeginn
 *
 * Bestätigungs-Deadline = startTime + confirmationWindowMinutes Minuten
 *
 * Standard: 60 (60 Minuten nach Terminbeginn)
 */
function getConfirmationWindowMinutes() {
  return window.appSettings?.confirmationWindowMinutes ?? 60;
}

/**
 * Gibt zurück ob ein Termin noch im Bestätigungs-Zeitfenster liegt.
 * @param {Date} eventStartTime - Startzeit des Termins
 * @returns {boolean} true wenn das Fenster noch offen ist
 */
function isInConfirmationWindow(eventStartTime) {
  if (!eventStartTime) return false;
  const windowMs  = getConfirmationWindowMinutes() * 60 * 1000;
  const deadline  = new Date(eventStartTime.getTime() + windowMs);
  return Date.now() <= deadline.getTime();
}
