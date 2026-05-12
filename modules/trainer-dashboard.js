// modules/trainer-dashboard.js

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  const user = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Trainer-Termine...</div>`;

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
        if (['registered','present','late_excused','late_unexcused'].includes(doc.data().status)) count++;
      });
      ev._participantCount = count;
      ev._minParticipants  = minPart;
      ev._missing          = Math.max(0, minPart - count);
    }));

    const upcoming = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past     = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; });

    container.innerHTML = `
      <h2 style="margin-top:0;">Trainer-Dashboard</h2>
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
    ? `<span class="chip chip-warning" style="font-size:0.82rem;font-weight:700;">⚠️ Noch ${missing} Person${missing === 1 ? '' : 'en'} benötigt</span>`
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
        ${isCancelled ? '<span class="chip chip-error">Abgesagt</span>' : isSelfCancelled ? '<span class="chip chip-warning">Abgemeldet</span>' : isPast ? '<span class="chip chip-info">Vergangen</span>' : '<span class="chip chip-success">Aktiv</span>'}
        <button class="btn-primary" data-action="detail" style="padding:5px 14px;font-size:0.85rem;">Details ›</button>
      </div>
    </div>
    ${event.trainerLateNote ? `<div class="chip chip-warning" style="margin-top:8px;">⚠️ Verspätung: ${event.trainerLateNote}</div>` : ''}
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

    // Trainer-Namen für am Event eingetragene Trainer laden
    const allTrainerIds = [...new Set([...trainerIds, ...cancelledIds])];
    const trainerNames  = {};
    await Promise.all(allTrainerIds.map(async tid => {
      const uDoc = await firestore.collection('users').doc(tid).get();
      trainerNames[tid] = uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || tid) : tid;
    }));

    // Alle Teacher/Trainer-Nutzer laden (für Vertretungsauswahl)
    const allTeachersSnap = await firestore.collection('users').get();
    const allTeachers = [];
    allTeachersSnap.forEach(doc => {
      const d = doc.data();
      const roles = d.roles || {};
      if (doc.id !== myUid && (roles.teacher || roles.admin || roles.coordinator)) {
        allTeachers.push({ uid: doc.id, name: d.displayName || d.email || doc.id });
      }
    });

    const subSnap  = await firestore.collection('substituteRequests')
      .where('eventId', '==', ev.id).where('requesterId', '==', myUid).get();
    const mySubReq = subSnap.empty ? null : { id: subSnap.docs[0].id, ...subSnap.docs[0].data() };

    const incomingSnap = await firestore.collection('substituteRequests')
      .where('eventId', '==', ev.id).where('targetId', '==', myUid).where('status', '==', 'pending').get();
    const incomingReqs = [];
    incomingSnap.forEach(doc => incomingReqs.push({ id: doc.id, ...doc.data() }));

    const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    const registeredCount = attendances.filter(a => ['registered','present','late_excused','late_unexcused'].includes(a.status)).length;
    const missingCount    = minPart ? Math.max(0, minPart - registeredCount) : 0;

    const userMap = {};
    for (const att of attendances) {
      if (!userMap[att.userId]) {
        const uDoc = await firestore.collection('users').doc(att.userId).get();
        userMap[att.userId] = uDoc.exists
          ? { name: uDoc.data().displayName || uDoc.data().email || att.userId, generalNote: uDoc.data().generalNote || '' }
          : { name: att.userId, generalNote: '' };
      }
    }

    const statusChipHtml = (status) => {
      const map = {
        present:          ['chip-success', 'Anwesend'],
        registered:       ['chip-info',    'Angemeldet'],
        cancelled:        ['chip-error',   'Abgemeldet'],
        absent_excused:   ['chip-warning', 'Entsch. gefehlt'],
        absent_unexcused: ['chip-error',   'Unentsch. gefehlt'],
        late_excused:     ['chip-warning', 'Verspätet (E)'],
        late_unexcused:   ['chip-warning', 'Verspätet (U)'],
      };
      const [cls, label] = map[status] || ['', status];
      return `<span class="chip ${cls}" style="font-size:0.8rem;">${label}</span>`;
    };

    const memberRows = attendances.map(att => {
      const u = userMap[att.userId] || { name: att.userId, generalNote: '' };
      return `
      <tr>
        <td>
          <span style="font-weight:500;">${u.name}</span>
          ${u.generalNote ? `<button class="btn-text info-btn" data-note="${encodeURIComponent(u.generalNote)}" title="Allgemeine Notiz" style="font-size:0.85rem;padding:0 4px;vertical-align:middle;">&#8505;&#65039;</button>` : ''}
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
            <option value="present"          ${att.status==='present'          ?'selected':''}>Anwesend</option>
            <option value="registered"       ${att.status==='registered'       ?'selected':''}>Angemeldet (offen)</option>
            <option value="absent_excused"   ${att.status==='absent_excused'   ?'selected':''}>Entschuldigt gefehlt</option>
            <option value="absent_unexcused" ${att.status==='absent_unexcused' ?'selected':''}>Unentschuldigt gefehlt</option>
            <option value="late_excused"     ${att.status==='late_excused'     ?'selected':''}>Verspätet (entschuldigt)</option>
            <option value="late_unexcused"   ${att.status==='late_unexcused'   ?'selected':''}>Verspätet (unentschuldigt)</option>
            <option value="cancelled"        ${att.status==='cancelled'        ?'selected':''}>Abgemeldet</option>
          </select>
        </td>
        <td>
          <input type="text" class="trainer-note-internal" data-att-id="${att.id}"
            placeholder="Interne Notiz (nur Trainer)" value="${att.trainerNoteInternal || ''}"
            style="min-width:120px;font-size:0.85rem;" />
        </td>
        <td>
          <input type="text" class="trainer-note-member" data-att-id="${att.id}"
            placeholder="Notiz an Mitglied" value="${att.trainerNoteMember || ''}"
            style="min-width:120px;font-size:0.85rem;" />
        </td>
        <td class="text-muted" style="font-size:0.82rem;max-width:140px;">${att.memberNote || ''}</td>
      </tr>`;
    }).join('');

    const missingTileHtml = minPart ? `
      <div class="card" style="margin:0;${missingCount > 0 ? 'border-left:3px solid var(--color-warning,#e65100);' : 'border-left:3px solid var(--color-success,#2e7d32);'}">
        <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Noch benötigt</p>
        <p style="margin:0;font-weight:700;font-size:1.3rem;color:${missingCount > 0 ? 'var(--color-warning,#e65100)' : 'var(--color-success,#2e7d32)'};">${missingCount > 0 ? missingCount : '✔️'}</p>
        ${missingCount > 0 ? `<p class="text-muted" style="margin:2px 0 0;font-size:0.8rem;">(mind. ${minPart} benötigt)</p>` : `<p class="text-muted" style="margin:2px 0 0;font-size:0.8rem;">Mindestanzahl erreicht</p>`}
      </div>` : '';

    const trainerStatusHtml = (trainerIds.length || cancelledIds.length) ? `
      <div class="card" style="margin-bottom:16px;">
        <h4 style="margin:0 0 10px;">👥 Trainer dieses Termins</h4>
        ${trainerIds.map(tid => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);">
            <span style="font-weight:500;flex:1;">${trainerNames[tid]||tid}</span>
            <span class="chip chip-success" style="font-size:0.8rem;">&#10003; Eingeplant</span>
          </div>`).join('')}
        ${cancelledIds.map(tid => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);">
            <span style="font-weight:500;flex:1;color:var(--color-text-muted);">${trainerNames[tid]||tid}</span>
            <span class="chip chip-error" style="font-size:0.8rem;">Abgemeldet</span>
          </div>`).join('')}
      </div>` : '';

    const incomingSubHtml = incomingReqs.map(req => `
      <div class="card" style="margin-bottom:12px;border-left:4px solid var(--color-primary);background:rgba(21,101,192,0.05);">
        <p style="margin:0 0 4px;font-weight:600;">&#128235; Vertretungsanfrage</p>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.88rem;">Du wurdest als mögliche Vertretung angefragt${req.reason ? ': „' + req.reason + '“' : '.'}</p>
        <div style="display:flex;gap:8px;">
          <button class="btn-primary sub-accept-btn" data-sub-id="${req.id}" style="padding:5px 14px;">Annehmen</button>
          <button class="btn-secondary sub-decline-btn" data-sub-id="${req.id}" style="padding:5px 14px;">Ablehnen</button>
        </div>
      </div>`).join('');

    const mySubHtml = (mySubReq && mySubReq.status === 'pending') ? `
      <div class="card" style="margin-bottom:12px;border-left:4px solid var(--color-warning,#e65100);">
        <p style="margin:0 0 4px;font-weight:600;color:var(--color-warning,#e65100);">&#8987; Vertretungsanfrage offen</p>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.88rem;">Gesendet an ${allTeachers.find(t=>t.uid===mySubReq.targetId)?.name || mySubReq.targetId}.</p>
        <button class="btn-secondary" id="cancel-sub-req-btn" style="padding:4px 12px;">Anfrage zurückziehen</button>
      </div>` : '';

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <button class="btn-secondary" id="detail-back" style="padding:6px 16px;">&larr; Zurück</button>
        <h2 style="margin:0;${isCancelled ? 'text-decoration:line-through;opacity:0.7;' : ''}">${ev.title || 'Termin'}</h2>
        ${isCancelled ? '<span class="chip chip-error">Abgesagt</span>' : ''}
        ${isSelfCancelled ? '<span class="chip chip-warning">Du hast dich abgemeldet</span>' : ''}
        ${!isCancelled && missingCount > 0 ? `<span class="chip chip-warning">⚠️ Noch ${missingCount} Person${missingCount===1?'':'en'} benötigt</span>` : ''}
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
          <p class="text-error" style="margin:0 0 4px;font-weight:600;">❌ Training abgesagt</p>
          <p class="text-muted" style="margin:0;">Begründung: ${ev.cancellationReason || '–'}</p>
          <button class="btn-secondary" id="revoke-cancel-btn" style="margin-top:12px;">Absage widerrufen</button>
        </div>` : ''}

      <div class="dashboard-grid" style="margin-bottom:16px;">
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Datum & Zeit</p>
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
        <h4 style="margin:0 0 6px;">📢 Nachricht an alle Mitglieder</h4>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.85rem;">Wird auf jeder Teilnehmer-Termincard angezeigt.</p>
        <textarea id="event-broadcast" rows="2" placeholder="z.B. Bitte Sportschuhe mitbringen...">${ev.trainerBroadcast || ''}</textarea>
        <button class="btn-secondary" id="save-broadcast" style="margin-top:0;">Nachricht speichern</button>
        <span id="broadcast-saved" class="text-muted" style="font-size:0.85rem;margin-left:10px;display:none;">✓ Gespeichert</span>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <h3 style="margin:0;">Anwesenheitsliste (${attendances.length})</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-secondary" id="mark-all-present" style="padding:5px 14px;font-size:0.85rem;">✓ Alle anwesend</button>
            <button class="btn-primary"   id="save-all-attendance">Speichern</button>
          </div>
        </div>
        ${attendances.length ? `
          <div style="overflow-x:auto;">
            <table>
              <thead><tr>
                <th>Name</th><th>Status</th><th>Schnell-Check</th><th>Detailstatus</th>
                <th>Interne Notiz <small class="text-muted">(nur Trainer)</small></th>
                <th>Notiz an Mitglied</th>
                <th>Hinweis v. Mitglied</th>
              </tr></thead>
              <tbody>${memberRows}</tbody>
            </table>
          </div>
        ` : '<p class="text-muted">Keine Teilnehmer angemeldet.</p>'}
      </div>

      <div class="card" style="margin-top:16px;">
        <h3 style="margin-top:0;">Aktionen</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${!isCancelled && !isSelfCancelled ? `
            <button class="btn-danger"    id="cancel-event-btn">Abmelden / Training absagen</button>
            <button class="btn-secondary" id="trainer-late-btn">Verspätung melden</button>
          ` : ''}
        </div>
        ${ev.trainerLateNote ? `<div class="chip chip-warning" style="margin-top:10px;">⚠️ Verspätung: ${ev.trainerLateNote}</div>` : ''}
      </div>
      <div id="detail-error" class="text-error" style="margin-top:8px;"></div>
    `;

    document.getElementById('detail-back').onclick = () => loadTrainerDashboard();

    container.querySelectorAll('.info-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showModal({ title: 'Allgemeine Notiz', body: `<p>${decodeURIComponent(btn.dataset.note)}</p>`, confirmLabel: 'OK', onConfirm: () => {} });
      };
    });

    document.getElementById('revoke-cancel-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Absage widerrufen',
        body: '<p>Soll das Training wieder als aktiv markiert werden?</p>',
        confirmLabel: 'Ja, widerrufen',
        onConfirm: async () => {
          try {
            await firestore.collection('events').doc(ev.id).update({
              status:             firebase.firestore.FieldValue.delete(),
              cancellationReason: firebase.firestore.FieldValue.delete(),
              updatedAt:          firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Absage widerrufen. Training ist wieder aktiv.', 'success');
            loadTrainerDashboard();
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
        }
      });
    });

    document.getElementById('revoke-self-cancel-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Abmeldung widerrufen',
        body: '<p>Möchtest du deine Abmeldung rückgängig machen und dich wieder als Trainer eintragen?</p>',
        confirmLabel: 'Ja, wieder eintragen',
        onConfirm: async () => {
          try {
            await firestore.collection('events').doc(ev.id).update({
              trainers:             firebase.firestore.FieldValue.arrayUnion(myUid),
              trainerCancellations: firebase.firestore.FieldValue.arrayRemove(myUid),
              updatedAt:            firebase.firestore.FieldValue.serverTimestamp()
            });
            if (mySubReq) {
              await firestore.collection('substituteRequests').doc(mySubReq.id).update({ status: 'revoked' });
            }
            showToast('Abmeldung widerrufen. Du bist wieder als Trainer eingetragen.', 'success');
            openTrainerEventDetail(ev);
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
        }
      });
    });

    document.getElementById('cancel-sub-req-btn')?.addEventListener('click', async () => {
      try {
        await firestore.collection('substituteRequests').doc(mySubReq.id).update({ status: 'revoked' });
        showToast('Anfrage zurückgezogen.', 'success');
        openTrainerEventDetail(ev);
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    container.querySelectorAll('.sub-accept-btn').forEach(btn => {
      btn.onclick = async () => {
        const subId = btn.dataset.subId;
        const req   = incomingReqs.find(r => r.id === subId);
        if (!req) return;
        try {
          await Promise.all([
            firestore.collection('substituteRequests').doc(subId).update({ status: 'accepted' }),
            firestore.collection('events').doc(ev.id).update({
              trainers: firebase.firestore.FieldValue.arrayUnion(myUid),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            })
          ]);
          showToast('Vertretung angenommen. Du bist jetzt als Trainer eingetragen.', 'success');
          openTrainerEventDetail(ev);
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      };
    });
    container.querySelectorAll('.sub-decline-btn').forEach(btn => {
      btn.onclick = async () => {
        try {
          await firestore.collection('substituteRequests').doc(btn.dataset.subId).update({ status: 'declined' });
          showToast('Vertretungsanfrage abgelehnt.', 'warning');
          openTrainerEventDetail(ev);
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      };
    });

    document.getElementById('save-broadcast')?.addEventListener('click', async () => {
      const msg = document.getElementById('event-broadcast')?.value ?? '';
      try {
        await firestore.collection('events').doc(ev.id).update({
          trainerBroadcast: msg,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const savedEl = document.getElementById('broadcast-saved');
        if (savedEl) { savedEl.style.display = 'inline'; setTimeout(() => savedEl.style.display = 'none', 3000); }
        showToast('Nachricht gespeichert.', 'success');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    container.querySelectorAll('.presence-cb').forEach(cb => {
      cb.onchange = () => {
        const sel = container.querySelector(`.status-select[data-att-id="${cb.dataset.attId}"]`);
        if (sel) sel.value = cb.checked ? 'present' : 'registered';
        updateStatusChip(cb.dataset.attId, cb.checked ? 'present' : 'registered');
      };
    });
    container.querySelectorAll('.status-select').forEach(sel => {
      sel.onchange = () => {
        const cb = container.querySelector(`.presence-cb[data-att-id="${sel.dataset.attId}"]`);
        if (cb) cb.checked = sel.value === 'present';
        updateStatusChip(sel.dataset.attId, sel.value);
      };
    });

    function updateStatusChip(attId, status) {
      const el = document.getElementById(`status-chip-${attId}`);
      if (!el) return;
      const map = {
        present:          ['chip-success', 'Anwesend'],
        registered:       ['chip-info',    'Angemeldet'],
        cancelled:        ['chip-error',   'Abgemeldet'],
        absent_excused:   ['chip-warning', 'Entsch. gefehlt'],
        absent_unexcused: ['chip-error',   'Unentsch. gefehlt'],
        late_excused:     ['chip-warning', 'Verspätet (E)'],
        late_unexcused:   ['chip-warning', 'Verspätet (U)'],
      };
      const [cls, label] = map[status] || ['', status];
      el.innerHTML = `<span class="chip ${cls}" style="font-size:0.8rem;">${label}</span>`;
    }

    document.getElementById('mark-all-present')?.addEventListener('click', () => {
      container.querySelectorAll('.presence-cb').forEach(cb => {
        cb.checked = true;
        const sel = container.querySelector(`.status-select[data-att-id="${cb.dataset.attId}"]`);
        if (sel) sel.value = 'present';
        updateStatusChip(cb.dataset.attId, 'present');
      });
    });

    document.getElementById('save-all-attendance')?.addEventListener('click', async () => {
      const errorEl = document.getElementById('detail-error');
      try {
        const batch = firestore.batch();
        container.querySelectorAll('.status-select').forEach(sel => {
          const internalInput = container.querySelector(`.trainer-note-internal[data-att-id="${sel.dataset.attId}"]`);
          const memberInput   = container.querySelector(`.trainer-note-member[data-att-id="${sel.dataset.attId}"]`);
          batch.update(firestore.collection('eventAttendance').doc(sel.dataset.attId), {
            status:              sel.value,
            trainerSet:          true,
            trainerNoteInternal: internalInput?.value || '',
            trainerNoteMember:   memberInput?.value   || '',
            updatedAt:           firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        showToast('Anwesenheit gespeichert.', 'success');
        container.querySelectorAll('.status-select').forEach(sel => {
          const cb = container.querySelector(`.presence-cb[data-att-id="${sel.dataset.attId}"]`);
          if (cb) cb.checked = sel.value === 'present';
          updateStatusChip(sel.dataset.attId, sel.value);
        });
      } catch (e) {
        showToast('Fehler beim Speichern: ' + e.message, 'error');
        document.getElementById('detail-error').textContent = 'Fehler: ' + e.message;
      }
    });

    document.getElementById('cancel-event-btn')?.addEventListener('click', () => {
      // Alle anderen Teacher als mögliche Vertretung (nicht nur am Event eingetragene)
      const subCandidates = allTeachers.filter(t => !cancelledIds.includes(t.uid));

      showModal({
        title: 'Abmelden / Training absagen',
        body: `
          <label>Art der Abmeldung</label>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
            <label style="display:flex;align-items:center;gap:8px;color:var(--color-text);cursor:pointer;">
              <input type="radio" name="cancel-type" value="self" checked />
              Nur ich melde mich ab
            </label>
            <label style="display:flex;align-items:center;gap:8px;color:var(--color-text);cursor:pointer;">
              <input type="radio" name="cancel-type" value="all" />
              Training komplett absagen
            </label>
          </div>
          <label>Begründung (optional)</label>
          <input type="text" id="cancel-reason" placeholder="z.B. Krankheit" />
          <div id="sub-req-section" style="margin-top:8px;">
            <hr style="border:none;border-top:1px solid var(--color-border);margin:12px 0;" />
            <p style="margin:0 0 8px;font-weight:500;">Vertretung anfragen (optional)</p>
            <p class="text-muted" style="margin:0 0 8px;font-size:0.85rem;">Sende eine Anfrage an einen anderen Trainer, das Training zu übernehmen.</p>
            ${subCandidates.length ? `
              <label>Trainer auswählen</label>
              <select id="sub-target">
                <option value="">-- keine Anfrage --</option>
                ${subCandidates.map(t => `<option value="${t.uid}">${t.name}</option>`).join('')}
              </select>` : '<p class="text-muted" style="font-size:0.85rem;">Keine anderen Trainer verfügbar.</p>'}
          </div>
        `,
        confirmLabel: 'Bestätigen',
        onConfirm: async () => {
          const reason    = document.getElementById('cancel-reason')?.value || '';
          const type      = document.querySelector('input[name="cancel-type"]:checked')?.value || 'self';
          const subTarget = document.getElementById('sub-target')?.value || '';
          try {
            if (type === 'self') {
              await firestore.collection('events').doc(ev.id).update({
                trainers:             firebase.firestore.FieldValue.arrayRemove(myUid),
                trainerCancellations: firebase.firestore.FieldValue.arrayUnion(myUid),
                updatedAt:            firebase.firestore.FieldValue.serverTimestamp()
              });
              showToast('Du wurdest abgemeldet.', 'success');
              if (subTarget) {
                const targetName = subCandidates.find(t => t.uid === subTarget)?.name || subTarget;
                await firestore.collection('substituteRequests').add({
                  eventId: ev.id, requesterId: myUid, targetId: subTarget,
                  reason, status: 'pending',
                  createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                showToast(`Vertretungsanfrage an ${targetName} gesendet.`, 'success');
              }
            } else {
              await firestore.collection('events').doc(ev.id).update({
                status: 'cancelled', cancellationReason: reason,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              });
              showToast('Training abgesagt.', 'success');
            }
            loadTrainerDashboard();
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
        }
      });

      // Vertretungsbereich bei "Training komplett absagen" ausblenden
      setTimeout(() => {
        const radios  = document.querySelectorAll('input[name="cancel-type"]');
        const subSect = document.getElementById('sub-req-section');
        if (!subSect) return;
        const toggle = () => {
          subSect.style.display = document.querySelector('input[name="cancel-type"]:checked')?.value === 'self' ? '' : 'none';
        };
        radios.forEach(r => r.onchange = toggle);
        toggle();
      }, 50);
    });

    document.getElementById('trainer-late-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Verspätung melden',
        body: `
          <label>Begründung / voraussichtliche Verspätung</label>
          <input type="text" id="late-reason" placeholder="z.B. ca. 15 Minuten" />
        `,
        confirmLabel: 'Melden',
        onConfirm: async () => {
          const reason = document.getElementById('late-reason')?.value?.trim() || '';
          try {
            await firestore.collection('events').doc(ev.id).update({
              trainerLateNote: reason,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Verspätung gemeldet.', 'success');
            openTrainerEventDetail(ev);
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
        }
      });
    });

  } catch (e) {
    console.error(e);
    container.innerHTML = `
      <button class="btn-secondary" onclick="loadTrainerDashboard()" style="margin-bottom:16px;">&larr; Zurück</button>
      <p class="text-error">Fehler: ${e.message}</p>
    `;
  }
}
