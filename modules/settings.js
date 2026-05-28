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

/**
 * Gibt das Rückzugsfenster für einen Termin in Minuten zurück.
 *
 * Priorität:
 *   1. Termin-spezifischer Wert (event.cancellationWindowMinutes), falls definiert
 *   2. Globale Einstellung (appSettings.cancellationWindowMinutes)
 *   3. Standard: 60 Minuten
 *
 * Semantik (gleich wie Bestätigungsfenster):
 *   - Positiver Wert: Abmeldung möglich bis X Minuten NACH Terminbeginn
 *   - Negativer Wert: Abmeldung nur bis X Minuten VOR Terminbeginn möglich
 *   - 0 = genau zum Terminbeginn
 *
 * Rückzugs-Deadline = startTime + cancellationWindowMinutes Minuten
 *
 * @param {Object|null} event - Das Event-Objekt (optional). Wenn übergeben, wird
 *   ein event-spezifischer Wert bevorzugt.
 * @returns {number} Fenster in Minuten
 */
function getCancellationWindowMinutes(event) {
  // 1. Per-Event-Wert (explizit gesetzt, auch 0 ist gültig)
  if (event && typeof event.cancellationWindowMinutes === 'number') {
    return event.cancellationWindowMinutes;
  }
  // 2. Globale Einstellung
  if (typeof window.appSettings?.cancellationWindowMinutes === 'number') {
    return window.appSettings.cancellationWindowMinutes;
  }
  // 3. Standard
  return 60;
}

/**
 * Gibt zurück ob ein Termin noch im Rückzugsfenster liegt
 * (d.h. ob Abmelden / Absagen noch möglich ist).
 * @param {Date}        eventStartTime - Startzeit des Termins
 * @param {Object|null} event          - Das Event-Objekt (für per-Event-Konfiguration)
 * @returns {boolean} true wenn Abmelden noch möglich ist
 */
function isInCancellationWindow(eventStartTime, event) {
  if (!eventStartTime) return true; // kein Start → immer erlauben
  const windowMs  = getCancellationWindowMinutes(event) * 60 * 1000;
  const deadline  = new Date(eventStartTime.getTime() + windowMs);
  return Date.now() <= deadline.getTime();
}
