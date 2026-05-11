// modules/member-dashboard.js

async function loadMemberDashboard() {
  const container = document.getElementById('app-content');
  const user      = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Termine...</div>`;

  try {
    const settingsDoc = await firestore.collection('settings').doc('global').get();
    const settings    = settingsDoc.exists ? settingsDoc.data() : {};
    window.appSettings = settings;
    const defaultLimit  = settings.defaultEventLookAhead ?? 30;

    const userDoc   = await firestore.collection('users').doc(user.uid).get();
    const userData  = userDoc.data() || {};
    const userGroups      = userData.groups || [];
    const lookAheadDays   = userData.eventLookAhead ?? defaultLimit;

    const now        = new Date();
    const cutOff     = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
    const pastCutOff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const attendanceSnap = await firestore.collection('eventAttendance').where('userId', '==', user.uid).get();
    const attendanceByEvent = {};
    attendanceSnap.forEach(doc => { attendanceByEvent[doc.data().eventId] = { id: doc.id, ...doc.data() }; });

    let events = [];
    const seen = new Set();
    const addEvent = (doc) => {
      const data = doc.data();
      if (!seen.has(doc.id)) { seen.add(doc.id); events.push({ id: doc.id, ...data }); }
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
      if (e.status === 'cancelled') return false;
      const t = e.startTime?.toDate?.();
      if (!t) return false;
      if (t < now) return !!attendanceByEvent[e.id];
      return t <= cutOff;
    });

    const visibilityMode = settings.visibilityMode || 'count';
    for (const ev of events) {
      const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
      let count = 0;
      const names = [];
      attSnap.forEach(doc => {
        const d = doc.data();
        if (['registered','present','late_excused','late_unexcused'].includes(d.status)) {
          count++;
          if (visibilityMode === 'names') names.push(d.userId);
        }
      });
      ev._participantCount = count;
      if (visibilityMode === 'names' && names.length) {
        const resolved = [];
        for (const uid of names) {
          const uDoc = await firestore.collection('users').doc(uid).get();
          resolved.push(uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || uid) : uid);
        }
        ev._participantNames = resolved;
      }
    }

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

function renderMemberEventCard(event, attendance, isPast) {
  const settings       = window.appSettings || {};
  const signupMins     = event.signupDeadlineMinutes ?? settings.defaultSignupDeadlineMinutes ?? 60;
  const mode           = event.mode || settings.defaultMode || 'opt_in';
  const visMode        = settings.visibilityMode || 'count';
  const minPart        = event.minParticipants ?? settings.defaultMinParticipants ?? 0;
  const start          = event.startTime?.toDate ? event.startTime.toDate() : null;
  const end            = event.endTime?.toDate   ? event.endTime.toDate()   : null;
  const now            = new Date();
  const deadline       = start ? new Date(start.getTime() - signupMins * 60000) : null;
  const withinDeadline = !deadline || now <= deadline;
  const memberStatus   = attendance?.status || (mode === 'opt_out' ? 'registered' : 'none');
  const memberNote     = attendance?.memberNote || '';

  const card = createElement('div', 'card');

  const trainerLate = event.trainerLateNote
    ? `<div class="chip chip-warning" style="margin-bottom:8px;">⚠️ Trainer meldet Verspätung: ${event.trainerLateNote}</div>` : '';

  if (event.status === 'cancelled') {
    card.innerHTML = `
      ${trainerLate}
      <h3>${event.title || 'Termin'}</h3>
      <p class="text-muted">${start ? formatDateTime(start) : ''}</p>
      <div class="chip chip-error">❌ Abgesagt${event.cancellationReason ? ': ' + event.cancellationReason : ''}</div>
    `;
    return card;
  }

  const isRegistered = memberStatus === 'registered';
  let participantInfo = '';
  if (!isPast) {
    if (visMode === 'names' && event._participantNames)
      participantInfo = `<p class="text-muted" style="font-size:0.85rem;">Teilnehmer: ${event._participantNames.join(', ')}</p>`;
    else if (visMode === 'count' && event._participantCount != null)
      participantInfo = `<p class="text-muted" style="font-size:0.85rem;">Angemeldete Teilnehmer: ${event._participantCount}${minPart ? ' (mind. ' + minPart + ' benötigt)' : ''}</p>`;
  }

  const statusChipClass = {
    registered: 'chip-success', cancelled: 'chip-error', present: 'chip-success',
    absent_excused: 'chip-warning', absent_unexcused: 'chip-error',
    late_excused: 'chip-warning', late_unexcused: 'chip-warning'
  }[memberStatus] || '';

  const toggleLabel = mode === 'opt_in'
    ? (isRegistered ? 'Abmelden' : 'Anmelden')
    : (memberStatus === 'cancelled' ? 'Wieder anmelden' : 'Abmelden');

  card.innerHTML = `
    ${trainerLate}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
      <div>
        <h3 style="margin:0 0 4px;">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
      </div>
      <span class="chip ${statusChipClass}">${translateMemberStatus(memberStatus, mode)}</span>
    </div>
    ${event.description ? `<p style="margin:10px 0 4px;">${event.description}</p>` : ''}
    ${participantInfo}
    ${!withinDeadline && !isPast ? '<p class="text-muted" style="font-size:0.85rem;">⏱ Anmeldefrist abgelaufen</p>' : ''}
    <hr class="divider" />
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${!isPast && withinDeadline ? `<button class="btn-primary" data-action="toggle">${toggleLabel}</button>` : ''}
      ${!isPast ? `<button class="btn-secondary" data-action="late">Verspätung melden</button>` : ''}
    </div>
    <div style="margin-top:12px;">
      <label>Mein Hinweis (für Trainer sichtbar)</label>
      <textarea rows="2" data-role="note">${memberNote}</textarea>
      <button class="btn-secondary" data-action="save-note" style="margin-top:0;">Hinweis speichern</button>
    </div>
    <div data-role="error" class="text-error"></div>
  `;

  const errorEl  = card.querySelector('[data-role="error"]');
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
        <p>Bitte gib eine Begründung an. Falls du keine angibst, wird die Verspätung als <strong>entschuldigt</strong> gewertet – unentschuldigt kann nur ein Trainer eintragen.</p>
        <label>Begründung (optional)</label>
        <input type="text" id="late-reason-input" placeholder="z.B. Zug hatte Verspätung" />
      `,
      confirmLabel: 'Melden',
      onConfirm: async () => {
        const reason = document.getElementById('late-reason-input')?.value.trim() || '';
        // Immer late_excused – unentschuldigt nur durch Trainer
        await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).set({
          eventId: event.id, userId: window.currentUser.firebaseUser.uid,
          status: 'late_excused',
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
    eventId: event.id, userId: user.uid, status: newStatus,
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
