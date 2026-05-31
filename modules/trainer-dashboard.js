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

    // Auto-Cancel-Check: offene Anfragen prüfen bevor wir rendern
    await _checkAutoCancelRequests();

    // Keine Composite-Queries (kein Index nötig): nur einzelne where-Klauseln,
    // Sortierung + zweite Filterbedingungen werden clientseitig erledigt.
    const [asTrainerSnap, cancelledSnap, incomingTargetedSnap, mySentSnap] = await Promise.all([
      firestore.collection('events').where('trainers', 'array-contains', uid).get(),
      firestore.collection('events').where('trainerCancellations', 'array-contains', uid).get(),
      // Eingehende gezielte Anfragen (nur targetTrainerId-Filter)
      firestore.collection('substitution_requests').where('targetTrainerId', '==', uid).get(),
      // Meine gesendeten Anfragen (nur requesterId-Filter, Sortierung clientseitig)
      firestore.collection('substitution_requests').where('requesterId', '==', uid).get()
    ]);

    // Allgemeine Anfragen ohne Composite-Index
    const generalSnap = await firestore.collection('substitution_requests')
      .where('targetTrainerId', '==', null)
      .get();

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

    // Vertretungsanfragen clientseitig filtern und sortieren
    const incoming = [];
    const seenReq = new Set();

    // Gezielte eingehende: nur 'open'
    incomingTargetedSnap.forEach(doc => {
      const d = doc.data();
      if (d.status === 'open' && !seenReq.has(doc.id)) {
        seenReq.add(doc.id);
        incoming.push({ id: doc.id, ...d });
      }
    });
    // Allgemeine offene (nicht von mir)
    generalSnap.forEach(doc => {
      const d = doc.data();
      if (d.status === 'open' && d.requesterId !== uid && !seenReq.has(doc.id)) {
        seenReq.add(doc.id);
        incoming.push({ id: doc.id, ...d });
      }
    });

    // Meine gesendeten: clientseitig sortieren + auf 10 begrenzen
    const mySent = [];
    mySentSnap.forEach(doc => mySent.push({ id: doc.id, ...doc.data() }));
    mySent.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
      const tb = b.createdAt?.toMillis?.() || (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
      return tb - ta;
    });
    const mySentLimited = mySent.slice(0, 10);

    const hasSubstRequests = incoming.length > 0 || mySentLimited.length > 0;

    const newHtml = `
      <div id="trainer-list-view">
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
          <h2 style="margin:0;">${getRoleLabel('teacher')}-Dashboard</h2>
          <p class="text-muted" style="margin:0;font-size:0.9rem;">Termine bis <strong>${untilText}</strong> (${lookAheadDays} Tage im Voraus)</p>
        </div>

        <div class="tabs" style="margin-bottom:16px;">
          <button class="tab-btn active" data-tab="upcoming">
            <span class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:4px;">event</span>
            Kommende Termine
            <span class="chip chip-primary" style="margin-left:4px;">${upcoming.length}</span>
          </button>
          <button class="tab-btn" data-tab="past">
            <span class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:4px;">history</span>
            Vergangene Termine
          </button>
        </div>

        <div id="trainer-overview-upcoming" style="display:flex;flex-direction:column;gap:12px;"></div>

        <div id="trainer-section-divider" style="display:flex;align-items:center;gap:12px;margin:28px 0 16px;">
          <div style="flex:1;height:1px;background:var(--color-border);"></div>
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);white-space:nowrap;">
            <span class="material-icons" style="font-size:15px;">history</span>
            Vergangene Termine
          </span>
          <div style="flex:1;height:1px;background:var(--color-border);"></div>
        </div>

        <div id="trainer-overview-past" style="display:flex;flex-direction:column;gap:12px;"></div>

        ${hasSubstRequests ? `
        <div style="display:flex;align-items:center;gap:12px;margin:28px 0 16px;">
          <div style="flex:1;height:1px;background:var(--color-border);"></div>
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);white-space:nowrap;">
            <span class="material-icons" style="font-size:15px;">swap_horiz</span>
            Vertretungsanfragen
          </span>
          <div style="flex:1;height:1px;background:var(--color-border);"></div>
        </div>
        <div id="trainer-substitution-section"></div>
        ` : ''}
      </div>
    `;

    const scrollY = container.scrollTop;
    container.innerHTML = newHtml;
    container.scrollTop = scrollY;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.dataset.tab === 'past' ? 'trainer-section-divider' : 'trainer-overview-upcoming';
        const targetEl = document.getElementById(targetId);
        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });

    const upEl = document.getElementById('trainer-overview-upcoming');
    const paEl = document.getElementById('trainer-overview-past');

    if (!upcoming.length) upEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine kommenden Termine.</p></div>`;
    if (!past.length)     paEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine vergangenen Termine.</p></div>`;

    for (const ev of upcoming) upEl.appendChild(await renderTrainerOverviewCard(ev, false));
    for (const ev of past)     paEl.appendChild(await renderTrainerOverviewCard(ev, true));

    if (hasSubstRequests) {
      renderSubstitutionSection(document.getElementById('trainer-substitution-section'), incoming, mySentLimited, uid);
    }

  } catch (e) {
    console.error(e);
    if (!window._silentRefresh) {
      container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
    }
  }
}

/* ===================== VERTRETUNGSANFRAGEN-SEKTION ===================== */

function renderSubstitutionSection(el, incoming, mySent, myUid) {
  let html = '';

  if (incoming.length) {
    html += `<div style="font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:6px;color:var(--color-text-muted);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.04em;">
      <span class="material-icons" style="font-size:16px;">inbox</span>Eingehend
    </div>`;
    html += incoming.map(req => {
      const d = req.eventDate?.toDate?.();
      const isGeneral = !req.targetTrainerId;
      return `
        <div class="card" style="margin-bottom:10px;border-left:3px solid var(--color-warning);" data-req-id="${req.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                <span class="material-icons" style="font-size:16px;color:var(--color-warning);">swap_horiz</span>
                ${req.eventGroupName || 'Gruppe'}
                ${isGeneral ? `<span class="chip chip-warning" style="font-size:0.72rem;">Allgemeine Anfrage</span>` : ''}
              </div>
              <div class="text-muted" style="font-size:0.88rem;">
                📅 ${d ? formatDate(d) : '–'}
                ${req.note ? ` · <em>"${escapeHtml(req.note)}"</em>` : ''}
              </div>
              <div class="text-muted" style="font-size:0.82rem;margin-top:3px;">Von: ${escapeHtml(req.requesterName || '–')}</div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <button class="btn-danger" data-action="decline-req" data-req-id="${req.id}" style="padding:6px 12px;font-size:0.85rem;">Ablehnen</button>
              <button class="btn-primary" data-action="accept-req" data-req-id="${req.id}" data-event-id="${req.eventId}" style="padding:6px 12px;font-size:0.85rem;display:inline-flex;align-items:center;gap:4px;">
                <span class="material-icons" style="font-size:15px;">check</span>Annehmen & öffnen
              </button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  const relevantSent = mySent.filter(r => r.requesterId === myUid);
  if (relevantSent.length) {
    html += `<div style="font-weight:600;margin:14px 0 10px;display:flex;align-items:center;gap:6px;color:var(--color-text-muted);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.04em;">
      <span class="material-icons" style="font-size:16px;">outbox</span>Meine Anfragen
    </div>`;
    html += relevantSent.map(req => {
      const d = req.eventDate?.toDate?.();
      const statusMap = {
        open:      { label: 'Offen – warte auf Rückmeldung', cls: 'chip-warning', icon: 'hourglass_empty' },
        accepted:  { label: `Angenommen${req.acceptedByName ? ' von ' + req.acceptedByName : ''}`, cls: 'chip-success', icon: 'check_circle' },
        cancelled: { label: 'Termin abgesagt', cls: 'chip-error', icon: 'cancel' },
        declined:  { label: 'Abgelehnt', cls: 'chip-error', icon: 'cancel' },
      };
      const s = statusMap[req.status] || { label: req.status, cls: '', icon: 'info' };
      return `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:600;margin-bottom:4px;">${req.eventGroupName || 'Gruppe'}</div>
              <div class="text-muted" style="font-size:0.88rem;">📅 ${d ? formatDate(d) : '–'}</div>
            </div>
            <span class="chip ${s.cls}" style="display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:14px;">${s.icon}</span>${s.label}
            </span>
          </div>
        </div>`;
    }).join('');
  }

  el.innerHTML = html || '<div class="card"><p class="text-muted" style="margin:0;">Keine Vertretungsanfragen.</p></div>';

  // Events binden
  el.querySelectorAll('[data-action="accept-req"]').forEach(btn => {
    btn.onclick = () => _acceptSubstitutionRequest(btn.dataset.reqId, btn.dataset.eventId);
  });
  el.querySelectorAll('[data-action="decline-req"]').forEach(btn => {
    btn.onclick = () => _declineSubstitutionRequest(btn.dataset.reqId);
  });
}

async function _acceptSubstitutionRequest(reqId, eventId) {
  const myUid  = window.currentUser?.firebaseUser?.uid;
  const myName = window.currentUser?.profile?.displayName || 'Trainer';
  showModal({
    title: 'Vertretung annehmen',
    body: `<p>Möchtest du diese Vertretung übernehmen? Der Termin wird direkt geöffnet.</p>`,
    confirmLabel: 'Annehmen',
    onConfirm: async () => {
      try {
        const batch = firestore.batch();
        const reqRef = firestore.collection('substitution_requests').doc(reqId);
        batch.update(reqRef, {
          status: 'accepted',
          resolution: 'trainer_found',
          acceptedById: myUid,
          acceptedByName: myName,
          resolvedAt: new Date()
        });
        const reqDoc = await reqRef.get();
        const req = reqDoc.data();
        const evRef = firestore.collection('events').doc(req.eventId || eventId);
        batch.update(evRef, {
          substitutionStatus: 'filled',
          substitutionTrainerId: myUid
        });
        await batch.commit();
        await _sendSubstitutionMessage(req, 'accepted', myName);
        showToast('Vertretung angenommen.', 'success');
        openTrainerDetailPage(req.eventId || eventId);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
      }
    }
  });
}

async function _declineSubstitutionRequest(reqId) {
  showModal({
    title: 'Anfrage ablehnen',
    body: `<p>Möchtest du diese Vertretungsanfrage ablehnen? Sie wird dann als <strong>allgemeine Anfrage</strong> an alle Koordinatoren weitergeleitet.</p>`,
    confirmLabel: 'Ablehnen',
    onConfirm: async () => {
      try {
        const reqRef = firestore.collection('substitution_requests').doc(reqId);
        const reqDoc = await reqRef.get();
        const req = reqDoc.data();
        await reqRef.update({ status: 'declined' });
        if (req.targetTrainerId) {
          await firestore.collection('substitution_requests').add({
            ...req,
            targetTrainerId: null,
            targetTrainerName: null,
            status: 'open',
            autoCancelNotified: false,
            createdAt: new Date()
          });
          await _sendSubstitutionMessage(req, 'declined_to_general');
        }
        showToast('Anfrage abgelehnt. Wurde als allgemeine Anfrage weitergeleitet.', 'info');
        loadTrainerDashboard();
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
      }
    }
  });
}

/* ===================== OVERVIEW CARD ===================== */

async function renderTrainerOverviewCard(event, isPast) {
  const card = createElement('div', 'card');
  card.style.marginBottom = '0';
  if (event.status === 'skipped')   card.style.borderLeft = '4px solid var(--color-warning)';
  if (event.status === 'cancelled') card.style.borderLeft = '4px solid var(--color-error)';

  if (event.substitutionStatus === 'requested') {
    card.style.borderLeft = '4px solid var(--color-notification)';
    card.style.background = 'color-mix(in oklch, var(--color-notification) 6%, var(--color-surface))';
  }

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
  const activeLabel = event.status === 'cancelled' ? 'Abgesagt' : event.status === 'skipped' ? 'Ausgefallen' : 'Aktiv';
  const activeClass = event.status === 'cancelled' ? 'chip-error' : event.status === 'skipped' ? 'chip-warning' : 'chip-success';

  const substBadge = event.substitutionStatus === 'requested'
    ? `<span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">swap_horiz</span>Vertretung gesucht</span>`
    : '';

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:1.35rem;font-weight:700;line-height:1.2;margin-bottom:8px;">${event.title || 'Termin'}</div>
        <div class="text-muted" style="font-size:0.95rem;margin-bottom:10px;">${start ? formatDate(start) : '–'}, ${start ? formatTime(start) : ''}${end ? ' - ' + formatTime(end) : ''}</div>
        <div class="text-muted" style="font-size:0.92rem;">${registered} / ${total} Teilnehmer angemeldet${isPast ? ` · ${present} anwesend` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        ${substBadge}
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

    const myUid = window.currentUser?.firebaseUser?.uid;

    // Offene eigene Anfrage für diesen Termin: nur eventId+status filtern (kein Index nötig)
    // requesterId wird clientseitig geprüft
    let myOpenRequest = null;
    const myReqSnap = await firestore.collection('substitution_requests')
      .where('eventId', '==', eventId)
      .where('status', '==', 'open')
      .get();
    myReqSnap.forEach(doc => {
      const d = doc.data();
      if (d.requesterId === myUid && !myOpenRequest) {
        myOpenRequest = { id: doc.id, ...d };
      }
    });

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

    const iAmCancelled = (event.trainerCancellations || []).includes(myUid);
    const iAmTrainer   = trainerUids.has(myUid);
    const myLateMinutes = event.trainerLateMinutes?.[myUid] || null;
    const myLateNote    = event.trainerLateNotes?.[myUid]   || null;

    // "Vertretung anfragen"-Button: nur sichtbar wenn abgemeldet und noch keine offene Anfrage
    const showSubstBtn = iAmTrainer && iAmCancelled && !myOpenRequest;

    const substBanner = myOpenRequest ? `
      <div id="subst-banner" style="background:color-mix(in oklch,var(--color-warning) 10%,var(--color-surface));border:1px solid var(--color-warning);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span style="display:inline-flex;align-items:center;gap:8px;font-size:0.9rem;color:var(--color-warning);">
          <span class="material-icons" style="font-size:18px;">warning</span>
          <strong>Offene Vertretungsanfrage:</strong> Für diesen Termin wartest du noch auf eine Vertretung.
          ${myOpenRequest.targetTrainerName ? `Angefragt: <strong>${escapeHtml(myOpenRequest.targetTrainerName)}</strong>` : 'Allgemeine Anfrage an Koordinatoren.'}
        </span>
        <button class="btn-secondary" id="subst-banner-close" style="padding:4px 10px;font-size:0.82rem;">Schließen</button>
      </div>` : '';

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
        .member-late-reason-icon {
          display: inline-flex; align-items: center; gap: 4px;
          cursor: pointer; color: var(--color-warning, #e65100);
          font-size: 0.82rem; vertical-align: middle;
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

      ${substBanner}

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
        <table style="width:100%;min-width:1100px;">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Schnell-Check</th>
              <th>Detailstatus</th>
              <th>Interne Notiz</th>
              <th>Notiz an Mitglied</th>
              <th>Hinweis v. Mitglied</th>
              <th>Versp.-Grund</th>
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
            <button class="btn-secondary" id="trainer-revoke-late-btn" style="padding:5px 14px;font-size:0.85rem;display:inline-flex;align-items:center;gap:4px;">
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
            ${showSubstBtn ? `
            <button class="btn-secondary" id="trainer-ask-subst-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">swap_horiz</span>
              Vertretung anfragen
            </button>
            ` : ''}
            <button class="btn-secondary" id="trainer-cancel-event-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">cancel</span>Termin absagen
            </button>
            <button class="btn-secondary" id="trainer-late-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">schedule</span>
              ${myLateMinutes ? `Verspätung ändern` : 'Verspätung melden'}
            </button>
          ` : ''}
        </div>
      </div>
    `;

    document.getElementById('trainer-back-btn').onclick = () => {
      const tip = container.querySelector('.member-note-tooltip-popup');
      if (tip) tip.remove();
      if (options.backFn) options.backFn();
      else loadTrainerDashboard();
    };

    const substBannerClose = document.getElementById('subst-banner-close');
    if (substBannerClose) substBannerClose.onclick = () => document.getElementById('subst-banner')?.remove();

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
          updates.push(firestore.collection('eventAttendance').doc(row.dataset.attId).update({
            status: row.querySelector('.trainer-status-select').value,
            trainerNoteInternal: row.querySelector('.trainer-internal-note').value.trim(),
            trainerNoteMember: row.querySelector('.trainer-member-note').value.trim(),
            trainerSet: true, trainerSetAt: new Date()
          }));
        });
        await Promise.all(updates);
        showToast('Anwesenheit gespeichert.', 'success');
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
        btn.disabled = false;
      }
    };

    if (iAmTrainer) {
      document.getElementById('trainer-cancel-self-btn').onclick = () => _toggleTrainerSelf(event, myUid, iAmCancelled, container, options);
      document.getElementById('trainer-cancel-event-btn').onclick = () => _cancelEvent(event, container, options);
      document.getElementById('trainer-late-btn').onclick = () => _reportTrainerLate(event, myUid, myLateMinutes, myLateNote, container, options);

      // Standalone "Vertretung anfragen"-Button (nur wenn abgemeldet + noch keine offene Anfrage)
      const askSubstBtn = document.getElementById('trainer-ask-subst-btn');
      if (askSubstBtn) {
        askSubstBtn.onclick = () => _askSubstitutionRequest(event, myUid, '', container, options);
      }

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
    let tooltipEl = document.createElement('div');
    tooltipEl.className = 'member-note-tooltip-popup';
    container.appendChild(tooltipEl);
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

    for (const att of memberAttendances) {
      const u = userMap[att.userId] || { displayName: att.userId };
      const tr = document.createElement('tr');
      tr.dataset.attId = att.id;

      const noteIconHtml = att.memberNote
        ? `<span class="member-note-icon" tabindex="0" data-note="${escapeHtml(att.memberNote)}" title="Hinweis anzeigen"><span class="material-icons" style="font-size:16px;">sticky_note_2</span></span>`
        : '<span style="color:var(--color-text-faint);font-size:0.8rem;">–</span>';

      const isLateStatus = ['late_excused', 'late_unexcused'].includes(att.status);
      const lateReasonHtml = isLateStatus && att.memberLateReason
        ? `<span class="member-late-reason-icon" tabindex="0" title="Verspätungsgrund: ${escapeHtml(att.memberLateReason)}">
            <span class="material-icons" style="font-size:16px;">schedule</span>
            ${escapeHtml(att.memberLateReason)}
          </span>`
        : (isLateStatus
            ? '<span style="color:var(--color-text-faint);font-size:0.8rem;">kein Grund</span>'
            : '<span style="color:var(--color-text-faint);font-size:0.8rem;">–</span>');

      const statusChip = getAttendanceStatusChip(att.status);
      const setterHint = att.trainerSet
        ? `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:3px;">vom Betreuer</div>`
        : `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:3px;">selbst</div>`;

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
        <td><input type="text" class="trainer-internal-note" value="${escapeHtml(att.trainerNoteInternal || '')}" placeholder="Interne Notiz…" style="width:120px;" /></td>
        <td><input type="text" class="trainer-member-note" value="${escapeHtml(att.trainerNoteMember || '')}" placeholder="Notiz an Mitglied…" style="width:130px;" /></td>
        <td>${noteIconHtml}</td>
        <td>${lateReasonHtml}</td>
        <td></td>
      `;

      const presentCheck  = tr.querySelector('.trainer-present-check');
      const statusSelect  = tr.querySelector('.trainer-status-select');
      presentCheck.onchange = () => {
        statusSelect.value = presentCheck.checked ? 'present' : 'registered';
      };
      statusSelect.onchange = () => {
        presentCheck.checked = ['present','late_excused','late_unexcused'].includes(statusSelect.value);
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

      if (isLateStatus && att.memberLateReason) {
        const lateIcon = tr.querySelector('.member-late-reason-icon');
        if (lateIcon) {
          const tipText = `Verspätungsgrund: ${att.memberLateReason}`;
          lateIcon.addEventListener('mouseenter', () => showMemberNoteTooltip(lateIcon, tipText));
          lateIcon.addEventListener('mouseleave', () => hideMemberNoteTooltip());
          lateIcon.addEventListener('focus',      () => showMemberNoteTooltip(lateIcon, tipText));
          lateIcon.addEventListener('blur',       () => hideMemberNoteTooltip());
          lateIcon.addEventListener('click',      () => showMemberNoteTooltip(lateIcon, tipText));
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

/* ===================== ABMELDE-FLOW + VERTRETUNGSANFRAGE ===================== */

function _toggleTrainerSelf(event, myUid, iAmCancelled, container, options) {
  if (iAmCancelled) {
    showModal({
      title: 'Wieder einplanen',
      body: `<p>Möchtest du dich wieder als ${getRoleLabel('teacher')} für diesen Termin einplanen?</p>`,
      confirmLabel: 'Wieder einplanen',
      onConfirm: async () => {
        try {
          await firestore.collection('events').doc(event.id).update({
            trainerCancellations: firebase.firestore.FieldValue.arrayRemove(myUid)
          });
          // Eigene offene Anfragen für diesen Termin stornieren (clientseitig gefiltert)
          const openSnap = await firestore.collection('substitution_requests')
            .where('eventId', '==', event.id)
            .where('status', '==', 'open')
            .get();
          const batch = firestore.batch();
          let found = false;
          openSnap.forEach(doc => {
            if (doc.data().requesterId === myUid) {
              batch.update(doc.ref, { status: 'cancelled', resolution: 'trainer_found', resolvedAt: new Date() });
              found = true;
            }
          });
          if (found) {
            await batch.commit();
            await firestore.collection('events').doc(event.id).update({ substitutionStatus: 'none', substitutionTrainerId: null });
          }
          showToast('Wieder eingeplant.', 'success');
          await renderTrainerDetailView(event.id, container, options);
        } catch (err) {
          showToast('Fehler: ' + err.message, 'error');
        }
      }
    });
    return;
  }

  showModal({
    title: 'Als Betreuer abmelden',
    body: `
      <p>Möchtest du dich als ${getRoleLabel('teacher')} von diesem Termin abmelden?</p>
      <label style="margin-top:8px;">Begründung (optional, für Koordinatoren sichtbar)</label>
      <input type="text" id="self-cancel-reason" placeholder="z.B. Bin krank" />
    `,
    confirmLabel: 'Abmelden',
    onConfirm: async () => {
      const reason = document.getElementById('self-cancel-reason')?.value.trim() || '';
      try {
        await firestore.collection('events').doc(event.id).update({
          trainerCancellations: firebase.firestore.FieldValue.arrayUnion(myUid)
        });
        showToast('Als Betreuer abgemeldet.', 'success');
        // BUGFIX: View erst neu laden (damit iAmCancelled + showSubstBtn aktuell sind),
        // dann Vertretungs-Dialog öffnen
        await renderTrainerDetailView(event.id, container, options);
        await _askSubstitutionRequest(event, myUid, reason, container, options);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
      }
    }
  });
}

async function _askSubstitutionRequest(event, myUid, cancelReason, container, options) {
  let allTrainers = [];
  try {
    const snap = await firestore.collection('users').where('roles', 'array-contains', 'teacher').get();
    snap.forEach(doc => {
      const d = doc.data();
      if (doc.id !== myUid) allTrainers.push({ id: doc.id, ...d });
    });
  } catch (e) { /* ignore */ }

  const trainerOptions = allTrainers.map(t =>
    `<option value="${t.id}">${escapeHtml(t.displayName || t.email || t.id)}</option>`
  ).join('');

  showModal({
    title: 'Vertretung anfragen?',
    body: `
      <p style="margin-bottom:14px;">Möchtest du eine Vertretung für diesen Termin anfragen?</p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1px solid var(--color-border);border-radius:8px;" id="subst-option-targeted-label">
          <input type="radio" name="subst-type" value="targeted" style="margin-top:3px;" />
          <div>
            <div style="font-weight:600;">Gezielt anfragen</div>
            <div class="text-muted" style="font-size:0.85rem;">Eine bestimmte Person anfragen</div>
          </div>
        </label>
        <div id="subst-trainer-select-wrap" style="display:none;padding:0 4px;">
          <label>Person auswählen</label>
          <select id="subst-trainer-select" style="width:100%;">
            <option value="">– Trainer wählen –</option>
            ${trainerOptions}
          </select>
        </div>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1px solid var(--color-border);border-radius:8px;" id="subst-option-general-label">
          <input type="radio" name="subst-type" value="general" style="margin-top:3px;" />
          <div>
            <div style="font-weight:600;">Allgemeine Anfrage</div>
            <div class="text-muted" style="font-size:0.85rem;">Koordinatoren werden benachrichtigt und suchen eine Lösung</div>
          </div>
        </label>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;border:1px solid var(--color-border);border-radius:8px;">
          <input type="radio" name="subst-type" value="none" checked style="margin-top:3px;" />
          <div>
            <div style="font-weight:600;">Keine Vertretung nötig</div>
            <div class="text-muted" style="font-size:0.85rem;">Kein Handlungsbedarf</div>
          </div>
        </label>
        <div>
          <label style="margin-top:4px;">Notiz (optional)</label>
          <input type="text" id="subst-note" placeholder="z.B. ${escapeHtml(cancelReason || 'Bin verhindert')}" value="${escapeHtml(cancelReason)}" />
        </div>
      </div>
    `,
    confirmLabel: 'Senden',
    onConfirm: async () => {
      const type = document.querySelector('input[name="subst-type"]:checked')?.value || 'none';
      const note = document.getElementById('subst-note')?.value.trim() || '';

      if (type === 'none') {
        await renderTrainerDetailView(event.id, container, options);
        return;
      }

      const targetId   = type === 'targeted' ? (document.getElementById('subst-trainer-select')?.value || null) : null;
      const targetUser = targetId ? allTrainers.find(t => t.id === targetId) : null;

      if (type === 'targeted' && !targetId) {
        showToast('Bitte einen Trainer auswählen.', 'warning');
        return false;
      }

      const myName = window.currentUser?.profile?.displayName || 'Trainer';
      const deadline = window.appSettings?.registrationDeadlineMinutes ?? 60;
      const eventDate = event.startTime?.toDate?.() || new Date();
      const autoCancelAt = new Date(eventDate.getTime() - 2 * deadline * 60 * 1000);

      const reqData = {
        eventId: event.id,
        eventDate: eventDate,
        eventGroupId: event.groupId || null,
        eventGroupName: event.groupName || event.title || 'Termin',
        requesterId: myUid,
        requesterName: myName,
        targetTrainerId: targetId || null,
        targetTrainerName: targetUser?.displayName || targetUser?.email || null,
        note: note,
        status: 'open',
        resolution: null,
        acceptedById: null,
        acceptedByName: null,
        resolvedAt: null,
        autoCancelAt: autoCancelAt,
        autoCancelNotified: false,
        createdAt: new Date()
      };

      try {
        const reqRef = await firestore.collection('substitution_requests').add(reqData);
        await firestore.collection('events').doc(event.id).update({
          substitutionStatus: 'requested',
          substitutionTrainerId: null
        });
        await _sendSubstitutionMessage({ ...reqData, id: reqRef.id }, 'created', null);
        showToast(
          type === 'targeted'
            ? `Anfrage an ${targetUser?.displayName || 'Trainer'} gesendet.`
            : 'Allgemeine Anfrage an Koordinatoren gesendet.',
          'success'
        );
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
        return false;
      }
    }
  });

  setTimeout(() => {
    document.querySelectorAll('input[name="subst-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const wrap = document.getElementById('subst-trainer-select-wrap');
        if (wrap) wrap.style.display = radio.value === 'targeted' ? 'block' : 'none';
      });
    });
  }, 50);
}

/* ===================== SYSTEM-MESSAGES HELFER ===================== */

async function _sendSubstitutionMessage(req, type, actorName) {
  try {
    const coordsSnap = await firestore.collection('users').where('roles', 'array-contains', 'coordinator').get();
    const coordIds = [];
    coordsSnap.forEach(doc => coordIds.push(doc.id));

    const dateStr = req.eventDate?.toDate
      ? formatDate(req.eventDate.toDate())
      : (req.eventDate ? formatDate(new Date(req.eventDate)) : '–');

    const messages = [];

    if (type === 'created') {
      const text = req.targetTrainerId
        ? `Vertretungsanfrage: ${req.requesterName} hat sich vom Termin "${req.eventGroupName}" am ${dateStr} abgemeldet und ${req.targetTrainerName} als Vertretung angefragt.`
        : `Vertretungsanfrage: ${req.requesterName} hat sich vom Termin "${req.eventGroupName}" am ${dateStr} abgemeldet und sucht eine Vertretung.`;
      for (const cid of coordIds) {
        messages.push({ recipientId: cid, text, type: 'substitution_request', linkedRequestId: req.id, expiresWhen: 'substitution_resolved', createdAt: new Date(), read: false });
      }
      if (req.targetTrainerId) {
        messages.push({
          recipientId: req.targetTrainerId,
          text: `${req.requesterName} bittet dich um Vertretung für "${req.eventGroupName}" am ${dateStr}.${req.note ? ' Notiz: ' + req.note : ''}`,
          type: 'substitution_request', linkedRequestId: req.id, expiresWhen: 'substitution_resolved', createdAt: new Date(), read: false
        });
      }
    } else if (type === 'accepted') {
      messages.push({
        recipientId: req.requesterId,
        text: `${actorName} hat deine Vertretungsanfrage für "${req.eventGroupName}" am ${dateStr} angenommen.`,
        type: 'substitution_accepted', linkedRequestId: req.id, createdAt: new Date(), read: false
      });
      for (const cid of coordIds) {
        messages.push({ recipientId: cid, text: `${actorName} übernimmt die Vertretung für "${req.eventGroupName}" am ${dateStr} (angefragt von ${req.requesterName}).`, type: 'substitution_accepted', linkedRequestId: req.id, createdAt: new Date(), read: false });
      }
    } else if (type === 'declined_to_general') {
      for (const cid of coordIds) {
        messages.push({ recipientId: cid, text: `Gezielte Vertretungsanfrage für "${req.eventGroupName}" am ${dateStr} wurde abgelehnt. Bitte eine Lösung finden.`, type: 'substitution_request', linkedRequestId: req.id, expiresWhen: 'substitution_resolved', createdAt: new Date(), read: false });
      }
    } else if (type === 'auto_cancelled') {
      messages.push({
        recipientId: req.requesterId,
        text: `Der Termin "${req.eventGroupName}" am ${dateStr} wurde automatisch abgesagt, da keine Vertretung gefunden wurde.`,
        type: 'substitution_auto_cancelled', linkedRequestId: req.id, createdAt: new Date(), read: false
      });
      for (const cid of coordIds) {
        messages.push({ recipientId: cid, text: `Termin "${req.eventGroupName}" am ${dateStr} automatisch abgesagt (keine Vertretung, Anmeldefrist abgelaufen).`, type: 'substitution_auto_cancelled', linkedRequestId: req.id, createdAt: new Date(), read: false });
      }
      if (req.eventGroupId) {
        const gDoc = await firestore.collection('groups').doc(req.eventGroupId).get();
        const memberIds = gDoc.exists ? (gDoc.data().members || []) : [];
        for (const mid of memberIds) {
          messages.push({ recipientId: mid, text: `Der Termin "${req.eventGroupName}" am ${dateStr} fällt aus – keine Vertretung gefunden.`, type: 'event_cancelled', linkedRequestId: req.id, createdAt: new Date(), read: false });
        }
      }
    }

    const batch = firestore.batch();
    for (const msg of messages) {
      batch.set(firestore.collection('system_messages').doc(), msg);
    }
    await batch.commit();
  } catch (e) {
    console.error('_sendSubstitutionMessage error:', e);
  }
}

/* ===================== AUTO-CANCEL CHECK ===================== */

async function _checkAutoCancelRequests() {
  try {
    const now = new Date();
    // Nur ein einziges where() → kein Composite-Index nötig
    // autoCancelNotified wird clientseitig gefiltert
    const snap = await firestore.collection('substitution_requests')
      .where('status', '==', 'open')
      .get();

    const toCancel = [];
    snap.forEach(doc => {
      const d = doc.data();
      // Clientseitiger Filter: autoCancelNotified === false
      if (d.autoCancelNotified === true) return;
      const cancelAt = d.autoCancelAt?.toDate?.();
      if (cancelAt && now >= cancelAt) {
        toCancel.push({ id: doc.id, ...d });
      }
    });

    for (const req of toCancel) {
      const batch = firestore.batch();
      batch.update(firestore.collection('substitution_requests').doc(req.id), {
        status: 'cancelled',
        resolution: 'event_cancelled',
        autoCancelNotified: true,
        resolvedAt: now
      });
      batch.update(firestore.collection('events').doc(req.eventId), {
        status: 'cancelled',
        substitutionStatus: 'cancelled',
        cancellationReason: 'Automatisch abgesagt – keine Vertretung gefunden.'
      });
      await batch.commit();
      await _sendSubstitutionMessage(req, 'auto_cancelled', null);
    }
  } catch (e) {
    console.error('_checkAutoCancelRequests error:', e);
  }
}

/* ===================== BESTEHENDE AKTIONEN ===================== */

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
