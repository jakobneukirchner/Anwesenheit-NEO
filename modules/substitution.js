// modules/substitution.js
// Vertretungsanfragen – Koordinator-Button + Modal + Anfrage senden

/**
 * Öffnet das Modal zum Senden einer Vertretungsanfrage für einen Termin.
 * Wird aus coordinator-dashboard.js aufgerufen.
 * @param {Object} ev – Event-Objekt aus Firestore
 */
async function openSubstitutionRequestModal(ev) {
  const coordinatorUid  = window.currentUser?.firebaseUser?.uid;
  const coordinatorName = window.currentUser?.profile?.displayName || 'Koordinator';
  const coordinatorRoles = window.currentUser?.profile?.roles || [];

  if (!coordinatorUid) {
    showToast('Nicht angemeldet.', 'error');
    return;
  }

  const roleLabel = coordinatorRoles.length
    ? coordinatorRoles.map(r => getRoleLabel(r)).join(', ')
    : 'Koordinator';
  const requesterLabel = `${coordinatorName} (${roleLabel})`;

  const allTrainers = window._allTrainers || [];
  if (!allTrainers.length) {
    showToast('Keine Trainer gefunden.', 'error');
    return;
  }

  const startDate = ev.startTime?.toDate ? ev.startTime.toDate() : new Date(ev.startTime);
  const dateStr   = formatDateTime(startDate);

  let existingPending = [];
  try {
    const snap = await firestore.collection('substitution_requests')
      .where('eventId', '==', ev.id)
      .where('status', '==', 'pending')
      .get();
    snap.forEach(doc => existingPending.push(doc.data().requestedTo));
  } catch (e) {
    console.warn('Konnte bestehende Anfragen nicht prüfen:', e);
  }

  const trainerOptions = allTrainers.map(t => {
    const isPending = existingPending.includes(t.id);
    return `<option value="${t.id}" ${isPending ? 'disabled' : ''}>
      ${escapeHtml(t.displayName || t.email)}${isPending ? ' (Anfrage läuft)' : ''}
    </option>`;
  }).join('');

  const assignedTrainers = ev.trainers || ev.trainer || [];
  const assignedNames = allTrainers
    .filter(t => assignedTrainers.includes(t.id))
    .map(t => t.displayName || t.email);

  showModal({
    title: 'Vertretung anfragen',
    body: `
      <div style="background:var(--color-surface-offset);border-radius:var(--radius-small,6px);padding:10px 12px;margin-bottom:14px;font-size:0.88rem;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span class="material-icons" style="font-size:16px;color:var(--color-primary);">event</span>
          <strong>${escapeHtml(ev.title || '(kein Titel)')}</strong>
        </div>
        <div style="color:var(--color-text-muted);">${dateStr}</div>
        ${assignedNames.length
          ? `<div style="margin-top:4px;">Aktuell eingetragen: ${assignedNames.map(n => `<span class="chip" style="font-size:0.75rem;">${escapeHtml(n)}</span>`).join(' ')}</div>`
          : '<div style="margin-top:4px;color:var(--color-warning,#f57c00);font-size:0.82rem;"><span class="material-icons" style="font-size:13px;vertical-align:middle;">warning</span> Kein Betreuer eingetragen</div>'}
      </div>

      <label>Trainer anfragen <span style="color:var(--color-error);">*</span></label>
      <select id="sub-trainer-select" style="width:100%;">
        <option value="">– Trainer auswählen –</option>
        ${trainerOptions}
      </select>

      <label style="margin-top:12px;">Notiz (optional)</label>
      <textarea id="sub-note" rows="3" placeholder="z.B. Bitte melde dich bis Donnerstag zurück…" style="width:100%;resize:vertical;"></textarea>
    `,
    confirmLabel: 'Anfrage senden',
    onConfirm: async () => {
      const trainerId = document.getElementById('sub-trainer-select').value;
      const note      = document.getElementById('sub-note').value.trim();

      if (!trainerId) {
        showToast('Bitte einen Trainer auswählen.', 'error');
        return false;
      }

      const trainer = allTrainers.find(t => t.id === trainerId);
      if (!trainer) {
        showToast('Trainer nicht gefunden.', 'error');
        return false;
      }

      if (existingPending.includes(trainerId)) {
        showToast('An diesen Trainer läuft bereits eine Anfrage.', 'error');
        return false;
      }

      try {
        await firestore.collection('substitution_requests').add({
          eventId:           ev.id,
          eventTitle:        ev.title || '',
          eventDate:         ev.startTime,
          groupId:           ev.groupId || null,
          groupName:         (window._allGroups || []).find(g => g.id === ev.groupId)?.name || '',
          requestedTo:       trainerId,
          requestedToName:   trainer.displayName || trainer.email || '',
          requestedBy:       coordinatorUid,
          requestedByName:   requesterLabel,
          status:            'pending',
          note:              note || '',
          createdAt:         firebase.firestore.FieldValue.serverTimestamp()
        });

        // _createSubstitutionSystemMessage ist in system-messages.js definiert
        await _createSubstitutionSystemMessage(ev, trainer, requesterLabel);

        const trainerName = trainer.displayName || trainer.email || 'Trainer';
        const eventDateLabel = dateStr || '';
        await sendEventNotification({
          recipientUid: trainerId,
          eventId:      ev.id,
          eventTitle:   ev.title || '(kein Titel)',
          type:         'substitution_request',
          message:      `Du wurdest als Vertretung für „${ev.title || 'einen Termin'}" (${eventDateLabel}) angefragt.`,
          _meta: {
            requestedByName: requesterLabel,
            requestedByUid:  coordinatorUid,
            trainerName,
            note: note || '',
          },
        });

        showToast(`Anfrage an ${trainerName} gesendet.`, 'success');
      } catch (e) {
        console.error('Substitution speichern fehlgeschlagen:', e);
        showToast('Fehler beim Senden: ' + e.message, 'error');
        return false;
      }
    }
  });
}

/**
 * Zieht alle pending Vertretungsanfragen für einen Termin zurück.
 * Setzt status → 'withdrawn' und benachrichtigt die betroffenen Trainer.
 * @param {string} eventId
 * @param {string} eventTitle
 * @param {Function} onSuccess – Callback nach erfolgreichem Zurückziehen
 */
async function withdrawSubstitutionRequests(eventId, eventTitle, onSuccess) {
  showModal({
    title: 'Anfragen zurückziehen',
    body: `
      <p>Alle offenen Vertretungsanfragen für <strong>${escapeHtml(eventTitle || 'diesen Termin')}</strong> zurückziehen?</p>
      <p class="text-muted" style="font-size:0.88rem;margin-top:8px;">Die angefragten Betreuer werden benachrichtigt, dass die Anfrage zurückgezogen wurde.</p>
    `,
    confirmLabel: 'Zurückziehen',
    onConfirm: async () => {
      try {
        const snap = await firestore.collection('substitution_requests')
          .where('eventId', '==', eventId)
          .where('status', '==', 'pending')
          .get();

        if (snap.empty) {
          showToast('Keine offenen Anfragen gefunden.', 'info');
          return;
        }

        const batch = firestore.batch();
        const affectedTrainers = [];

        snap.forEach(doc => {
          batch.update(doc.ref, {
            status:      'withdrawn',
            withdrawnAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          const data = doc.data();
          if (data.requestedTo) {
            affectedTrainers.push({ uid: data.requestedTo, name: data.requestedToName || '' });
          }
        });

        await batch.commit();

        // Benachrichtigung an alle betroffenen Trainer
        const notifyPromises = affectedTrainers.map(({ uid, name }) => {
          if (typeof sendEventNotification !== 'function') return Promise.resolve();
          return sendEventNotification({
            recipientUid: uid,
            eventId:      eventId,
            eventTitle:   eventTitle || 'Termin',
            type:         'substitution_withdrawn',
            message:      `Die Vertretungsanfrage für „${eventTitle || 'Termin'}" wurde zurückgezogen.`,
            _meta: { trainerName: name },
          }).catch(e => console.warn('Benachrichtigung fehlgeschlagen für', uid, e));
        });

        await Promise.all(notifyPromises);

        showToast('Anfragen zurückgezogen.', 'success');
        if (typeof onSuccess === 'function') onSuccess();
      } catch (e) {
        console.error('withdrawSubstitutionRequests fehlgeschlagen:', e);
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });
}
