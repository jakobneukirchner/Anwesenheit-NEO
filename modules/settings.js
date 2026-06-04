// modules/settings.js
// Globale Einstellungen, Branding, Hilfsfunktionen für Fenster-Berechnungen

window.appSettings = {};
window.roleLabels  = {
  admin:       'Admin',
  coordinator: 'Koordinator',
  teacher:     'Trainer',
  member:      'Mitglied'
};

/* ─── Branding sofort beim Script-Load anwenden ─────────────────────────────── */
(async function applyBrandingEarly() {
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    if (doc.exists) _applyBrandingData(doc.data());
  } catch (e) {
    // Firestore-Regeln erlauben ggf. keinen anonymen Zugriff → still fail
  }
})();

/** Branding jederzeit erneut anwenden (z.B. nach Login) */
async function applyBranding() {
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    if (doc.exists) _applyBrandingData(doc.data());
  } catch (e) {
    // still
  }
}

/** Interne Hilfsfunktion: Branding-Daten in DOM + window.appSettings schreiben */
function _applyBrandingData(data) {
  // Alle Einstellungen in window.appSettings mergen
  window.appSettings = { ...window.appSettings, ...data };

  // Rollenbezeichnungen
  if (data.roleLabels) {
    window.roleLabels = { ...window.roleLabels, ...data.roleLabels };
  }

  // App-Titel
  if (data.brandingTitle) {
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = data.brandingTitle;
    document.title = data.brandingTitle;
  }

  // Logo
  if (data.logoUrl) {
    const logoEl = document.getElementById('app-logo');
    if (logoEl) logoEl.style.backgroundImage = `url('${data.logoUrl}')`;
  }

  // Favicon
  if (data.faviconUrl) {
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = data.faviconUrl;

    // PWA: Apple Touch Icon + Manifest-Icons dynamisch setzen
    let appleIcon = document.querySelector("link[rel='apple-touch-icon']");
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = data.faviconUrl;

    _patchManifest({
      icons: [
        { src: data.faviconUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: data.faviconUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    });

    // SW anweisen das Icon zu cachen
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_ICON',
        url: data.faviconUrl
      });
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   BESTÄTIGUNGSFENSTER

   Semantik:
     Positiver Wert  → Fenster endet X Min. NACH Terminbeginn
     Negativer Wert  → Fenster endet X Min. VOR  Terminbeginn
     0               → genau zum Terminbeginn

   Deadline = startTime + confirmationWindowMinutes * 60_000 ms
   Standard: 60 Minuten nach Terminbeginn
═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Gibt das konfigurierte Bestätigungs-Zeitfenster in Minuten zurück.
 * @returns {number}
 */
function getConfirmationWindowMinutes() {
  return window.appSettings?.confirmationWindowMinutes ?? 60;
}

/**
 * Gibt zurück, ob ein Termin noch im Bestätigungs-Zeitfenster liegt.
 * @param {Date} eventStartTime
 * @returns {boolean}
 */
function isInConfirmationWindow(eventStartTime) {
  if (!eventStartTime) return false;
  const windowMs = getConfirmationWindowMinutes() * 60_000;
  const deadline  = new Date(eventStartTime.getTime() + windowMs);
  return Date.now() <= deadline.getTime();
}

/* ═══════════════════════════════════════════════════════════════════════════════
   RÜCKZUGSFENSTER

   Semantik (gleich wie Bestätigungsfenster):
     Positiver Wert  → Abmeldung möglich bis X Min. NACH Terminbeginn
     Negativer Wert  → Abmeldung nur bis   X Min. VOR  Terminbeginn
     0               → genau zum Terminbeginn

   Priorität:
     1. event.cancellationWindowMinutes  (termin-individuell)
     2. appSettings.cancellationWindowMinutes  (global)
     3. Standard: 60
═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Gibt das Rückzugsfenster für einen Termin in Minuten zurück.
 * @param {Object|null} event – Das Event-Objekt (optional)
 * @returns {number}
 */
function getCancellationWindowMinutes(event) {
  // 1. Per-Event-Wert (auch 0 ist ein gültiger expliziter Wert)
  if (event && typeof event.cancellationWindowMinutes === 'number') {
    return event.cancellationWindowMinutes;
  }
  // 2. Globale Einstellung
  if (typeof window.appSettings?.cancellationWindowMinutes === 'number') {
    return window.appSettings.cancellationWindowMinutes;
  }
  // 3. Hardcoded Standard
  return 60;
}

/**
 * Gibt zurück, ob sich ein Mitglied noch von einem Termin abmelden kann.
 * @param {Date}        eventStartTime
 * @param {Object|null} event
 * @returns {boolean}
 */
function isInCancellationWindow(eventStartTime, event) {
  if (!eventStartTime) return true; // kein Startdatum → immer erlauben
  const windowMs = getCancellationWindowMinutes(event) * 60_000;
  const deadline  = new Date(eventStartTime.getTime() + windowMs);
  return Date.now() <= deadline.getTime();
}

/* ═══════════════════════════════════════════════════════════════════════════════
   VORAUSSCHAU-FENSTER

   Wie viele Tage in die Zukunft Mitglieder Termine sehen / sich anmelden können.
   Standard: 30 Tage
═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Gibt die konfigurierte Vorausschau in Tagen zurück.
 * @returns {number}
 */
function getEventLookAheadDays() {
  return window.appSettings?.defaultEventLookAhead ?? 30;
}

/**
 * Gibt das Enddatum der Vorausschau als Date-Objekt zurück.
 * @returns {Date}
 */
function getEventLookAheadDate() {
  const days = getEventLookAheadDays();
  return new Date(Date.now() + days * 24 * 60 * 60_000);
}
