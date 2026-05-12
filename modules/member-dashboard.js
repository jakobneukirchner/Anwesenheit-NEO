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
        ev._trainerNames     = trainerIds.map(tid => trainerNames[tid] || tid);
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
  if (loc