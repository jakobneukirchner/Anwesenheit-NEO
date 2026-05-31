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

    const newHtml = `
      <div id="trainer-list-view">
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
          <h2 style="margin:0;">${getRoleLabel('teacher')}-Dashboard</h2>
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

        <div id="trainer-overview-upcoming" style="display:flex;flex-direction:column;gap:12px;"${activeTab !== 'upcoming' ? ' hidden' : ''}></div>
        <div id="trainer-overview-past"     style="display:flex;flex-direction:column;gap:12px;"${activeTab !== 'past'     ? ' hidden' : ''}></div>
      </div>
    `;

    const scrollY = container.scrollTop;
    container.innerHTML = newHtml;
    container.scrollTop = scrollY;

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('trainer-overview-upcoming').hidden = btn.dataset.tab !== 'upcoming';
        document.getElementById('trainer-overview-past').hidden     = btn.dataset.tab !== 'past';
      };
    });

    const upEl = document.getElementById('trainer-overview-upcoming');
    const paEl = document.getElementById('trainer-overview-past');

    if (!upcoming.length) upEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine kommenden Termine.</p></div>`;
    if (!past.length)     paEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine vergangenen Termine.</p></div>`;

    for (const ev of upcoming) upEl.appendChild(await renderTrainerOverviewCard(ev, false));
    for (const ev of past)     paEl.appendChild(await renderTrainerOverviewCard(ev, true));

  } catch (e) {
    console.error(e);
    if (!window._silentRefresh) {
      container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
    }
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

/**
 * Gibt einen lesbaren Label + CSS-Klasse für einen Anwesenheitsstatus zurück.
 */
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
        <table style="width:100%;min-width:1050px;">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Schnell-Check</th>
              <th>Detailstatus</th>
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
