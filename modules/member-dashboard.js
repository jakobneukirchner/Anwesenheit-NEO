// modules/member-dashboard.js
// Mitglieder-Dashboard: Termine ansehen, an-/abmelden, Verspätung melden, Hinweise

async function loadMemberDashboard() {
  const container = document.getElementById('app-content');
  const user = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Termine...</div>`;

  try {
    const attendanceSnap = await firestore.collection('eventAttendance')
      .where('userId', '==', user.uid)
      .get();

    const attendanceByEvent = {};
    attendanceSnap.forEach(doc => {
      attendanceByEvent[doc.data().eventId] = { id: doc.id, ...doc.data() };
    });

    const userDoc = await firestore.collection('users').doc(user.uid).get();
    const userData = userDoc.data() || {};
    const userGroups = userData.groups || [];

    const now = new Date();
    let events = [];

    // Direkte Zuweisungen ohne problematische Misch-Query
    const directSnap = await firestore.collection('events')
      .where('directMembers', 'array-contains', user.uid)
      .get();
    directSnap.forEach(doc => {
      const data = doc.data();
      if (data.status !== 'cancelled' && !events.find(e => e.id === doc.id)) events.push({ id: doc.id, ...data });
    });

    // Gruppentermine
    for (const groupId of userGroups) {
      const groupSnap = await firestore.collection('events')
        .where('groupId', '==', groupId)
        .get();
      groupSnap.forEach(doc => {
        const data = doc.data();
        if (data.status !== 'cancelled' && !events.find(e => e.id === doc.id)) events.push({ id: doc.id, ...data });
      });
    }

    // Vergangene Events aus Attendance ergänzen
    for (const eventId of Object.keys(attendanceByEvent)) {
      if (!events.find(e => e.id === eventId)) {
        const evDoc = await firestore.collection('events').doc(eventId).get();
        if (evDoc.exists) events.push({ id: evDoc.id, ...evDoc.data() });
      }
    }

    // Teilnehmerinfos vorbereiten
    const visibilityMode = window.appSettings?.visibilityMode || 'count';
    for (const ev of events) {
      const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
      const attendees = [];
      const userIds = [];
      attSnap.forEach(doc => {
        const d = doc.data();
        if (['registered','present','late_excused','late_unexcused'].includes(d.status)) {
          attendees.push(d);
          userIds.push(d.userId);
        }
      });
      ev._participantCount = attendees.length;

      if (visibilityMode === 'names' && userIds.length) {
        const names = [];
        for (const uid of userIds) {
          const uDoc = await firestore.collection('users').doc(uid).get();
          if (uDoc.exists) names.push(uDoc.data().displayName || uDoc.data().email || uid);
        }
        ev._participantNames = names;
      }
    }

    events.sort((a, b) => {
      const aT = a.startTime?.toMillis ? a.startTime.toMillis() : 0;
      const bT = b.startTime?.toMillis ? b.startTime.toMillis() : 0;
      return aT - bT;
    });

    const upcoming = events.filter(e => {
      const t = e.startTime?.toDate ? e.startTime.toDate() : null;
      return t && t > now;
    });
    const past = events.filter(e => {
      const t = e.startTime?.toDate ? e.startTime.toDate() : null;
      return !t || t <= now;
    });

    container.innerHTML = `
      <div class="tabs">
        <button class="tab-btn active" data-tab="upcoming">Kommende Termine</button>
        <button class="tab-btn" data-tab="past">Vergangene Termine</button>
      </div>
      <div id="tab-upcoming"></div>
      <div id="tab-past" hidden></div>
    `;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-upcoming').hidden = btn.dataset.tab !== 'upcoming';
        document.getElementById('tab-past').hidden = btn.dataset.tab !== 'past';
      };
    });

    const upcomingEl = document.getElementById('tab-upcoming');
    const pastEl = document.getElementById('tab-past');

    if (!upcoming.length) upcomingEl.innerHTML = '<p class="text-muted">Keine kommenden Termine.</p>';
    else upcoming.forEach(ev => upcomingEl.appendChild(renderMemberEventCard(ev, attendanceByEvent[ev.id], false)));

    if (!past.length) pastEl.innerHTML = '<p class="text-muted">Keine vergangenen Termine.</p>';
    else past.forEach(ev => pastEl.appendChild(renderMemberEventCard(ev, attendanceByEvent[ev.id], true)));

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden der Termine.</p>';
  }
}

function renderMemberEventCard(event, attendance, isPast) {
  const settings = window.appSettings || {};
  const signupMins = event.signupDeadlineMinutes ?? settings.defaultSignupDeadlineMinutes ?? 60;
  const mode = event.mode || settings.defaultMode || 'opt_in';
  const visMode = event.visibilityMode || settings.visibilityMode || 'count';
  const minPart = event.minParticipants ?? settings.defaultMinParticipants ?? 0;

  const start = event.startTime?.toDate ? event.startTime.toDate() : null;
  const end = event.endTime?.toDate ? event.endTime.toDate() : null;
  const now = new Date();
  const deadline = start ? new Date(start.getTime() - signupMins * 60000) : null;
  const withinDeadline = !deadline || now <= deadline;

  const memberStatus = attendance?.status || (mode === 'opt_out' ? 'registered' : 'none');
  const memberNote = attendance?.memberNote || '';
  const card = createElement('div', 'card');

  const trainerLate = event.trainerLateNote ? `<div class="chip chip-warning" style="margin-bottom:8px;">⚠️ Trainer meldet Verspätung: ${event.trainerLateNote}</div>` : '';
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
    if (visMode === 'names' && event._participantNames) {
      participantInfo = `<p class="text-muted" style="font-size:0.85rem;">Teilnehmer: ${event._participantNames.join(', ')}</p>`;
    } else if (visMode === 'count' && event._participantCount != null) {
      participantInfo = `<p class="text-muted" style="font-size:0.85rem;">Angemeldete Teilnehmer: ${event._participantCount}${minPart ? ' (mind. ' + minPart + ' benötigt)' : ''}</p>`;
    }
  }

  const statusChipClass = {
    registered: 'chip-success', cancelled: 'chip-error',
    present: 'chip-success', absent_excused: 'chip-warning',
    absent_unexcused: 'chip-error', late_excused: 'chip-warning', late_unexcused: 'chip-warning'
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
    ${event.description ? '<p style="margin:10px 0 4px;">' + event.description + '</p>' : ''}
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

  const errorEl = card.querySelector('[data-role="error"]');
  const toggleBtn = card.querySelector('[data-action="toggle"]');
  if (toggleBtn) {
    toggleBtn.onclick = () => guardedAction(async () => {
      try { await memberToggleAttendance(event, attendance, mode, deadline); }
      catch (e) { errorEl.textContent = 'Aktion fehlgeschlagen: ' + e.message; }
    });
  }

  const lateBtn = card.querySelector('[data-action="late"]');
  if (lateBtn) {
    lateBtn.onclick = () => guardedAction(async () => {
      try { await memberMarkLate(event, attendance); }
      catch (e) { errorEl.textContent = 'Verspätung konnte nicht gemeldet werden.'; }
    });
  }

  const noteTextarea = card.querySelector('textarea[data-role="note"]');
  const noteBtn = card.querySelector('[data-action="save-note"]');
  if (noteBtn) {
    noteBtn.onclick = () => guardedAction(async () => {
      try {
        await memberSaveNote(event, attendance, noteTextarea.value);
        showToast('Hinweis gespeichert.', 'success');
      } catch (e) { errorEl.textContent = 'Hinweis konnte nicht gespeichert werden.'; }
    });
  }

  return card;
}

function translateMemberStatus(status, mode) {
  switch (status) {
    case 'registered': return mode === 'opt_in' ? 'Angemeldet' : 'Vorgemerkt';
    case 'none': return mode === 'opt_in' ? 'Nicht angemeldet' : 'Vorgemerkt';
    case 'cancelled': return 'Abgemeldet';
    case 'present': return 'Anwesend';
    case 'absent_excused': return 'Entschuldigt gefehlt';
    case 'absent_unexcused': return 'Unentschuldigt gefehlt';
    case 'late_excused': return 'Verspätet (entschuldigt)';
    case 'late_unexcused': return 'Verspätet (unentschuldigt)';
    default: return status;
  }
}

async function memberToggleAttendance(event, attendance, mode, deadline) {
  const user = window.currentUser.firebaseUser;
  const now = new Date();
  if (deadline && now > deadline) { showToast('Anmeldefrist abgelaufen.', 'warning'); return; }

  const currentStatus = attendance?.status || (mode === 'opt_out' ? 'registered' : 'none');
  let newStatus;
  if (mode === 'opt_in') newStatus = currentStatus === 'registered' ? 'cancelled' : 'registered';
  else newStatus = currentStatus === 'cancelled' ? 'registered' : 'cancelled';

  const docId = `${event.id}_${user.uid}`;
  await firestore.collection('eventAttendance').doc(docId).set({
    eventId: event.id,
    userId: user.uid,
    status: newStatus,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  showToast(newStatus === 'registered' ? 'Erfolgreich angemeldet.' : 'Erfolgreich abgemeldet.', 'success');
  loadMemberDashboard();
}

async function memberMarkLate(event, attendance) {
  const user = window.currentUser.firebaseUser;
  const reason = prompt('Begründung für die Verspätung (optional – leer lassen für unentschuldigt):');
  if (reason === null) return;
  const status = reason.trim() ? 'late_excused' : 'late_unexcused';
  const docId = `${event.id}_${user.uid}`;
  await firestore.collection('eventAttendance').doc(docId).set({
    eventId: event.id,
    userId: user.uid,
    status,
    memberNote: reason.trim() || (attendance?.memberNote || ''),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  showToast('Verspätung gemeldet.', 'success');
  loadMemberDashboard();
}

async function memberSaveNote(event, attendance, note) {
  const user = window.currentUser.firebaseUser;
  const docId = `${event.id}_${user.uid}`;
  await firestore.collection('eventAttendance').doc(docId).set({
    eventId: event.id,
    userId: user.uid,
    memberNote: note,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}
