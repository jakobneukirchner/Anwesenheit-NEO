// modules/member-dashboard.js

async function loadMemberDashboard() {
  const container = document.getElementById('app-content');
  const user      = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Termine...</div>`;

  try {
    const settingsDoc = await firestore.collection('settings').doc('global').get();
    const settings    = settingsDoc.exists ? settingsDoc.data() : {};
    window.appSettings = settings;
    const defaultLimit = settings.defaultEventLookAhead ?? 30;

    const userDoc  = await firestore.collection('users').doc(user.uid).get();
    const userData = userDoc.data() || {};
    const userGroups    = userData.groups || [];
    const lookAheadDays = userData.eventLookAhead ?? defaultLimit;

    const now        = new Date();
    const cutOff     = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
    const pastCutOff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const attendanceSnap = await firestore.collection('eventAttendance').where('userId', '==', user.uid).get();
    const attendanceByEvent = {};
    attendanceSnap.forEach(doc => { attendanceByEvent[doc.data().eventId] = { id: doc.id, ...doc.data() }; });

    let events = [];
    const seen = new Set();
    const addEvent = (doc) => {
      if (!seen.has(doc.id)) { seen.add(doc.id); events.push({ id: doc.id, ...doc.data() }); }
    };

    const directSnap = await firestore.collection('events').where('directMembers', 'array-contains', user.uid).get();
    directSnap.forEach(addEvent);
    for (const groupId of userGroups) {
      const groupSnap = await firestore.collection('events').where('groupId', '==', groupId).get();
      groupSnap.forEach(addEvent);
    }
    for (const eventId of Object.keys(attendanceByEvent)) {
      if (!seen.has(eventId)) {
        const evDoc = await firestore.collection('events').doc(eventId).get();
        if (evDoc.exists) addEvent(evDoc);
      }
    }

    events = events.filter(e => {
      const t = e.startTime?.toDate?.();
      if (!t) return false;
      if (t < pastCutOff || t > cutOff) return false;
      if (e.status === 'cancelled' || e.status === 'skipped') return true;
      if (t <= now) return !!attendanceByEvent[e.id];
      return true;
    });

    const visibilityMode = settings.visibilityMode || 'count';
    await Promise.all(events.map(async ev => {
      const trainerIds    = ev.trainers || [];
      const cancelledIds  = ev.trainerCancellations || [];
      const allTrainerIds = [...new Set([...trainerIds, ...cancelledIds])];
      if (allTrainerIds.length) {
        const trainerNames = {};
        await Promise.all(allTrainerIds.map(async tid => {
          const uDoc = await firestore.collection('users').doc(tid).get();
          trainerNames[tid] = uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || tid) : tid;
        }));
        ev._trainerNames     = trainerIds.map(tid => trainerNames[tid] || tid);
        ev._trainerCancelled = cancelledIds.map(tid => trainerNames[tid] || tid);
      }

      if (ev.status === 'cancelled' || ev.status === 'skipped') return;

      const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
      let count = 0;
      const uids = [];
      attSnap.forEach(doc => {
        const d = doc.data();
        if (['registered','present','late_excused','late_unexcused','confirmation_pending'].includes(d.status)) {
          count++;
          if (visibilityMode === 'names') uids.push(d.userId);
        }
      });
      ev._participantCount = count;
      if (visibilityMode === 'names' && uids.length) {
        ev._participantNames = await Promise.all(uids.map(async uid => {
          const uDoc = await firestore.collection('users').doc(uid).get();
          return uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || uid) : uid;
        }));
      }
    }));

    events.sort((a, b) => (a.startTime?.toMillis?.() || 0) - (b.startTime?.toMillis?.() || 0));

    // Laufende Termine (startTime <= now) erscheinen unter "Vergangen"
    const upcoming = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past     = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; });

    container.innerHTML = `
      <p class="text-muted" style="margin-bottom:12px;font-size:0.85rem;">
        Termine bis <strong>${cutOff.toLocaleDateString('de-DE')}</strong> (${lookAheadDays} Tage im Voraus)
      </p>
      <div class="tabs">
        <button class="tab-btn active" data-tab="upcoming">Kommende Termine (${upcoming.length})</button>
        <button class="tab-btn"        data-tab="past">Vergangene Termine (${past.length})</button>
      </div>
      <div id="tab-upcoming"></div>
      <div id="tab-past" hidden></div>
    `;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-upcoming').hidden = btn.dataset.tab !== 'upcoming';
        document.getElementById('tab-past').hidden     = btn.dataset.tab !== 'past';
      };
    });

    const upcomingEl = document.getElementById('tab-upcoming');
    const pastEl     = document.getElementById('tab-past');

    if (!upcoming.length) upcomingEl.innerHTML = '<p class="text-muted">Keine kommenden Termine.</p>';
    else upcoming.forEach(ev => upcomingEl.appendChild(renderMemberEventCard(ev, attendanceByEvent[ev.id], false)));

    if (!past.length) pastEl.innerHTML = '<p class="text-muted">Keine vergangenen Termine.</p>';
    else past.forEach(ev => pastEl.appendChild(renderMemberEventCard(ev, attendanceByEvent[ev.id], true)));

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden: ' + e.message + '</p>';
  }
}

function isLockedByTrainer(attendance) {
  if (!attendance) return false;
  const lockedStatuses = ['present', 'absent_excused', 'absent_unexcused', 'late_unexcused'];
  if (lockedStatuses.includes(attendance.status)) return true;
  if (attendance.status === 'late_excused' && attendance.trainerSet) return true;
  return false;
}

function buildParticipantInfoHtml(event, isPast) {
  if (isPast) return '';
  const settings = window.appSettings || {};
  const visMode  = settings.visibilityMode || 'count';
  const minPart  = event.minParticipants ?? settings.defaultMinParticipants ?? 0;
  const count    = event._participantCount ?? null;
  if (visMode === 'none' || count === null) return '';
  const missing  = minPart ? Math.max(0, minPart - count) : 0;
  let content = (visMode === 'names' && event._participantNames?.length)
    ? `<span class="pi-count">${count} angemeldet</span>: <span>${event._participantNames.join(', ')}</span>`
    : `<span class="pi-count">${count} angemeldet</span>`;
  if (minPart) {
    content += missing > 0
      ? ` &nbsp;&middot;&nbsp; <span class="pi-missing">noch ${missing} ben&ouml;tigt</span> <span class="text-muted">(mind. ${minPart})</span>`
      : ` &nbsp;&middot;&nbsp; <span class="pi-ok"><span class="material-icons" style="font-size:14px;vertical-align:middle;">check</span> Mindestanzahl erreicht</span>`;
  }
  return `<div class="participant-info">${content}</div>`;
}

function buildTrainerInfoHtml(event, isPast) {
  if (isPast) return '';
  const tLabel    = getRoleLabel('teacher');
  const active    = event._trainerNames    || [];
  const cancelled = event._trainerCancelled || [];
  if (!active.length && !cancelled.length) return '';

  const activePills = active.map(n =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(46,125,50,0.1);color:var(--color-success,#2e7d32);border-radius:999px;padding:2px 10px;font-size:0.8rem;font-weight:500;"><span class="material-icons" style="font-size:13px;">check</span>${n}</span>`
  ).join(' ');

  const cancelledPills = cancelled.map(n =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(198,40,40,0.1);color:var(--color-error,#c62828);border-radius:999px;padding:2px 10px;font-size:0.8rem;font-weight:500;text-decoration:line-through;"><span class="material-icons" style="font-size:13px;">close</span>${n}</span>`
  ).join(' ');

  const warning = cancelled.length && !active.length
    ? `<span class="chip chip-error" style="font-size:0.78rem;margin-left:6px;display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">warning</span> Kein ${tLabel}!</span>` : '';

  return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 2px;font-size:0.83rem;">
      <span class="text-muted">${tLabel}:</span>
      ${activePills}${cancelledPills}${warning}
    </div>`;
}

function renderMemberEventCard(event, attendance, isPast) {
  const settings   = window.appSettings || {};
  const tLabel     = getRoleLabel('teacher');
  const signupMins = event.signupDeadlineMinutes ?? settings.defaultSignupDeadlineMinutes ?? 60;
  const WITHDRAW_WINDOW_MS = ((settings.withdrawWindowMinutes ?? 60) * 60 * 1000);
  const mode       = event.mode || settings.defaultMode || 'opt_in';
  const isConfMode = mode === 'confirmation';

  // ── Bestätigungsfenster: relativ zu Terminbeginn (startTime)
  // Wert in Minuten: negativ = X Min VOR Terminbeginn, positiv = X Min NACH Terminbeginn.
  // Standard: 60 Min nach Terminbeginn (Mitglieder können bis 60 Min nach Start bestätigen).
  const confWindowMinutes = settings.confirmationWindowMinutes ?? 60;
  const start       = event.startTime?.toDate ? event.startTime.toDate() : null;
  const end         = event.endTime?.toDate   ? event.endTime.toDate()   : null;
  const now         = new Date();

  // Deadline für Bestätigung = startTime + confWindowMinutes (kann negativ sein = vor Start)
  const confDeadline = start ? new Date(start.getTime() + confWindowMinutes * 60 * 1000) : null;
  // Fenster abgelaufen wenn confDeadline in der Vergangenheit liegt
  const confWindowExpired = isConfMode && confDeadline && now > confDeadline;

  const deadline       = start ? new Date(start.getTime() - signupMins * 60000) : null;
  const withinDeadline = !deadline || now <= deadline;
  const locked         = isLockedByTrainer(attendance);
  const isCancelled    = event.status === 'cancelled';
  const isSkipped      = event.status === 'skipped';

  const memberStatus = attendance?.status || (
    isConfMode       ? 'confirmation_pending' :
    mode === 'opt_out' ? 'registered' : 'none'
  );
  const memberNote   = attendance?.memberNote || '';

  const firstRegTime     = attendance?.firstRegisteredAt?.toDate?.() || null;
  const alreadyWithdrawn = !!attendance?.hasWithdrawn;

  const canWithdraw = !locked && !isPast && !alreadyWithdrawn
    && attendance?.status === 'registered' && !attendance?.trainerSet
    && firstRegTime && (now - firstRegTime) < WITHDRAW_WINDOW_MS;

  const card = createElement('div', 'card');

  // --- Abgesagt ---
  if (isCancelled) {
    card.style.opacity    = '0.72';
    card.style.borderLeft = '4px solid var(--color-error, #c62828)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0 0 2px;text-decoration:line-through;color:var(--color-text-muted);">${event.title || 'Termin'}</h3>
          <p class="text-muted" style="margin:0;font-size:0.88rem;text-decoration:line-through;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
        </div>
        <span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:14px;">cancel</span> Abgesagt
        </span>
      </div>
      ${event.cancellationReason ? `<p class="text-muted" style="margin:8px 0 0;font-size:0.88rem;">Begründung: ${event.cancellationReason}</p>` : ''}
      ${event.trainerBroadcast  ? `<p class="text-muted" style="margin:6px 0 0;font-size:0.85rem;font-style:italic;">„${event.trainerBroadcast}“</p>` : ''}
    `;
    return card;
  }

  // --- Ausgefallen ---
  if (isSkipped) {
    card.style.opacity    = '0.75';
    card.style.borderLeft = '4px solid var(--color-warning, #e65100)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0 0 2px;color:var(--color-text-muted);">${event.title || 'Termin'}</h3>
          <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
        </div>
        <span class="chip chip-warning" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:14px;">event_busy</span> Ausgefallen
        </span>
      </div>
      ${event.skipReason ? `<p class="text-muted" style="margin:8px 0 0;font-size:0.88rem;">Begründung: ${event.skipReason}</p>` : ''}
    `;
    return card;
  }

  const trainerLateHtml = event.trainerLateNote
    ? `<div class="chip chip-warning" style="margin-bottom:8px;display:inline-flex;align-items:center;gap:4px;">
        <span class="material-icons" style="font-size:15px;">schedule</span>
        ${tLabel} meldet Verspätung: ${event.trainerLateNote}
       </div>` : '';

  const broadcastHtml = event.trainerBroadcast
    ? `<div style="background:rgba(21,101,192,0.08);border-left:3px solid var(--color-primary);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
        <span style="font-size:0.8rem;font-weight:600;color:var(--color-primary);text-transform:uppercase;letter-spacing:.04em;">Nachricht vom ${tLabel}</span>
        <p style="margin:4px 0 0;">${event.trainerBroadcast}</p>
       </div>` : '';

  const trainerNoteHtml = attendance?.trainerNoteMember
    ? `<div style="background:rgba(245,124,0,0.08);border-left:3px solid var(--color-warning,#f57c00);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
        <span style="font-size:0.8rem;font-weight:600;color:var(--color-warning,#f57c00);text-transform:uppercase;letter-spacing:.04em;">Persönliche Notiz deines ${tLabel}s</span>
        <p style="margin:4px 0 0;">${attendance.trainerNoteMember}</p>
       </div>` : '';

  const participantInfo = buildParticipantInfoHtml(event, isPast);
  const trainerInfo     = buildTrainerInfoHtml(event, isPast);

  const statusChipClass = {
    registered:           'chip-success',
    confirmation_pending: 'chip-warning',
    none:                 '',
    cancelled:            'chip-error',
    present:              'chip-success',
    absent_excused:       'chip-warning',
    absent_unexcused:     'chip-error',
    late_excused:         'chip-warning',
    late_unexcused:       'chip-warning'
  }[memberStatus] || '';

  const isPending    = memberStatus === 'confirmation_pending';
  const isRegistered = memberStatus === 'registered';

  const toggleLabel = isConfMode
    ? (memberStatus === 'cancelled' ? 'Wieder anmelden' : 'Abmelden')
    : mode === 'opt_in'
      ? (isRegistered ? 'Abmelden' : 'Anmelden')
      : (memberStatus === 'cancelled' ? 'Wieder anmelden' : 'Abmelden');

  const lockedHtml = locked
    ? `<p class="text-muted" style="font-size:0.85rem;margin:4px 0 0;display:flex;align-items:center;gap:4px;">
        <span class="material-icons" style="font-size:15px;">lock</span>
        Vom ${tLabel} eingetragen – keine Änderung möglich.
       </p>` : '';

  let withdrawHtml = '';
  if (canWithdraw) {
    const msLeft  = Math.max(0, WITHDRAW_WINDOW_MS - (now - firstRegTime));
    const minLeft = Math.floor(msLeft / 60000);
    const secLeft = Math.floor((msLeft % 60000) / 1000);
    withdrawHtml = `
      <div style="background:rgba(198,40,40,0.07);border-left:3px solid var(--color-error,#c62828);border-radius:4px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span style="font-size:0.85rem;color:var(--color-error,#c62828);display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">timer</span>
          Versehentlich angemeldet? Noch <strong id="withdraw-countdown-${event.id}">${minLeft}:${String(secLeft).padStart(2,'0')}</strong> zum Rückziehen.
        </span>
        <button class="btn-danger" data-action="withdraw" style="padding:4px 14px;font-size:0.85rem;">Anmeldung zurückziehen</button>
      </div>`;
  }

  const deadlineHtml = !withinDeadline && !isPast && !locked
    ? `<p class="text-muted" style="font-size:0.85rem;display:flex;align-items:center;gap:4px;">
        <span class="material-icons" style="font-size:15px;">schedule</span>
        Anmeldefrist abgelaufen
       </p>` : '';

  // ── Bestätigungsmodus-Banner
  // Zeige Banner wenn: Modus=confirmation, Termin nicht in Vergangenheit (aus Sicht isPast),
  // nicht durch Trainer gesperrt, Status ausstehend, Fenster NICHT abgelaufen
  let confirmBannerHtml = '';
  if (isConfMode && !locked && isPending && !confWindowExpired) {
    confirmBannerHtml = `
      <div style="background:rgba(245,124,0,0.09);border-left:3px solid var(--color-warning,#e65100);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
        <p style="margin:0 0 6px;font-weight:600;color:var(--color-warning,#e65100);display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">pending</span>
          Bestätigung ausstehend
        </p>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.85rem;">Du bist vorläufig angemeldet. Bitte bestätige deine Teilnahme oder melde dich ab.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" data-action="confirm-attendance" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">check_circle</span> Teilnahme bestätigen
          </button>
          <button class="btn-danger" data-action="toggle" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">cancel</span> Abmelden
          </button>
        </div>
      </div>`;
  } else if (isConfMode && isPending && confWindowExpired) {
    confirmBannerHtml = `<p class="text-muted" style="font-size:0.85rem;display:flex;align-items:center;gap:4px;margin-bottom:8px;"><span class="material-icons" style="font-size:15px;">lock_clock</span> Bestätigungsfenster abgelaufen.</p>`;
  }

  const showToggle = !isPast && withinDeadline && !locked
    && !(isConfMode && isPending)
    && !(isConfMode && confWindowExpired && memberStatus !== 'cancelled');

  card.innerHTML = `
    ${trainerLateHtml}${broadcastHtml}${trainerNoteHtml}${withdrawHtml}${confirmBannerHtml}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
      <div>
        <h3 style="margin:0 0 4px;">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
      </div>
      <span class="chip ${statusChipClass}">${translateMemberStatus(memberStatus, mode)}</span>
    </div>
    ${lockedHtml}
    ${event.description ? `<p style="margin:10px 0 4px;">${event.description}</p>` : ''}
    ${trainerInfo}
    ${participantInfo}
    ${deadlineHtml}
    <hr class="divider" />
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${showToggle ? `<button class="btn-primary" data-action="toggle">${toggleLabel}</button>` : ''}
      ${!isPast && !locked ? `<button class="btn-secondary" data-action="late" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:16px;">schedule</span> Verspätung melden</button>` : ''}
    </div>
    <div style="margin-top:12px;">
      <label>Mein Hinweis (für ${tLabel} sichtbar)</label>
      <textarea rows="2" data-role="note" ${locked ? 'disabled style="opacity:0.6;"' : ''}>${memberNote}</textarea>
      ${!locked ? `<button class="btn-secondary" data-action="save-note" style="margin-top:0;display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:16px;">save</span> Hinweis speichern</button>` : ''}
    </div>
    <div data-role="error" class="text-error"></div>
  `;

  if (!locked) {
    const errorEl = card.querySelector('[data-role="error"]');

    const withdrawBtn = card.querySelector('[data-action="withdraw"]');
    if (withdrawBtn) withdrawBtn.onclick = () => guardedAction(async () => {
      try {
        await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).set({
          eventId: event.id, userId: window.currentUser.firebaseUser.uid,
          hasWithdrawn: true, status: 'cancelled',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Anmeldung erfolgreich zurückgezogen.', 'success');
        loadMemberDashboard();
      } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
    });

    if (canWithdraw) {
      const countdownEl = card.querySelector(`#withdraw-countdown-${event.id}`);
      if (countdownEl) {
        const timer = setInterval(() => {
          const remaining = Math.max(0, WITHDRAW_WINDOW_MS - (Date.now() - firstRegTime.getTime()));
          const m = Math.floor(remaining / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          countdownEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
          if (remaining === 0) { clearInterval(timer); loadMemberDashboard(); }
        }, 1000);
      }
    }

    const confirmBtn = card.querySelector('[data-action="confirm-attendance"]');
    if (confirmBtn) confirmBtn.onclick = () => guardedAction(async () => {
      try {
        await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).set({
          eventId: event.id, userId: window.currentUser.firebaseUser.uid,
          status: 'registered', trainerSet: false,
          confirmedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Teilnahme bestätigt.', 'success');
        loadMemberDashboard();
      } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
    });

    const toggleBtn = card.querySelector('[data-action="toggle"]');
    if (toggleBtn) toggleBtn.onclick = () => guardedAction(async () => {
      try { await memberToggleAttendance(event, attendance, mode, deadline); }
      catch (e) { errorEl.textContent = 'Aktion fehlgeschlagen: ' + e.message; }
    });

    const lateBtn = card.querySelector('[data-action="late"]');
    if (lateBtn) lateBtn.onclick = () => guardedAction(async () => {
      showModal({
        title: 'Verspätung melden',
        body: `
          <p>Verspätungen werden immer als <strong>entschuldigt</strong> eingetragen – unentschuldigt kann nur ein ${tLabel} eintragen.</p>
          <label>Begründung (optional)</label>
          <input type="text" id="late-reason-input" placeholder="z.B. Zug hatte Verspätung" />
        `,
        confirmLabel: 'Melden',
        onConfirm: async () => {
          const reason = document.getElementById('late-reason-input')?.value.trim() || '';
          await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).set({
            eventId: event.id, userId: window.currentUser.firebaseUser.uid,
            status: 'late_excused', trainerSet: false,
            memberNote: reason || (attendance?.memberNote || ''),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          showToast('Verspätung gemeldet (entschuldigt).', 'success');
          loadMemberDashboard();
        }
      });
    });

    const noteTextarea = card.querySelector('textarea[data-role="note"]');
    const noteBtn      = card.querySelector('[data-action="save-note"]');
    if (noteBtn) noteBtn.onclick = () => guardedAction(async () => {
      try { await memberSaveNote(event, attendance, noteTextarea.value); showToast('Hinweis gespeichert.', 'success'); }
      catch (e) { errorEl.textContent = 'Hinweis konnte nicht gespeichert werden.'; }
    });
  }

  return card;
}

function translateMemberStatus(status, mode) {
  switch (status) {
    case 'registered':           return mode === 'opt_in' ? 'Angemeldet' : 'Vorgemerkt';
    case 'confirmation_pending': return 'Ausst. Bestätigung';
    case 'none':                 return mode === 'opt_in' ? 'Nicht angemeldet' : 'Vorgemerkt';
    case 'cancelled':            return 'Abgemeldet';
    case 'present':              return 'Anwesend';
    case 'absent_excused':       return 'Entschuldigt gefehlt';
    case 'absent_unexcused':     return 'Unentschuldigt gefehlt';
    case 'late_excused':         return 'Verspätet (entschuldigt)';
    case 'late_unexcused':       return 'Verspätet (unentschuldigt)';
    default: return status;
  }
}

async function memberToggleAttendance(event, attendance, mode, deadline) {
  const user = window.currentUser.firebaseUser;
  if (deadline && new Date() > deadline) { showToast('Anmeldefrist abgelaufen.', 'warning'); return; }
  const isConfMode = mode === 'confirmation';
  const currentStatus = attendance?.status || (
    isConfMode ? 'confirmation_pending' :
    mode === 'opt_out' ? 'registered' : 'none'
  );

  let newStatus;
  if (isConfMode) {
    newStatus = currentStatus === 'cancelled' ? 'confirmation_pending' : 'cancelled';
  } else {
    newStatus = mode === 'opt_in'
      ? (currentStatus === 'registered' ? 'cancelled' : 'registered')
      : (currentStatus === 'cancelled'  ? 'registered' : 'cancelled');
  }

  const isFirstReg = (newStatus === 'registered' || newStatus === 'confirmation_pending') && !attendance?.firstRegisteredAt;
  const updateData = {
    eventId: event.id, userId: user.uid,
    status: newStatus, trainerSet: false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (isFirstReg) updateData.firstRegisteredAt = firebase.firestore.FieldValue.serverTimestamp();

  await firestore.collection('eventAttendance').doc(`${event.id}_${user.uid}`).set(updateData, { merge: true });

  const msg = newStatus === 'cancelled' ? 'Erfolgreich abgemeldet.'
    : newStatus === 'confirmation_pending' ? 'Wieder vorgemerkt – bitte Teilnahme bestätigen.'
    : 'Erfolgreich angemeldet.';
  showToast(msg, 'success');
  loadMemberDashboard();
}

async function memberSaveNote(event, attendance, note) {
  const user = window.currentUser.firebaseUser;
  await firestore.collection('eventAttendance').doc(`${event.id}_${user.uid}`).set({
    eventId: event.id, userId: user.uid, memberNote: note,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}
