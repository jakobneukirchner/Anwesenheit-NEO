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

    const untilText = formatDateGerman(futureEnd);
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
        <div class="text-muted" style="font-size:0.95rem;margin-bottom:10px;">${start ? formatDateGermanShort(start) : '–'}, ${start ? formatTime(start) : ''}${end ? ' - ' + formatTime(end) : ''}</div>
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

    // FIX: Trainer-IDs aus userIds entfernen, damit Trainer nicht in der Anwesenheitsliste erscheinen
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

    // FIX: Aktions-Buttons je nach Status anpassen
    const myUid = window.currentUser?.firebaseUser?.uid;
    const iAmCancelled = (event.trainerCancellations || []).includes(myUid);
    const iAmTrainer   = trainerUids.has(myUid);
    const myLateStatus = event.trainerLateMinutes?.[myUid];

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
            ${start ? formatDateGerman(start) : ''} · ${start ? formatTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
        ${renderTrainerStatCard('Datum & Zeit', `${start ? formatDateGerman(start) : '–'}, ${start ? formatTime(start) : ''}${end ? ' - ' + formatTime(end) : ''}`)}
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
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--color-border);">
                <span>${u.displayName || u.email || uid}</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  ${lateMin ? `<span class="chip chip-warning">~${lateMin} Min. verspätet</span>` : ''}
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
              <th>Name</th><th>Status</th><th>Schnell-Check</th><th>Detailstatus</th>
              <th>Interne Notiz</th><th>Notiz an Mitglied</th><th>Hinweis v. Mitglied</th><th></th>
            </tr>
          </thead>
          <tbody id="trainer-attendance-body"></tbody>
        </table>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
          <span class="material-icons" style="font-size:18px;color:var(--color-primary);">settings</span>Aktionen
        </div>
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
              ${myLateStatus ? `Verspätung: ~${myLateStatus} Min.` : 'Verspätung melden'}
            </button>
          ` : ''}
        </div>
      </div>
    `;

    document.getElementById('trainer-back-btn').onclick = () => {
      if (options.backFn) options.backFn();
      else loadTrainerDashboard();
    };

    // FIX: Broadcast-Speichern – liest jetzt korrekt aus dem textarea
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

    // FIX: Speichern-Button – korrekte Selektor-Logik
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
      // FIX: Abmelden / Wieder einplanen
      document.getElementById('trainer-cancel-self-btn').onclick = () => _toggleTrainerSelf(event, myUid, iAmCancelled, container, options);

      // FIX: Termin absagen (event.status = cancelled)
      document.getElementById('trainer-cancel-event-btn').onclick = () => _cancelEvent(event, container, options);

      // FIX: Verspätung melden – echtes Modal
      document.getElementById('trainer-late-btn').onclick = () => _reportTrainerLate(event, myUid, myLateStatus, container, options);
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
      let left = rect.left;
      let top  = rect.bottom + 6;
      if (left + tooltipW > window.innerWidth - 8) left = window.innerWidth - tooltipW - 8;
      if (left < 8) left = 8;
      if (top + 80 > window.innerHeight) top = rect.top - 80;
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top  = top  + 'px';
      tooltipEl.style.maxWidth = tooltipW + 'px';
    }
    function hideMemberNoteTooltip() {
      tooltipHideTimer = setTimeout(() => tooltipEl.classList.remove('visible'), 100);
    }

    // FIX: Anwesenheitsliste filtert Trainer-UIDs heraus
    const tbody = document.getElementById('trainer-attendance-body');
    const memberAttendances = attendances.filter(a => !trainerUids.has(a.userId));

    for (const att of memberAttendances) {
      const user = userMap[att.userId] || { displayName: att.userId };
      const tr   = document.createElement('tr');
      tr.dataset.attId = att.id;

      const selectOptions = [
        ['registered','Angemeldet (offen)'],['confirmation_pending','Ausst. (Bestätigung)'],
        ['present','Anwesend'],['absent_excused','Abgemeldet'],['absent_unexcused','Unentschuldigt gefehlt'],
        ['late_excused','Verspätet (entsch.)'],['late_unexcused','Verspätet (unentsch.)'],['cancelled','Termin abgesagt']
      ];

      const generalNote  = (user.generalNote || '').trim();
      const noteIconHtml = generalNote
        ? `<button class="member-note-icon" aria-label="Notiz anzeigen" tabindex="0" style="background:none;border:none;cursor:pointer;"><span class="material-icons" style="font-size:18px;">info</span></button>`
        : '';

      tr.innerHTML = `
        <td>
          <div style="font-weight:600;display:flex;align-items:center;gap:0;flex-wrap:nowrap;">
            <span>${escapeHtml(user.displayName || user.email || att.userId)}</span>
            ${noteIconHtml}
          </div>
          ${att.addedByTrainer ? `<div><span class="chip" style="font-size:0.72rem;">Manuell</span></div>` : ''}
        </td>
        <td>${renderTrainerStatusChip(att.status)}</td>
        <td><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" class="trainer-present-check" ${['present','late_excused','late_unexcused'].includes(att.status) ? 'checked' : ''}/> Anwesend</label></td>
        <td><select class="trainer-status-select" style="min-width:180px;">${selectOptions.map(([v,l]) => `<option value="${v}" ${att.status===v?'selected':''}>${l}</option>`).join('')}</select></td>
        <td><input class="trainer-internal-note" type="text" value="${escapeHtml(att.trainerNoteInternal||'')}" placeholder="Interne Notiz" style="width:100%;min-width:180px;"/></td>
        <td><input class="trainer-member-note" type="text" value="${escapeHtml(att.trainerNoteMember||'')}" placeholder="Notiz an Mitglied" style="width:100%;min-width:160px;"/></td>
        <td><input type="text" value="${escapeHtml(att.memberNote||'')}" disabled style="width:100%;min-width:150px;background:var(--color-surface-offset);"/></td>
        <td><button class="btn-danger trainer-remove-person" style="padding:6px 8px;display:inline-flex;align-items:center;gap:4px;" title="Entfernen"><span class="material-icons" style="font-size:16px;">person_remove</span></button></td>
      `;

      if (generalNote) {
        const noteBtn = tr.querySelector('.member-note-icon');
        noteBtn.addEventListener('mouseenter', () => showMemberNoteTooltip(noteBtn, generalNote));
        noteBtn.addEventListener('mouseleave', hideMemberNoteTooltip);
        noteBtn.addEventListener('focus',      () => showMemberNoteTooltip(noteBtn, generalNote));
        noteBtn.addEventListener('blur',       hideMemberNoteTooltip);
        noteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (tooltipEl.classList.contains('visible')) tooltipEl.classList.remove('visible');
          else showMemberNoteTooltip(noteBtn, generalNote);
        });
      }

      const selectEl     = tr.querySelector('.trainer-status-select');
      const presentCheck = tr.querySelector('.trainer-present-check');
      presentCheck.onchange = () => { if (presentCheck.checked) selectEl.value = 'present'; };
      selectEl.onchange     = () => {
        presentCheck.checked = ['present','late_excused','late_unexcused'].includes(selectEl.value);
        tr.children[1].innerHTML = renderTrainerStatusChip(selectEl.value);
      };
      tr.querySelector('.trainer-remove-person').onclick = () => {
        showModal({
          title: 'Person entfernen',
          body: `<p>Soll <strong>${escapeHtml(user.displayName || user.email || att.userId)}</strong> entfernt werden?</p>`,
          confirmLabel: 'Entfernen',
          onConfirm: async () => {
            try {
              await firestore.collection('eventAttendance').doc(att.id).delete();
              showToast('Person entfernt.', 'success');
              await renderTrainerDetailView(event.id, container, options);
            } catch (err) { showToast('Fehler: ' + err.message, 'error'); return false; }
          }
        });
      };
      tbody.appendChild(tr);
    }

    document.addEventListener('click', () => tooltipEl.classList.remove('visible'), { once: false });

  } catch (e) {
    console.error(e);
    container.innerHTML = `<p class="text-error">Fehler beim Laden der Detailansicht: ${e.message}</p>`;
  }
}

// FIX: Abmelden / Wieder einplanen als Trainer
async function _toggleTrainerSelf(event, trainerUid, isCancelled, container, options) {
  const action = isCancelled ? 'Wieder einplanen' : 'Als Betreuer abmelden';
  const body   = isCancelled
    ? `<p>Möchtest du dich wieder für <strong>${escapeHtml(event.title || 'Termin')}</strong> einplanen?</p>`
    : `<p>Möchtest du dich als ${getRoleLabel('teacher')} für <strong>${escapeHtml(event.title || 'Termin')}</strong> abmelden?</p>`;
  showModal({
    title: action,
    body,
    confirmLabel: action,
    onConfirm: async () => {
      try {
        if (isCancelled) {
          await firestore.collection('events').doc(event.id).update({
            trainerCancellations: firebase.firestore.FieldValue.arrayRemove(trainerUid)
          });
          showToast('Du bist wieder eingeplant.', 'success');
        } else {
          await firestore.collection('events').doc(event.id).update({
            trainerCancellations: firebase.firestore.FieldValue.arrayUnion(trainerUid)
          });
          showToast('Du wurdest abgemeldet.', 'success');
        }
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) { showToast('Fehler: ' + err.message, 'error'); return false; }
    }
  });
}

// FIX: Termin absagen (setzt event.status = 'cancelled')
async function _cancelEvent(event, container, options) {
  if (event.status === 'cancelled') {
    showModal({
      title: 'Absage rückgängig machen',
      body: `<p>Soll <strong>${escapeHtml(event.title || 'Termin')}</strong> wieder aktiviert werden?</p>`,
      confirmLabel: 'Reaktivieren',
      onConfirm: async () => {
        try {
          await firestore.collection('events').doc(event.id).update({ status: 'active' });
          showToast('Termin reaktiviert.', 'success');
          await renderTrainerDetailView(event.id, container, options);
        } catch (err) { showToast('Fehler: ' + err.message, 'error'); return false; }
      }
    });
    return;
  }
  showModal({
    title: 'Termin absagen',
    body: `
      <p>Soll <strong>${escapeHtml(event.title || 'Termin')}</strong> abgesagt werden?</p>
      <p class="text-muted" style="font-size:0.88rem;">Alle angemeldeten Mitglieder werden benachrichtigt.</p>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <input type="checkbox" id="cancel-notify-members" checked/>
        Mitglieder per Push benachrichtigen
      </label>`,
    confirmLabel: 'Termin absagen',
    onConfirm: async () => {
      try {
        await firestore.collection('events').doc(event.id).update({ status: 'cancelled' });
        showToast('Termin wurde abgesagt.', 'success');
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) { showToast('Fehler: ' + err.message, 'error'); return false; }
    }
  });
}

// FIX: Verspätung melden als Trainer
async function _reportTrainerLate(event, trainerUid, currentLateMin, container, options) {
  showModal({
    title: 'Verspätung melden',
    body: `
      <p class="text-muted" style="margin-top:0;font-size:0.88rem;">Wie viele Minuten wirst du voraussichtlich verspätet sein?</p>
      <input type="number" id="trainer-late-minutes" min="1" max="120" value="${currentLateMin || 15}"
        style="width:100%;font-size:1.1rem;text-align:center;" placeholder="Minuten"/>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        ${[5,10,15,20,30,45].map(m => `<button class="btn-secondary trainer-late-preset" data-min="${m}" style="padding:5px 12px;">${m} Min.</button>`).join('')}
      </div>`,
    confirmLabel: 'Melden',
    onConfirm: async () => {
      const min = parseInt(document.getElementById('trainer-late-minutes').value);
      if (!min || min < 1) { showToast('Bitte eine gültige Minutenanzahl eingeben.', 'error'); return false; }
      try {
        await firestore.collection('events').doc(event.id).update({
          [`trainerLateMinutes.${trainerUid}`]: min
        });
        showToast(`Verspätung von ${min} Min. gemeldet.`, 'success');
        await renderTrainerDetailView(event.id, container, options);
      } catch (err) { showToast('Fehler: ' + err.message, 'error'); return false; }
    }
  });
  // Preset-Buttons nach Modal-Render setzen
  setTimeout(() => {
    document.querySelectorAll('.trainer-late-preset').forEach(btn => {
      btn.onclick = () => {
        const inp = document.getElementById('trainer-late-minutes');
        if (inp) inp.value = btn.dataset.min;
      };
    });
  }, 60);
}

function renderTrainerStatCard(label, value, valueColor = 'var(--color-text)') {
  return `<div class="card" style="margin:0;"><div class="text-muted" style="font-size:0.82rem;margin-bottom:10px;">${label}</div><div style="font-size:1.65rem;font-weight:700;color:${valueColor};line-height:1.1;">${value}</div></div>`;
}

function renderTrainerNeedCard(needed, reached) {
  return `
    <div class="card" style="margin:0;border-left:4px solid ${reached ? 'var(--color-success)' : 'var(--color-warning)'};">
      <div class="text-muted" style="font-size:0.82rem;margin-bottom:10px;">Noch benötigt</div>
      <div style="font-size:1.65rem;font-weight:700;color:${reached ? 'var(--color-success)' : 'var(--color-warning)'};line-height:1.1;">${needed}</div>
      <div style="margin-top:10px;font-size:0.86rem;color:var(--color-text-muted);display:flex;align-items:center;gap:6px;">
        <span class="material-icons" style="font-size:16px;color:${reached ? 'var(--color-success)' : 'var(--color-warning)'};">${reached ? 'check_circle' : 'warning'}</span>
        ${reached ? 'Mindestanzahl erreicht' : 'Noch Teilnehmer benötigt'}
      </div>
    </div>`;
}

function renderTrainerStatusChip(status) {
  const map = {
    registered:['Angemeldet','chip-primary'], confirmation_pending:['Ausst. Bestätigung','chip-warning'],
    present:['Anwesend','chip-success'], absent_excused:['Abgemeldet','chip-error'],
    absent_unexcused:['Unentschuldigt','chip-error'], late_excused:['Verspätet (entsch.)','chip-warning'],
    late_unexcused:['Verspätet (unentsch.)','chip-warning'], cancelled:['Termin abgesagt','chip-error']
  };
  const [label, cls] = map[status] || [status, ''];
  return `<span class="chip ${cls}">${label}</span>`;
}

async function _showAddMemberModal(event, _unused, onDone) {
  const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', event.id).get();
  const registeredUids = new Set();
  attSnap.forEach(doc => registeredUids.add(doc.data().userId));

  const uSnap = await firestore.collection('users').orderBy('displayName').get();
  const allUsers = [];
  uSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));

  const available = allUsers.filter(u => (u.roles || []).includes('member') && !registeredUids.has(u.id));
  if (!available.length) { showToast('Alle Mitglieder sind bereits angemeldet.', 'info'); return; }

  showModal({
    title: 'Person hinzufügen',
    body: `
      <p class="text-muted" style="margin-top:0;font-size:0.88rem;">Mitglieder können auch außerhalb der Gruppe hinzugefügt werden.</p>
      <input type="search" id="trainer-add-member-search" placeholder="Mitglied suchen…" style="width:100%;margin-bottom:10px;"/>
      <div id="trainer-add-member-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
        ${available.map(u => `
          <label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;background:var(--color-surface-offset);cursor:pointer;">
            <input type="checkbox" name="trainer-add-member" value="${u.id}"/>
            <div><div style="font-weight:600;">${escapeHtml(u.displayName || '(kein Name)')}</div><div class="text-muted" style="font-size:0.8rem;">${escapeHtml(u.email || '')}</div></div>
          </label>`).join('')}
      </div>`,
    confirmLabel: 'Hinzufügen',
    onConfirm: async () => {
      const selected = [...document.querySelectorAll('input[name="trainer-add-member"]:checked')].map(i => i.value);
      if (!selected.length) { showToast('Bitte mindestens eine Person wählen.', 'error'); return false; }
      try {
        const defaultMode   = event.mode || window.appSettings?.defaultMode || 'opt_in';
        const initialStatus = defaultMode === 'confirmation' ? 'confirmation_pending' : 'registered';
        const batch = firestore.batch();
        selected.forEach(uid => {
          const ref = firestore.collection('eventAttendance').doc();
          batch.set(ref, { eventId: event.id, userId: uid, status: initialStatus, addedByTrainer: true, addedAt: new Date(), firstRegisteredAt: new Date() });
          batch.update(firestore.collection('events').doc(event.id), { directMembers: firebase.firestore.FieldValue.arrayUnion(uid) });
        });
        await batch.commit();
        showToast('Person(en) hinzugefügt.', 'success');
        onDone && onDone();
      } catch (err) { showToast('Fehler: ' + err.message, 'error'); return false; }
    }
  });

  setTimeout(() => {
    const search = document.getElementById('trainer-add-member-search');
    const list   = document.getElementById('trainer-add-member-list');
    if (!search || !list) return;
    search.oninput = () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll('label').forEach(l => { l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    };
    search.focus();
  }, 60);
}

function formatDateGerman(date) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
function formatDateGermanShort(date) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
function escapeHtml(value) {
  return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
