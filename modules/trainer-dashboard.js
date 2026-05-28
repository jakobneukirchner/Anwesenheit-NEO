// modules/trainer-dashboard.js
// Betreuer-Dashboard: Zeigt alle Termine bei denen der Betreuer eingetragen ist

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0 0 4px;">${getRoleLabel('teacher')}-Bereich</h2>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">Deine Termine und Anwesenheitsverwaltung</p>
      </div>
    </div>
    <div id="trainer-content">
      <div class="loading-center">Lade Termine...</div>
    </div>
  `;

  const uid = window.currentUser?.firebaseUser?.uid;
  if (!uid) {
    document.getElementById('trainer-content').innerHTML =
      '<p class="text-error">Kein Benutzer eingeloggt.</p>';
    return;
  }

  await renderTrainerEvents(document.getElementById('trainer-content'), uid);
}

async function renderTrainerEvents(el, uid) {
  el.innerHTML = `<div class="loading-center">Lade Termine...</div>`;
  try {
    const now     = new Date();
    const evtMap  = {};

    // --- Abfrage 1: trainers[] (neues Feldformat) ---
    try {
      const snap1 = await firestore.collection('events')
        .where('trainers', 'array-contains', uid)
        .orderBy('startTime', 'desc')
        .limit(200)
        .get();
      snap1.forEach(doc => { evtMap[doc.id] = { id: doc.id, ...doc.data() }; });
    } catch (e) {
      // Falls Index fehlt, ignorieren wir diesen Pfad still
      console.warn('trainers[]-Query fehlgeschlagen:', e.message);
    }

    // --- Abfrage 2: trainer[] (altes Feldformat, Singular) ---
    try {
      const snap2 = await firestore.collection('events')
        .where('trainer', 'array-contains', uid)
        .orderBy('startTime', 'desc')
        .limit(200)
        .get();
      snap2.forEach(doc => { evtMap[doc.id] = { id: doc.id, ...doc.data() }; });
    } catch (e) {
      console.warn('trainer[]-Query fehlgeschlagen:', e.message);
    }

    // --- Abfrage 3: Alle Termine der Gruppen des Betreuers ---
    try {
      const userDoc = await firestore.collection('users').doc(uid).get();
      const userGroups = (userDoc.exists ? userDoc.data().groups : null) || [];
      if (userGroups.length) {
        // Firestore: in-Query max 30 Elemente
        const chunks = [];
        for (let i = 0; i < userGroups.length; i += 10) chunks.push(userGroups.slice(i, i + 10));
        for (const chunk of chunks) {
          try {
            const snap3 = await firestore.collection('events')
              .where('groupId', 'in', chunk)
              .orderBy('startTime', 'desc')
              .limit(200)
              .get();
            snap3.forEach(doc => { evtMap[doc.id] = { id: doc.id, ...doc.data() }; });
          } catch (e) {
            console.warn('groupId-in-Query fehlgeschlagen:', e.message);
          }
        }
      }
    } catch (e) {
      console.warn('Gruppen-Fallback fehlgeschlagen:', e.message);
    }

    const events = Object.values(evtMap);

    // Gruppen-Namen laden
    const groupsSnap = await firestore.collection('groups').get();
    const groups = {};
    groupsSnap.forEach(doc => { groups[doc.id] = doc.data().name; });

    if (!events.length) {
      el.innerHTML = `
        <div class="card" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:var(--space-12) var(--space-8);">
          <span class="material-icons" style="font-size:48px;color:var(--color-text-faint);margin-bottom:12px;">event_note</span>
          <h3 style="margin:0 0 8px;">Keine Termine</h3>
          <p class="text-muted" style="max-width:38ch;margin:0;">Du bist noch keinem Termin als ${getRoleLabel('teacher')} zugeordnet und bist in keiner Gruppe.</p>
        </div>`;
      return;
    }

    // Laufende (start <= now) zählen als vergangen (wie member-dashboard)
    const upcoming = events
      .filter(e => { const s = e.startTime?.toDate?.(); return s && s > now; })
      .sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0));

    const past = events
      .filter(e => { const s = e.startTime?.toDate?.(); return s && s <= now; })
      .sort((a, b) => (b.startTime?.toMillis?.() ?? 0) - (a.startTime?.toMillis?.() ?? 0));

    el.innerHTML = `
      <div class="tabs" style="margin-bottom:16px;">
        <button class="tab-btn active" data-tab="upcoming">Kommende (${upcoming.length})</button>
        <button class="tab-btn"        data-tab="past">Vergangene (${past.length})</button>
      </div>
      <div id="trainer-tab-upcoming"></div>
      <div id="trainer-tab-past" hidden></div>
    `;

    const upEl = el.querySelector('#trainer-tab-upcoming');
    const ptEl = el.querySelector('#trainer-tab-past');

    el.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        el.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        upEl.hidden = btn.dataset.tab !== 'upcoming';
        ptEl.hidden = btn.dataset.tab !== 'past';
      };
    });

    renderTrainerEventList(upEl, upcoming, groups, window.appSettings || {}, false);
    renderTrainerEventList(ptEl, past,     groups, window.appSettings || {}, true);

  } catch (e) {
    console.error('renderTrainerEvents Fehler:', e);
    el.innerHTML = `<p class="text-error">Fehler beim Laden der Termine: ${e.message}</p>`;
  }
}

function renderTrainerEventList(el, events, groups, settings, isPast) {
  if (!events.length) {
    el.innerHTML = `<p class="text-muted" style="padding:16px 0;">Keine ${isPast ? 'vergangenen' : 'kommenden'} Termine.</p>`;
    return;
  }

  el.innerHTML = '';
  events.forEach(event => {
    const start       = event.startTime?.toDate?.();
    const end         = event.endTime?.toDate?.();
    const groupName   = groups[event.groupId] || '–';
    const isSkipped   = event.status === 'skipped';
    const isCancelled = event.status === 'cancelled';

    const statusBadge = isSkipped
      ? `<span class="chip chip-warning" style="font-size:0.78rem;">Ausgefallen</span>`
      : isCancelled
        ? `<span class="chip chip-error"   style="font-size:0.78rem;">Abgesagt</span>`
        : `<span class="chip chip-success" style="font-size:0.78rem;">Geplant</span>`;

    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '12px';
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <strong style="font-size:1rem;">${event.title || 'Termin'}</strong>
            ${statusBadge}
            ${event.recurrenceGroup ? '<span class="chip" style="font-size:0.75rem;">Serie</span>' : ''}
          </div>
          <div class="text-muted" style="font-size:0.85rem;display:flex;gap:16px;flex-wrap:wrap;">
            <span>
              <span class="material-icons" style="font-size:14px;vertical-align:middle;">schedule</span>
              ${start ? formatDateTime(start) : '–'}${end ? ' – ' + _fmtTime(end) : ''}
            </span>
            <span>
              <span class="material-icons" style="font-size:14px;vertical-align:middle;">group</span>
              ${groupName}
            </span>
            ${event.skipReason ? `<span style="color:var(--color-warning);"><span class="material-icons" style="font-size:14px;vertical-align:middle;">info</span> ${event.skipReason}</span>` : ''}
          </div>
        </div>
        <button class="btn-secondary toggle-att-btn" data-open="false"
                style="white-space:nowrap;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">people</span> Anwesenheit
        </button>
      </div>
      <div class="att-panel" style="display:none;margin-top:12px;border-top:1px solid var(--color-border);padding-top:12px;"></div>
    `;

    const toggleBtn = card.querySelector('.toggle-att-btn');
    const attDiv    = card.querySelector('.att-panel');

    toggleBtn.onclick = async () => {
      if (toggleBtn.dataset.open === 'true') {
        toggleBtn.dataset.open = 'false';
        attDiv.style.display   = 'none';
        toggleBtn.innerHTML    = `<span class="material-icons" style="font-size:16px;">people</span> Anwesenheit`;
        return;
      }
      toggleBtn.dataset.open = 'true';
      toggleBtn.innerHTML    = `<span class="material-icons" style="font-size:16px;">expand_less</span> Schließen`;
      attDiv.style.display   = 'block';
      await loadTrainerAttendancePanel(attDiv, event, isPast, settings);
    };

    el.appendChild(card);
  });
}

async function loadTrainerAttendancePanel(el, event, isPast, settings) {
  el.innerHTML = `<div class="loading-center" style="padding:12px 0;">Lade Teilnehmer...</div>`;
  try {
    const eventDoc  = await firestore.collection('events').doc(event.id).get();
    const eventData = eventDoc.exists ? { id: event.id, ...eventDoc.data() } : event;
    const eventMode = eventData.mode || 'opt_in';

    // Mitglieder aus Gruppe + directMembers
    const memberIds = new Set();
    if (eventData.groupId) {
      const gDoc = await firestore.collection('groups').doc(eventData.groupId).get();
      if (gDoc.exists) (gDoc.data().members || []).forEach(id => memberIds.add(id));
    }
    (eventData.directMembers || []).forEach(id => memberIds.add(id));

    // Attendance-Einträge
    const attSnap = await firestore.collection('eventAttendance')
      .where('eventId', '==', event.id).get();
    const attMap = {};
    attSnap.forEach(doc => {
      attMap[doc.data().userId] = doc.data();
      memberIds.add(doc.data().userId); // auch Nutzer die manuell hinzugefügt wurden
    });

    if (!memberIds.size) {
      el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <p class="text-muted" style="margin:0;">Keine Teilnehmer in diesem Termin.</p>
          <button class="btn-secondary add-mbr-btn" style="padding:5px 14px;display:inline-flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:16px;">person_add</span> Person hinzufügen
          </button>
        </div>`;
      el.querySelector('.add-mbr-btn').onclick = () =>
        showAddMemberToEventDialog(event.id, memberIds, [], () =>
          loadTrainerAttendancePanel(el, event, isPast, settings));
      return;
    }

    // Benutzer-Daten in Batches laden
    const ids   = [...memberIds];
    const users = [];
    for (let i = 0; i < ids.length; i += 30) {
      const chunk  = ids.slice(i, i + 30);
      const uSnap  = await firestore.collection('users')
        .where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get();
      uSnap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));
    }
    users.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

    el.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;';
    header.innerHTML = `
      <span style="font-weight:600;font-size:0.9rem;">${users.length} Teilnehmer</span>
      <button class="btn-secondary add-mbr-btn" style="padding:5px 14px;display:inline-flex;align-items:center;gap:6px;">
        <span class="material-icons" style="font-size:16px;">person_add</span> Person hinzufügen
      </button>`;
    el.appendChild(header);
    header.querySelector('.add-mbr-btn').onclick = () =>
      showAddMemberToEventDialog(event.id, memberIds, users, () =>
        loadTrainerAttendancePanel(el, event, isPast, settings));

    users.forEach(member => {
      const att = attMap[member.id];
      const row = renderAttendanceRow(
        eventData, member, att, isPast, eventMode, settings,
        () => loadTrainerAttendancePanel(el, event, isPast, settings)
      );
      el.appendChild(row);
    });

  } catch (e) {
    console.error('loadTrainerAttendancePanel Fehler:', e);
    el.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
  }
}

// ── Zeit-Hilfsfunktion (lokaler Name um Konflikte zu vermeiden) ───────────────
function _fmtTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ── Person zu Termin hinzufügen ───────────────────────────────────────────────
function showAddMemberToEventDialog(eventId, currentMemberIds, knownUsers, onAdded) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
  });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:12px;width:min(520px,95vw);
                max-height:80vh;display:flex;flex-direction:column;
                box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden;">
      <div style="padding:18px 22px 14px;border-bottom:1px solid var(--color-border);
                  display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h3 style="margin:0 0 2px;">Person zu Termin hinzufügen</h3>
          <p class="text-muted" style="margin:0;font-size:0.82rem;">Auch außerhalb der Gruppe möglich</p>
        </div>
        <button id="amt-close" style="background:none;border:none;font-size:1.4rem;
                                      color:var(--color-text-muted);cursor:pointer;">&times;</button>
      </div>
      <div style="padding:10px 22px;border-bottom:1px solid var(--color-border);">
        <input type="search" id="amt-search" placeholder="Person suchen..." style="margin-bottom:0;" />
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

  const renderList = (allUsers, q = '') => {
    listEl.innerHTML = '';
    const filtered = allUsers.filter(u =>
      !q || (u.displayName || u.email || '').toLowerCase().includes(q.toLowerCase())
    );
    if (!filtered.length) {
      listEl.innerHTML = '<p class="text-muted" style="padding:12px 0;">Keine Personen gefunden.</p>';
      return;
    }
    filtered.forEach(u => {
      const isAlready = currentMemberIds instanceof Set
        ? currentMemberIds.has(u.id)
        : (currentMemberIds || []).includes(u.id);
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;' +
        'padding:9px 0;border-bottom:1px solid var(--color-border);gap:12px;';
      row.innerHTML = `
        <div>
          <div style="font-weight:500;">${u.displayName || u.email || u.id}</div>
          <div style="font-size:0.8rem;color:var(--color-text-muted);">${u.email || ''}&nbsp;
            ${(u.roles || []).map(r =>
              `<span class="chip" style="font-size:0.72rem;padding:1px 6px;">${getRoleLabel(r)}</span>`
            ).join(' ')}
          </div>
        </div>
        <button class="${isAlready ? 'btn-secondary' : 'btn-primary'}"
                style="padding:4px 14px;font-size:0.85rem;white-space:nowrap;"
                ${isAlready ? 'disabled' : ''}>
          ${isAlready ? 'Bereits dabei' : 'Hinzufügen'}
        </button>`;
      if (!isAlready) {
        row.querySelector('button').onclick = async () => {
          try {
            await firestore.collection('events').doc(eventId).update({
              directMembers: firebase.firestore.FieldValue.arrayUnion(u.id),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            const evDoc    = await firestore.collection('events').doc(eventId).get();
            const mode     = evDoc.exists ? (evDoc.data().mode || 'opt_in') : 'opt_in';
            const initStat = mode === 'confirmation' ? 'confirmation_pending' : 'registered';
            await firestore.collection('eventAttendance')
              .doc(`${eventId}_${u.id}`).set({
                eventId, userId: u.id,
                status: initStat, trainerSet: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
            if (currentMemberIds instanceof Set) currentMemberIds.add(u.id);
            showToast(`${u.displayName || u.email} hinzugefügt.`, 'success');
            close();
            if (onAdded) onAdded();
          } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
        };
      }
      listEl.appendChild(row);
    });
  };

  const load = async () => {
    listEl.innerHTML = '<div class="loading-center" style="padding:16px 0;">Lade Benutzer...</div>';
    let allUsers = [...(knownUsers || [])];
    if (!allUsers.length) {
      try {
        const snap = await firestore.collection('users').orderBy('displayName').get();
        snap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
      } catch (e) { console.error(e); }
    } else {
      // Ergänze um eventuell fehlende Benutzer
      try {
        const snap = await firestore.collection('users').orderBy('displayName').get();
        const known = new Set(allUsers.map(u => u.id));
        snap.forEach(doc => { if (!known.has(doc.id)) allUsers.push({ id: doc.id, ...doc.data() }); });
      } catch (e) {}
    }
    renderList(allUsers);
    searchEl.oninput = () => renderList(allUsers, searchEl.value);
  };
  load();
}

// ── Attendance-Zeile (wird von Betreuer- und Mitglieder-Report verwendet) ─────
function renderAttendanceRow(event, member, att, isPast, eventMode, settings, onChanged) {
  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;align-items:center;flex-wrap:wrap;gap:8px;' +
    'padding:10px 0;border-bottom:1px solid var(--color-border);';

  const statusOptions = [
    { value: 'registered',           label: 'Angemeldet' },
    { value: 'confirmation_pending', label: 'Ausst. Bestätigung' },
    { value: 'present',              label: 'Anwesend' },
    { value: 'absent_excused',       label: 'Entsch. gefehlt' },
    { value: 'absent_unexcused',     label: 'Unentsch. gefehlt' },
    { value: 'late_excused',         label: 'Verspätet (E)' },
    { value: 'late_unexcused',       label: 'Verspätet (U)' },
    { value: 'cancelled',            label: 'Abgemeldet' },
  ];

  const defaultStatus =
    eventMode === 'confirmation' ? 'confirmation_pending'
    : eventMode === 'opt_out'    ? 'registered'
    : 'none';
  const currentStatus = att?.status || defaultStatus;

  const colorMap = {
    present:              'var(--color-success)',
    registered:           'var(--color-primary)',
    confirmation_pending: 'var(--color-warning)',
    absent_excused:       'var(--color-warning)',
    absent_unexcused:     'var(--color-error)',
    late_excused:         'var(--color-warning)',
    late_unexcused:       'var(--color-warning)',
    cancelled:            'var(--color-text-muted)',
    none:                 'var(--color-text-muted)',
  };
  const dotColor = colorMap[currentStatus] || 'var(--color-text-muted)';

  const pendingNote = currentStatus === 'confirmation_pending'
    ? `<span style="font-size:0.78rem;color:var(--color-warning);margin-left:4px;">
         <span class="material-icons" style="font-size:12px;vertical-align:middle;">pending</span> Ausständig
       </span>` : '';

  row.innerHTML = `
    <div style="flex:1;min-width:140px;">
      <div style="font-weight:500;">${member.displayName || member.email || member.id}</div>
      <div style="font-size:0.8rem;color:var(--color-text-muted);display:flex;align-items:center;gap:4px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};"></span>
        ${statusOptions.find(o => o.value === currentStatus)?.label || currentStatus}${pendingNote}
      </div>
    </div>
    <select data-role="status-sel" style="flex:1;min-width:160px;margin-bottom:0;">
      ${statusOptions.map(o =>
        `<option value="${o.value}" ${currentStatus === o.value ? 'selected' : ''}>${o.label}</option>`
      ).join('')}
    </select>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn-secondary" data-a="save"   style="padding:4px 12px;">Speichern</button>
      <button class="btn-secondary" data-a="note"   style="padding:4px 12px;">Notiz</button>
      <button class="btn-danger"    data-a="cancel" style="padding:4px 12px;">Termin absagen</button>
    </div>
  `;

  row.querySelector('[data-a="save"]').onclick = async () => {
    const ns = row.querySelector('[data-role="status-sel"]').value;
    await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
      eventId: event.id, userId: member.id,
      status: ns, trainerSet: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast('Status gespeichert.', 'success');
    if (onChanged) onChanged();
  };

  row.querySelector('[data-a="note"]').onclick = () => {
    showModal({
      title:  `Notiz für ${member.displayName || member.email}`,
      body: `
        <label>Notiz für ${getRoleLabel('member')} (sichtbar für das Mitglied)</label>
        <textarea id="tn-m" rows="3">${att?.trainerNoteMember || ''}</textarea>
        <label style="margin-top:8px;">Interne Notiz (nur für Betreuer)</label>
        <textarea id="tn-i" rows="2">${att?.trainerNoteInternal || ''}</textarea>
      `,
      confirmLabel: 'Speichern',
      onConfirm: async () => {
        await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
          eventId: event.id, userId: member.id,
          trainerNoteMember:   document.getElementById('tn-m')?.value || '',
          trainerNoteInternal: document.getElementById('tn-i')?.value || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Notiz gespeichert.', 'success');
        if (onChanged) onChanged();
      }
    });
  };

  row.querySelector('[data-a="cancel"]').onclick = () => {
    showModal({
      title: 'Termin absagen',
      body:  `<p>Soll <strong>${member.displayName || member.email}</strong> von diesem Termin abgemeldet werden?</p>`,
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
