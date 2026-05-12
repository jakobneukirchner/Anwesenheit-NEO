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
      if (e.status === 'cancelled') return true;
      if (t <= now) return !!attendanceByEvent[e.id];
      return true;
    });

    const visibilityMode = settings.visibilityMode || 'count';
    await Promise.all(events.map(async ev => {
      if (ev.status === 'cancelled') return;
      const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
      let count = 0;
      const uids = [];
      attSnap.forEach(doc => {
        const d = doc.data();
        if (['registered','present','late_excused','late_unexcused'].includes(d.status)) {
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

      // Trainer-Status laden
      const trainerIds    = ev.trainers || [];
      const cancelledIds  = ev.trainerCancellations || [];
      const allTrainerIds = [...new Set([...trainerIds, ...cancelledIds])];
      if (allTrainerIds.length) {
        const trainerNames = {};
        await Promise.all(allTrainerIds.map(async tid => {
          const uDoc = await firestore.collection('users').doc(tid).get();
          trainerNames[tid] = uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || tid) : tid;
        }));
        ev._trainerNames    = trainerIds.map(tid => trainerNames[tid] || tid);
        ev._trainerCancelled = cancelledIds.map(tid => trainerNames[tid] || tid);
      }
    }));

    events.sort((a, b) => (a.startTime?.toMillis?.() || 0) - (b.startTime?.toMillis?.() || 0));

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
      ? ` &nbsp;·&nbsp; <span class="pi-missing">noch ${missing} ben&ouml;tigt</span> <span class="text-muted">(mind. ${minPart})</span>`
      : ` &nbsp;·&nbsp; <span class="pi-ok">&#10004; Mindestanzahl erreicht</span>`;
  }
  return `<div class="participant-info">${content}</div>`;
}

/** Trainer-Status Anzeige für Mitglieder */
function buildTrainerInfoHtml(event, isPast) {
  if (isPast) return '';
  const active    = event._trainerNames    || [];
  const cancelled = event._trainerCancelled || [];
  if (!active.length && !cancelled.length) return '';

  const activePills = active.map(n =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(46,125,50,0.1);color:var(--color-success,#2e7d32);border-radius:999px;padding:2px 10px;font-size:0.8rem;font-weight:500;">&#10003; ${n}</span>`
  ).join(' ');

  const cancelledPills = cancelled.map(n =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(198,40,40,0.1);color:var(--color-error,#c62828);border-radius:999px;padding:2px 10px;font-size:0.8rem;font-weight:500;text-decoration:line-through;">&#10005; ${n}</span>`
  ).join(' ');

  const warning = cancelled.length && !active.length
    ? `<span class="chip chip-error" style="font-size:0.78rem;margin-left:6px;">&#9888; Kein Trainer!</span>` : '';

  return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 2px;font-size:0.83rem;">
      <span class="text-muted">Trainer:</span>
      ${activePills}${cancelledPills}${warning}
    </div>`;
}

function renderMemberEventCard(event, attendance, isPast) {
  const settings       = window.appSettings || {};
  const signupMins     = event.signupDeadlineMinutes ?? settings.defaultSignupDeadlineMinutes ?? 60;
  const mode           = event.mode || settings.defaultMode || 'opt_in';
  const start          = event.startTime?.toDate ? event.startTime.toDate() : null;
  const end            = event.endTime?.toDate   ? event.endTime.toDate()   : null;
  const now            = new Date();
  const deadline       = start ? new Date(start.getTime() - signupMins * 60000) : null;
  const withinDeadline = !deadline || now <= deadline;
  const memberStatus   = attendance?.status || (mode === 'opt_out' ? 'registered' : 'none');
  const memberNote     = attendance?.memberNote || '';
  const locked         = isLockedByTrainer(attendance);
  const isCancelled    = event.status === 'cancelled';

  const regTime     = attendance?.updatedAt?.toDate?.() || null;
  const canWithdraw = !locked
    && !isPast
    && attendance?.status === 'registered'
    && !attendance?.trainerSet
    && regTime
    && (now - regTime) < 5 * 60 * 1000;

  const card = createElement('div', 'card');

  if (isCancelled) {
    card.style.opacity    = '0.72';
    card.style.borderLeft = '4px solid var(--color-error, #c62828)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0 0 2px;text-decoration:line-through;color:var(--color-text-muted);">${event.title || 'Termin'}</h3>
          <p class="text-muted" style="margin:0;font-size:0.88rem;text-decoration:line-through;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
        </div>
        <span class="chip chip-error">❌ Abgesagt</span>
      </div>
      ${event.cancellationReason ? `<p class="text-muted" style="margin:8px 0 0;font-size:0.88rem;">Begründung: ${event.cancellationReason}</p>` : ''}
      ${event.trainerBroadcast  ? `<p class="text-muted" style="margin:6px 0 0;font-size:0.85rem;font-style:italic;">„${event.trainerBroadcast}“</p>` : ''}
    `;
    return card;
  }

  const trainerLateHtml = event.trainerLateNote
    ? `<div class="chip chip-warning" style="margin-bottom:8px;">⚠️ Trainer meldet Verspätung: ${event.trainerLateNote}</div>` : '';

  const broadcastHtml = event.trainerBroadcast
    ? `<div style="background:rgba(21,101,192,0.08);border-left:3px solid var(--color-primary);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
        <span style="font-size:0.8rem;font-weight:600;color:var(--color-primary);text-transform:uppercase;letter-spacing:.04em;">Nachricht vom Trainer</span>
        <p style="margin:4px 0 0;">${event.trainerBroadcast}</p>
       </div>` : '';

  const trainerNoteHtml = attendance?.trainerNoteMember
    ? `<div style="background:rgba(245,124,0,0.08);border-left:3px solid var(--color-warning,#f57c00);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
        <span style="font-size:0.8rem;font-weight:600;color:var(--color-warning,#f57c00);text-transform:uppercase;letter-spacing:.04em;">Persönliche Notiz deines Trainers</span>
        <p style="margin:4px 0 0;">${attendance.trainerNoteMember}</p>
       </div>` : '';

  const participantInfo = buildParticipantInfoHtml(event, isPast);
  const trainerInfo     = buildTrainerInfoHtml(event, isPast);

  const statusChipClass = {
    registered: 'chip-success', cancelled: 'chip-error', present: 'chip-success',
    absent_excused: 'chip-warning', absent_unexcused: 'chip-error',
    late_excused: 'chip-warning', late_unexcused: 'chip-warning'
  }[memberStatus] || '';

  const isRegistered = memberStatus === 'registered';
  const toggleLabel  = mode === 'opt_in'
    ? (isRegistered ? 'Abmelden' : 'Anmelden')
    : (memberStatus === 'cancelled' ? 'Wieder anmelden' : 'Abmelden');

  const lockedHtml = locked
    ? `<p class="text-muted" style="font-size:0.85rem;margin:4px 0 0;">🔒 Vom Trainer eingetragen – keine Änderung möglich.</p>` : '';

  let withdrawHtml = '';
  if (canWithdraw) {
    const secsLeft = Math.max(0, Math.ceil((5 * 60 * 1000 - (now - regTime)) / 1000));
    const minLeft  = Math.floor(secsLeft / 60);
    const secLeft  = secsLeft % 60;
    withdrawHtml = `
      <div style="background:rgba(198,40,40,0.07);border-left:3px solid var(--color-error,#c62828);border-radius:4px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span style="font-size:0.85rem;color:var(--color-error,#c62828);">&#9200; Versehentlich angemeldet? Noch <strong id="withdraw-countdown-${event.id}">${minLeft}:${String(secLeft).padStart(2,'0')}</strong> zum Rückziehen.</span>
        <button class="btn-danger" data-action="withdraw" style="padding:4px 14px;font-size:0.85rem;">Anmeldung zurückziehen</button>
      </div>`;
  }

  card.innerHTML = `
    ${trainerLateHtml}${broadcastHtml}${trainerNoteHtml}${withdrawHtml}
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
    ${!withinDeadline && !isPast && !locked ? '<p class="text-muted" style="font-size:0.85rem;">⏱ Anmeldefrist abgelaufen</p>' : ''}
    <hr class="divider" />
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${!isPast && withinDeadline && !locked ? `<button class="btn-primary" data-action="toggle">${toggleLabel}</button>` : ''}
      ${!isPast && !locked ? `<button class="btn-secondary" data-action="late">Verspätung melden</button>` : ''}
    </div>
    <div style="margin-top:12px;">
      <label>Mein Hinweis (für Trainer sichtbar)</label>
      <textarea rows="2" data-role="note" ${locked ? 'disabled style="opacity:0.6;"' : ''}>${memberNote}</textarea>
      ${!locked ? `<button class="btn-secondary" data-action="save-note" style="margin-top:0;">Hinweis speichern</button>` : ''}
    </div>
    <div data-role="error" class="text-error"></div>
  `;

  if (!locked) {
    const errorEl   = card.querySelector('[data-role="error"]');

    const withdrawBtn = card.querySelector('[data-action="withdraw"]');
    if (withdrawBtn) withdrawBtn.onclick = () => guardedAction(async () => {
      try {
        await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).delete();
        showToast('Anmeldung erfolgreich zurückgezogen.', 'success');
        loadMemberDashboard();
      } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
    });

    if (canWithdraw) {
      const countdownEl = card.querySelector(`#withdraw-countdown-${event.id}`);
      if (countdownEl) {
        const timer = setInterval(() => {
          const remaining = Math.max(0, Math.ceil((5 * 60 * 1000 - (Date.now() - regTime.getTime())) / 1000));
          const m = Math.floor(remaining / 60), s = remaining % 60;
          countdownEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
          if (remaining === 0) { clearInterval(timer); loadMemberDashboard(); }
        }, 1000);
      }
    }

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
          <p>Verspätungen werden immer als <strong>entschuldigt</strong> eingetragen – unentschuldigt kann nur ein Trainer eintragen.</p>
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
    case 'registered':       return mode === 'opt_in' ? 'Angemeldet' : 'Vorgemerkt';
    case 'none':             return mode === 'opt_in' ? 'Nicht angemeldet' : 'Vorgemerkt';
    case 'cancelled':        return 'Abgemeldet';
    case 'present':          return 'Anwesend';
    case 'absent_excused':   return 'Entschuldigt gefehlt';
    case 'absent_unexcused': return 'Unentschuldigt gefehlt';
    case 'late_excused':     return 'Verspätet (entschuldigt)';
    case 'late_unexcused':   return 'Verspätet (unentschuldigt)';
    default: return status;
  }
}

async function memberToggleAttendance(event, attendance, mode, deadline) {
  const user = window.currentUser.firebaseUser;
  if (deadline && new Date() > deadline) { showToast('Anmeldefrist abgelaufen.', 'warning'); return; }
  const currentStatus = attendance?.status || (mode === 'opt_out' ? 'registered' : 'none');
  const newStatus = mode === 'opt_in'
    ? (currentStatus === 'registered' ? 'cancelled' : 'registered')
    : (currentStatus === 'cancelled'  ? 'registered' : 'cancelled');
  await firestore.collection('eventAttendance').doc(`${event.id}_${user.uid}`).set({
    eventId: event.id, userId: user.uid,
    status: newStatus, trainerSet: false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  showToast(newStatus === 'registered' ? 'Erfolgreich angemeldet.' : 'Erfolgreich abgemeldet.', 'success');
  loadMemberDashboard();
}

async function memberSaveNote(event, attendance, note) {
  const user = window.currentUser.firebaseUser;
  await firestore.collection('eventAttendance').doc(`${event.id}_${user.uid}`).set({
    eventId: event.id, userId: user.uid, memberNote: note,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}
