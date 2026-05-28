// modules/trainer-dashboard.js

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  const user      = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Termine...</div>`;

  try {
    const settingsDoc = await firestore.collection('settings').doc('global').get();
    const settings    = settingsDoc.exists ? settingsDoc.data() : {};
    window.appSettings = settings;

    const now = new Date();

    // Kein .orderBy() – vermeidet Composite-Index-Fehler → clientseitig sortieren
    const evSnap = await firestore.collection('events')
      .where('trainers', 'array-contains', user.uid)
      .get();

    const events = [];
    evSnap.forEach(doc => events.push({ id: doc.id, ...doc.data() }));

    // Clientseitig nach startTime sortieren
    events.sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0));

    // Laufende Termine (startTime <= now) erscheinen unter "Vergangen"
    const upcoming = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past     = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; });

    container.innerHTML = `
      <h2 style="margin-top:0;">Meine Termine</h2>
      <div class="tabs">
        <button class="tab-btn active" data-tab="upcoming">Kommende (${upcoming.length})</button>
        <button class="tab-btn" data-tab="past">Vergangene (${past.length})</button>
      </div>
      <div id="tab-t-upcoming"></div>
      <div id="tab-t-past" hidden></div>
    `;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-t-upcoming').hidden = btn.dataset.tab !== 'upcoming';
        document.getElementById('tab-t-past').hidden     = btn.dataset.tab !== 'past';
      };
    });

    const upEl = document.getElementById('tab-t-upcoming');
    const paEl = document.getElementById('tab-t-past');

    if (!upcoming.length) upEl.innerHTML = '<p class="text-muted">Keine kommenden Termine.</p>';
    else upcoming.forEach(ev => upEl.appendChild(renderTrainerEventCard(ev, false, settings)));

    if (!past.length) paEl.innerHTML = '<p class="text-muted">Keine vergangenen Termine.</p>';
    else past.slice().reverse().forEach(ev => paEl.appendChild(renderTrainerEventCard(ev, true, settings)));

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden: ' + e.message + '</p>';
  }
}

function renderTrainerEventCard(event, isPast, settings) {
  settings = settings || window.appSettings || {};
  const card  = createElement('div', 'card');
  const start = event.startTime?.toDate ? event.startTime.toDate() : null;
  const end   = event.endTime?.toDate   ? event.endTime.toDate()   : null;
  const tLabel = getRoleLabel('teacher');

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
      <div>
        <h3 style="margin:0 0 4px;">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        ${event.status === 'cancelled' ? '<span class="chip chip-error">Abgesagt</span>' : ''}
        ${event.status === 'skipped'   ? '<span class="chip chip-warning">Ausgefallen</span>' : ''}
        <button class="btn-primary" data-action="manage" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:16px;">manage_accounts</span> Verwalten
        </button>
      </div>
    </div>
    ${event.description ? `<p style="margin:0 0 10px;">${event.description}</p>` : ''}
    <div id="trainer-card-detail-${event.id}"></div>
  `;

  card.querySelector('[data-action="manage"]').onclick = () =>
    loadTrainerEventDetail(event.id, isPast);

  return card;
}

async function loadTrainerEventDetail(eventId, isPast) {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Termin...</div>`;

  try {
    const settings    = window.appSettings || {};
    const evDoc       = await firestore.collection('events').doc(eventId).get();
    if (!evDoc.exists) { container.innerHTML = '<p class="text-error">Termin nicht gefunden.</p>'; return; }
    const event       = { id: evDoc.id, ...evDoc.data() };
    const start       = event.startTime?.toDate ? event.startTime.toDate() : null;
    const end         = event.endTime?.toDate   ? event.endTime.toDate()   : null;
    const tLabel      = getRoleLabel('teacher');
    const mLabel      = getRoleLabel('member');
    const eventMode   = event.mode || settings.defaultMode || 'opt_in';

    // Alle Nutzer laden (fuer Mitglied-Hinzufuegen-Dialog)
    const allUsersSnap = await firestore.collection('users').orderBy('displayName').get();
    const allUsers = [];
    allUsersSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));

    // Gruppenmitglieder + directMembers
    let memberIds = new Set(event.directMembers || []);
    if (event.groupId) {
      const groupDoc = await firestore.collection('groups').doc(event.groupId).get();
      if (groupDoc.exists) (groupDoc.data().members || []).forEach(id => memberIds.add(id));
    }

    // Anwesenheitsdaten
    const attSnap = await firestore.collection('eventAttendance')
      .where('eventId', '==', eventId).get();
    const attendances = {};
    attSnap.forEach(doc => { attendances[doc.data().userId] = { id: doc.id, ...doc.data() }; });

    // Alle relevanten User-IDs
    Object.keys(attendances).forEach(uid => memberIds.add(uid));
    const memberIdArr = [...memberIds];

    const memberDetails = {};
    await Promise.all(memberIdArr.map(async uid => {
      const uDoc = await firestore.collection('users').doc(uid).get();
      memberDetails[uid] = uDoc.exists ? { id: uid, ...uDoc.data() } : { id: uid, displayName: uid };
    }));

    const renderDetail = () => {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
          <button class="btn-secondary" id="trainer-back" style="padding:6px 16px;display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:18px;">arrow_back</span> Zurueck
          </button>
          <div style="flex:1;">
            <h2 style="margin:0 0 2px;">${event.title || 'Termin'}</h2>
            <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
          </div>
          ${event.status === 'cancelled' ? '<span class="chip chip-error">Abgesagt</span>' : ''}
          ${event.status === 'skipped'   ? '<span class="chip chip-warning">Ausgefallen</span>' : ''}
        </div>

        <div class="card" style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <h3 style="margin:0;">Anwesenheit</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn-secondary" id="trainer-add-member" style="display:inline-flex;align-items:center;gap:4px;">
                <span class="material-icons" style="font-size:16px;">person_add</span> ${mLabel} hinzufuegen
              </button>
              <button class="btn-secondary" id="trainer-cancel-btn" style="display:inline-flex;align-items:center;gap:4px;">
                <span class="material-icons" style="font-size:16px;">block</span> Termin absagen
              </button>
            </div>
          </div>
          <div id="attendance-list" style="margin-top:16px;"></div>
        </div>

        <div class="card">
          <h3 style="margin-top:0;">Nachricht an alle senden</h3>
          <textarea id="trainer-broadcast" rows="3" placeholder="Nachricht an alle Teilnehmer...">${event.trainerBroadcast || ''}</textarea>
          <button class="btn-primary" id="trainer-broadcast-btn" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">send</span> Senden
          </button>
        </div>
      `;

      document.getElementById('trainer-back').onclick = () => loadTrainerDashboard();

      document.getElementById('trainer-add-member').onclick = () =>
        showAddMemberToEventDialog(eventId, memberIds, allUsers, () => loadTrainerEventDetail(eventId, isPast));

      document.getElementById('trainer-cancel-btn').onclick = () =>
        trainerCancelEvent(event, () => loadTrainerEventDetail(eventId, isPast));

      const listEl = document.getElementById('attendance-list');
      if (!memberIdArr.length) {
        listEl.innerHTML = '<p class="text-muted">Keine Mitglieder zugewiesen.</p>';
      } else {
        memberIdArr.forEach(uid => {
          const member = memberDetails[uid];
          const att    = attendances[uid];
          listEl.appendChild(renderAttendanceRow(event, member, att, isPast, eventMode, settings, () => loadTrainerEventDetail(eventId, isPast)));
        });
      }

      document.getElementById('trainer-broadcast-btn').onclick = async () => {
        const msg = document.getElementById('trainer-broadcast')?.value.trim();
        await firestore.collection('events').doc(eventId).update({
          trainerBroadcast: msg,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Nachricht gespeichert.', 'success');
      };
    };

    renderDetail();

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler: ' + e.message + '</p>';
  }
}

// ── Mitglied zu Termin hinzufuegen (auch ausserhalb der Gruppe) ───────────────
function showAddMemberToEventDialog(eventId, currentMemberIds, allUsers, onAdded) {
  const mLabel   = getRoleLabel('member');
  const members  = allUsers.filter(u => (u.roles || []).includes('member'));

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
  });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:12px;width:min(520px,95vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden;">
      <div style="padding:18px 22px 14px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;">${mLabel} zu Termin hinzufuegen</h3>
        <button id="amt-close" style="background:none;border:none;font-size:1.4rem;color:var(--color-text-muted);cursor:pointer;">&times;</button>
      </div>
      <div style="padding:10px 22px;border-bottom:1px solid var(--color-border);">
        <input type="search" id="amt-search" placeholder="${mLabel} suchen..." style="margin-bottom:0;" />
      </div>
      <div id="amt-list" style="flex:1;overflow-y:auto;padding:8px 22px;"></div>
      <div style="padding:14px 22px;border-top:1px solid var(--color-border);text-align:right;">
        <button id="amt-cancel" class="btn-secondary">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const listEl   = overlay.querySelector('#amt-list');
  const searchEl = overlay.querySelector('#amt-search');
  const close    = () => overlay.remove();
  overlay.querySelector('#amt-close').onclick  = close;
  overlay.querySelector('#amt-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const renderList = (q = '') => {
    listEl.innerHTML = '';
    const filtered = members.filter(u =>
      !q || (u.displayName || u.email || '').toLowerCase().includes(q.toLowerCase())
    );
    if (!filtered.length) {
      listEl.innerHTML = '<p class="text-muted" style="padding:12px 0;">Keine Mitglieder gefunden.</p>';
      return;
    }
    filtered.forEach(u => {
      const isAlready = currentMemberIds.has(u.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--color-border);gap:12px;';
      row.innerHTML = `
        <div>
          <div style="font-weight:500;">${u.displayName || u.email || u.id}</div>
          <div style="font-size:0.8rem;color:var(--color-text-muted);">${u.email || ''}</div>
        </div>
        <button class="${isAlready ? 'btn-secondary' : 'btn-primary'}" style="padding:4px 14px;font-size:0.85rem;white-space:nowrap;" ${isAlready ? 'disabled' : ''}>
          ${isAlready ? 'Bereits dabei' : 'Hinzufuegen'}
        </button>
      `;
      if (!isAlready) {
        row.querySelector('button').onclick = async () => {
          try {
            await firestore.collection('events').doc(eventId).update({
              directMembers: firebase.firestore.FieldValue.arrayUnion(u.id),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            const ev = await firestore.collection('events').doc(eventId).get();
            const mode = ev.exists ? (ev.data().mode || 'opt_in') : 'opt_in';
            const initStatus = mode === 'confirmation' ? 'confirmation_pending' : 'registered';
            await firestore.collection('eventAttendance').doc(`${eventId}_${u.id}`).set({
              eventId, userId: u.id, status: initStatus, trainerSet: false,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            currentMemberIds.add(u.id);
            showToast(`${u.displayName || u.email} hinzugefuegt.`, 'success');
            close();
            if (onAdded) onAdded();
          } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
        };
      }
      listEl.appendChild(row);
    });
  };

  renderList();
  searchEl.oninput = () => renderList(searchEl.value);
}

// ── Anwesenheits-Zeile ────────────────────────────────────────────────────────
function renderAttendanceRow(event, member, att, isPast, eventMode, settings, onChanged) {
  const mLabel = getRoleLabel('member');
  const row    = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 0;border-bottom:1px solid var(--color-border);';

  const statusOptions = [
    { value: 'registered',           label: 'Angemeldet' },
    { value: 'confirmation_pending', label: 'Ausstehend' },
    { value: 'present',              label: 'Anwesend' },
    { value: 'absent_excused',       label: 'Entsch. gefehlt' },
    { value: 'absent_unexcused',     label: 'Unentsch. gefehlt' },
    { value: 'late_excused',         label: 'Verspaetet (E)' },
    { value: 'late_unexcused',       label: 'Verspaetet (U)' },
    { value: 'cancelled',            label: 'Abgemeldet' },
  ];

  const defaultStatus = eventMode === 'confirmation' ? 'confirmation_pending'
    : eventMode === 'opt_out' ? 'registered' : 'none';
  const currentStatus = att?.status || defaultStatus;

  const statusBadgeColor = {
    present:              'var(--color-success)',
    registered:           'var(--color-primary)',
    confirmation_pending: 'var(--color-warning)',
    absent_excused:       'var(--color-warning)',
    absent_unexcused:     'var(--color-error)',
    late_excused:         'var(--color-warning)',
    late_unexcused:       'var(--color-warning)',
    cancelled:            'var(--color-text-muted)',
    none:                 'var(--color-text-muted)',
  }[currentStatus] || 'var(--color-text-muted)';

  const confirmPendingNote = currentStatus === 'confirmation_pending'
    ? `<span style="font-size:0.78rem;color:var(--color-warning);margin-left:4px;">– Bestaetigung steht aus</span>` : '';

  row.innerHTML = `
    <div style="flex:1;min-width:140px;">
      <div style="font-weight:500;">${member.displayName || member.email || member.id}</div>
      <div style="font-size:0.8rem;color:var(--color-text-muted);display:flex;align-items:center;gap:4px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusBadgeColor};"></span>
        ${statusOptions.find(o => o.value === currentStatus)?.label || currentStatus}${confirmPendingNote}
      </div>
    </div>
    <select data-role="status-select" style="flex:1;min-width:160px;margin-bottom:0;">
      ${statusOptions.map(o => `<option value="${o.value}" ${currentStatus === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn-secondary" data-action="save-status" style="padding:4px 12px;">Speichern</button>
      <button class="btn-secondary" data-action="note" style="padding:4px 12px;">Notiz</button>
      <button class="btn-danger"    data-action="remove-termin" style="padding:4px 12px;">Termin absagen</button>
    </div>
  `;

  row.querySelector('[data-action="save-status"]').onclick = async () => {
    const newStatus = row.querySelector('[data-role="status-select"]').value;
    await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
      eventId: event.id, userId: member.id,
      status: newStatus, trainerSet: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast('Status gespeichert.', 'success');
    if (onChanged) onChanged();
  };

  row.querySelector('[data-action="note"]').onclick = () => {
    showModal({
      title: `Notiz fuer ${member.displayName || member.email}`,
      body: `
        <label>Notiz fuer Mitglied (sichtbar fuer das Mitglied)</label>
        <textarea id="tn-member-note" rows="3">${att?.trainerNoteMember || ''}</textarea>
        <label style="margin-top:8px;">Interne Notiz (nur fuer Betreuer)</label>
        <textarea id="tn-internal-note" rows="2">${att?.trainerNoteInternal || ''}</textarea>
      `,
      confirmLabel: 'Speichern',
      onConfirm: async () => {
        await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
          eventId: event.id, userId: member.id,
          trainerNoteMember:   document.getElementById('tn-member-note')?.value || '',
          trainerNoteInternal: document.getElementById('tn-internal-note')?.value || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Notiz gespeichert.', 'success');
        if (onChanged) onChanged();
      }
    });
  };

  // Neutrales Wort "Termin" statt "Training"
  row.querySelector('[data-action="remove-termin"]').onclick = () => {
    showModal({
      title: 'Termin absagen',
      body: `<p>Soll <strong>${member.displayName || member.email}</strong> von diesem Termin abgemeldet werden?</p>`,
      confirmLabel: 'Termin absagen',
      onConfirm: async () => {
        await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
          eventId: event.id, userId: member.id,
          status: 'cancelled', trainerSet: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Termin abgesagt.', 'success');
        if (onChanged) onChanged();
      }
    });
  };

  return row;
}

function trainerCancelEvent(event, onDone) {
  showModal({
    title: 'Termin absagen',
    body: `
      <p>Soll der Termin <strong>${event.title || 'Termin'}</strong> fuer alle abgesagt werden?</p>
      <label>Begruendung (optional)</label>
      <input type="text" id="cancel-reason" placeholder="z.B. kein ${getRoleLabel('teacher')} verfuegbar" />
    `,
    confirmLabel: 'Termin absagen',
    onConfirm: async () => {
      const reason = document.getElementById('cancel-reason')?.value.trim() || '';
      await firestore.collection('events').doc(event.id).update({
        status: 'cancelled',
        cancellationReason: reason,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast('Termin abgesagt.', 'success');
      if (onDone) onDone();
    }
  });
}
