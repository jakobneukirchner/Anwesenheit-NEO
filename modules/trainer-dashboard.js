// modules/trainer-dashboard.js
// Betreuer-Dashboard

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');

  if (window._silentRefresh && container.contains(document.activeElement)) return;

  if (!window._silentRefresh) {
    container.innerHTML = `<div class="loading-center">Lade Betreuer-Dashboard…</div>`;
  }

  try {
    const uid = window.currentUser?.firebaseUser?.uid;
    if (!uid) throw new Error('Nicht eingeloggt.');

    const settings = window.appSettings || {};

    // Alle Events die diesem Betreuer zugeordnet sind
    const eventsSnap = await firestore.collection('events')
      .where('trainers', 'array-contains', uid)
      .orderBy('startTime', 'desc')
      .limit(50)
      .get();

    const events = [];
    eventsSnap.forEach(doc => events.push({ id: doc.id, ...doc.data() }));

    if (!window._silentRefresh) {
      const newHtml = `
        <div id="trainer-list-view">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
            <h2 style="margin:0;">Meine Trainings</h2>
          </div>
          <div id="trainer-event-list" style="display:flex;flex-direction:column;gap:12px;"></div>
        </div>
      `;
      container.innerHTML = newHtml;
    }

    const listEl = document.getElementById('trainer-event-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (!events.length) {
      listEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine Trainings gefunden.</p></div>`;
      return;
    }

    for (const event of events) {
      const card = await renderTrainerEventCard(event, uid, settings);
      listEl.appendChild(card);
    }

  } catch (e) {
    console.error(e);
    if (!window._silentRefresh) {
      container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
    }
  }
}

// ─────────────────────────────────────────────────────────────
function renderTrainerStatCard(label, value, color = 'var(--color-text)') {
  return `<div style="background:var(--color-surface-offset);border-radius:var(--radius-md);padding:12px 16px;">
    <div style="font-size:0.78rem;color:var(--color-text-muted);font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px;">${label}</div>
    <div style="font-size:1.5rem;font-weight:700;color:${color};">${value}</div>
  </div>`;
}

function getAttendanceStatusChip(status) {
  const map = {
    registered:           { label: 'Angemeldet',              cls: 'chip-success'  },
    present:              { label: 'Anwesend',                cls: 'chip-success'  },
    absent_excused:       { label: 'Entsch. gefehlt',        cls: 'chip-warning'  },
    absent_unexcused:     { label: 'Unentsch. gefehlt',      cls: 'chip-error'    },
    late_excused:          { label: 'Verspätet (entsch.)',    cls: 'chip-warning'  },
    late_unexcused:        { label: 'Verspätet (unentsch.)', cls: 'chip-error'    },
    cancelled:             { label: 'Abgemeldet',             cls: 'chip-warning'  },
    confirmation_pending:  { label: 'Ausst. Bestätigung',    cls: 'chip-warning'  },
    none:                  { label: 'Nicht angemeldet',       cls: 'chip-primary'  },
  };
  const s = map[status] || { label: status, cls: 'chip-primary' };
  return `<span class="chip ${s.cls}" style="font-size:0.78rem;">${s.label}</span>`;
}

// ─────────────────────────────────────────────────────────────
async function renderTrainerEventCard(event, myUid, settings) {
  const container = createElement('div', 'card');
  container.style.marginBottom = '0';
  container.innerHTML = `<div class="loading-center" style="padding:20px;">Lade…</div>`;

  // Lazy-load detail
  setTimeout(async () => {
    try {
      await _renderTrainerEventCardContent(container, event, myUid, settings);
    } catch (e) {
      container.innerHTML = `<p class="text-error">Fehler: ${e.message}</p>`;
    }
  }, 0);

  return container;
}

async function _renderTrainerEventCardContent(container, event, myUid, settings) {
  const start = event.startTime?.toDate?.();
  const end   = event.endTime?.toDate?.();
  const now   = new Date();

  const isCancelled = event.status === 'cancelled';
  const isSkipped   = event.status === 'skipped';
  const isPast      = start && start <= now;

  // Anwesenheiten laden
  const attSnap = await firestore.collection('eventAttendance')
    .where('eventId', '==', event.id)
    .get();
  const attendances = [];
  attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

  // User-Namen laden
  const userIds = [...new Set(attendances.map(a => a.userId))];
  const userMap = {};
  await Promise.all(userIds.map(async uid2 => {
    const uDoc = await firestore.collection('users').doc(uid2).get();
    userMap[uid2] = uDoc.exists ? uDoc.data() : { displayName: uid2 };
  }));

  const mode = event.registrationMode || event.mode || 'opt_in';
  const registered = attendances.filter(a => ['registered','present','confirmation_pending','late_excused','late_unexcused'].includes(a.status)).length;
  const present    = attendances.filter(a => ['present','late_excused','late_unexcused'].includes(a.status)).length;
  const cancelled  = attendances.filter(a => a.status === 'cancelled').length;
  const minMembers = event.minMembers || 0;
  const needsBadge = minMembers > 0 && registered < minMembers;

  // Eigene Verspätung
  const myLateMinutes = event.trainerLateMinutes?.[myUid] || 0;
  const myLateNote    = event.trainerLateNotes?.[myUid] || '';

  const activeClass = event.status === 'cancelled' ? 'chip-error' : event.status === 'skipped' ? 'chip-warning' : 'chip-success';
  const activeLabel = event.status === 'cancelled' ? 'Abgesagt' : event.status === 'skipped' ? 'Ausgefallen' : (isPast ? 'Vergangen' : 'Geplant');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">${event.title || 'Termin'}</div>
        <div class="text-muted" style="font-size:0.9rem;margin-bottom:4px;">
          ${start ? formatDate(start) : ''}, ${start ? formatTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}
        </div>
        ${event.location ? `<div class="text-muted" style="font-size:0.85rem;"><span class="material-icons" style="font-size:14px;vertical-align:middle;">place</span> ${escapeHtml(event.location)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;">
        <span class="chip ${activeClass}">${activeLabel}</span>
        ${needsBadge ? `<span class="chip chip-warning" style="display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">warning</span>Noch ${minMembers - registered} Person${minMembers - registered === 1 ? '' : 'en'} benötigt</span>` : ''}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0;">
      ${renderTrainerStatCard('Angemeldet', registered, 'var(--color-success)')}
      ${renderTrainerStatCard('Anwesend / Versp.', present, 'var(--color-primary)')}
      ${renderTrainerStatCard('Abgemeldet', cancelled, 'var(--color-warning)')}
    </div>

    ${myLateMinutes ? `
      <div style="background:rgba(245,124,0,0.07);border-left:3px solid var(--color-warning,#f57c00);border-radius:4px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span style="font-size:0.88rem;">
          Deine Verspätung: <strong>~${myLateMinutes} Min.</strong>${myLateNote ? ' – ' + escapeHtml(myLateNote) : ''}
        </span>
        <button class="btn-secondary" id="trainer-revoke-late-btn" style="padding:5px 14px;font-size:0.85rem;display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:15px;">undo</span> Widerrufen
        </button>
      </div>
    ` : ''}

    ${!isCancelled && !isSkipped ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn-secondary" id="trainer-late-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">schedule</span>
          ${myLateMinutes ? `Verspätung ändern` : 'Verspätung melden'}
        </button>
        <button class="btn-secondary" id="trainer-broadcast-btn" style="padding:8px 16px;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">campaign</span>
          Nachricht senden
        </button>
      </div>
    ` : ''}

    <div id="trainer-att-section">
      <h3 style="font-size:1rem;margin-bottom:10px;">Anwesenheit</h3>

      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <thead>
            <tr style="border-bottom:2px solid var(--color-border);">
              <th style="text-align:left;padding:6px 8px;">Name</th>
              <th style="text-align:left;padding:6px 8px;">Status</th>
              <th style="text-align:left;padding:6px 8px;">Schnell-Check</th>
              <th style="text-align:left;padding:6px 8px;">Detailstatus</th>
              <th style="text-align:left;padding:6px 8px;">Interne Notiz</th>
              <th style="text-align:left;padding:6px 8px;">Notiz an Mitglied</th>
              <th style="text-align:left;padding:6px 8px;">Hinweis v. Mitglied</th>
              <th style="text-align:left;padding:6px 8px;">Versp.-Grund</th>
              <th style="text-align:left;padding:6px 8px;"></th>
            </tr>
          </thead>
          <tbody id="trainer-att-body"></tbody>
        </table>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-primary" id="trainer-save-att-btn" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">save</span> Anwesenheit speichern
        </button>
      </div>
    </div>

    <div style="position:relative;">
      <div class="member-note-tooltip-popup" style="
        position:absolute; bottom:calc(100% + 6px); left:0;
        background:var(--color-surface-2); border:1px solid var(--color-border);
        border-radius:var(--radius-md); padding:8px 12px;
        font-size:0.85rem; max-width:260px; z-index:100;
        box-shadow:var(--shadow-md);
        opacity:0; pointer-events:none;
        transform: translateY(4px); transition: opacity 0.15s ease, transform 0.15s ease;
      "></div>
    </div>

    <div data-role="error" class="text-error" style="margin-top:8px;"></div>
  `;

  const errorEl    = container.querySelector('[data-role="error"]');
  const attBody    = container.querySelector('#trainer-att-body');
  const tooltipEl  = container.querySelector('.member-note-tooltip-popup');

  function showMemberNoteTooltip(anchor, text) {
    tooltipEl.textContent = text;
    tooltipEl.classList.add('visible');
    tooltipEl.style.opacity = '1';
    tooltipEl.style.pointerEvents = 'auto';
    tooltipEl.style.transform = 'translateY(0)';
  }
  function hideMemberNoteTooltip() {
    tooltipEl.style.opacity = '0';
    tooltipEl.style.pointerEvents = 'none';
    tooltipEl.style.transform = 'translateY(4px)';
  }

  // Betreuer-Verspätung melden
  const trainerLateBtn = container.querySelector('#trainer-late-btn');
  if (trainerLateBtn) trainerLateBtn.onclick = () =>
    _reportTrainerLate(event, myUid, myLateMinutes, myLateNote, container, settings);

  const revokeBtn = container.querySelector('#trainer-revoke-late-btn');
  if (revokeBtn) revokeBtn.onclick = () => showModal({
    title: 'Verspätung widerrufen',
    body: `<p>Möchtest du deine gemeldete Verspätung wirklich widerrufen? Die Mitglieder sehen dann keine Verspätungsmeldung mehr von dir.</p>`,
    confirmLabel: 'Ja, widerrufen',
    onConfirm: async () => {
      try {
        await firestore.collection('events').doc(event.id).update({
          [`trainerLateMinutes.${myUid}`]: firebase.firestore.FieldValue.delete(),
          [`trainerLateNotes.${myUid}`]:   firebase.firestore.FieldValue.delete(),
        });
        showToast('Verspätung widerrufen.', 'success');
        loadTrainerDashboard();
      } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
    }
  });

  // Broadcast
  const broadcastBtn = container.querySelector('#trainer-broadcast-btn');
  if (broadcastBtn) broadcastBtn.onclick = () => showModal({
    title: 'Nachricht an alle Angemeldeten',
    body: `
      <p>Diese Nachricht wird allen angemeldeten Mitgliedern in ihrer Terminansicht angezeigt.</p>
      <label>Nachricht</label>
      <textarea id="broadcast-input" rows="3" placeholder="z.B. Bitte Hallenschuhe mitbringen…">${escapeHtml(event.trainerBroadcast || '')}</textarea>
    `,
    confirmLabel: 'Senden',
    onConfirm: async () => {
      const msg = document.getElementById('broadcast-input')?.value.trim() || '';
      try {
        await firestore.collection('events').doc(event.id).update({ trainerBroadcast: msg || firebase.firestore.FieldValue.delete() });
        showToast('Nachricht gespeichert.', 'success');
        loadTrainerDashboard();
      } catch (e) { errorEl.textContent = 'Fehler: ' + e.message; }
    }
  });

  // Anwesenheits-Tabelle befüllen
  const memberAttendances = attendances.filter(a => a.userId !== myUid);

  const statusOptions = [
    ['registered',           'Angemeldet'],
    ['present',              'Anwesend'],
    ['absent_excused',       'Entsch. gefehlt'],
    ['absent_unexcused',     'Unentsch. gefehlt'],
    ['late_excused',         'Verspätet (entsch.)'],
    ['late_unexcused',       'Verspätet (unentsch.)'],
    ['cancelled',            'Abgemeldet'],
    ['confirmation_pending', 'Ausst. Bestätigung']
  ];

  for (const att of memberAttendances) {
    const u = userMap[att.userId] || { displayName: att.userId };
    const tr = document.createElement('tr');
    tr.dataset.attId = att.id;

    // Hinweis-Icon (memberNote)
    const noteIconHtml = att.memberNote
      ? `<span class="member-note-icon" tabindex="0" data-note="${escapeHtml(att.memberNote)}" title="Hinweis anzeigen"><span class="material-icons" style="font-size:16px;">sticky_note_2</span></span>`
      : '<span style="color:var(--color-text-faint);font-size:0.8rem;">–</span>';

    // Verspätungsgrund des Mitglieds (memberLateReason) – eigenes Feld
    const isLateStatus = ['late_excused','late_unexcused'].includes(att.status);
    const lateReasonHtml = isLateStatus && att.memberLateReason
      ? `<span class="member-late-reason-icon" tabindex="0" data-reason="${escapeHtml(att.memberLateReason)}" title="Verspätungsgrund" style="color:var(--color-warning,#e65100);cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:16px;">schedule</span>
          <span style="font-size:0.82rem;">${escapeHtml(att.memberLateReason)}</span>
        </span>`
      : (isLateStatus
          ? `<span style="color:var(--color-text-faint);font-size:0.8rem;">kein Grund</span>`
          : '<span style="color:var(--color-text-faint);font-size:0.8rem;">–</span>');

    // Status-Chip + Setter-Hinweis
    const statusChip = getAttendanceStatusChip(att.status);
    const setterHint = att.trainerSet
      ? `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:3px;">vom Betreuer</div>`
      : `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:3px;">selbst</div>`;

    tr.innerHTML = `
      <td style="font-weight:500;padding:6px 8px;">${u.displayName || u.email || att.userId}</td>
      <td style="padding:6px 8px;">
        ${statusChip}
        ${setterHint}
      </td>
      <td style="padding:6px 8px;">
        <input type="checkbox" class="trainer-present-check" ${['present','late_excused','late_unexcused'].includes(att.status) ? 'checked' : ''}
          style="width:18px;height:18px;cursor:pointer;" />
      </td>
      <td style="padding:6px 8px;">
        <select class="trainer-status-select" style="padding:4px 6px;font-size:0.85rem;">
          ${statusOptions.map(([v,l]) => `<option value="${v}"${att.status === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </td>
      <td style="padding:6px 8px;"><input type="text" class="trainer-internal-note" value="${escapeHtml(att.trainerNoteInternal || '')}" placeholder="Interne Notiz…" style="width:120px;" /></td>
      <td style="padding:6px 8px;"><input type="text" class="trainer-member-note" value="${escapeHtml(att.trainerNoteMember || '')}" placeholder="Notiz an Mitglied…" style="width:130px;" /></td>
      <td style="padding:6px 8px;">${noteIconHtml}</td>
      <td style="padding:6px 8px;">${lateReasonHtml}</td>
      <td style="padding:6px 8px;"></td>
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
      const lateReasonIcon = tr.querySelector('.member-late-reason-icon');
      if (lateReasonIcon) {
        const showTip = () => showMemberNoteTooltip(lateReasonIcon, `Verspätungsgrund: ${att.memberLateReason}`);
        lateReasonIcon.addEventListener('mouseenter', showTip);
        lateReasonIcon.addEventListener('mouseleave', () => hideMemberNoteTooltip());
        lateReasonIcon.addEventListener('focus',      showTip);
        lateReasonIcon.addEventListener('blur',       () => hideMemberNoteTooltip());
        lateReasonIcon.addEventListener('click',      showTip);
      }
    }

    attBody.appendChild(tr);
  }

  // Anwesenheit speichern
  const saveAttBtn = container.querySelector('#trainer-save-att-btn');
  if (saveAttBtn) saveAttBtn.onclick = () => guardedAction(async () => {
    try {
      const rows = attBody.querySelectorAll('tr');
      const batch = firestore.batch();

      rows.forEach(row => {
        const attId        = row.dataset.attId;
        const newStatus    = row.querySelector('.trainer-status-select')?.value;
        const internalNote = row.querySelector('.trainer-internal-note')?.value.trim() || '';
        const memberNote   = row.querySelector('.trainer-member-note')?.value.trim()   || '';
        if (!attId || !newStatus) return;

        batch.set(
          firestore.collection('eventAttendance').doc(attId),
          {
            status: newStatus,
            trainerSet: true,
            trainerNoteInternal: internalNote,
            trainerNoteMember:   memberNote,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });

      await batch.commit();
      showToast('Anwesenheit gespeichert.', 'success');
      window._silentRefresh = true;
      await loadTrainerDashboard();
      window._silentRefresh = false;
    } catch (e) {
      errorEl.textContent = 'Fehler beim Speichern: ' + e.message;
    }
  });
}

// ─────────────────────────────────────────────────────────────
async function _reportTrainerLate(event, myUid, currentLateMinutes, currentLateNote, container, settings) {
  showModal({
    title: currentLateMinutes ? 'Verspätung ändern' : 'Verspätung melden',
    body: `
      <label>Verspätung (Minuten)</label>
      <input type="number" id="late-minutes-input" min="1" max="120" value="${currentLateMinutes || 15}" style="width:100px;" />
      <label style="margin-top:10px;">Grund (optional)</label>
      <input type="text" id="late-note-input" placeholder="z.B. Zug hat Verspätung" value="${escapeHtml(currentLateNote || '')}" />
    `,
    confirmLabel: currentLateMinutes ? 'Ändern' : 'Melden',
    onConfirm: async () => {
      const minutes = parseInt(document.getElementById('late-minutes-input')?.value || '0', 10);
      const note    = document.getElementById('late-note-input')?.value.trim() || '';
      if (!minutes || minutes < 1) { showToast('Bitte gültige Minutenzahl eingeben.', 'warning'); return; }
      try {
        await firestore.collection('events').doc(event.id).update({
          [`trainerLateMinutes.${myUid}`]: minutes,
          [`trainerLateNotes.${myUid}`]:   note || firebase.firestore.FieldValue.delete(),
        });
        showToast(`Verspätung von ~${minutes} Min. gemeldet.`, 'success');
        loadTrainerDashboard();
      } catch (e) {
        const errorEl = container.querySelector('[data-role="error"]');
        if (errorEl) errorEl.textContent = 'Fehler: ' + e.message;
      }
    }
  });
}
