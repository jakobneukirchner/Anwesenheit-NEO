// modules/trainer-dashboard.js
// Betreuer-Dashboard – sauber strukturiert
// Sektionen:
//   1. loadTrainerDashboard()        – Einstiegspunkt
//   2. renderTrainerEventCard()      – Termincard
//   3. _renderTrainerActions()       – Buttons pro Termin
//   4. _loadAttendanceSection()      – Anwesenheitsliste laden
//   5. _buildAttendanceRow()         – Einzelne Zeile
//   6. _getStatusInfo()             – Status → Icon/Farbe/Label
//   7. _fillAttendanceActions()      – Buttons pro Zeile
//   8. _showNoteModal()             – Notiz bearbeiten
//   9. _cancelTrainerSelf()          – Eigene Absage als Betreuer
//  10. _undoCancelTrainerSelf()      – Absage zurückziehen
//  11. _showBroadcastModal()         – Nachricht an Mitglieder
//  12. _showAddMemberModal()         – Mitglied zum Termin hinzufügen

/* ═══════════════════════════════════════════════════════════════════════════════
   1. EINSTIEGSPUNKT
═══════════════════════════════════════════════════════════════════════════════ */
async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Termine…</div>`;

  try {
    const uid = window.currentUser?.firebaseUser?.uid;
    if (!uid) throw new Error('Nicht eingeloggt.');

    // Einstellungen laden und global speichern
    const settingsDoc = await firestore.collection('settings').doc('global').get();
    window.appSettings = settingsDoc.exists ? settingsDoc.data() : {};

    // Vergangenheitsfenster: 90 Tage; Zukunftsfenster aus Einstellungen
    const lookAheadDays = window.appSettings.defaultEventLookAhead ?? 60;
    const now       = new Date();
    const past90    = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const futureEnd = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

    // Termine laden: als Betreuer zugewiesen ODER selbst abgesagt
    const [asTrainerSnap, cancelledSnap] = await Promise.all([
      firestore.collection('events').where('trainers',             'array-contains', uid).get(),
      firestore.collection('events').where('trainerCancellations', 'array-contains', uid).get()
    ]);

    const seen   = new Set();
    const events = [];
    const addEvent = doc => {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        events.push({ id: doc.id, ...doc.data() });
      }
    };
    asTrainerSnap.forEach(addEvent);
    cancelledSnap.forEach(addEvent);

    // Filtern: nur innerhalb des Fensters
    const filtered = events.filter(e => {
      const t = e.startTime?.toDate?.();
      return t && t >= past90 && t <= futureEnd;
    });

    filtered.sort((a, b) =>
      (b.startTime?.toMillis?.() || 0) - (a.startTime?.toMillis?.() || 0)
    );

    // Kommend: in der Zukunft; Vergangen: jetzt oder früher (inkl. laufende)
    const upcoming = filtered.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past     = filtered.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; });

    const tLabel = getRoleLabel('teacher');

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <h2 style="margin:0;">${tLabel}-Dashboard</h2>
      </div>
      <div class="tabs">
        <button class="tab-btn active" data-tab="upcoming">Kommende Termine (${upcoming.length})</button>
        <button class="tab-btn"        data-tab="past">Vergangene &amp; laufende Termine (${past.length})</button>
      </div>
      <div id="tr-tab-upcoming"></div>
      <div id="tr-tab-past" hidden></div>
    `;

    // Tab-Umschaltung
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tr-tab-upcoming').hidden = btn.dataset.tab !== 'upcoming';
        document.getElementById('tr-tab-past').hidden     = btn.dataset.tab !== 'past';
      };
    });

    const upEl = document.getElementById('tr-tab-upcoming');
    const paEl = document.getElementById('tr-tab-past');

    if (!upcoming.length) {
      upEl.innerHTML = '<p class="text-muted" style="margin-top:12px;">Keine kommenden Termine.</p>';
    } else {
      upcoming.forEach(ev => upEl.appendChild(renderTrainerEventCard(ev, uid, false)));
    }

    if (!past.length) {
      paEl.innerHTML = '<p class="text-muted" style="margin-top:12px;">Keine vergangenen Termine.</p>';
    } else {
      past.forEach(ev => paEl.appendChild(renderTrainerEventCard(ev, uid, true)));
    }

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden: ' + e.message + '</p>';
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   2. TERMINCARD
═══════════════════════════════════════════════════════════════════════════════ */
function renderTrainerEventCard(event, trainerUid, isPast) {
  const settings = window.appSettings || {};
  const start    = event.startTime?.toDate?.();
  const end      = event.endTime?.toDate?.();

  const isCancelled  = event.status === 'cancelled';
  const isSkipped    = event.status === 'skipped';
  const ownCancelled = (event.trainerCancellations || []).includes(trainerUid);

  const card = createElement('div', 'card');
  card.style.marginBottom = '14px';

  /* ── Abgesagt ─────────────────────────────────────────────────────────────── */
  if (isCancelled) {
    card.style.opacity    = '0.72';
    card.style.borderLeft = '4px solid var(--color-error)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0 0 2px;text-decoration:line-through;color:var(--color-text-muted);">
            ${event.title || 'Termin'}
          </h3>
          <p class="text-muted" style="margin:0;font-size:0.88rem;">
            ${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}
          </p>
        </div>
        <span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:14px;">cancel</span> Abgesagt
        </span>
      </div>`;
    return card;
  }

  /* ── Ausgefallen ──────────────────────────────────────────────────────────── */
  if (isSkipped) {
    card.style.opacity    = '0.75';
    card.style.borderLeft = '4px solid var(--color-warning)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0 0 2px;text-decoration:line-through;color:var(--color-text-muted);">
            ${event.title || 'Termin'}
          </h3>
          <p class="text-muted" style="margin:0;font-size:0.88rem;">
            ${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}
          </p>
        </div>
        <span class="chip chip-warning" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:14px;">event_busy</span> Ausgefallen
        </span>
      </div>
      ${event.skipReason
        ? `<p class="text-muted" style="margin:8px 0 0;font-size:0.88rem;">Grund: ${event.skipReason}</p>`
        : ''}`;
    return card;
  }

  /* ── Normaler Termin ──────────────────────────────────────────────────────── */
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
      <div>
        <h3 style="margin:0 0 2px;">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">
          ${start ? formatDateTime(start) : '–'}${end ? ' – ' + formatTime(end) : ''}
          ${event.location
            ? ` &nbsp;·&nbsp; <span class="material-icons" style="font-size:13px;vertical-align:middle;">place</span> ${event.location}`
            : ''}
        </p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        ${ownCancelled
          ? `<span class="chip chip-error" style="font-size:0.8rem;">Du hast diesen Termin abgesagt</span>`
          : ''}
        ${event.recurrenceId
          ? `<span class="chip" style="font-size:0.78rem;padding:2px 6px;">Reihe</span>`
          : ''}
      </div>
    </div>
    <div id="tr-actions-${event.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;"></div>
    <div id="tr-attendance-${event.id}"></div>`;

  _renderTrainerActions(card, event, trainerUid, isPast, settings);
  _loadAttendanceSection(card, event, isPast);

  return card;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   3. AKTIONS-BUTTONS (Betreuer-eigene)
═══════════════════════════════════════════════════════════════════════════════ */
function _renderTrainerActions(card, event, trainerUid, isPast, settings) {
  const actionsEl    = card.querySelector(`#tr-actions-${event.id}`);
  if (!actionsEl) return;
  const ownCancelled = (event.trainerCancellations || []).includes(trainerUid);

  /* 1. Eigene Absage als Betreuer */
  if (!isPast) {
    if (!ownCancelled) {
      const btn = _makeBtn('btn-secondary', 'person_off', `Als ${getRoleLabel('teacher')} abmelden`,
        () => _cancelTrainerSelf(event, trainerUid, card));
      actionsEl.appendChild(btn);
    } else {
      const btn = _makeBtn('btn-secondary', 'undo', 'Abmeldung zurückziehen',
        () => _undoCancelTrainerSelf(event, trainerUid, card));
      actionsEl.appendChild(btn);
    }
  }

  /* 2. Nachricht an Mitglieder */
  if (!isPast) {
    const btn = _makeBtn('btn-secondary', 'campaign', 'Nachricht',
      () => _showBroadcastModal(event));
    actionsEl.appendChild(btn);
  }

  /* 3. Mitglied hinzufügen (auch außerhalb Gruppe) */
  const addBtn = _makeBtn('btn-secondary', 'person_add',
    `${getRoleLabel('member')} hinzufügen`,
    () => _showAddMemberModal(event, card));
  actionsEl.appendChild(addBtn);
}

/** Hilfsfunktion: erzeuge einen Button mit Icon */
function _makeBtn(cls, icon, label, onClick) {
  const btn = createElement('button', cls);
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 14px;';
  btn.innerHTML = `<span class="material-icons" style="font-size:15px;">${icon}</span>${label}`;
  btn.onclick   = onClick;
  return btn;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   4. ANWESENHEITSLISTE LADEN
═══════════════════════════════════════════════════════════════════════════════ */
async function _loadAttendanceSection(card, event, isPast) {
  const attEl = card.querySelector(`#tr-attendance-${event.id}`);
  if (!attEl) return;
  attEl.innerHTML = `<div class="text-muted" style="font-size:0.85rem;">Lade Teilnehmer…</div>`;

  try {
    const settings  = window.appSettings || {};
    const mLabel    = getRoleLabel('member');

    const attSnap = await firestore.collection('eventAttendance')
      .where('eventId', '==', event.id).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    // Alle betroffenen UIDs auflösen (Anmeldungen + directMembers)
    const uidSet = new Set(attendances.map(a => a.userId));
    (event.directMembers || []).forEach(uid => uidSet.add(uid));

    const userMap = {};
    await Promise.all([...uidSet].map(async uid => {
      const uDoc = await firestore.collection('users').doc(uid).get();
      userMap[uid] = uDoc.exists
        ? (uDoc.data().displayName || uDoc.data().email || uid)
        : uid;
    }));

    if (!attendances.length) {
      attEl.innerHTML = `<p class="text-muted" style="font-size:0.85rem;margin:6px 0 0;">Noch keine ${mLabel} angemeldet.</p>`;
      return;
    }

    attEl.innerHTML = `
      <div style="border-top:1px solid var(--color-border);padding-top:10px;margin-top:4px;">
        <p style="font-size:0.85rem;font-weight:600;margin:0 0 8px;color:var(--color-text-muted);">
          ${mLabel} (${attendances.length})
        </p>
        <div id="att-list-${event.id}" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>`;

    const listEl = attEl.querySelector(`#att-list-${event.id}`);
    attendances.forEach(att => {
      const row = _buildAttendanceRow(
        att, userMap[att.userId] || att.userId, event, isPast, settings, listEl
      );
      listEl.appendChild(row);
    });

  } catch (e) {
    console.error(e);
    if (attEl) attEl.innerHTML = `<p class="text-error" style="font-size:0.85rem;">Fehler: ${e.message}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   5. EINE ANWESENHEITSZEILE
═══════════════════════════════════════════════════════════════════════════════ */
function _buildAttendanceRow(att, userName, event, isPast, settings, listEl) {
  const row = createElement('div', '');
  row.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:space-between',
    'flex-wrap:wrap', 'gap:6px', 'padding:6px 10px',
    'background:var(--color-surface-offset)', 'border-radius:6px'
  ].join(';');

  const si = _getStatusInfo(att.status);

  row.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;min-width:0;">
      <span class="material-icons" style="font-size:18px;color:${si.color};flex-shrink:0;">${si.icon}</span>
      <div style="min-width:0;">
        <div style="font-weight:500;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userName}</div>
        <div style="font-size:0.78rem;color:var(--color-text-muted);">
          ${si.label}${att.memberNote ? ' · ' + att.memberNote : ''}
        </div>
      </div>
    </div>
    <div id="att-actions-${att.id}" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"></div>`;

  _fillAttendanceActions(row, att, event, isPast, settings, listEl, userName);
  return row;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   6. STATUS → ICON / FARBE / LABEL
═══════════════════════════════════════════════════════════════════════════════ */
function _getStatusInfo(status) {
  const map = {
    registered:           { label: 'Angemeldet',             icon: 'check_circle',         color: 'var(--color-primary)' },
    present:              { label: 'Anwesend',                icon: 'done_all',             color: 'var(--color-success)' },
    absent_excused:       { label: 'Entsch. gefehlt',         icon: 'event_busy',           color: 'var(--color-warning)' },
    absent_unexcused:     { label: 'Unentsch. gefehlt',       icon: 'cancel',               color: 'var(--color-error)'   },
    late_excused:         { label: 'Verspätet (entsch.)',     icon: 'schedule',             color: 'var(--color-warning)' },
    late_unexcused:       { label: 'Verspätet (unentsch.)',   icon: 'schedule',             color: 'var(--color-warning)' },
    cancelled:            { label: 'Termin abgesagt',         icon: 'person_off',           color: 'var(--color-text-muted)' },
    confirmation_pending: { label: '⏳ Ausstehend',           icon: 'hourglass_empty',      color: 'var(--color-gold, #d19900)' },
    none:                 { label: 'Kein Status',             icon: 'radio_button_unchecked', color: 'var(--color-text-faint)' }
  };
  return map[status] || { label: status, icon: 'help_outline', color: 'var(--color-text-muted)' };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   7. AKTIONS-BUTTONS PRO ANWESENHEITSZEILE
═══════════════════════════════════════════════════════════════════════════════ */
function _fillAttendanceActions(row, att, event, isPast, settings, listEl, userName) {
  const actEl = row.querySelector(`#att-actions-${att.id}`);
  if (!actEl) return;

  /** Erstellt einen kleinen Status-Button */
  const makeStatusBtn = (label, icon, targetStatus, btnClass) => {
    const btn = createElement('button', btnClass || 'btn-secondary');
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:3px 10px;font-size:0.8rem;';
    btn.innerHTML     = `<span class="material-icons" style="font-size:13px;">${icon}</span>${label}`;
    btn.disabled      = att.status === targetStatus;
    btn.onclick       = async () => {
      try {
        await firestore.collection('eventAttendance').doc(att.id).update({
          status:       targetStatus,
          trainerSet:   true,
          trainerSetAt: new Date()
        });
        att.status = targetStatus;
        row.replaceWith(_buildAttendanceRow(att, userName, event, isPast, settings, listEl));
        showToast('Status gespeichert.', 'success');
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
      }
    };
    return btn;
  };

  /* ── Vergangener Termin: volle Statuspalette ── */
  if (isPast) {
    actEl.appendChild(makeStatusBtn('Anwesend',          'done_all',   'present',          'btn-primary'));
    actEl.appendChild(makeStatusBtn('Entsch.',            'event_busy', 'absent_excused',   'btn-secondary'));
    actEl.appendChild(makeStatusBtn('Unentsch.',          'cancel',     'absent_unexcused', 'btn-danger'));
    actEl.appendChild(makeStatusBtn('Verspätet (E)',      'schedule',   'late_excused',     'btn-secondary'));

  } else {
    /* ── Kommender Termin: Termin absagen ── */
    if (att.status !== 'cancelled') {
      const cancelBtn = createElement('button', 'btn-secondary');
      cancelBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:3px 10px;font-size:0.8rem;';
      cancelBtn.innerHTML     = `<span class="material-icons" style="font-size:13px;">person_off</span> Termin absagen`;
      cancelBtn.onclick       = async () => {
        try {
          await firestore.collection('eventAttendance').doc(att.id).update({
            status:       'cancelled',
            trainerSet:   true,
            trainerSetAt: new Date()
          });
          att.status = 'cancelled';
          row.replaceWith(_buildAttendanceRow(att, userName, event, isPast, settings, listEl));
          showToast('Termin für Mitglied abgesagt.', 'success');
        } catch (e) {
          showToast('Fehler: ' + e.message, 'error');
        }
      };
      actEl.appendChild(cancelBtn);
    }
  }

  /* ── Notiz-Button (immer sichtbar) ── */
  const noteBtn = createElement('button', 'btn-text');
  noteBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:3px 8px;font-size:0.8rem;';
  noteBtn.innerHTML     = `<span class="material-icons" style="font-size:13px;">edit_note</span>`;
  noteBtn.title         = 'Notiz bearbeiten';
  noteBtn.onclick       = () => _showNoteModal(att, userName, row, event, isPast, settings, listEl);
  actEl.appendChild(noteBtn);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   8. NOTIZ-MODAL
═══════════════════════════════════════════════════════════════════════════════ */
function _showNoteModal(att, userName, row, event, isPast, settings, listEl) {
  showModal({
    title: `Notiz – ${userName}`,
    body: `
      <label>Interne Notiz (für ${getRoleLabel('teacher')})</label>
      <textarea id="note-trainer" rows="2" style="width:100%;">${att.trainerNoteInternal || ''}</textarea>
      <label style="margin-top:8px;">Notiz für ${getRoleLabel('member')}</label>
      <textarea id="note-member" rows="2" style="width:100%;">${att.trainerNoteMember || ''}</textarea>`,
    confirmLabel: 'Speichern',
    onConfirm: async () => {
      const internal = document.getElementById('note-trainer').value.trim();
      const member   = document.getElementById('note-member').value.trim();
      try {
        await firestore.collection('eventAttendance').doc(att.id).update({
          trainerNoteInternal: internal,
          trainerNoteMember:   member
        });
        att.trainerNoteInternal = internal;
        att.trainerNoteMember   = member;
        row.replaceWith(_buildAttendanceRow(att, userName, event, isPast, settings, listEl));
        showToast('Notiz gespeichert.', 'success');
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   9. EIGENE TRAINER-ABSAGE
═══════════════════════════════════════════════════════════════════════════════ */
async function _cancelTrainerSelf(event, trainerUid, card) {
  showModal({
    title: `Als ${getRoleLabel('teacher')} abmelden`,
    body: `<p>Möchtest du dich für den Termin <strong>${event.title}</strong> als ${getRoleLabel('teacher')} abmelden?</p>`,
    confirmLabel: 'Abmelden',
    onConfirm: async () => {
      try {
        await firestore.collection('events').doc(event.id).update({
          trainerCancellations: firebase.firestore.FieldValue.arrayUnion(trainerUid)
        });
        showToast('Du wurdest als Betreuer abgemeldet.', 'success');
        loadTrainerDashboard();
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   10. ABSAGE ZURÜCKZIEHEN
═══════════════════════════════════════════════════════════════════════════════ */
async function _undoCancelTrainerSelf(event, trainerUid, card) {
  try {
    await firestore.collection('events').doc(event.id).update({
      trainerCancellations: firebase.firestore.FieldValue.arrayRemove(trainerUid)
    });
    showToast('Abmeldung zurückgezogen.', 'success');
    loadTrainerDashboard();
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   11. BROADCAST-NACHRICHT AN MITGLIEDER
═══════════════════════════════════════════════════════════════════════════════ */
function _showBroadcastModal(event) {
  showModal({
    title: `Nachricht an ${getRoleLabel('member')}`,
    body: `
      <p class="text-muted" style="font-size:0.88rem;margin-top:0;">
        Diese Nachricht wird allen ${getRoleLabel('member')}n in ihrer Terminansicht angezeigt.
      </p>
      <label>Nachricht</label>
      <textarea id="broadcast-msg" rows="3" style="width:100%;">${event.trainerBroadcast || ''}</textarea>`,
    confirmLabel: 'Speichern',
    onConfirm: async () => {
      const msg = document.getElementById('broadcast-msg').value.trim();
      try {
        await firestore.collection('events').doc(event.id).update({
          trainerBroadcast: msg || firebase.firestore.FieldValue.delete()
        });
        showToast('Nachricht gespeichert.', 'success');
        loadTrainerDashboard();
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   12. MITGLIED HINZUFÜGEN (auch außerhalb Gruppe)
═══════════════════════════════════════════════════════════════════════════════ */
async function _showAddMemberModal(event, card) {
  const mLabel = getRoleLabel('member');

  // Bereits angemeldete UIDs ermitteln
  const attSnap = await firestore.collection('eventAttendance')
    .where('eventId', '==', event.id).get();
  const registeredUids = new Set();
  attSnap.forEach(doc => registeredUids.add(doc.data().userId));

  // Alle Benutzer laden
  const uSnap = await firestore.collection('users').orderBy('displayName').get();
  const allUsers = [];
  uSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));

  // Nur Mitglieder, die noch nicht angemeldet sind
  const available = allUsers.filter(u =>
    (u.roles || []).includes('member') && !registeredUids.has(u.id)
  );

  if (!available.length) {
    showToast(`Alle ${mLabel} sind bereits angemeldet.`, 'info');
    return;
  }

  showModal({
    title: `${mLabel} zum Termin hinzufügen`,
    body: `
      <p class="text-muted" style="font-size:0.88rem;margin-top:0;">
        Wähle ${mLabel} aus – auch wenn sie nicht in der zugehörigen Gruppe sind.
      </p>
      <input type="search" id="add-member-search"
        placeholder="${mLabel} suchen…"
        style="width:100%;margin-bottom:10px;" />
      <div id="add-member-list"
        style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
        ${available.map(u => `
          <label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;background:var(--color-surface-offset);">
            <input type="checkbox" name="add-member" value="${u.id}" />
            <div>
              <div style="font-weight:500;font-size:0.88rem;">${u.displayName || '(kein Name)'}</div>
              <div style="font-size:0.78rem;color:var(--color-text-muted);">${u.email || ''}</div>
            </div>
          </label>`).join('')}
      </div>`,
    confirmLabel: 'Hinzufügen',
    onConfirm: async () => {
      const selected = [...document.querySelectorAll('input[name="add-member"]:checked')]
        .map(i => i.value);
      if (!selected.length) {
        showToast('Bitte mindestens ein Mitglied wählen.', 'error');
        return false;
      }

      try {
        const settings    = window.appSettings || {};
        const defaultMode = event.mode || settings.defaultMode || 'opt_in';
        const initStatus  =
          defaultMode === 'opt_out'      ? 'registered'
          : defaultMode === 'confirmation' ? 'confirmation_pending'
          : 'registered';

        const batch = firestore.batch();
        selected.forEach(uid => {
          const attRef   = firestore.collection('eventAttendance').doc();
          const eventRef = firestore.collection('events').doc(event.id);
          batch.set(attRef, {
            eventId:           event.id,
            userId:            uid,
            status:            initStatus,
            addedByTrainer:    true,
            addedAt:           new Date(),
            firstRegisteredAt: new Date()
          });
          batch.update(eventRef, {
            directMembers: firebase.firestore.FieldValue.arrayUnion(uid)
          });
        });
        await batch.commit();
        showToast(`${selected.length} ${mLabel} hinzugefügt.`, 'success');
        _loadAttendanceSection(card, event, false);
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });

  // Such-Filter aktivieren (kurz warten bis Modal im DOM)
  setTimeout(() => {
    const searchEl = document.getElementById('add-member-search');
    const listEl   = document.getElementById('add-member-list');
    if (!searchEl || !listEl) return;
    searchEl.oninput = () => {
      const q = searchEl.value.toLowerCase();
      listEl.querySelectorAll('label').forEach(lbl => {
        lbl.style.display = lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
    searchEl.focus();
  }, 80);
}
