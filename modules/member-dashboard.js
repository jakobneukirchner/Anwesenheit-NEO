// modules/member-dashboard.js

async function loadMemberDashboard() {
  const container = document.getElementById('app-content');

  if (window._silentRefresh && container.contains(document.activeElement)) return;

  if (!window._silentRefresh) {
    container.innerHTML = `<div class="loading-center">Lade Dashboard…</div>`;
  }

  try {
    const uid = window.currentUser?.firebaseUser?.uid;
    if (!uid) throw new Error('Nicht eingeloggt.');

    const settingsDoc = await firestore.collection('settings').doc('global').get();
    window.appSettings = settingsDoc.exists
      ? { ...(window.appSettings || {}), ...settingsDoc.data() }
      : (window.appSettings || {});

    const lookAheadDays = window.appSettings.defaultEventLookAhead ?? 30;
    const now       = new Date();
    const futureEnd = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
    const pastStart = new Date(now.getTime() - 120   * 24 * 60 * 60 * 1000);

    const [allEventsSnap, myAttSnap] = await Promise.all([
      firestore.collection('events')
        .where('startTime', '>=', firebase.firestore.Timestamp.fromDate(pastStart))
        .where('startTime', '<=', firebase.firestore.Timestamp.fromDate(futureEnd))
        .orderBy('startTime', 'asc')
        .get(),
      firestore.collection('eventAttendance').where('userId', '==', uid).get()
    ]);

    const attMap = {};
    myAttSnap.forEach(doc => { attMap[doc.data().eventId] = { id: doc.id, ...doc.data() }; });

    const getMode = ev => ev.registrationMode || ev.mode || 'opt_in';

    const skipEvent = ev => {
      if (ev.status === 'cancelled' || ev.status === 'skipped') return true;
      const mode = getMode(ev);
      if (mode === 'opt_out') return false;
      if (mode === 'confirmation') return false;
      const trainers = ev.trainers || [];
      const cancelledIds = ev.trainerCancellations || [];
      const activeTrainers = trainers.filter(t => !cancelledIds.includes(t));
      return trainers.length > 0 && activeTrainers.length === 0;
    };

    const eventsRaw = [];
    const trainerUids = new Set();
    allEventsSnap.forEach(doc => {
      const ev = { id: doc.id, ...doc.data() };
      if (!skipEvent(ev)) eventsRaw.push(ev);
      (ev.trainers || []).forEach(t => trainerUids.add(t));
      (ev.trainerCancellations || []).forEach(t => trainerUids.add(t));
    });

    const trainerNames = {};
    await Promise.all([...trainerUids].map(async tUid => {
      const uDoc = await firestore.collection('users').doc(tUid).get();
      trainerNames[tUid] = uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || tUid) : tUid;
    }));

    const events = eventsRaw.map(ev => {
      const trainerIds       = ev.trainers || [];
      const cancelledIds     = ev.trainerCancellations || [];
      const activeTrainerIds = trainerIds.filter(tid => !cancelledIds.includes(tid));
      return {
        ...ev,
        _trainerActive:    activeTrainerIds.map(tid => trainerNames[tid] || tid),
        _trainerCancelled: cancelledIds.map(tid => trainerNames[tid] || tid)
      };
    });

    const upcoming = events.filter(ev => { const t = ev.startTime?.toDate?.(); return t && t >  now; });
    const past     = events.filter(ev => { const t = ev.startTime?.toDate?.(); return t && t <= now; })
                           .sort((a,b) => (b.startTime?.toMillis?.() || 0) - (a.startTime?.toMillis?.() || 0));

    upcoming.forEach(ev => {
      if (ev.status === 'cancelled' || ev.status === 'skipped') return;
      const att  = attMap[ev.id];
      const mode = getMode(ev);
      const defaultStatus = mode === 'opt_out' ? 'registered' : mode === 'confirmation' ? 'confirmation_pending' : 'none';
      if (!att) {
        attMap[ev.id] = { status: defaultStatus, _virtual: true };
      }
    });

    const activeTab = container.querySelector('.tab-btn.active')?.dataset?.tab || 'upcoming';
    const untilText = formatDate(futureEnd);

    // ── Heute-Trennlinie ─────────────────────────────────────────────────
    const todayStr = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const todayDivider = `
      <div style="display:flex;align-items:center;gap:10px;margin:4px 0 8px;">
        <div style="flex:1;height:2px;background:linear-gradient(to right,var(--color-primary,#01696f),transparent);border-radius:2px;"></div>
        <span style="font-size:0.8rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-primary,#01696f);white-space:nowrap;">
          <span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:3px;">today</span>Heute · ${todayStr}
        </span>
        <div style="flex:1;height:2px;background:linear-gradient(to left,var(--color-primary,#01696f),transparent);border-radius:2px;"></div>
      </div>`;

    const newHtml = `
      <div id="member-list-view">
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
          <h2 style="margin:0;">Meine Termine</h2>
          <p class="text-muted" style="margin:0;font-size:0.9rem;">Termine bis <strong>${untilText}</strong> (${lookAheadDays} Tage im Voraus)</p>
        </div>

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
        </div>

        <div id="member-upcoming" style="display:flex;flex-direction:column;gap:12px;"${activeTab !== 'upcoming' ? ' hidden' : ''}></div>
        <div id="member-past"     style="display:flex;flex-direction:column;gap:12px;"${activeTab !== 'past'     ? ' hidden' : ''}></div>
      </div>
    `;

    const scrollY = container.scrollTop;
    container.innerHTML = newHtml;
    container.scrollTop = scrollY;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('member-upcoming').hidden = btn.dataset.tab !== 'upcoming';
        document.getElementById('member-past').hidden     = btn.dataset.tab !== 'past';
      };
    });

    const upEl = document.getElementById('member-upcoming');
    const paEl = document.getElementById('member-past');

    if (!upcoming.length) upEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine kommenden Termine.</p></div>`;
    if (!past.length)     paEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine vergangenen Termine.</p></div>`;

    const settings = window.appSettings || {};

    // Trennlinie oben in "Kommende" (zeigt: ab jetzt)
    if (upcoming.length) {
      upEl.insertAdjacentHTML('beforeend', todayDivider);
    }
    // Trennlinie oben in "Vergangene" (zeigt: bis heute)
    if (past.length) {
      paEl.insertAdjacentHTML('beforeend', todayDivider);
    }

    for (const ev of upcoming) upEl.appendChild(await renderMemberEventCard(ev, attMap[ev.id], settings, false));
    for (const ev of past)     paEl.appendChild(await renderMemberEventCard(ev, attMap[ev.id], settings, true));

  } catch (e) {
    console.error(e);
    if (!window._silentRefresh) {
      container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
    }
  }
}

function renderTrainerPillRow(event) {
  const active    = event._trainerActive    || [];
  const cancelled = event._trainerCancelled || [];
  if (!active.length && !cancelled.length) return '';
  const tLabel = getRoleLabel('teacher');
  const activePills    = active.map(n =>
    `<span class="chip chip-success" style="font-size:0.78rem;">${n}</span>`).join('');
  const cancelledPills = cancelled.map(n =>
    `<span class="chip chip-error" style="font-size:0.78rem;text-decoration:line-through;">${n}</span>`).join('');
  const warning = cancelled.length && !active.length
    ? `<span class="chip chip-warning" style="font-size:0.78rem;"><span class="material-icons" style="font-size:13px;vertical-align:middle;">warning</span> Kein ${tLabel} eingeplant</span>`
    : '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center;">${activePills}${cancelledPills}${warning}</div>`;
}

const WITHDRAW_WINDOW_MS = 5 * 60 * 1000;

async function renderMemberEventCard(event, attendance, settings, isPast) {
  const mode             = event.registrationMode || event.mode || 'opt_in';
  const isConfMode       = mode === 'confirmation';
  const deadline         = event.registrationDeadline?.toDate?.() ?? null;
  const confWindowMinutes = settings.confirmationWindowMinutes ?? 60;
  const confWindowEnd    = event.startTime?.toDate
    ? new Date(event.startTime.toDate().getTime() + confWindowMinutes * 60 * 1000)
    : null;
  const confWindowExpired = confWindowEnd ? new Date() > confWindowEnd : false;
  const tLabel = getRoleLabel('teacher');

  const start = event.startTime?.toDate?.();
  const end   = event.endTime?.toDate?.();

  const isCancelled    = event.status === 'cancelled';
  const isSkipped      = event.status === 'skipped';
  const memberStatus   = attendance?.status ?? (isConfMode ? 'confirmation_pending' : mode === 'opt_out' ? 'registered' : 'none');
  const locked         = isPast || isCancelled || isSkipped;
  const withinDeadline = !deadline || new Date() <= deadline;
  const isMemberCancelled = memberStatus === 'cancelled' && !locked && !isPast;
  const firstRegTime      = attendance?.firstRegisteredAt?.toDate?.();
  const canWithdraw       = !!(firstRegTime && (Date.now() - firstRegTime.getTime()) < WITHDRAW_WINDOW_MS && memberStatus !== 'cancelled' && !locked);

  const isRegistered = ['registered','present','late_excused','late_unexcused','confirmation_pending'].includes(memberStatus);
  const trainerLate  = event.trainerLateMinutes
    ? Object.values(event.trainerLateMinutes).some(m => m > 0) : false;

  const btnLabel = isConfMode
    ? (memberStatus === 'cancelled' ? 'Wieder anmelden' : 'Abmelden')
    : mode === 'opt_in'
      ? (isRegistered ? 'Abmelden' : 'Anmelden')
      : (memberStatus === 'cancelled' ? 'Wieder anmelden' : 'Abmelden');

  const statusMap = {
    registered:           'chip-success',
    present:              'chip-success',
    late_excused:         'chip-warning',
    late_unexcused:       'chip-error',
    absent_excused:       'chip-warning',
    absent_unexcused:     'chip-error',
    confirmation_pending: 'chip-warning',
    cancelled:            'chip-error',
    none:                 'chip-primary',
  };

  const isPending_ = memberStatus === 'confirmation_pending';

  const trainerLateHtml = trainerLate
    ? `<p class="text-muted" style="font-size:0.85rem;display:flex;align-items:center;gap:4px;margin-bottom:8px;"><span class="material-icons" style="font-size:15px;">schedule</span> ${tLabel} meldet Verspätung.</p>`
    : '';

  // ── Betreuer-Broadcast: groß & prominent ─────────────────────────────
  const broadcastHtml = event.trainerBroadcast
    ? `<div style="background:var(--color-surface-offset,#f3f0ec);border-left:4px solid var(--color-primary,#01696f);border-radius:6px;padding:12px 16px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span class="material-icons" style="font-size:20px;color:var(--color-primary,#01696f);">campaign</span>
          <strong style="font-size:1rem;color:var(--color-primary,#01696f);">Nachricht vom Betreuer</strong>
        </div>
        <p style="margin:0;font-size:1rem;line-height:1.5;">${escapeHtml(event.trainerBroadcast)}</p>
      </div>`
    : '';

  // ── Betreuer-Notiz an Mitglied: groß & prominent ─────────────────────
  const trainerNoteHtml = attendance?.trainerNoteMember
    ? `<div style="background:var(--color-surface-offset,#f3f0ec);border-left:4px solid var(--color-blue,#006494);border-radius:6px;padding:12px 16px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span class="material-icons" style="font-size:20px;color:var(--color-blue,#006494);">info</span>
          <strong style="font-size:1rem;color:var(--color-blue,#006494);">Notiz deines Betreuers</strong>
        </div>
        <p style="margin:0;font-size:1rem;line-height:1.5;">${escapeHtml(attendance.trainerNoteMember)}</p>
      </div>`
    : '';

  const withdrawHtml = canWithdraw
    ? `<div style="background:rgba(245,124,0,0.07);border-left:3px solid var(--color-warning,#f57c00);border-radius:4px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span style="font-size:0.88rem;color:var(--color-text);">Anmeldung rücknahme noch möglich: <strong><span id="withdraw-countdown-${event.id}">--:--</span></strong></span>
        <button class="btn-danger" data-action="withdraw" style="padding:5px 14px;font-size:0.85rem;display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:15px;">undo</span> Anmeldung rückziehen
        </button>
      </div>`
    : '';
  const lateBannerHtml = ['late_excused','late_unexcused'].includes(memberStatus)
    ? `<div style="background:rgba(245,124,0,0.07);border-left:3px solid var(--color-warning,#f57c00);border-radius:4px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span style="font-size:0.88rem;">Verspätung gemeldet</span>
        <button class="btn-secondary" data-action="revoke-late" style="padding:5px 14px;font-size:0.85rem;display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:15px;">undo</span> Widerrufen
        </button>
      </div>`
    : '';
  const cancelledBannerHtml = isMemberCancelled && withinDeadline
    ? `<div style="background:rgba(183,28,28,0.06);border-left:3px solid var(--color-error,#b71c1c);border-radius:4px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        <span class="material-icons" style="font-size:16px;color:var(--color-error,#b71c1c);">cancel</span>
        <span style="font-size:0.88rem;">Du bist für diesen Termin abgemeldet.</span>
      </div>`
    : '';

  let confirmBannerHtml = '';
  if (isConfMode && !isPast && !locked && isPending_ && !confWindowExpired && withinDeadline) {
    confirmBannerHtml = `
      <div style="background:rgba(245,124,0,0.09);border-left:3px solid var(--color-warning,#e65100);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
        <p style="margin:0 0 6px;font-weight:600;color:var(--color-warning,#e65100);display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">pending</span>
          Bestätigung ausstehend
        </p>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.85rem;">Du bist vorläufig angemeldet. Bitte bestätige deine Teilnahme oder melde dich ab.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" data-action="confirm-attendance" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">check_circle</span> Teilnahme bestätigen
          </button>
          <button class="btn-danger" data-action="toggle" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">cancel</span> Abmelden
          </button>
        </div>
      </div>`;
  } else if (isConfMode && isPending_ && confWindowExpired) {
    confirmBannerHtml = `<p class="text-muted" style="font-size:0.85rem;display:flex;align-items:center;gap:4px;margin-bottom:8px;"><span class="material-icons" style="font-size:15px;">lock_clock</span> Bestätigungsfenster abgelaufen.</p>`;
  }

  const showToggle = withinDeadline && !locked
    && !(isConfMode && isPending_ && !confWindowExpired)
    && !(isConfMode && confWindowExpired && memberStatus !== 'cancelled');

  const card = createElement('div', 'card');
  card.style.marginBottom = '0';

  if (isCancelled) {
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">${event.title || 'Termin'}</div>
          <div class="text-muted" style="font-size:0.9rem;margin-bottom:4px;">${start ? formatDate(start) : ''}, ${start ? formatTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</div>
        </div>
        <span class="chip chip-error" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">cancel</span> Abgesagt</span>
      </div>
      ${event.cancellationReason ? `<p class="text-muted" style="margin:8px 0 0;font-size:0.88rem;">Begründung: ${event.cancellationReason}</p>` : ''}
      ${renderTrainerPillRow(event)}
    `;
    return card;
  }

  if (isSkipped) {
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">${event.title || 'Termin'}</div>
          <div class="text-muted" style="font-size:0.9rem;margin-bottom:4px;">${start ? formatDate(start) : ''}, ${start ? formatTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</div>
        </div>
        <span class="chip chip-warning" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">warning</span> Ausgefallen</span>
      </div>
      ${event.skipReason ? `<p class="text-muted" style="margin:8px 0 0;font-size:0.88rem;">Begründung: ${event.skipReason}</p>` : ''}
      ${renderTrainerPillRow(event)}
    `;
    return card;
  }

  const statusChipClass = statusMap[memberStatus] || 'chip-primary';
  const statusLabel     = translateMemberStatus(memberStatus, mode);

  const isRegisteredOrLate2 = ['registered','present','late_excused','late_unexcused'].includes(memberStatus);
  const showLateBtn  = isRegisteredOrLate2 && !isPast && !locked;
  const showNoteArea = isRegisteredOrLate2 && !isPast;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">${event.title || 'Termin'}</div>
        <div class="text-muted" style="font-size:0.9rem;margin-bottom:4px;">${start ? formatDate(start) : ''}, ${start ? formatTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</div>
        ${event.location ? `<div class="text-muted" style="font-size:0.85rem;margin-bottom:4px;"><span class="material-icons" style="font-size:14px;vertical-align:middle;">place</span> ${escapeHtml(event.location)}</div>` : ''}
      </div>
      <span class="chip ${statusChipClass}" style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">
        ${statusLabel}
      </span>
    </div>

    ${renderTrainerPillRow(event)}

    <div style="margin-top:12px;">
      ${trainerLateHtml}${broadcastHtml}${trainerNoteHtml}${withdrawHtml}${lateBannerHtml}${cancelledBannerHtml}${confirmBannerHtml}

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${showToggle ? `
          <button class="${memberStatus === 'cancelled' || memberStatus === 'none' ? 'btn-primary' : 'btn-danger'}" data-action="toggle" style="padding:7px 16px;display:inline-flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:16px;">${memberStatus === 'cancelled' || memberStatus === 'none' ? 'check_circle' : 'cancel'}</span>
            ${btnLabel}
          </button>
        ` : ''}
        ${showLateBtn ? `
          <button class="btn-secondary" data-action="late" style="padding:7px 16px;display:inline-flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:16px;">schedule</span>
            Verspätung melden
          </button>
        ` : ''}
      </div>

      ${showNoteArea ? `
        <div style="margin-top:10px;">
          <textarea data-role="note" rows="2" style="width:100%;" placeholder="Hinweis an den ${tLabel} (optional)…">${escapeHtml(attendance?.memberNote || '')}</textarea>
          <button class="btn-secondary" data-action="save-note" style="margin-top:4px;padding:5px 14px;font-size:0.85rem;">Hinweis speichern</button>
        </div>
      ` : ''}
    </div>
    <div data-role="error" class="text-error"></div>
  `;

  if (!locked) {
    const errorEl = card.querySelector('[data-role="error"]');

    const withdrawBtn = card.querySelector('[data-action="withdraw"]');
    if (withdrawBtn) withdrawBtn.onclick = () => guardedAction(async () => {
      try {
        await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).set({
          eventId: event.id, userId: window.currentUser.firebaseUser.uid,
          hasWithdrawn: true, status: 'cancelled',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Anmeldung erfolgreich zurückgezogen.', 'success');
        loadMemberDashboard();
      } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
    });

    if (canWithdraw) {
      const countdownEl = card.querySelector(`#withdraw-countdown-${event.id}`);
      if (countdownEl) {
        const timer = setInterval(() => {
          const remaining = Math.max(0, WITHDRAW_WINDOW_MS - (Date.now() - firstRegTime.getTime()));
          const m = Math.floor(remaining / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          countdownEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
          if (remaining === 0) { clearInterval(timer); loadMemberDashboard(); }
        }, 1000);
      }
    }

    const revokeLateBtn = card.querySelector('[data-action="revoke-late"]');
    if (revokeLateBtn) revokeLateBtn.onclick = () => guardedAction(async () => {
      showModal({
        title: 'Verspätung widerrufen',
        body: `<p>Möchtest du deine gemeldete Verspätung widerrufen und wieder als <strong>angemeldet</strong> gelten?</p>`,
        confirmLabel: 'Ja, widerrufen',
        onConfirm: async () => {
          try {
            const prevStatus = mode === 'confirmation' ? 'confirmation_pending' : 'registered';
            await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).set({
              eventId: event.id, userId: window.currentUser.firebaseUser.uid,
              status: prevStatus, trainerSet: false,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            showToast('Verspätung widerrufen.', 'success');
            loadMemberDashboard();
          } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
        }
      });
    });

    const confirmBtn = card.querySelector('[data-action="confirm-attendance"]');
    if (confirmBtn) confirmBtn.onclick = () => guardedAction(async () => {
      try {
        await firestore.collection('eventAttendance').doc(`${event.id}_${window.currentUser.firebaseUser.uid}`).set({
          eventId: event.id, userId: window.currentUser.firebaseUser.uid,
          status: 'registered', trainerSet: false,
          confirmedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Teilnahme bestätigt.', 'success');
        loadMemberDashboard();
      } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
    });

    card.querySelectorAll('[data-action="toggle"]').forEach(btn => {
      btn.onclick = () => guardedAction(async () => {
        try { await memberToggleAttendance(event, attendance, mode, deadline); }
        catch (e) { errorEl.textContent = 'Aktion fehlgeschlagen: ' + e.message; }
      });
    });

    const lateBtn = card.querySelector('[data-action="late"]');
    if (lateBtn) lateBtn.onclick = () => guardedAction(async () => {
      showModal({
        title: 'Verspätung melden',
        body: `
          <p>Verspätungen werden immer als <strong>entschuldigt</strong> eingetragen – unentschuldigt kann nur ein ${tLabel} eintragen.</p>
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
    case 'registered':           return mode === 'opt_in' ? 'Angemeldet' : 'Vorgemerkt';
    case 'confirmation_pending': return 'Ausst. Bestätigung';
    case 'none':                 return mode === 'opt_in' ? 'Nicht angemeldet' : 'Vorgemerkt';
    case 'cancelled':            return 'Abgemeldet';
    case 'present':              return 'Anwesend';
    case 'absent_excused':       return 'Entschuldigt gefehlt';
    case 'absent_unexcused':     return 'Unentschuldigt gefehlt';
    case 'late_excused':         return 'Verspätet (entschuldigt)';
    case 'late_unexcused':       return 'Verspätet (unentschuldigt)';
    default: return status;
  }
}

async function memberToggleAttendance(event, attendance, mode, deadline) {
  const user = window.currentUser.firebaseUser;
  if (deadline && new Date() > deadline) { showToast('Anmeldefrist abgelaufen.', 'warning'); return; }
  const isConfMode = mode === 'confirmation';
  const currentStatus = attendance?.status || (
    isConfMode ? 'confirmation_pending' :
    mode === 'opt_out' ? 'registered' : 'none'
  );

  let newStatus;
  if (isConfMode) {
    newStatus = currentStatus === 'cancelled' ? 'confirmation_pending' : 'cancelled';
  } else {
    newStatus = mode === 'opt_in'
      ? (currentStatus === 'registered' ? 'cancelled' : 'registered')
      : (currentStatus === 'cancelled'  ? 'registered' : 'cancelled');
  }

  if (newStatus === 'cancelled') {
    showModal({
      title: 'Abmelden',
      body: `
        <p>Möchtest du dich wirklich abmelden?</p>
        <label style="display:block;margin-top:10px;">Abmeldegrund (optional)</label>
        <input type="text" id="cancel-reason-input" placeholder="z.B. Krank, anderer Termin…" style="margin-top:4px;" />
      `,
      confirmLabel: 'Abmelden',
      onConfirm: async () => {
        const reason = document.getElementById('cancel-reason-input')?.value.trim() || '';
        const updateData = {
          eventId: event.id, userId: user.uid,
          status: 'cancelled', trainerSet: false,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (reason) updateData.memberNote = reason;
        await firestore.collection('eventAttendance').doc(`${event.id}_${user.uid}`).set(updateData, { merge: true });
        showToast('Erfolgreich abgemeldet.', 'success');
        loadMemberDashboard();
      }
    });
    return;
  }

  const isFirstReg = (newStatus === 'registered' || newStatus === 'confirmation_pending') && !attendance?.firstRegisteredAt;
  const updateData = {
    eventId: event.id, userId: user.uid,
    status: newStatus, trainerSet: false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (isFirstReg) updateData.firstRegisteredAt = firebase.firestore.FieldValue.serverTimestamp();

  await firestore.collection('eventAttendance').doc(`${event.id}_${user.uid}`).set(updateData, { merge: true });

  const msg = newStatus === 'confirmation_pending' ? 'Wieder vorgemerkt – bitte Teilnahme bestätigen.'
    : 'Erfolgreich angemeldet.';
  showToast(msg, 'success');
  loadMemberDashboard();
}

async function memberSaveNote(event, attendance, note) {
  const user = window.currentUser.firebaseUser;
  await firestore.collection('eventAttendance').doc(`${event.id}_${user.uid}`).set({
    eventId: event.id, userId: user.uid, memberNote: note,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}
