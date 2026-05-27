// modules/trainer-dashboard.js

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  const user = window.currentUser.firebaseUser;
  const tLabel = getRoleLabel('teacher');
  container.innerHTML = `<div class="loading-center">Lade ${tLabel}-Termine...</div>`;

  try {
    const settingsDoc  = await firestore.collection('settings').doc('global').get();
    const settings     = settingsDoc.exists ? settingsDoc.data() : {};
    window.appSettings = settings;
    const defaultLimit = settings.defaultEventLookAhead ?? 30;

    const userDoc   = await firestore.collection('users').doc(user.uid).get();
    const userData  = userDoc.exists ? userDoc.data() : {};
    const lookAheadDays = userData.eventLookAhead ?? defaultLimit;

    const now        = new Date();
    const cutOff     = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
    const pastCutOff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    let events = [];
    const seen = new Set();
    const addEvents = (snap) => snap.forEach(doc => {
      if (!seen.has(doc.id)) { seen.add(doc.id); events.push({ id: doc.id, ...doc.data() }); }
    });

    const trainerSnap = await firestore.collection('events').where('trainers', 'array-contains', user.uid).get();
    addEvents(trainerSnap);
    const cancelledSnap = await firestore.collection('events').where('trainerCancellations', 'array-contains', user.uid).get();
    addEvents(cancelledSnap);
    const userGroups = userData.groups || [];
    for (const groupId of userGroups) {
      const groupSnap = await firestore.collection('events').where('groupId', '==', groupId).get();
      addEvents(groupSnap);
    }

    events = events.filter(e => {
      const t = e.startTime?.toDate?.();
      if (!t) return false;
      return t >= pastCutOff && t <= cutOff;
    });
    events.sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0));

    await Promise.all(events.map(async ev => {
      const minPart = ev.minParticipants ?? settings.defaultMinParticipants ?? 0;
      if (!minPart || ev.status === 'cancelled') return;
      const snap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
      let count = 0;
      snap.forEach(doc => {
        if (['registered','present','late_excused','late_unexcused','confirmation_pending'].includes(doc.data().status)) count++;
      });
      ev._participantCount = count;
      ev._minParticipants  = minPart;
      ev._missing          = Math.max(0, minPart - count);
    }));

    const upcoming = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past     = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; });

    container.innerHTML = `
      <h2 style="margin-top:0;">${tLabel}-Dashboard</h2>
      <p class="text-muted" style="margin-top:-8px;margin-bottom:16px;font-size:0.85rem;">
        Termine bis <strong>${cutOff.toLocaleDateString('de-DE')}</strong> (${lookAheadDays} Tage im Voraus)
      </p>
      <div class="tabs">
        <button class="tab-btn active" data-tab="upcoming">Kommende Termine (${upcoming.length})</button>
        <button class="tab-btn" data-tab="past">Vergangene Termine (${past.length})</button>
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
    else for (const ev of upcoming) upcomingEl.appendChild(renderTrainerEventSummaryCard(ev, false));

    if (!past.length) pastEl.innerHTML = '<p class="text-muted">Keine vergangenen Termine.</p>';
    else for (const ev of past) pastEl.appendChild(renderTrainerEventSummaryCard(ev, true));

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden: ' + e.message + '</p>';
  }
}

function renderTrainerEventSummaryCard(event, isPast) {
  const card           = createElement('div', 'card');
  const start          = event.startTime?.toDate?.();
  const end            = event.endTime?.toDate?.();
  const isCancelled    = event.status === 'cancelled';
  const missing        = event._missing ?? 0;
  const uid            = window.currentUser?.firebaseUser?.uid;
  const isSelfCancelled = (event.trainerCancellations || []).includes(uid);

  if (isCancelled)          card.style.borderLeft = '4px solid var(--color-error, #c62828)';
  else if (isSelfCancelled) card.style.borderLeft = '4px solid var(--color-warning, #e65100)';
  else if (!isPast && missing > 0) card.style.borderLeft = '4px solid var(--color-warning, #e65100)';
  card.style.cursor = 'pointer';

  const missingBadge = (!isCancelled && !isPast && missing > 0)
    ? `<span class="chip chip-warning" style="font-size:0.82rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
        <span class="material-icons" style="font-size:14px;">warning</span>
        Noch ${missing} Person${missing === 1 ? '' : 'en'} benötigt
       </span>`
    : '';
  const selfCancelBadge = isSelfCancelled
    ? `<span class="chip chip-warning" style="font-size:0.82rem;">Du hast dich abgemeldet</span>` : '';

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
      <div style="flex:1;min-width:0;">
        <h3 style="margin:0 0 4px;${isCancelled || isSelfCancelled ? 'opacity:0.6;' : ''}">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        ${missingBadge}${selfCancelBadge}
        ${isCancelled
          ? '<span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">cancel</span> Abgesagt</span>'
          : isSelfCancelled
          ? '<span class="chip chip-warning">Abgemeldet</span>'
          : isPast
          ? '<span class="chip chip-info">Vergangen</span>'
          : '<span class="chip chip-success" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">check_circle</span> Aktiv</span>'}
        <button class="btn-primary" data-action="detail" style="padding:5px 14px;font-size:0.85rem;">Details &rsaquo;</button>
      </div>
    </div>
    ${event.trainerLateNote
      ? `<div class="chip chip-warning" style="margin-top:8px;display:inline-flex;align-items:center;gap:4px;">
           <span class="material-icons" style="font-size:14px;">schedule</span> Verspätung: ${event.trainerLateNote}
         </div>`
      : ''}
    ${isCancelled ? `<p class="text-muted" style="margin:6px 0 0;font-size:0.88rem;">Begründung: ${event.cancellationReason || '–'}</p>` : ''}
    ${!isCancelled && !isPast && event._minParticipants
      ? `<p class="text-muted" style="margin:6px 0 0;font-size:0.83rem;">${event._participantCount ?? 0} / ${event._minParticipants} Teilnehmer angemeldet</p>`
      : ''}
  `;

  card.querySelector('[data-action="detail"]').onclick = (e) => { e.stopPropagation(); openTrainerEventDetail(event); };
  card.onclick = () => openTrainerEventDetail(event);
  return card;
}

async function openTrainerEventDetail(event) {
  const container = document.getElementById('app-content');
  const myUid     = window.currentUser.firebaseUser.uid;
  const tLabel    = getRoleLabel('teacher');
  container.innerHTML = `<div class="loading-center">Lade Termin-Details...</div>`;

  try {
    const evDoc   = await firestore.collection('events').doc(event.id).get();
    const ev      = evDoc.exists ? { id: evDoc.id, ...evDoc.data() } : event;

    const settings        = window.appSettings || {};
    const start           = ev.startTime?.toDate?.();
    const end             = ev.endTime?.toDate?.();
    const isCancelled     = ev.status === 'cancelled';
    const isSelfCancelled = (ev.trainerCancellations || []).includes(myUid);
    const trainerIds      = ev.trainers || [];
    const cancelledIds    = ev.trainerCancellations || [];
    const minPart         = ev.minParticipants ?? settings.defaultMinParticipants ?? 0;

    const allTrainerIds = [...new Set([...trainerIds, ...cancelledIds])];
    const trainerNames  = {};
    await Promise.all(allTrainerIds.map(async tid => {
      const uDoc = await firestore.collection('users').doc(tid).get();
      trainerNames[tid] = uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || tid) : tid;
    }));

    const myUserDoc  = await firestore.collection('users').doc(myUid).get();
    const myName     = myUserDoc.exists ? (myUserDoc.data().displayName || myUserDoc.data().email || myUid) : myUid;

    // Alle Nutzer laden – unabhängig von Rolle für "Hinzufügen"-Feature
    const allUsersSnap = await firestore.collection('users').get();
    const allTeachers  = [];
    const allUsers     = []; // Alle Nutzer (für manuelles Hinzufügen)
    allUsersSnap.forEach(doc => {
      const d = doc.data();
      const roles = d.roles || [];
      const entry = { uid: doc.id, name: d.displayName || d.email || doc.id, roles };
      allUsers.push(entry);
      if (doc.id !== myUid && (roles.includes('teacher') || roles.includes('admin') || roles.includes('coordinator'))) {
        allTeachers.push(entry);
      }
    });

    const subSnap = await firestore.collection('substituteRequests')
      .where('eventId', '==', ev.id).where('requesterId', '==', myUid).get();
    const mySubReqs = [];
    subSnap.forEach(doc => mySubReqs.push({ id: doc.id, ...doc.data() }));
    const myActiveSubReqs = mySubReqs.filter(r => r.status === 'pending' || r.status === 'accepted');
    const neededCount = myActiveSubReqs.length > 0 ? (myActiveSubReqs[0].neededCount ?? 1) : 1;
    const acceptedReqs = myActiveSubReqs.filter(r => r.status === 'accepted');

    const incomingSnap = await firestore.collection('substituteRequests')
      .where('eventId', '==', ev.id).where('targetId', '==', myUid).where('status', '==', 'pending').get();
    const incomingReqs = [];
    incomingSnap.forEach(doc => incomingReqs.push({ id: doc.id, ...doc.data() }));

    const incomingWithContext = await Promise.all(incomingReqs.map(async req => {
      const siblingSnap = await firestore.collection('substituteRequests')
        .where('eventId', '==', ev.id).where('requesterId', '==', req.requesterId).get();
      const siblings = [];
      siblingSnap.forEach(d => siblings.push({ id: d.id, ...d.data() }));
      const accepted = siblings.filter(s => s.status === 'accepted').length;
      const needed   = req.neededCount ?? 1;
      const requesterDoc = await firestore.collection('users').doc(req.requesterId).get();
      const requesterName = requesterDoc.exists
        ? (requesterDoc.data().displayName || requesterDoc.data().email || req.requesterId)
        : req.requesterId;
      return { ...req, acceptedCount: accepted, neededCount: needed, requesterName };
    }));

    const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    const registeredCount = attendances.filter(a =>
      ['registered','present','late_excused','late_unexcused','confirmation_pending'].includes(a.status)
    ).length;
    const missingCount = minPart ? Math.max(0, minPart - registeredCount) : 0;

    const existingAttendeeUids = new Set(attendances.map(a => a.userId));

    const userMap = {};
    for (const att of attendances) {
      if (!userMap[att.userId]) {
        const uDoc = await firestore.collection('users').doc(att.userId).get();
        userMap[att.userId] = uDoc.exists
          ? { name: uDoc.data().displayName || uDoc.data().email || att.userId, generalNote: uDoc.data().generalNote || '' }
          : { name: att.userId, generalNote: '' };
      }
    }

    // Status-Chip ohne Sanduhr-Emoji
    const statusChipHtml = (status) => {
      const map = {
        present:              ['chip-success', 'Anwesend'],
        registered:           ['chip-info',    'Angemeldet'],
        cancelled:            ['chip-error',   'Abgemeldet'],
        absent_excused:       ['chip-warning', 'Entsch. gefehlt'],
        absent_unexcused:     ['chip-error',   'Unentsch. gefehlt'],
        late_excused:         ['chip-warning', 'Verspätet (E)'],
        late_unexcused:       ['chip-warning', 'Verspätet (U)'],
        confirmation_pending: ['chip-warning', 'Ausstehend'],
      };
      const [cls, label] = map[status] || ['', status];
      return `<span class="chip ${cls}" style="font-size:0.8rem;">${label}</span>`;
    };

    // Tabellenzeilen – manuell hinzugefügte haben Entfernen-Button
    const memberRows = attendances.map(att => {
      const u = userMap[att.userId] || { name: att.userId, generalNote: '' };
      const isManual = !!att.addedByTrainer;
      return `
      <tr data-att-id="${att.id}">
        <td>
          <span style="font-weight:500;">${u.name}</span>
          ${u.generalNote
            ? `<button class="btn-text info-btn" data-note="${encodeURIComponent(u.generalNote)}" title="Allgemeine Notiz" style="font-size:0.85rem;padding:0 4px;vertical-align:middle;">
                <span class="material-icons" style="font-size:16px;">info</span>
               </button>`
            : ''}
          ${isManual ? '<span class="chip" style="font-size:0.72rem;margin-left:4px;background:var(--color-surface-offset);color:var(--color-text-muted);">Manuell</span>' : ''}
        </td>
        <td id="status-chip-${att.id}">${statusChipHtml(att.status)}</td>
        <td>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" class="presence-cb" data-att-id="${att.id}"
              style="width:20px;height:20px;" ${att.status === 'present' ? 'checked' : ''} />
            Anwesend
          </label>
        </td>
        <td>
          <select class="status-select" data-att-id="${att.id}" style="font-size:0.85rem;">
            <option value="present"              ${att.status==='present'              ?'selected':''}>Anwesend</option>
            <option value="registered"           ${att.status==='registered'           ?'selected':''}>Angemeldet (offen)</option>
            <option value="confirmation_pending" ${att.status==='confirmation_pending' ?'selected':''}>Ausstehend (Bestätigung)</option>
            <option value="absent_excused"       ${att.status==='absent_excused'       ?'selected':''}>Entschuldigt gefehlt</option>
            <option value="absent_unexcused"     ${att.status==='absent_unexcused'     ?'selected':''}>Unentschuldigt gefehlt</option>
            <option value="late_excused"         ${att.status==='late_excused'         ?'selected':''}>Verspätet (entschuldigt)</option>
            <option value="late_unexcused"       ${att.status==='late_unexcused'       ?'selected':''}>Verspätet (unentschuldigt)</option>
            <option value="cancelled"            ${att.status==='cancelled'            ?'selected':''}>Abgemeldet</option>
          </select>
        </td>
        <td>
          <input type="text" class="trainer-note-internal" data-att-id="${att.id}"
            placeholder="Interne Notiz (nur ${tLabel})" value="${att.trainerNoteInternal || ''}"
            style="min-width:120px;font-size:0.85rem;" />
        </td>
        <td>
          <input type="text" class="trainer-note-member" data-att-id="${att.id}"
            placeholder="Notiz an Mitglied" value="${att.trainerNoteMember || ''}"
            style="min-width:120px;font-size:0.85rem;" />
        </td>
        <td class="text-muted" style="font-size:0.82rem;max-width:140px;">${att.memberNote || ''}</td>
        <td>
          ${isManual ? `
            <button class="btn-danger remove-manual-att-btn" data-att-id="${att.id}"
              title="Manuell hinzugefügte Person entfernen"
              style="padding:4px 10px;font-size:0.82rem;display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:15px;">person_remove</span>
            </button>` : ''}
        </td>
      </tr>`;
    }).join('');

    const missingTileHtml = minPart ? `
      <div class="card" style="margin:0;${missingCount > 0 ? 'border-left:3px solid var(--color-warning,#e65100);' : 'border-left:3px solid var(--color-success,#2e7d32);'}">
        <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Noch benötigt</p>
        <p style="margin:0;font-weight:700;font-size:1.3rem;color:${missingCount > 0 ? 'var(--color-warning,#e65100)' : 'var(--color-success,#2e7d32)'};">${
          missingCount > 0
            ? missingCount
            : '<span class="material-icons" style="font-size:1.2rem;vertical-align:middle;">check_circle</span>'
        }</p>
        ${missingCount > 0
          ? `<p class="text-muted" style="margin:2px 0 0;font-size:0.8rem;">(mind. ${minPart} benötigt)</p>`
          : `<p class="text-muted" style="margin:2px 0 0;font-size:0.8rem;">Mindestanzahl erreicht</p>`}
      </div>` : '';

    const trainerStatusHtml = (trainerIds.length || cancelledIds.length) ? `
      <div class="card" style="margin-bottom:16px;">
        <h4 style="margin:0 0 10px;display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="color:var(--color-primary);">group</span>
          ${tLabel} dieses Termins
        </h4>
        ${trainerIds.map(tid => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);">
            <span style="font-weight:500;flex:1;">${trainerNames[tid]||tid}</span>
            <span class="chip chip-success" style="font-size:0.8rem;display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:13px;">check</span> Eingeplant
            </span>
          </div>`).join('')}
        ${cancelledIds.map(tid => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);">
            <span style="font-weight:500;flex:1;color:var(--color-text-muted);">${trainerNames[tid]||tid}</span>
            <span class="chip chip-error" style="font-size:0.8rem;">Abgemeldet</span>
          </div>`).join('')}
      </div>` : '';

    const incomingSubHtml = incomingWithContext.map(req => {
      const stillNeeded = Math.max(0, req.neededCount - req.acceptedCount);
      const contextInfo = req.neededCount > 1
        ? `<span class="chip chip-info" style="font-size:0.8rem;margin-left:6px;">${req.acceptedCount} / ${req.neededCount} Zusagen</span>`
        : '';
      return `
      <div class="card" style="margin-bottom:12px;border-left:4px solid var(--color-primary);background:rgba(21,101,192,0.05);">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
          <p style="margin:0;font-weight:600;display:flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:18px;color:var(--color-primary);">mail</span>
            Vertretungsanfrage von ${req.requesterName}
          </p>
          ${contextInfo}
          ${stillNeeded > 0
            ? `<span class="chip chip-warning" style="font-size:0.8rem;">Noch ${stillNeeded} Vertretung${stillNeeded===1?'':'en'} gesucht</span>`
            : '<span class="chip chip-success" style="font-size:0.8rem;">Bereits genügend Zusagen</span>'}
        </div>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.88rem;">Du wurdest als mögliche Vertretung angefragt${req.reason ? ': „' + req.reason + '"' : '.'}</p>
        <div style="display:flex;gap:8px;">
          <button class="btn-primary sub-accept-btn" data-sub-id="${req.id}" data-requester-id="${req.requesterId}" style="padding:5px 14px;">Annehmen</button>
          <button class="btn-secondary sub-decline-btn" data-sub-id="${req.id}" data-requester-id="${req.requesterId}" data-needed="${req.neededCount}" data-accepted="${req.acceptedCount}" data-event-id="${ev.id}" style="padding:5px 14px;">Ablehnen</button>
        </div>
      </div>`;
    }).join('');

    const mySubHtml = myActiveSubReqs.length > 0 ? `
      <div class="card" style="margin-bottom:12px;border-left:4px solid var(--color-warning,#e65100);">
        <p style="margin:0 0 4px;font-weight:600;color:var(--color-warning,#e65100);display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">schedule</span>
          Vertretungsanfragen offen
        </p>
        <p class="text-muted" style="margin:0 0 4px;font-size:0.88rem;">
          Bisher <strong>${acceptedReqs.length} von ${neededCount}</strong> benötigten Vertretungen zugesagt.
        </p>
        <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;">
          ${myActiveSubReqs.map(r => {
            const tName = allTeachers.find(t => t.uid === r.targetId)?.name || r.targetId;
            const statusChip = r.status === 'accepted'
              ? `<span class="chip chip-success" style="font-size:0.75rem;display:inline-flex;align-items:center;gap:3px;"><span class="material-icons" style="font-size:12px;">check</span> Angenommen</span>`
              : `<span class="chip chip-info" style="font-size:0.75rem;display:inline-flex;align-items:center;gap:3px;"><span class="material-icons" style="font-size:12px;">schedule</span> Ausstehend</span>`;
            return `<div style="display:flex;align-items:center;gap:8px;font-size:0.88rem;"><span>${tName}</span>${statusChip}</div>`;
          }).join('')}
        </div>
        <button class="btn-secondary" id="cancel-all-sub-reqs-btn" style="padding:4px 12px;">Alle Anfragen zurückziehen</button>
      </div>` : '';

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <button class="btn-secondary" id="detail-back" style="padding:6px 16px;display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:18px;">arrow_back</span> Zurück
        </button>
        <h2 style="margin:0;${isCancelled ? 'text-decoration:line-through;opacity:0.7;' : ''}">${ev.title || 'Termin'}</h2>
        ${isCancelled
          ? '<span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">cancel</span> Abgesagt</span>'
          : ''}
        ${isSelfCancelled ? '<span class="chip chip-warning">Du hast dich abgemeldet</span>' : ''}
        ${!isCancelled && missingCount > 0
          ? `<span class="chip chip-warning" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">warning</span> Noch ${missingCount} Person${missingCount===1?'':'en'} benötigt</span>`
          : ''}
      </div>

      ${incomingSubHtml}
      ${mySubHtml}

      ${isSelfCancelled ? `
        <div class="card" style="margin-bottom:16px;border-left:4px solid var(--color-warning,#e65100);">
          <p style="margin:0 0 4px;font-weight:600;color:var(--color-warning,#e65100);">Du hast dich von diesem Termin abgemeldet.</p>
          <button class="btn-primary" id="revoke-self-cancel-btn" style="margin-top:8px;">Abmeldung widerrufen</button>
        </div>` : ''}

      ${isCancelled ? `
        <div class="card" style="margin-bottom:16px;border-left:4px solid var(--color-error,#c62828);">
          <p class="text-error" style="margin:0 0 4px;font-weight:600;display:flex;align-items:center;gap:6px;">
            <span class="material-icons">cancel</span> Termin abgesagt
          </p>
          <p class="text-muted" style="margin:0;">Begründung: ${ev.cancellationReason || '–'}</p>
          <button class="btn-secondary" id="revoke-cancel-btn" style="margin-top:12px;">Absage widerrufen</button>
        </div>` : ''}

      <div class="dashboard-grid" style="margin-bottom:16px;">
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Datum &amp; Zeit</p>
          <p style="margin:0;font-weight:600;">${start ? formatDateTime(start) : '–'}${end ? ' – ' + formatTime(end) : ''}</p>
        </div>
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Angemeldet</p>
          <p style="margin:0;font-weight:700;font-size:1.3rem;">${registeredCount}${minPart ? ' / ' + minPart : ''}</p>
        </div>
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Anwesend</p>
          <p style="margin:0;font-weight:700;font-size:1.3rem;color:var(--color-success);">${attendances.filter(a=>a.status==='present').length}</p>
        </div>
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Gefehlt</p>
          <p style="margin:0;font-weight:700;font-size:1.3rem;color:var(--color-error);">${attendances.filter(a=>['absent_excused','absent_unexcused'].includes(a.status)).length}</p>
        </div>
        ${missingTileHtml}
      </div>

      ${trainerStatusHtml}

      ${ev.description ? `<div class="card" style="margin-bottom:16px;"><p style="margin:0;">${ev.description}</p></div>` : ''}

      <div class="card" style="margin-bottom:16px;">
        <h4 style="margin:0 0 6px;display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="color:var(--color-primary);">campaign</span>
          Nachricht an alle Mitglieder
        </h4>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.85rem;">Wird auf jeder Teilnehmer-Termincard als „Nachricht von ${myName}" angezeigt.</p>
        <textarea id="event-broadcast" rows="2" placeholder="z.B. Bitte Sportschuhe mitbringen...">${ev.trainerBroadcast || ''}</textarea>
        <button class="btn-secondary" id="save-broadcast" style="margin-top:0;display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:16px;">save</span> Nachricht speichern
        </button>
        <span id="broadcast-saved" class="text-muted" style="font-size:0.85rem;margin-left:10px;display:none;">
          <span class="material-icons" style="font-size:14px;vertical-align:middle;">check</span> Gespeichert
        </span>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <h3 style="margin:0;">Anwesenheitsliste (${attendances.length})</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-secondary" id="add-member-to-event-btn" style="padding:5px 14px;font-size:0.85rem;display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:16px;">person_add</span> Person hinzufügen
            </button>
            <button class="btn-secondary" id="mark-all-present" style="padding:5px 14px;font-size:0.85rem;display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:16px;">check</span> Alle anwesend
            </button>
            <button class="btn-primary" id="save-all-attendance" style="display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:16px;">save</span> Speichern
            </button>
          </div>
        </div>
        ${attendances.length ? `
          <div style="overflow-x:auto;">
            <table>
              <thead><tr>
                <th>Name</th><th>Status</th><th>Schnell-Check</th><th>Detailstatus</th>
                <th>Interne Notiz <small class="text-muted">(nur ${tLabel})</small></th>
                <th>Notiz an Mitglied</th>
                <th>Hinweis v. Mitglied</th>
                <th></th>
              </tr></thead>
              <tbody id="attendance-tbody">${memberRows}</tbody>
            </table>
          </div>
        ` : '<p class="text-muted" id="no-attendees-msg">Keine Teilnehmer angemeldet.</p>'}
      </div>

      <div class="card" style="margin-top:16px;">
        <h3 style="margin-top:0;">Aktionen</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${!isCancelled && !isSelfCancelled ? `
            <button class="btn-danger" id="cancel-event-btn" style="display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">event_busy</span>
              Abmelden / Termin absagen
            </button>
            <button class="btn-secondary" id="trainer-late-btn" style="display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">schedule</span>
              Verspätung melden
            </button>
          ` : ''}
        </div>
        ${ev.trainerLateNote
          ? `<div class="chip chip-warning" style="margin-top:10px;display:inline-flex;align-items:center;gap:4px;">
               <span class="material-icons" style="font-size:14px;">schedule</span> Verspätung: ${ev.trainerLateNote}
             </div>`
          : ''}
      </div>
      <div id="detail-error" class="text-error" style="margin-top:8px;"></div>
    `;

    document.getElementById('detail-back').onclick = () => loadTrainerDashboard();

    // ── Manuell hinzugefügte Personen entfernen ──────────────────────────────
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('.remove-manual-att-btn');
      if (!btn) return;
      const attId = btn.dataset.attId;
      showModal({
        title: 'Person aus Termin entfernen',
        body: '<p>Diese manuell hinzugefügte Person wirklich aus dem Termin entfernen?</p>',
        confirmLabel: 'Entfernen',
        onConfirm: async () => {
          try {
            await firestore.collection('eventAttendance').doc(attId).delete();
            showToast('Person wurde entfernt.', 'success');
            openTrainerEventDetail(ev);
          } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
        }
      });
    });

    // ── Person zum Termin hinzufügen (alle Nutzer, unabhängig von Rolle) ─────
    document.getElementById('add-member-to-event-btn')?.addEventListener('click', () => {
      const available = allUsers.filter(u => !existingAttendeeUids.has(u.uid));
      if (!available.length) {
        showToast('Alle Nutzer sind bereits eingetragen.', 'info');
        return;
      }
      showModal({
        title: 'Person zum Termin hinzufügen',
        body: `
          <p class="text-muted" style="margin-bottom:12px;font-size:0.88rem;">
            Die Person wird auch dann hinzugefügt, wenn sie nicht in der Gruppe ist.
          </p>
          <label>Person suchen</label>
          <input type="text" id="member-search-input" placeholder="Name oder E-Mail..." style="margin-bottom:8px;" />
          <div id="member-list" style="max-height:200px;overflow-y:auto;border:1px solid var(--color-border);border-radius:6px;">
            ${available.map(u => `
              <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--color-border);color:var(--color-text);">
                <input type="radio" name="add-member-pick" value="${u.uid}" style="width:16px;height:16px;" />
                <span>${u.name}</span>
                <span class="chip" style="font-size:0.72rem;margin-left:auto;background:var(--color-surface-offset);color:var(--color-text-muted);">${(u.roles||[]).join(', ') || '–'}</span>
              </label>`).join('')}
          </div>
          <label style="margin-top:14px;">Teilnahme-Rolle bei diesem Termin</label>
          <select id="add-member-event-role" style="font-size:0.9rem;margin-bottom:10px;">
            <option value="member">Als Mitglied (Teilnehmer)</option>
            <option value="trainer_full">Als Trainer – mit Anwesenheitsrechten (kann bearbeiten)</option>
            <option value="trainer_readonly">Als Trainer – nur lesen (kann Anwesenheit sehen)</option>
            <option value="trainer_hidden">Als Trainer – ohne Anwesenheitszugang (sieht Liste nicht)</option>
          </select>
          <label>Anfangsstatus</label>
          <select id="add-member-status" style="font-size:0.9rem;">
            <option value="registered">Angemeldet</option>
            <option value="confirmation_pending">Ausstehend (Bestätigung)</option>
            <option value="present">Anwesend</option>
          </select>`,
        confirmLabel: 'Hinzufügen',
        onConfirm: async () => {
          const picked    = document.querySelector('input[name="add-member-pick"]:checked')?.value;
          const eventRole = document.getElementById('add-member-event-role')?.value || 'member';
          const status    = document.getElementById('add-member-status')?.value || 'registered';
          if (!picked) { showToast('Bitte eine Person auswählen.', 'warning'); return false; }
          try {
            const existing = await firestore.collection('eventAttendance')
              .where('eventId', '==', ev.id).where('userId', '==', picked).get();
            if (!existing.empty) { showToast('Person ist bereits eingetragen.', 'info'); return false; }
            await firestore.collection('eventAttendance').add({
              eventId:       ev.id,
              userId:        picked,
              status,
              eventRole,           // 'member' | 'trainer_full' | 'trainer_readonly' | 'trainer_hidden'
              addedByTrainer: true,
              addedAt:       firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
            });
            // Falls Trainer-Rolle: auch im Event-Dokument eintragen
            if (eventRole.startsWith('trainer')) {
              await firestore.collection('events').doc(ev.id).update({
                trainers: firebase.firestore.FieldValue.arrayUnion(picked),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            }
            showToast('Person wurde zum Termin hinzugefügt.', 'success');
            openTrainerEventDetail(ev);
          } catch (err) { showToast('Fehler: ' + err.message, 'error'); return false; }
        }
      });

      // Live-Suche
      setTimeout(() => {
        const si = document.getElementById('member-search-input');
        const ml = document.getElementById('member-list');
        if (si && ml) {
          si.addEventListener('input', () => {
            const q = si.value.toLowerCase();
            ml.querySelectorAll('label').forEach(lbl => {
              lbl.style.display = lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
          });
        }
      }, 80);
    });

    // ── Info-Notiz-Buttons ───────────────────────────────────────────────────
    container.querySelectorAll('.info-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showModal({ title: 'Allgemeine Notiz', body: `<p>${decodeURIComponent(btn.dataset.note)}</p>`, confirmLabel: 'OK', onConfirm: () => {} });
      };
    });

    document.getElementById('revoke-cancel-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Absage widerrufen',
        body: '<p>Soll der Termin wieder als aktiv markiert werden?</p>',
        confirmLabel: 'Ja, widerrufen',
        onConfirm: async () => {
          try {
            await firestore.collection('events').doc(ev.id).update({
              status:             firebase.firestore.FieldValue.delete(),
              cancellationReason: firebase.firestore.FieldValue.delete(),
              updatedAt:          firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Absage widerrufen. Termin ist wieder aktiv.', 'success');
            loadTrainerDashboard();
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
        }
      });
    });

    document.getElementById('revoke-self-cancel-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Abmeldung widerrufen',
        body: `<p>Möchtest du deine Abmeldung rückgängig machen und dich wieder als ${tLabel} eintragen?</p>`,
        confirmLabel: 'Ja, wieder eintragen',
        onConfirm: async () => {
          try {
            await firestore.collection('events').doc(ev.id).update({
              trainers:             firebase.firestore.FieldValue.arrayUnion(myUid),
              trainerCancellations: firebase.firestore.FieldValue.arrayRemove(myUid),
              updatedAt:            firebase.firestore.FieldValue.serverTimestamp()
            });
            if (myActiveSubReqs.length > 0) {
              const batch = firestore.batch();
              myActiveSubReqs.forEach(r => batch.update(firestore.collection('substituteRequests').doc(r.id), { status: 'revoked' }));
              await batch.commit();
            }
            showToast(`Abmeldung widerrufen. Du bist wieder als ${tLabel} eingetragen.`, 'success');
            openTrainerEventDetail(ev);
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
        }
      });
    });

    document.getElementById('cancel-all-sub-reqs-btn')?.addEventListener('click', async () => {
      try {
        const batch = firestore.batch();
        myActiveSubReqs.forEach(r => batch.update(firestore.collection('substituteRequests').doc(r.id), { status: 'revoked' }));
        await batch.commit();
        showToast('Alle Anfragen zurückgezogen.', 'success');
        openTrainerEventDetail(ev);
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    container.querySelectorAll('.sub-accept-btn').forEach(btn => {
      btn.onclick = async () => {
        const subId = btn.dataset.subId;
        try {
          await Promise.all([
            firestore.collection('substituteRequests').doc(subId).update({ status: 'accepted' }),
            firestore.collection('events').doc(ev.id).update({
              trainers: firebase.firestore.FieldValue.arrayUnion(myUid),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            })
          ]);
          showToast(`Vertretung angenommen. Du bist jetzt als ${tLabel} eingetragen.`, 'success');
          openTrainerEventDetail(ev);
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      };
    });

    container.querySelectorAll('.sub-decline-btn').forEach(btn => {
      btn.onclick = async () => {
        const subId       = btn.dataset.subId;
        const requesterId = btn.dataset.requesterId;
        const needed      = parseInt(btn.dataset.needed) || 1;
        const accepted    = parseInt(btn.dataset.accepted) || 0;
        try {
          await firestore.collection('substituteRequests').doc(subId).update({ status: 'declined' });

          const siblingSnap = await firestore.collection('substituteRequests')
            .where('eventId', '==', ev.id).where('requesterId', '==', requesterId).get();
          const siblings = [];
          siblingSnap.forEach(d => siblings.push({ id: d.id, ...d.data() }));
          const stillPending = siblings.filter(s => s.status === 'pending').length;
          const nowAccepted  = siblings.filter(s => s.status === 'accepted').length;

          if (stillPending === 0 && nowAccepted < needed) {
            await firestore.collection('events').doc(ev.id).update({
              status: 'cancelled',
              cancellationReason: 'Keine Vertretung gefunden – automatisch abgesagt.',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Abgelehnt. Keine weiteren Anfragen offen – Termin automatisch abgesagt.', 'warning');
          } else {
            showToast('Vertretungsanfrage abgelehnt.', 'info');
          }
          openTrainerEventDetail(ev);
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      };
    });

    document.getElementById('save-broadcast')?.addEventListener('click', async () => {
      const msg = document.getElementById('event-broadcast')?.value.trim() || '';
      try {
        await firestore.collection('events').doc(ev.id).update({
          trainerBroadcast: msg,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const saved = document.getElementById('broadcast-saved');
        if (saved) { saved.style.display = 'inline'; setTimeout(() => saved.style.display = 'none', 2500); }
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    document.getElementById('mark-all-present')?.addEventListener('click', () => {
      container.querySelectorAll('.presence-cb').forEach(cb => cb.checked = true);
      container.querySelectorAll('.status-select').forEach(sel => sel.value = 'present');
    });

    document.getElementById('save-all-attendance')?.addEventListener('click', async () => {
      try {
        const batch = firestore.batch();
        container.querySelectorAll('.status-select').forEach(sel => {
          const attId = sel.dataset.attId;
          const noteInternal = container.querySelector(`.trainer-note-internal[data-att-id="${attId}"]`)?.value || '';
          const noteMember   = container.querySelector(`.trainer-note-member[data-att-id="${attId}"]`)?.value || '';
          batch.update(firestore.collection('eventAttendance').doc(attId), {
            status: sel.value, trainerSet: true,
            trainerNoteInternal: noteInternal,
            trainerNoteMember:   noteMember,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        showToast('Anwesenheit gespeichert.', 'success');
        openTrainerEventDetail(ev);
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    document.getElementById('cancel-event-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Abmelden oder Termin absagen',
        body: `
          <p>Was möchtest du tun?</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);">
              <input type="radio" name="cancel-mode" value="self" checked /> Nur mich abmelden (Vertretung suchen)
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);">
              <input type="radio" name="cancel-mode" value="event" /> Ganzen Termin absagen
            </label>
          </div>
          <label style="margin-top:12px;">Begründung</label>
          <input type="text" id="cancel-reason" placeholder="z.B. Krank, Urlaub..." />
          <div id="sub-picker" style="margin-top:10px;">
            <label>Vertretungen auswählen (optional)</label>
            <div style="max-height:160px;overflow-y:auto;border:1px solid var(--color-border);border-radius:6px;padding:4px;">
              ${allTeachers.map(t => `
                <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;color:var(--color-text);">
                  <input type="checkbox" class="sub-pick" data-tid="${t.uid}" style="width:16px;height:16px;" />
                  ${t.name}
                </label>`).join('')}
            </div>
          </div>`,
        confirmLabel: 'Bestätigen',
        onConfirm: async () => {
          const mode   = document.querySelector('input[name="cancel-mode"]:checked')?.value || 'self';
          const reason = document.getElementById('cancel-reason')?.value.trim() || '';
          if (mode === 'event') {
            await firestore.collection('events').doc(ev.id).update({
              status: 'cancelled', cancellationReason: reason,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Termin abgesagt.', 'success');
            loadTrainerDashboard();
          } else {
            await firestore.collection('events').doc(ev.id).update({
              trainers:             firebase.firestore.FieldValue.arrayRemove(myUid),
              trainerCancellations: firebase.firestore.FieldValue.arrayUnion(myUid),
              updatedAt:            firebase.firestore.FieldValue.serverTimestamp()
            });
            const selectedSubs = [...document.querySelectorAll('.sub-pick:checked')].map(cb => cb.dataset.tid);
            if (selectedSubs.length) {
              const batch = firestore.batch();
              selectedSubs.forEach(tid => {
                const ref = firestore.collection('substituteRequests').doc();
                batch.set(ref, {
                  eventId: ev.id, requesterId: myUid, targetId: tid,
                  status: 'pending', reason, neededCount: selectedSubs.length,
                  createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
              });
              await batch.commit();
            }
            showToast('Abgemeldet.' + (selectedSubs.length ? ' Vertretungsanfragen gesendet.' : ''), 'success');
            loadTrainerDashboard();
          }
        }
      });
    });

    document.getElementById('trainer-late-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Verspätung melden',
        body: `
          <label>Begründung / Hinweis</label>
          <input type="text" id="late-note-input" value="${ev.trainerLateNote || ''}" placeholder="z.B. ca. 10 Minuten später" />`,
        confirmLabel: 'Speichern',
        onConfirm: async () => {
          const note = document.getElementById('late-note-input')?.value.trim() || '';
          await firestore.collection('events').doc(ev.id).update({
            trainerLateNote: note || firebase.firestore.FieldValue.delete(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          showToast('Verspätung gespeichert.', 'success');
          openTrainerEventDetail(ev);
        }
      });
    });

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden: ' + e.message + '</p>';
  }
}
