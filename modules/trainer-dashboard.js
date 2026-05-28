// modules/trainer-dashboard.js
// Betreuer-Dashboard: Terminansicht + Anwesenheitserfassung

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Termine...</div>`;

  try {
    const uid          = window.currentUser?.firebaseUser?.uid;
    const settingsDoc  = await firestore.collection('settings').doc('global').get();
    const settings     = settingsDoc.exists ? settingsDoc.data() : {};
    window.appSettings = settings;

    const tLabel = getRoleLabel('teacher');
    const mLabel = getRoleLabel('member');

    // Alle Termine laden, bei denen dieser Betreuer zugewiesen ist
    const [asTrainerSnap, cancelledSnap] = await Promise.all([
      firestore.collection('events').where('trainers',             'array-contains', uid).get(),
      firestore.collection('events').where('trainerCancellations', 'array-contains', uid).get()
    ]);

    const seen   = new Set();
    const events = [];
    const add = doc => {
      if (!seen.has(doc.id)) { seen.add(doc.id); events.push({ id: doc.id, ...doc.data() }); }
    };
    asTrainerSnap.forEach(add);
    cancelledSnap.forEach(add);

    const now      = new Date();
    const past90   = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const future60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const filtered = events.filter(e => {
      const t = e.startTime?.toDate?.();
      return t && t >= past90 && t <= future60;
    });

    filtered.sort((a, b) => (b.startTime?.toMillis?.() || 0) - (a.startTime?.toMillis?.() || 0));

    const upcoming = filtered.filter(e => { const t = e.startTime?.toDate?.(); return t && t >  now; });
    const past     = filtered.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; });

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <h2 style="margin:0;">${tLabel}-Dashboard</h2>
      </div>
      <div class="tabs">
        <button class="tab-btn active" data-tab="upcoming">Kommende Termine (${upcoming.length})</button>
        <button class="tab-btn"        data-tab="past">Vergangene Termine (${past.length})</button>
      </div>
      <div id="tr-tab-upcoming"></div>
      <div id="tr-tab-past" hidden></div>
    `;

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

    if (!upcoming.length) upEl.innerHTML = '<p class="text-muted" style="margin-top:12px;">Keine kommenden Termine.</p>';
    else upcoming.forEach(ev => upEl.appendChild(renderTrainerEventCard(ev, uid, false)));

    if (!past.length) paEl.innerHTML = '<p class="text-muted" style="margin-top:12px;">Keine vergangenen Termine.</p>';
    else past.forEach(ev => paEl.appendChild(renderTrainerEventCard(ev, uid, true)));

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden: ' + e.message + '</p>';
  }
}

/* ─── Termincard in der Betreueransicht ─────────────────────────────────────── */
function renderTrainerEventCard(event, trainerUid, isPast) {
  const settings  = window.appSettings || {};
  const mLabel    = getRoleLabel('member');

  const start = event.startTime?.toDate?.();
  const end   = event.endTime?.toDate?.();
  const now   = new Date();

  const isCancelled = event.status === 'cancelled';
  const isSkipped   = event.status === 'skipped';
  const ownCancelled = (event.trainerCancellations || []).includes(trainerUid);

  const card = createElement('div', 'card');
  card.style.marginBottom = '14px';

  // ── Abgesagt ──────────────────────────────────────────────────────────────
  if (isCancelled) {
    card.style.opacity    = '0.72';
    card.style.borderLeft = '4px solid var(--color-error, #c62828)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0 0 2px;text-decoration:line-through;color:var(--color-text-muted);">${event.title || 'Termin'}</h3>
          <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
        </div>
        <span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:14px;">cancel</span> Abgesagt
        </span>
      </div>`;
    return card;
  }

  // ── Ausgefallen ───────────────────────────────────────────────────────────
  if (isSkipped) {
    card.style.opacity    = '0.75';
    card.style.borderLeft = '4px solid var(--color-warning, #e65100)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0 0 2px;text-decoration:line-through;color:var(--color-text-muted);">${event.title || 'Termin'}</h3>
          <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
        </div>
        <span class="chip chip-warning" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:14px;">event_busy</span> Ausgefallen
        </span>
      </div>
      ${event.skipReason ? `<p class="text-muted" style="margin:8px 0 0;font-size:0.88rem;">Grund: ${event.skipReason}</p>` : ''}`;
    return card;
  }

  // ── Normaler Termin ────────────────────────────────────────────────────────
  const headerHtml = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
      <div>
        <h3 style="margin:0 0 2px;">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">
          ${start ? formatDateTime(start) : '–'}${end ? ' – ' + formatTime(end) : ''}
          ${event.location ? ` &nbsp;·&nbsp; <span class="material-icons" style="font-size:13px;vertical-align:middle;">place</span> ${event.location}` : ''}
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
    </div>`;

  card.innerHTML = headerHtml + `
    <div id="tr-actions-${event.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
    </div>
    <div id="tr-attendance-${event.id}"></div>`;

  // Actions-Bereich füllen
  _renderTrainerActions(card, event, trainerUid, isPast, settings);
  // Anwesenheitsliste laden
  _loadAttendanceSection(card, event, isPast);

  return card;
}

/* ─── Actions (Betreuer-eigene Buttons) ─────────────────────────────────────── */
function _renderTrainerActions(card, event, trainerUid, isPast, settings) {
  const actionsEl   = card.querySelector(`#tr-actions-${event.id}`);
  if (!actionsEl) return;

  const ownCancelled = (event.trainerCancellations || []).includes(trainerUid);

  // 1) Eigene Abwesenheit als Betreuer
  if (!isPast) {
    if (!ownCancelled) {
      const cancelSelfBtn = createElement('button', 'btn-secondary');
      cancelSelfBtn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 14px;';
      cancelSelfBtn.innerHTML = `<span class="material-icons" style="font-size:15px;">person_off</span> Als ${getRoleLabel('teacher')} abmelden`;
      cancelSelfBtn.onclick   = () => _cancelTrainerSelf(event, trainerUid, card);
      actionsEl.appendChild(cancelSelfBtn);
    } else {
      const undoCancelBtn = createElement('button', 'btn-secondary');
      undoCancelBtn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 14px;';
      undoCancelBtn.innerHTML = `<span class="material-icons" style="font-size:15px;">undo</span> Abmeldung zurückziehen`;
      undoCancelBtn.onclick   = () => _undoCancelTrainerSelf(event, trainerUid, card);
      actionsEl.appendChild(undoCancelBtn);
    }
  }

  // 2) Nachricht an Mitglieder
  if (!isPast) {
    const broadcastBtn = createElement('button', 'btn-secondary');
    broadcastBtn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 14px;';
    broadcastBtn.innerHTML = `<span class="material-icons" style="font-size:15px;">campaign</span> Nachricht`;
    broadcastBtn.onclick   = () => _showBroadcastModal(event);
    actionsEl.appendChild(broadcastBtn);
  }

  // 3) Mitglied zum Termin hinzufügen (auch außerhalb Gruppe)
  const addMemberBtn = createElement('button', 'btn-secondary');
  addMemberBtn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 14px;';
  addMemberBtn.innerHTML = `<span class="material-icons" style="font-size:15px;">person_add</span> ${getRoleLabel('member')} hinzufügen`;
  addMemberBtn.onclick   = () => _showAddMemberModal(event, card);
  actionsEl.appendChild(addMemberBtn);
}

/* ─── Anwesenheitsliste laden & rendern ─────────────────────────────────────── */
async function _loadAttendanceSection(card, event, isPast) {
  const attEl = card.querySelector(`#tr-attendance-${event.id}`);
  if (!attEl) return;
  attEl.innerHTML = `<div class="text-muted" style="font-size:0.85rem;">Lade Teilnehmer…</div>`;

  try {
    const settings = window.appSettings || {};
    const mLabel   = getRoleLabel('member');

    // Alle Anmeldungen für diesen Termin
    const attSnap = await firestore.collection('eventAttendance')
      .where('eventId', '==', event.id).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    // Nutzer-Namen auflösen
    const uidSet = new Set(attendances.map(a => a.userId));
    // directMembers ebenfalls laden
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
        <p style="font-size:0.85rem;font-weight:600;margin:0 0 8px;color:var(--color-text-muted);">${mLabel} (${attendances.length})</p>
        <div id="att-list-${event.id}" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>`;

    const listEl = attEl.querySelector(`#att-list-${event.id}`);

    attendances.forEach(att => {
      const row = _buildAttendanceRow(att, userMap[att.userId] || att.userId, event, isPast, settings, listEl);
      listEl.appendChild(row);
    });

  } catch (e) {
    console.error(e);
    if (attEl) attEl.innerHTML = `<p class="text-error" style="font-size:0.85rem;">Fehler: ${e.message}</p>`;
  }
}

/* ─── Eine Anwesenheitszeile ────────────────────────────────────────────────── */
function _buildAttendanceRow(att, userName, event, isPast, settings, listEl) {
  const row = createElement('div', '');
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;padding:6px 10px;background:var(--color-surface-offset);border-radius:6px;';

  const statusInfo = _getStatusInfo(att.status);

  row.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;min-width:0;">
      <span class="material-icons" style="font-size:18px;color:${statusInfo.color};flex-shrink:0;">${statusInfo.icon}</span>
      <div style="min-width:0;">
        <div style="font-weight:500;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userName}</div>
        <div style="font-size:0.78rem;color:var(--color-text-muted);">${statusInfo.label}${att.memberNote ? ' · ' + att.memberNote : ''}</div>
      </div>
    </div>
    <div id="att-actions-${att.id}" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"></div>`;

  _fillAttendanceActions(row, att, event, isPast, settings, listEl, userName);
  return row;
}

function _getStatusInfo(status) {
  const map = {
    registered:           { label: 'Angemeldet',          icon: 'check_circle',   color: 'var(--color-primary)' },
    present:              { label: 'Anwesend',             icon: 'done_all',       color: 'var(--color-success)' },
    absent_excused:       { label: 'Entsch. gefehlt',      icon: 'event_busy',     color: 'var(--color-warning)' },
    absent_unexcused:     { label: 'Unentsch. gefehlt',    icon: 'cancel',         color: 'var(--color-error)'   },
    late_excused:         { label: 'Verspätet (entsch.)',  icon: 'schedule',       color: 'var(--color-warning)' },
    late_unexcused:       { label: 'Verspätet (unentsch.)',icon: 'schedule',       color: 'var(--color-warning)' },
    cancelled:            { label: 'Termin abgesagt',      icon: 'person_off',     color: 'var(--color-text-muted)' },
    confirmation_pending: { label: '⏳ Ausstehend',        icon: 'hourglass_empty',color: 'var(--color-gold, #d19900)' },
    none:                 { label: 'Kein Status',          icon: 'radio_button_unchecked', color: 'var(--color-text-faint)' }
  };
  return map[status] || { label: status, icon: 'help_outline', color: 'var(--color-text-muted)' };
}

/* ─── Aktions-Buttons pro Anwesenheitszeile ─────────────────────────────────── */
function _fillAttendanceActions(row, att, event, isPast, settings, listEl, userName) {
  const actEl = row.querySelector(`#att-actions-${att.id}`);
  if (!actEl) return;

  // Schnell-Status-Buttons für Betreuer
  const makeStatusBtn = (label, icon, status, colorClass) => {
    const btn = createElement('button', colorClass || 'btn-secondary');
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:3px 10px;font-size:0.8rem;';
    btn.innerHTML = `<span class="material-icons" style="font-size:13px;">${icon}</span>${label}`;
    btn.disabled = att.status === status;
    btn.onclick = async () => {
      try {
        await firestore.collection('eventAttendance').doc(att.id)
          .update({ status, trainerSet: true, trainerSetAt: new Date() });
        att.status = status;
        row.replaceWith(_buildAttendanceRow(att, userName, event, isPast, settings, listEl));
        showToast('Status gespeichert.', 'success');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    };
    return btn;
  };

  // Für vergangene Termine: volle Statuspalette
  if (isPast) {
    actEl.appendChild(makeStatusBtn('Anwesend',      'done_all',     'present',          'btn-primary'));
    actEl.appendChild(makeStatusBtn('Entsch.',        'event_busy',   'absent_excused',   'btn-secondary'));
    actEl.appendChild(makeStatusBtn('Unentsch.',      'cancel',       'absent_unexcused', 'btn-danger'));
    actEl.appendChild(makeStatusBtn('Verspätet (E)', 'schedule',     'late_excused',     'btn-secondary'));
  } else {
    // Für kommende Termine: Abmelden-Button (neutral: „Termin absagen")
    if (!['cancelled'].includes(att.status)) {
      const cancelBtn = createElement('button', 'btn-secondary');
      cancelBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:3px 10px;font-size:0.8rem;';
      cancelBtn.innerHTML = `<span class="material-icons" style="font-size:13px;">person_off</span> Termin absagen`;
      cancelBtn.onclick = async () => {
        try {
          await firestore.collection('eventAttendance').doc(att.id)
            .update({ status: 'cancelled', trainerSet: true, trainerSetAt: new Date() });
          att.status = 'cancelled';
          row.replaceWith(_buildAttendanceRow(att, userName, event, isPast, settings, listEl));
          showToast('Termin für Mitglied abgesagt.', 'success');
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      };
      actEl.appendChild(cancelBtn);
    }
  }

  // Notiz-Button
  const noteBtn = createElement('button', 'btn-text');
  noteBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:3px 8px;font-size:0.8rem;';
  noteBtn.innerHTML = `<span class="material-icons" style="font-size:13px;">edit_note</span>`;
  noteBtn.title = 'Notiz bearbeiten';
  noteBtn.onclick = () => _showNoteModal(att, userName, row, event, isPast, settings, listEl);
  actEl.appendChild(noteBtn);
}

/* ─── Notiz-Modal ───────────────────────────────────────────────────────────── */
function _showNoteModal(att, userName, row, event, isPast, settings, listEl) {
  showModal({
    title: `Notiz – ${userName}`,
    body: `
      <label>Interne Notiz (für ${getRoleLabel('teacher')})</label>
      <textarea id="note-trainer" rows="2" style="width:100%;">${att.trainerNoteInternal || ''}</textarea>
      <label style="margin-top:8px;">Notiz für Mitglied</label>
      <textarea id="note-member" rows="2" style="width:100%;">${att.trainerNoteMember || ''}</textarea>`,
    confirmLabel: 'Speichern',
    onConfirm: async () => {
      const internal = document.getElementById('note-trainer').value.trim();
      const member   = document.getElementById('note-member').value.trim();
      try {
        await firestore.collection('eventAttendance').doc(att.id)
          .update({ trainerNoteInternal: internal, trainerNoteMember: member });
        att.trainerNoteInternal = internal;
        att.trainerNoteMember   = member;
        row.replaceWith(_buildAttendanceRow(att, userName, event, isPast, settings, listEl));
        showToast('Notiz gespeichert.', 'success');
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); return false; }
    }
  });
}

/* ─── Eigene Trainer-Absage ─────────────────────────────────────────────────── */
async function _cancelTrainerSelf(event, trainerUid, card) {
  showModal({
    title: 'Als Betreuer abmelden',
    body: `<p>Möchtest du dich für den Termin <strong>${event.title}</strong> als ${getRoleLabel('teacher')} abmelden?</p>`,
    confirmLabel: 'Abmelden',
    onConfirm: async () => {
      try {
        await firestore.collection('events').doc(event.id).update({
          trainerCancellations: firebase.firestore.FieldValue.arrayUnion(trainerUid)
        });
        showToast('Du wurdest als Betreuer abgemeldet.', 'success');
        loadTrainerDashboard();
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); return false; }
    }
  });
}

async function _undoCancelTrainerSelf(event, trainerUid, card) {
  try {
    await firestore.collection('events').doc(event.id).update({
      trainerCancellations: firebase.firestore.FieldValue.arrayRemove(trainerUid)
    });
    showToast('Abmeldung zurückgezogen.', 'success');
    loadTrainerDashboard();
  } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
}

/* ─── Broadcast-Nachricht ───────────────────────────────────────────────────── */
function _showBroadcastModal(event) {
  showModal({
    title: `Nachricht an ${getRoleLabel('member')}`,
    body: `
      <p class="text-muted" style="font-size:0.88rem;margin-top:0;">Diese Nachricht wird allen Mitgliedern in ihrer Terminansicht angezeigt.</p>
      <label>Nachricht</label>
      <textarea id="broadcast-msg" rows="3" style="width:100%;">${event.trainerBroadcast || ''}</textarea>`,
    confirmLabel: 'Speichern',
    onConfirm: async () => {
      const msg = document.getElementById('broadcast-msg').value.trim();
      try {
        await firestore.collection('events').doc(event.id)
          .update({ trainerBroadcast: msg || firebase.firestore.FieldValue.delete() });
        showToast('Nachricht gespeichert.', 'success');
        loadTrainerDashboard();
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); return false; }
    }
  });
}

/* ─── Mitglied hinzufügen (auch außerhalb Gruppe) ───────────────────────────── */
async function _showAddMemberModal(event, card) {
  const mLabel = getRoleLabel('member');

  // Alle Attendance-IDs bereits beim Termin
  const attSnap = await firestore.collection('eventAttendance')
    .where('eventId', '==', event.id).get();
  const registeredUids = new Set();
  attSnap.forEach(doc => registeredUids.add(doc.data().userId));

  // Alle Benutzer laden
  let allUsers = [];
  const uSnap = await firestore.collection('users').orderBy('displayName').get();
  uSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));

  // Nur Mitglieder die noch NICHT angemeldet sind
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
      <input type="search" id="add-member-search" placeholder="${mLabel} suchen…" style="margin-bottom:10px;" />
      <div id="add-member-list" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
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
      if (!selected.length) { showToast('Bitte mindestens ein Mitglied wählen.', 'error'); return false; }

      try {
        const settings    = window.appSettings || {};
        const defaultMode = event.mode || settings.defaultMode || 'opt_in';
        const initStatus  = defaultMode === 'opt_out'      ? 'registered'
                          : defaultMode === 'confirmation' ? 'confirmation_pending'
                          : 'registered';

        const batch = firestore.batch();
        selected.forEach(uid => {
          const ref = firestore.collection('eventAttendance').doc();
          batch.set(ref, {
            eventId:           event.id,
            userId:            uid,
            status:            initStatus,
            addedByTrainer:    true,
            addedAt:           new Date(),
            firstRegisteredAt: new Date()
          });
          // directMembers am Event pflegen
          batch.update(firestore.collection('events').doc(event.id), {
            directMembers: firebase.firestore.FieldValue.arrayUnion(uid)
          });
        });
        await batch.commit();
        showToast(`${selected.length} ${mLabel} hinzugefügt.`, 'success');
        _loadAttendanceSection(card, event, false);
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); return false; }
    }
  });

  // Such-Filter im Modal
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
  }, 80);
}
