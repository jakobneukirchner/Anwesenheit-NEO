// modules/trainer-dashboard.js
// Betreuer-Dashboard

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');

  if (window._silentRefresh && container.contains(document.activeElement)) return;

  if (!window._silentRefresh) {
    container.innerHTML = `<div class="loading-center">Lade Dashboard…</div>`;
  }

  try {
    const uid = window.currentUser?.firebaseUser?.uid;
    if (!uid) throw new Error('Nicht eingeloggt.');

    const settingsDoc = await firestore.collection('settings').doc('global').get();
    window.appSettings = settingsDoc.exists ? { ...(window.appSettings || {}), ...settingsDoc.data() } : (window.appSettings || {});

    const lookAheadDays = window.appSettings.defaultEventLookAhead ?? 30;
    const now = new Date();
    const futureEnd = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
    const pastStart = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

    // systemMessages für diesen User laden
    let systemMessages = [];
    try {
      const msgSnap = await firestore.collection('systemMessages')
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
      msgSnap.forEach(doc => {
        const d = { id: doc.id, ...doc.data() };
        const isGlobal = d.recipients === 'all' || !d.recipients;
        const isForUser = d.recipients === 'users' && Array.isArray(d.recipientUsers) && d.recipientUsers.includes(uid);
        // Vertretungsanfragen NICHT im Banner anzeigen – die haben eigenen Tab
        if ((isGlobal || isForUser) && d._msgType !== 'replacement_request') systemMessages.push(d);
      });
    } catch (e) {
      console.warn('systemMessages konnten nicht geladen werden:', e);
    }

    // Offene Vertretungsanfragen für diesen Trainer laden
    let pendingRequests = [];
    try {
      const reqSnap = await firestore.collection('substitution_requests')
        .where('requestedTo', '==', uid)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .get();
      reqSnap.forEach(doc => pendingRequests.push({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.warn('Vertretungsanfragen konnten nicht geladen werden:', e);
    }

    const [asTrainerSnap, cancelledSnap] = await Promise.all([
      firestore.collection('events').where('trainers', 'array-contains', uid).get(),
      firestore.collection('events').where('trainerCancellations', 'array-contains', uid).get()
    ]);

    const seen = new Set();
    const events = [];
    const addDoc = doc => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      events.push({ id: doc.id, ...doc.data() });
    };
    asTrainerSnap.forEach(addDoc);
    cancelledSnap.forEach(addDoc);

    const filtered = events.filter(e => {
      const t = e.startTime?.toDate?.();
      return t && t >= pastStart && t <= futureEnd;
    }).sort((a, b) => (a.startTime?.toMillis?.() || 0) - (b.startTime?.toMillis?.() || 0));

    const upcoming = filtered.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past = filtered.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; })
      .sort((a, b) => (b.startTime?.toMillis?.() || 0) - (a.startTime?.toMillis?.() || 0));

    const untilText = formatDate(futureEnd);
    const activeTab = container.querySelector('.tab-btn.active')?.dataset?.tab || 'upcoming';

    // systemMessages-Banner HTML
    const bannerHtml = systemMessages.length ? `
      <div id="trainer-system-messages" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        ${systemMessages.map(msg => {
          const isWarning   = msg.type === 'warning'  || msg.type === 'error';
          const isSuccess   = msg.type === 'success';
          const bgColor     = isWarning ? 'rgba(161,44,123,0.08)' : isSuccess ? 'rgba(67,122,34,0.08)' : 'rgba(0,105,111,0.08)';
          const borderColor = isWarning ? 'var(--color-error)' : isSuccess ? 'var(--color-success)' : 'var(--color-primary)';
          const iconColor   = isWarning ? 'var(--color-error)' : isSuccess ? 'var(--color-success)' : 'var(--color-primary)';
          const icon        = isWarning ? 'warning' : isSuccess ? 'check_circle' : 'info';
          return `
            <div style="background:${bgColor};border-left:4px solid ${borderColor};border-radius:6px;padding:10px 14px;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;" data-msg-id="${msg.id}">
              <span class="material-icons" style="font-size:20px;color:${iconColor};flex-shrink:0;margin-top:1px;">${icon}</span>
              <div style="flex:1;min-width:0;">
                ${msg.title ? `<strong style="color:${iconColor};display:block;margin-bottom:2px;">${escapeHtml(msg.title)}</strong>` : ''}
                <div style="font-size:0.88rem;color:var(--color-text);">${escapeHtml(msg.message || '')}</div>
              </div>
              <button class="btn-text trainer-msg-dismiss" data-msg-id="${msg.id}" style="flex-shrink:0;padding:2px 6px;font-size:0.8rem;color:var(--color-text-muted);" title="Ausblenden">
                <span class="material-icons" style="font-size:16px;">close</span>
              </button>
            </div>`;
        }).join('')}
      </div>` : '';

    const requestsBadge = pendingRequests.length
      ? `<span class="chip chip-warning" style="margin-left:4px;">${pendingRequests.length}</span>`
      : '';

    const newHtml = `
      <div id="trainer-list-view">
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
          <h2 style="margin:0;">${getRoleLabel('teacher')}-Dashboard</h2>
          <p class="text-muted" style="margin:0;font-size:0.9rem;">Termine bis <strong>${untilText}</strong> (${lookAheadDays} Tage im Voraus)</p>
        </div>

        ${bannerHtml}

        <div class="tabs" style="margin-bottom:16px;">
          <button class="tab-btn${activeTab === 'upcoming' ? ' active' : ''}" data-tab="upcoming">
            <span class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:4px;">event</span>
            Kommende Termine
            <span class="chip chip-primary" style="margin-left:4px;">${upcoming.length}</span>
          </button>
          <button class="tab-btn${activeTab === 'past' ? ' active' : ''}" data-tab="past">
            <span class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:4px;">history</span>
            Vergangene Termine
          </button>
          <button class="tab-btn${activeTab === 'requests' ? ' active' : ''}" data-tab="requests">
            <span class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:4px;">swap_horiz</span>
            Vertretungsanfragen
            ${requestsBadge}
          </button>
        </div>

        <div id="trainer-overview-upcoming" style="display:flex;flex-direction:column;gap:12px;"${activeTab !== 'upcoming' ? ' hidden' : ''}></div>
        <div id="trainer-overview-past"     style="display:flex;flex-direction:column;gap:12px;"${activeTab !== 'past'     ? ' hidden' : ''}></div>
        <div id="trainer-overview-requests" style="display:flex;flex-direction:column;gap:12px;"${activeTab !== 'requests' ? ' hidden' : ''}></div>
      </div>
    `;

    const scrollY = container.scrollTop;
    container.innerHTML = newHtml;
    container.scrollTop = scrollY;

    // Banner-Dismiss-Handler
    container.querySelectorAll('.trainer-msg-dismiss').forEach(btn => {
      btn.onclick = async () => {
        const msgId = btn.dataset.msgId;
        const bannerEl = container.querySelector(`[data-msg-id="${msgId}"]`);
        if (bannerEl) bannerEl.remove();
        const wrapper = document.getElementById('trainer-system-messages');
        if (wrapper && !wrapper.querySelector('[data-msg-id]')) wrapper.remove();
        try {
          await firestore.collection('systemMessages').doc(msgId).update({ active: false });
        } catch(e) {
          console.warn('systemMessage konnte nicht deaktiviert werden:', e);
        }
      };
    });

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('trainer-overview-upcoming').hidden = btn.dataset.tab !== 'upcoming';
        document.getElementById('trainer-overview-past').hidden     = btn.dataset.tab !== 'past';
        document.getElementById('trainer-overview-requests').hidden = btn.dataset.tab !== 'requests';
      };
    });

    const upEl  = document.getElementById('trainer-overview-upcoming');
    const paEl  = document.getElementById('trainer-overview-past');
    const reqEl = document.getElementById('trainer-overview-requests');

    if (!upcoming.length) upEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine kommenden Termine.</p></div>`;
    if (!past.length)     paEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine vergangenen Termine.</p></div>`;

    for (const ev of upcoming) upEl.appendChild(await renderTrainerOverviewCard(ev, false));
    for (const ev of past)     paEl.appendChild(await renderTrainerOverviewCard(ev, true));

    // Vertretungsanfragen rendern
    renderSubstitutionRequestsTab(reqEl, pendingRequests, uid);

  } catch (e) {
    console.error(e);
    if (!window._silentRefresh) {
      container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
    }
  }
}

/**
 * Rendert den Tab mit offenen Vertretungsanfragen für diesen Trainer.
 */
function renderSubstitutionRequestsTab(container, requests, myUid) {
  if (!requests.length) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:32px 16px;">
        <span class="material-icons" style="font-size:40px;color:var(--color-text-faint);margin-bottom:12px;display:block;">swap_horiz</span>
        <p class="text-muted" style="margin:0;">Keine offenen Vertretungsanfragen.</p>
      </div>`;
    return;
  }

  requests.forEach(req => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.borderLeft = '4px solid var(--color-warning)';

    const eventDate = req.eventDate?.toDate ? req.eventDate.toDate() : (req.eventDate ? new Date(req.eventDate) : null);
    const dateStr   = eventDate ? `${formatDate(eventDate)}, ${formatTime(eventDate)}` : '–';
    const createdAt = req.createdAt?.toDate ? req.createdAt.toDate() : null;
    const createdStr = createdAt ? formatDate(createdAt) : '';

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <span class="material-icons" style="font-size:18px;color:var(--color-warning);">swap_horiz</span>
            <strong style="font-size:1.05rem;">Vertretungsanfrage</strong>
            <span class="chip chip-warning" style="font-size:0.75rem;">Offen</span>
          </div>
          <div style="font-size:0.95rem;font-weight:600;margin-bottom:4px;">${escapeHtml(req.eventTitle || 'Termin')}</div>
          <div class="text-muted" style="font-size:0.88rem;margin-bottom:4px;">
            <span class="material-icons" style="font-size:14px;vertical-align:middle;">event</span>
            ${dateStr}
          </div>
          ${req.groupName ? `<div class="text-muted" style="font-size:0.85rem;margin-bottom:4px;">
            <span class="material-icons" style="font-size:14px;vertical-align:middle;">group</span>
            ${escapeHtml(req.groupName)}
          </div>` : ''}
          <div class="text-muted" style="font-size:0.85rem;margin-bottom:${req.note ? '8px' : '0'};">
            <span class="material-icons" style="font-size:14px;vertical-align:middle;">person</span>
            Angefragt von: <strong>${escapeHtml(req.requestedByName || 'Koordinator')}</strong>
            ${createdStr ? `<span style="margin-left:6px;color:var(--color-text-faint);">(${createdStr})</span>` : ''}
          </div>
          ${req.note ? `
            <div style="background:var(--color-surface-offset);border-radius:var(--radius-md);padding:8px 12px;font-size:0.88rem;color:var(--color-text);margin-top:4px;">
              <span class="material-icons" style="font-size:14px;vertical-align:middle;color:var(--color-primary);">chat_bubble_outline</span>
              ${escapeHtml(req.note)}
            </div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
          <button class="btn-primary sub-req-accept" data-req-id="${req.id}" style="padding:8px 18px;display:inline-flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:16px;">check_circle</span>Annehmen
          </button>
          <button class="btn-secondary sub-req-decline" data-req-id="${req.id}" style="padding:8px 18px;display:inline-flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:16px;">cancel</span>Ablehnen
          </button>
        </div>
      </div>
    `;

    // Annehmen
    card.querySelector('.sub-req-accept').onclick = () => {
      showModal({
        title: 'Vertretung annehmen',
        body: `
          <p>Möchtest du die Vertretung für <strong>${escapeHtml(req.eventTitle || 'diesen Termin')}</strong> am <strong>${dateStr}</strong> wirklich übernehmen?</p>
          <label style="margin-top:10px;">Nachricht an Koordinator (optional)</label>
          <textarea id="sub-accept-note" rows="2" placeholder="z.B. Ich bin dabei!" style="width:100%;"></textarea>
        `,
        confirmLabel: 'Ja, übernehmen',
        onConfirm: async () => {
          const note = document.getElementById('sub-accept-note')?.value.trim() || '';
          await _resolveSubstitutionRequest(req, 'accepted', note, myUid);
        }
      });
    };

    // Ablehnen
    card.querySelector('.sub-req-decline').onclick = () => {
      showModal({
        title: 'Vertretung ablehnen',
        body: `
          <p>Möchtest du die Vertretungsanfrage für <strong>${escapeHtml(req.eventTitle || 'diesen Termin')}</strong> ablehnen?</p>
          <label style="margin-top:10px;">Begründung (optional)</label>
          <textarea id="sub-decline-note" rows="2" placeholder="z.B. Ich bin verhindert." style="width:100%;"></textarea>
        `,
        confirmLabel: 'Ablehnen',
        onConfirm: async () => {
          const note = document.getElementById('sub-decline-note')?.value.trim() || '';
          await _resolveSubstitutionRequest(req, 'declined', note, myUid);
        }
      });
    };

    container.appendChild(card);
  });
}

/**
 * Verarbeitet Annehmen oder Ablehnen einer Vertretungsanfrage:
 * 1. Status in substitution_requests updaten
 * 2. systemMessage an den Koordinator senden
 * 3. Bei Annehmen: Trainer zum Event hinzufügen
 * 4. Dashboard neu laden
 */
async function _resolveSubstitutionRequest(req, resolution, note, myUid) {
  const myName = window.currentUser?.profile?.displayName || 'Betreuer';
  const isAccepted = resolution === 'accepted';

  try {
    // 1. substitution_requests aktualisieren
    await firestore.collection('substitution_requests').doc(req.id).update({
      status:      resolution,
      resolution:  resolution,
      resolvedAt:  firebase.firestore.FieldValue.serverTimestamp(),
      resolvedNote: note || ''
    });

    // 2. Bei Annehmen: Trainer zum Event hinzufügen
    if (isAccepted) {
      try {
        await firestore.collection('events').doc(req.eventId).update({
          trainers: firebase.firestore.FieldValue.arrayUnion(myUid),
          trainerCancellations: firebase.firestore.FieldValue.arrayRemove(myUid)
        });
      } catch (e) {
        console.warn('Event konnte nicht aktualisiert werden:', e);
      }
    }

    // 3. systemMessage an den anfragenden Koordinator senden
    const eventDate = req.eventDate?.toDate ? req.eventDate.toDate() : null;
    const dateStr   = eventDate ? `${formatDate(eventDate)}, ${formatTime(eventDate)}` : '–';

    const msgText = isAccepted
      ? `${myName} hat die Vertretungsanfrage für „${req.eventTitle || 'Termin'}" (${dateStr}) angenommen.${note ? ' Nachricht: ' + note : ''}`
      : `${myName} hat die Vertretungsanfrage für „${req.eventTitle || 'Termin'}" (${dateStr}) abgelehnt.${note ? ' Begründung: ' + note : ''}`;

    await firestore.collection('systemMessages').add({
      type:           isAccepted ? 'success' : 'warning',
      title:          isAccepted ? 'Vertretung angenommen' : 'Vertretung abgelehnt',
      message:        msgText,
      recipients:     'users',
      recipientUsers: [req.requestedBy],
      active:         true,
      highlight:      true,
      createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
      _eventId:       req.eventId,
      _eventTitle:    req.eventTitle || '',
      _fromUid:       myUid,
      _msgType:       'replacement_response'
    });

    showToast(
      isAccepted ? 'Vertretung angenommen. Koordinator wurde informiert.' : 'Anfrage abgelehnt. Koordinator wurde informiert.',
      isAccepted ? 'success' : 'info'
    );

    // Dashboard neu laden
    await loadTrainerDashboard();

  } catch (err) {
    console.error(err);
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function renderTrainerOverviewCard(event, isPast) {
  const card = createElement('div', 'card');
  card.style.marginBottom = '0';
  if (event.status === 'skipped')   card.style.borderLeft = '4px solid var(--color-warning)';
  if (event.status === 'cancelled') card.style.borderLeft = '4px solid var(--color-error)';

  const start = event.startTime?.toDate?.();
  const end   = event.endTime?.toDate?.();

  const attendanceSnap = await firestore.collection('eventAttendance').where('eventId', '==', event.id).get();
  const rows = [];
  attendanceSnap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));

  const registered = rows.filter(r => ['registered','present','confirmation_pending','late_excused','late_unexcused'].includes(r.status)).length;
  const total      = rows.length;
  const present    = rows.filter(r => ['present','late_excused','late_unexcused'].includes(r.status)).length;
  const missing    = Math.max(0, (event.minParticipants || 0) - registered);
  const needsBadge = !isPast && missing > 0;

  const activeTrainers = (event.trainers || []).filter(uid => !(event.trainerCancellations || []).includes(uid));
  const noTrainerBadge = !isPast && activeTrainers.length === 0 && (event.trainers || []).length > 0;

  const activeLabel = event.status === 'cancelled' ? 'Abgesagt' : event.status === 'skipped' ? 'Ausgefallen' : 'Aktiv';
  const activeClass = event.status === 'cancelled' ? 'chip-error' : event.status === 'skipped' ? 'chip-warning' : 'chip-success';

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:1.35rem;font-weight:700;line-height:1.2;margin-bottom:8px;">${event.title || 'Termin'}</div>
        <div class="text-muted" style="font-size:0.95rem;margin-bottom:10px;">${start ? formatDate(start) : '–'}, ${start ? formatTime(start) : ''}${end ? ' - ' + formatTime(end) : ''}</div>
        <div class="text-muted" style="font-size:0.92rem;">${registered} / ${total} Teilnehmer angemeldet${isPast ? ` · ${present} anwesend` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        ${noTrainerBadge ? `<span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;" title="Kein aktiver Betreuer – alle haben sich abgemeldet"><span class="material-icons" style="font-size:14px;">person_off</span>Kein Betreuer</span>` : ''}
        ${needsBadge ? `<span class="chip chip-warning" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">warning</span>Noch ${missing} Person${missing === 1 ? '' : 'en'} benötigt</span>` : ''}
        <span class="chip ${activeClass}" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">${event.status === 'cancelled' ? 'cancel' : 'check_circle'}</span>${activeLabel}</span>
        <button class="btn-primary" data-open-detail="${event.id}" style="padding:7px 16px;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">open_in_new</span>Details
        </button>
      </div>
    </div>
  `;

  card.querySelector('[data-open-detail]').onclick = () => openTrainerDetailPage(event.id);
  return card;
}

function openTrainerDetailPage(eventId) {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div id="trainer-detail-page"><div class="loading-center">Lade Termin…</div></div>`;
  renderTrainerDetailView(eventId, document.getElementById('trainer-detail-page'), {
    backFn: () => loadTrainerDashboard()
  });
}

function getAttendanceStatusChip(status) {
  const map = {
    registered:            { label: 'Angemeldet',             cls: 'chip-primary'  },
    present:               { label: 'Anwesend',               cls: 'chip-success'  },
    absent_excused:        { label: 'Entsch. gefehlt',        cls: 'chip-warning'  },
    absent_unexcused:      { label: 'Unentsch. gefehlt',      cls: 'chip-error'    },
    late_excused:          { label: 'Verspätet (entsch.)',    cls: 'chip-warning'  },
    late_unexcused:        { label: 'Verspätet (unentsch.)', cls: 'chip-error'    },
    cancelled:             { label: 'Abgemeldet',             cls: 'chip-warning'  },
    confirmation_pending:  { label: 'Ausst. Bestätigung',    cls: 'chip-primary'  },
  };
  const entry = map[status];
  if (!entry) return `<span class="chip" style="font-size:0.78rem;">${status}</span>`;
  return `<span class="chip ${entry.cls}" style="font-size:0.78rem;">${entry.label}</span>`;
}

async function renderTrainerDetailView(eventId, container, options = {}) {
  container.innerHTML = `<div class="loading-center">Lade Termin…</div>`;

  try {
    const eventDoc = await firestore.collection('events').doc(eventId).get();
    if (!eventDoc.exists) throw new Error('Termin nicht gefunden.');
    const event = { id: eventDoc.id, ...eventDoc.data() };
    const start = event.startTime?.toDate?.();
    const end   = event.endTime?.toDate?.();

    const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', event.id).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    const trainerUids = new Set(event.trainers || []);
    const userIds = new Set([...trainerUids, ...attendances.map(a => a.userId)]);
    const userMap = {};
    await Promise.all([...userIds].map(async uid => {
      const uDoc = await firestore.collection('users').doc(uid).get();
      userMap[uid] = uDoc.exists ? { id: uid, ...uDoc.data() } : { id: uid, displayName: uid };
    }));

    const registered = attendances.filter(a => ['registered','present','confirmation_pending','late_excused','late_unexcused'].includes(a.status)).length;
    const present    = attendances.filter(a => ['present','late_excused','late_unexcused'].includes(a.status)).length;
    const absent     = attendances.filter(a => ['absent_excused','absent_unexcused','cancelled'].includes(a.status)).length;
    const needed     = Math.max(0, (event.minParticipants || 0) - registered);
    const minReached = needed === 0;

    const description = event.description?.trim() || '';
    const location    = event.location?.trim()    || '';

    const descriptionBlock = description ? `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:700;">
          <span class="material-icons" style="font-size:18px;color:var(--color-primary);">description</span>
          Beschreibung
        </div>
        <div style="color:var(--color-text);white-space:pre-line;">${escapeHtml(description)}</div>
      </div>` : '';

    const locationBlock = location ? `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:700;">
          <span class="material-icons" style="font-size:18px;color:var(--color-primary);">place</span>
          Ort
        </div>
        <div style="color:var(--color-text);">${escapeHtml(location)}</div>
      </div>` : '';

    const myUid = window.currentUser?.firebaseUser?.uid;
    const iAmCancelled = (event.trainerCancellations || []).includes(myUid);
    const iAmTrainer   = trainerUids.has(myUid);
    const myLateMinutes = event.trainerLateMinutes?.[myUid] || null;
    const myLateNote    = event.trainerLateNotes?.[myUid]   || null;

    const activeTrainers = (event.trainers || []).filter(uid => !(event.trainerCancellations || []).includes(uid));
    const noTrainerWarning = activeTrainers.length === 0 && (event.trainers || []).length > 0;

    container.innerHTML = `
      <style>
        .member-note-tooltip-popup {
          position: fixed; z-index: 9999;
          background: var(--color-surface-2); border: 1px solid var(--color-border);
          border-radius: 8px; padding: 10px 14px; max-width: 280px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.15); font-size: 0.88rem; line-height: 1.5;
          color: var(--color-text); pointer-events: none; opacity: 0;
          transform: translateY(4px); transition: opacity 0.15s ease, transform 0.15s ease;
        }
        .member-note-tooltip-popup.visible { opacity: 1; transform: translateY(0); }
        .member-note-icon {
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--color-primary); vertical-align: middle;
          margin-left: 5px; border-radius: 50%; padding: 2px; transition: background 0.15s;
          -webkit-tap-highlight-color: transparent;
        }
        .member-note-icon:hover, .member-note-icon:focus {
          background: var(--color-primary-highlight); outline: none;
        }
      </style>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
        <button class="btn-secondary" id="trainer-back-btn" style="padding:7px 14px;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">arrow_back</span>Zurück
        </button>
        <div>
          <h2 style="margin:0;line-height:1.2;">${event.title || 'Termin'}</h2>
          <div class="text-muted" style="font-size:0.92rem;margin-top:4px;">
            ${start ? formatDate(start) : ''} &middot; ${start ? formatTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}
          </div>
        </div>
      </div>

      ${noTrainerWarning ? `
      <div style="background:rgba(161,44,123,0.08);border-left:4px solid var(--color-error);border-radius:6px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="material-icons" style="font-size:20px;color:var(--color-error);flex-shrink:0;">warning</span>
        <div style="flex:1;">
          <strong style="color:var(--color-error);">Kein aktiver Betreuer!</strong>
          <div style="font-size:0.87rem;color:var(--color-text-muted);margin-top:2px;">Alle Betreuer haben sich abgemeldet. Bitte eine Vertretung organisieren oder den Koordinator informieren.</div>
        </div>
        <button class="btn-secondary" id="trainer-notify-coord-btn" style="padding:6px 14px;display:inline-flex;align-items:center;gap:6px;flex-shrink:0;">
          <span class="material-icons" style="font-size:15px;">send</span>Koordinator informieren
        </button>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
        ${renderTrainerStatCard('Datum & Zeit', `${start ? formatDate(start) : '–'}, ${start ? formatTime(start) : ''}${end ? ' - ' + formatTime(end) : ''}`)}
        ${renderTrainerStatCard('Angemeldet', `${registered} / ${event.minParticipants || registered}`)}
        ${renderTrainerStatCard('Anwesend', `${present}`, 'var(--color-success)')}
        ${renderTrainerStatCard('Gefehlt', `${absent}`, absent > 0 ? 'var(--color-error)' : 'var(--color-text)')}
        ${renderTrainerNeedCard(needed, minReached)}
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-weight:700;">
          <span class="material-icons" style="font-size:18px;color:var(--color-primary);">groups</span>
          ${getRoleLabel('teacher')} dieses Termins
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${(event.trainers || []).map(uid => {
            const u = userMap[uid] || { displayName: uid };
            const cancelled = (event.trainerCancellations || []).includes(uid);
            const lateMin   = event.trainerLateMinutes?.[uid];
            const lateNote  = event.trainerLateNotes?.[uid];
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--color-border);">
                <span>${u.displayName || u.email || uid}</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  ${lateMin ? `<span class="chip chip-warning" title="${lateNote ? escapeHtml(lateNote) : ''}">~${lateMin} Min. verspätet</span>` : ''}
                  <span class="chip ${cancelled ? 'chip-error' : 'chip-success'}">${cancelled ? 'Abgemeldet' : 'Eingeplant'}</span>
                </div>
              </div>`;
          }).join('') || `<span class="text-muted">Keine Betreuer eingetragen.</span>`}
        </div>
      </div>

      ${descriptionBlock}
      ${locationBlock}

      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-weight:700;">
          <span class="material-icons" style="font-size:18px;color:var(--color-primary);">campaign</span>
          Nachricht an alle Mitglieder
        </div>
        <p class="text-muted" style="margin:0 0 10px;font-size:0.85rem;">Wird auf jeder Teilnehmer-Termincard als „Nachricht von ${escapeHtml(window.currentUser?.profile?.displayName || 'Betreuer')}" angezeigt.</p>
        <textarea id="trainer-broadcast-input" rows="3" style="width:100%;margin-bottom:10px;" placeholder="z.B. Bitte Sportschuhe mitbringen...">${escapeHtml(event.trainerBroadcast || '')}</textarea>
        <div><button class="btn-secondary" id="trainer-save-broadcast" style="padding:7px 14px;display:inline-flex;align-items:center;gap:6px;"><span class="material-icons" style="font-size:16px;">save</span>Nachricht speichern</button></div>
      </div>

      <div class="card" style="margin-bottom:12px;overflow-x:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="font-weight:700;display:flex;align-items:center;gap:8px;">
            <span class="material-icons" style="font-size:18px;color:var(--color-primary);">checklist</span>
            Anwesenheitsliste (${attendances.length})
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-secondary" id="trainer-add-person" style="padding:7px 14px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">person_add</span>Person hinzufügen
            </button>
            <button class="btn-secondary" id="trainer-mark-all-present" style="padding:7px 14px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">done_all</span>Alle anwesend
            </button>
            <button class="btn-primary" id="trainer-save-attendance" style="padding:7px 14px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">save</span>Speichern
            </button>
          </div>
        </div>
        <table style="width:100%;min-width:1150px;">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Schnell-Check</th>
              <th>Detailstatus</th>
              <th>Versp.-Grund</th>
              <th>Interne Notiz</th>
              <th>Notiz an Mitglied</th>
              <th>Hinweis v. Mitglied</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="trainer-attendance-body"></tbody>
        </table>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
          <span class="material-icons" style="font-size:18px;color:var(--color-primary);">settings</span>Aktionen
        </div>
        ${myLateMinutes ? `
          <div style="background:rgba(245,124,0,0.08);border-left:3px solid var(--color-warning,#f57c00);border-radius:4px;padding:8px 12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <span style="font-size:0.9rem;color:var(--color-warning,#f57c00);display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">schedule</span>
              Deine Verspätung: <strong>~${myLateMinutes} Min.</strong>${myLateNote ? ' – ' + escapeHtml(myLateNote) : ''}
            </span>
            <button class="btn-secondary" id="trainer-revoke-late-btn" style="padding:5px 14px;font-size:0.85rem;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:15px;">undo</span> Widerrufen
            </button>
          </div>
        ` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${iAmTrainer ? `
            <button class="btn-danger" id="trainer-cancel-self-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">${iAmCancelled ? 'event_available' : 'event_busy'}</span>
              ${iAmCancelled ? 'Wieder einplanen' : 'Als Betreuer abmelden'}
            </button>
            <button class="btn-secondary" id="trainer-cancel-event-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">cancel</span>Termin absagen
            </button>
            <button class="btn-secondary" id="trainer-late-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">schedule</span>
              ${myLateMinutes ? `Verspätung ändern` : 'Verspätung melden'}
            </button>
            <button class="btn-secondary" id="trainer-find-replacement-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">people</span>
              Nach Vertretung suchen
            </button>
          ` : ''}
        </div>
      </div>
    `;

    document.getElementById('trainer-back-btn').onclick = () => {
      if (options.backFn) options.backFn();
      else loadTrainerDashboard();
    };

    document.getElementById('trainer-save-broadcast').onclick = async () => {
      const btn = document.getElementById('trainer-save-broadcast');
      const msg = document.getElementById('trainer-broadcast-input').value.trim();
      btn.disabled = true;
      try {
        await firestore.collection('events').doc(event.id).update({
          trainerBroadcast: msg || firebase.firestore.FieldValue.delete()
        });
        showToast('Nachricht gespeichert.', 'success');
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };

    document.getElementById('trainer-add-person').onclick = () => _showAddMemberModal(event, null, async () => {
      await renderTrainerDetailView(event.id, container, options);
    });

    document.getElementById('trainer-mark-all-present').onclick = () => {
      container.querySelectorAll('.trainer-present-check').forEach(cb => { if (!cb.disabled) cb.checked = true; });
    };

    document.getElementById('trainer-save-attendance').onclick = async () => {
      const btn = document.getElementById('trainer-save-attendance');
      btn.disabled = true;
      try {
        const updates = [];
        document.getElementById('trainer-attendance-body').querySelectorAll('tr[data-att-id]').forEach(row => {
          const lateReasonVal = row.querySelector('.trainer-late-reason')?.value.trim() || '';
          const updatePayload = {
            status: row.querySelector('.trainer-status-select').value,
            trainerNoteInternal: row.querySelector('.trainer-internal-note').value.trim(),
            trainerNoteMember: row.querySelector('.trainer-member-note').value.trim(),
            trainerSet: true, trainerSetAt: new Date()
          };
          if (lateReasonVal) {
            updatePayload.lateReason = lateReasonVal;
          } else {
            updatePayload.lateReason = firebase.firestore.FieldValue.delete();
          }
          updates.push(firestore.collection('eventAttendance').doc(row.dataset.attId).update(updatePayload));
        });
        await Promise.all(updates);
        showToast('Anwesenheit gespeichert.', 'success');
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
        btn.disabled = false;
      }
    };

    const notifyCoordBtn = document.getElementById('trainer-notify-coord-btn');
    if (notifyCoordBtn) {
      notifyCoordBtn.onclick = () => _notifyCoordinatorNoTrainer(event);
    }

    if (iAmTrainer) {
      document.getElementById('trainer-cancel-self-btn').onclick = () => _toggleTrainerSelf(event, myUid, iAmCancelled, container, options);
      document.getElementById('trainer-cancel-event-btn').onclick = () => _cancelEvent(event, container, options);
      document.getElementById('trainer-late-btn').onclick = () => _reportTrainerLate(event, myUid, myLateMinutes, myLateNote, container, options);
      document.getElementById('trainer-find-replacement-btn').onclick = () => _openReplacementModal(event, myUid);

      const revokeBtn = document.getElementById('trainer-revoke-late-btn');
      if (revokeBtn) revokeBtn.onclick = () => {
        showModal({
          title: 'Verspätung widerrufen',
          body: `<p>Möchtest du deine gemeldete Verspätung wirklich widerrufen? Die Mitglieder sehen dann keine Verspätungsmeldung mehr von dir.</p>`,
          confirmLabel: 'Ja, widerrufen',
          onConfirm: async () => {
            try {
              await firestore.collection('events').doc(event.id).update({
                [`trainerLateMinutes.${myUid}`]: firebase.firestore.FieldValue.delete(),
                [`trainerLateNotes.${myUid}`]:   firebase.firestore.FieldValue.delete()
              });
              showToast('Verspätung widerrufen.', 'success');
              await renderTrainerDetailView(event.id, container, options);
            } catch (err) {
              showToast('Fehler: ' + err.message, 'error');
            }
          }
        });
      };
    }

    // Tooltip
    let tooltipEl = document.getElementById('trainer-member-note-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'trainer-member-note-tooltip';
      tooltipEl.className = 'member-note-tooltip-popup';
      document.body.appendChild(tooltipEl);
    }
    let tooltipHideTimer = null;

    function showMemberNoteTooltip(anchorEl, noteText) {
      clearTimeout(tooltipHideTimer);
      tooltipEl.textContent = noteText;
      tooltipEl.classList.add('visible');
      const rect = anchorEl.getBoundingClientRect();
      const tooltipW = 280;
      let left = rect.left + rect.width / 2 - tooltipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tooltipW - 8));
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top  = (rect.bottom + 8) + 'px';
    }

    function hideMemberNoteTooltip(delay = 200) {
      tooltipHideTimer = setTimeout(() => tooltipEl.classList.remove('visible'), delay);
    }

    const attBody = document.getElementById('trainer-attendance-body');
    const memberAttendances = attendances.filter(a => !trainerUids.has(a.userId));

    const statusOptions = [
      ['registered','Angemeldet'],
      ['present','Anwesend'],
      ['absent_excused','Entsch. gefehlt'],
      ['absent_unexcused','Unentsch. gefehlt'],
      ['late_excused','Verspätet (entsch.)'],
      ['late_unexcused','Verspätet (unentsch.)'],
      ['cancelled','Abgemeldet'],
      ['confirmation_pending','Ausst. Bestätigung']
    ];

    const isLateStatus = s => s === 'late_excused' || s === 'late_unexcused';

    for (const att of memberAttendances) {
      const u = userMap[att.userId] || { displayName: att.userId };
      const tr = document.createElement('tr');
      tr.dataset.attId = att.id;

      const noteIconHtml = att.memberNote
        ? `<span class="member-note-icon" tabindex="0" data-note="${escapeHtml(att.memberNote)}" title="Hinweis anzeigen"><span class="material-icons" style="font-size:16px;">sticky_note_2</span></span>`
        : '<span style="color:var(--color-text-faint);font-size:0.8rem;">–</span>';

      const statusChip = getAttendanceStatusChip(att.status);
      const setterHint = att.trainerSet
        ? `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:3px;">vom Betreuer</div>`
        : `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:3px;">selbst</div>`;

      const showLate = isLateStatus(att.status);

      tr.innerHTML = `
        <td style="font-weight:500;">${u.displayName || u.email || att.userId}</td>
        <td>
          ${statusChip}
          ${setterHint}
        </td>
        <td>
          <input type="checkbox" class="trainer-present-check" ${['present','late_excused','late_unexcused'].includes(att.status) ? 'checked' : ''}
            style="width:18px;height:18px;cursor:pointer;" />
        </td>
        <td>
          <select class="trainer-status-select" style="padding:4px 6px;font-size:0.85rem;">
            ${statusOptions.map(([v,l]) => `<option value="${v}"${att.status === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </td>
        <td>
          <input type="text" class="trainer-late-reason" value="${escapeHtml(att.lateReason || '')}"
            placeholder="Grund…"
            style="width:110px;${showLate ? '' : 'opacity:0.35;pointer-events:none;'}" />
        </td>
        <td><input type="text" class="trainer-internal-note" value="${escapeHtml(att.trainerNoteInternal || '')}" placeholder="Interne Notiz…" style="width:120px;" /></td>
        <td><input type="text" class="trainer-member-note" value="${escapeHtml(att.trainerNoteMember || '')}" placeholder="Notiz an Mitglied…" style="width:130px;" /></td>
        <td>${noteIconHtml}</td>
        <td></td>
      `;

      const presentCheck  = tr.querySelector('.trainer-present-check');
      const statusSelect  = tr.querySelector('.trainer-status-select');
      const lateReasonEl  = tr.querySelector('.trainer-late-reason');

      const syncLateReason = () => {
        const late = isLateStatus(statusSelect.value);
        lateReasonEl.style.opacity = late ? '1' : '0.35';
        lateReasonEl.style.pointerEvents = late ? 'auto' : 'none';
        if (!late) lateReasonEl.value = '';
      };

      presentCheck.onchange = () => {
        statusSelect.value = presentCheck.checked ? 'present' : 'registered';
        syncLateReason();
      };
      statusSelect.onchange = () => {
        presentCheck.checked = ['present','late_excused','late_unexcused'].includes(statusSelect.value);
        syncLateReason();
      };

      if (att.memberNote) {
        const noteIcon = tr.querySelector('.member-note-icon');
        if (noteIcon) {
          noteIcon.addEventListener('mouseenter', () => showMemberNoteTooltip(noteIcon, att.memberNote));
          noteIcon.addEventListener('mouseleave', () => hideMemberNoteTooltip());
          noteIcon.addEventListener('focus',      () => showMemberNoteTooltip(noteIcon, att.memberNote));
          noteIcon.addEventListener('blur',       () => hideMemberNoteTooltip());
          noteIcon.addEventListener('click',      () => showMemberNoteTooltip(noteIcon, att.memberNote));
        }
      }

      attBody.appendChild(tr);
    }

  } catch (e) {
    console.error(e);
    container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
  }
}

function renderTrainerStatCard(label, value, color = 'var(--color-text)') {
  return `
    <div class="card" style="padding:12px 16px;margin-bottom:0;">
      <div class="text-muted" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${label}</div>
      <div style="font-size:1.4rem;font-weight:700;color:${color};">${value}</div>
    </div>`;
}

function renderTrainerNeedCard(needed, minReached) {
  if (minReached) {
    return `<div class="card" style="padding:12px 16px;margin-bottom:0;border-left:3px solid var(--color-success);">
      <div class="text-muted" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Mindestanzahl</div>
      <div style="font-size:1rem;font-weight:600;color:var(--color-success);display:flex;align-items:center;gap:6px;">
        <span class="material-icons" style="font-size:18px;">check_circle</span>Erreicht
      </div>
    </div>`;
  }
  return `<div class="card" style="padding:12px 16px;margin-bottom:0;border-left:3px solid var(--color-warning);">
    <div class="text-muted" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Noch benötigt</div>
    <div style="font-size:1.4rem;font-weight:700;color:var(--color-warning);">${needed} Person${needed === 1 ? '' : 'en'}</div>
  </div>`;
}

function _toggleTrainerSelf(event, myUid, iAmCancelled, container, options) {
  showModal({
    title: iAmCancelled ? 'Wieder einplanen' : 'Als Betreuer abmelden',
    body: iAmCancelled
      ? `<p>Möchtest du dich wieder als ${getRoleLabel('teacher')} für diesen Termin einplanen?</p>`
      : `<p>Möchtest du dich als ${getRoleLabel('teacher')} von diesem Termin abmelden?</p>`,
    confirmLabel: iAmCancelled ? 'Wieder einplanen' : 'Abmelden',
    onConfirm: async () => {
      try {
        if (iAmCancelled) {
          await firestore.collection('events').doc(event.id).update({
            trainerCancellations: firebase.firestore.FieldValue.arrayRemove(myUid)
          });
          showToast('Wieder eingeplant.', 'success');
        } else {
          await firestore.collection('events').doc(event.id).update({
            trainerCancellations: firebase.firestore.FieldValue.arrayUnion(myUid)
          });
          showToast('Als Betreuer abgemeldet.', 'success');

          await renderTrainerDetailView(event.id, container, options);

          const freshDoc = await firestore.collection('events').doc(event.id).get();
          const freshEvent = freshDoc.exists ? { id: freshDoc.id, ...freshDoc.data() } : event;
          const stillActive = (freshEvent.trainers || []).filter(uid => !(freshEvent.trainerCancellations || []).includes(uid));

          if (stillActive.length === 0) {
            setTimeout(() => {
              showModal({
                title: 'Kein Betreuer mehr!',
                body: `<p style="color:var(--color-error);font-weight:600;margin-bottom:8px;">⚠️ Es sind jetzt keine aktiven Betreuer für diesen Termin mehr eingetragen.</p>
                       <p>Möchtest du den Koordinator darüber informieren oder direkt eine Vertretung suchen?</p>`,
                confirmLabel: 'Koordinator informieren',
                cancelLabel: 'Vertretung suchen',
                onConfirm: async () => {
                  await _notifyCoordinatorNoTrainer(freshEvent);
                },
                onCancel: () => {
                  _openReplacementModal(freshEvent, myUid);
                }
              });
            }, 180);
          } else if ((event.trainers || []).length > 1) {
            setTimeout(() => {
              showModal({
                title: 'Vertretung organisieren?',
                body: `<p>Du hast dich abgemeldet. Möchtest du direkt einen anderen Betreuer als mögliche Vertretung vorschlagen/benachrichtigen?</p>`,
                confirmLabel: 'Vertretung auswählen',
                onConfirm: async () => {
                  _openReplacementModal(freshEvent, myUid);
                }
              });
            }, 180);
          }
          return;
        }
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
      }
    }
  });
}

function _cancelEvent(event, container, options) {
  showModal({
    title: 'Termin absagen',
    body: `
      <p>Bitte gib eine kurze Begründung an (optional):</p>
      <input type="text" id="cancel-reason-input" placeholder="z.B. Halle nicht verfügbar" />
    `,
    confirmLabel: 'Termin absagen',
    onConfirm: async () => {
      const reason = document.getElementById('cancel-reason-input')?.value.trim() || '';
      try {
        await firestore.collection('events').doc(event.id).update({
          status: 'cancelled',
          cancellationReason: reason || firebase.firestore.FieldValue.delete()
        });
        showToast('Termin abgesagt.', 'success');
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
      }
    }
  });
}

function _reportTrainerLate(event, myUid, currentLateMinutes, currentLateNote, container, options) {
  showModal({
    title: currentLateMinutes ? 'Verspätung ändern' : 'Verspätung melden',
    body: `
      <p>Wie viele Minuten wirst du voraussichtlich zu spät sein?</p>
      <label>Minuten</label>
      <input type="number" id="late-minutes-input" min="1" max="120" value="${currentLateMinutes || 15}" style="width:100px;" />
      <label style="margin-top:10px;">Begründung (optional, für Mitglieder sichtbar)</label>
      <input type="text" id="late-note-input" placeholder="z.B. Zug hat Verspätung" value="${escapeHtml(currentLateNote || '')}" />
    `,
    confirmLabel: 'Speichern',
    onConfirm: async () => {
      const minutes = parseInt(document.getElementById('late-minutes-input')?.value || '0', 10);
      const note    = document.getElementById('late-note-input')?.value.trim() || '';
      if (!minutes || minutes < 1) { showToast('Bitte eine gültige Minutenzahl eingeben.', 'warning'); return; }
      try {
        await firestore.collection('events').doc(event.id).update({
          [`trainerLateMinutes.${myUid}`]: minutes,
          [`trainerLateNotes.${myUid}`]:   note || firebase.firestore.FieldValue.delete()
        });
        showToast(`Verspätung von ~${minutes} Min. gemeldet.`, 'success');
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
      }
    }
  });
}

async function _notifyCoordinatorNoTrainer(event) {
  const start = event.startTime?.toDate?.();
  const dateStr = start ? `${formatDate(start)}, ${formatTime(start)}` : 'unbekanntes Datum';
  const myName = window.currentUser?.profile?.displayName || 'Ein Betreuer';

  try {
    const coordSnap = await firestore.collection('users').get();
    const coordinators = [];
    coordSnap.forEach(doc => {
      const d = doc.data();
      if ((d.roles || []).some(r => r === 'coordinator' || r === 'admin')) {
        coordinators.push({ id: doc.id, ...d });
      }
    });

    if (!coordinators.length) {
      showToast('Keine Koordinatoren gefunden.', 'warning');
      return;
    }

    const coordUids = coordinators.map(c => c.id);
    const msgText = `${myName} meldet: Der Termin „${event.title || 'Termin'}" (${dateStr}) hat keinen aktiven Betreuer mehr. Bitte eine Vertretung organisieren.`;

    await firestore.collection('systemMessages').add({
      type:            'warning',
      title:           'Kein Betreuer!',
      message:         msgText,
      recipients:      'users',
      recipientUsers:  coordUids,
      active:          true,
      highlight:       true,
      createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
      _eventId:        event.id,
      _eventTitle:     event.title || '',
      _fromUid:        window.currentUser?.firebaseUser?.uid || null,
      _msgType:        'no_trainer_alert'
    });

    showToast(`Koordinator${coordinators.length > 1 ? 'en' : ''} informiert.`, 'success');
  } catch (err) {
    showToast('Fehler beim Senden: ' + err.message, 'error');
  }
}

async function _openReplacementModal(event, requestingUid) {
  const start = event.startTime?.toDate?.();
  const dateStr = start ? `${formatDate(start)}, ${formatTime(start)}` : 'unbekanntes Datum';

  let allTrainers = [];
  try {
    const snap = await firestore.collection('users').orderBy('displayName').get();
    snap.forEach(doc => {
      const d = doc.data();
      if ((d.roles || []).includes('teacher') && doc.id !== requestingUid) {
        allTrainers.push({ id: doc.id, ...d });
      }
    });
  } catch (e) {
    console.warn('Konnte Trainer nicht laden:', e);
  }

  if (!allTrainers.length) {
    showModal({
      title: 'Keine Betreuer verfügbar',
      body: `<p>Es sind keine weiteren ${getRoleLabel('teacher')} im System eingetragen.</p>`,
      confirmLabel: 'OK',
      onConfirm: () => {}
    });
    return;
  }

  const myProfile = window.currentUser?.profile;
  const myName = myProfile?.displayName || 'Ein Betreuer';

  const eventTrainerUids = new Set((event.trainers || []).filter(uid => uid !== requestingUid));
  const ownTrainers   = allTrainers.filter(u => eventTrainerUids.has(u.id));
  const otherTrainers = allTrainers.filter(u => !eventTrainerUids.has(u.id));

  const buildOptions = (list, groupLabel) => list.length
    ? `<optgroup label="${groupLabel}">${list.map(u => `<option value="${u.id}">${u.displayName || u.email || u.id}</option>`).join('')}</optgroup>`
    : '';

  const optionsHtml = buildOptions(ownTrainers, 'Am Termin eingeplant')
    + buildOptions(otherTrainers, 'Andere Betreuer');

  showModal({
    title: 'Vertretung anfragen',
    body: `
      <p style="margin-bottom:12px;">Wen möchtest du als mögliche Vertretung für <strong>${escapeHtml(event.title || 'diesen Termin')}</strong> (${dateStr}) anfragen?</p>
      <label style="display:block;margin-bottom:4px;font-weight:600;">Betreuer auswählen</label>
      <select id="replacement-target-select" style="width:100%;margin-bottom:12px;">${optionsHtml}</select>
      <label style="display:block;margin-bottom:4px;font-weight:600;">Nachricht (optional)</label>
      <textarea id="replacement-message-input" rows="3" placeholder="z.B. Ich kann leider nicht kommen. Kannst du einspringen?" style="width:100%;"></textarea>
    `,
    confirmLabel: 'Anfrage senden',
    onConfirm: async () => {
      const targetUid = document.getElementById('replacement-target-select')?.value;
      const customMsg = document.getElementById('replacement-message-input')?.value.trim() || '';
      if (!targetUid) return;

      const targetUser = allTrainers.find(u => u.id === targetUid) || { displayName: targetUid };
      const messageText = customMsg
        || `${myName} kann beim Termin „${event.title || 'Termin'}" (${dateStr}) nicht dabei sein und fragt, ob du einspringen kannst.`;

      try {
        await firestore.collection('systemMessages').add({
          type:           'info',
          title:          'Vertretungsanfrage',
          message:        messageText,
          recipients:     'users',
          recipientUsers: [targetUid],
          active:         true,
          highlight:      true,
          createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
          _eventId:       event.id,
          _eventTitle:    event.title || '',
          _fromUid:       requestingUid,
          _msgType:       'replacement_request'
        });
        showToast(`Anfrage an ${targetUser.displayName || 'Betreuer'} gesendet.`, 'success');
      } catch (err) {
        showToast('Fehler beim Senden: ' + err.message, 'error');
      }
    }
  });
}
