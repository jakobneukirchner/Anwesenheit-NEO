// modules/event-notifications.js

/**
 * Sendet eine Ereignis-Benachrichtigung an alle Mitglieder eines Events.
 * Schreibt einen Eintrag in die Firestore-Collection 'eventNotifications'.
 *
 * @param {string} eventId   - ID des betroffenen Termins
 * @param {string} type      - Typ der Benachrichtigung, z.B. 'substitution_sent', 'substitution_accepted', 'substitution_declined'
 * @param {object} payload   - Zusätzliche Daten (z.B. { requestedToName, requestedByName, note })
 */
async function sendEventNotification(eventId, type, payload = {}) {
  try {
    if (!eventId || !type) return;
    await firestore.collection('eventNotifications').add({
      eventId,
      type,
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      read: false
    });
  } catch (e) {
    console.warn('sendEventNotification fehlgeschlagen:', e);
  }
}
