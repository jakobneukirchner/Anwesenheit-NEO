// modules/trainer-dashboard.js

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  const user = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Trainer-Termine...</div>`;

  try {
    const settingsDoc  = await firestore.collection('settings').doc('global').get();
    const settings     = settingsDoc.exists ? settingsDoc.data() : {};
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

/* ---- Übersichtskarte ---- */
function renderTrainerEventSummaryCard(event, isPast) {
  const card  = createElement('div', 'card');
  const start = event.startTime?.toDate?.();
  const end   = event.endTime?.toDate?.();
  const isCancelled = event.status === 'cancelled';

  card.style.cursor = 'pointer';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
      <div>
        <h3 style="margin:0 0 4px;">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${isCancelled ? '<span class="chip chip-error">Abgesagt</span>' : isPast ? '<span class="chip chip-info">Vergangen</span>' : '<span class="chip chip-success">Aktiv</span>'}
        <button class="btn-primary" data-action="detail" style="padding:5px 14px;font-size:0.85rem;">Details ›</button>
      </div>
    </div>
    ${event.trainerLateNote ? `<div class="chip chip-warning" style="margin-top:8px;">⚠️ Verspätung gemeldet: ${event.trainerLateNote}</div>` : ''}
    ${isCancelled ? `<p class="text-muted" style="margin:6px 0 0;">Begründung: ${event.cancellationReason || '–'}</p>` : ''}
  `;

  card.querySelector('[data-action="detail"]').onclick = (e) => { e.stopPropagation(); openTrainerEventDetail(event); };
  card.onclick = () => openTrainerEventDetail(event);
  return card;
}

/* ---- Detailansicht ---- */
async function openTrainerEventDetail(event) {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Termin-Details...</div>`;

  try {
    const evDoc   = await firestore.collection('events').doc(event.id).get();
    const ev      = evDoc.exists ? { id: evDoc.id, ...evDoc.data() } : event;

    const start        = ev.startTime?.toDate?.();
    const end          = ev.endTime?.toDate?.();
    const isCancelled  = ev.status === 'cancelled';
    const trainerCount = (ev.trainers || []).length;

    const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', ev.id).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

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
          ${u.generalNote ? `<button class="btn-text info-btn" data-note="${encodeURIComponent(u.generalNote)}" title="Allgemeine Notiz" style="font-size:0.85rem;padding:0 4px;vertical-align:middle;">ℹ️</button>` : ''}
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

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <button class="btn-secondary" id="detail-back" style="padding:6px 16px;">&larr; Zurück</button>
        <h2 style="margin:0;">${ev.title || 'Termin'}</h2>
        ${isCancelled ? '<span class="chip chip-error">Abgesagt</span>' : ''}
      </div>

      <div class="dashboard-grid" style="margin-bottom:16px;">
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Datum & Zeit</p>
          <p style="margin:0;font-weight:600;">${start ? formatDateTime(start) : '–'}${end ? ' – ' + formatTime(end) : ''}</p>
        </div>
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Angemeldet</p>
          <p style="margin:0;font-weight:600;font-size:1.3rem;">${attendances.filter(a=>['registered','present','late_excused','late_unexcused'].includes(a.status)).length}</p>
        </div>
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Anwesend</p>
          <p style="margin:0;font-weight:600;font-size:1.3rem;color:var(--color-success);">${attendances.filter(a=>a.status==='present').length}</p>
        </div>
        <div class="card" style="margin:0;">
          <p class="text-muted" style="margin:0 0 2px;font-size:0.8rem;">Gefehlt</p>
          <p style="margin:0;font-weight:600;font-size:1.3rem;color:var(--color-error);">${attendances.filter(a=>['absent_excused','absent_unexcused'].includes(a.status)).length}</p>
        </div>
      </div>

      ${ev.description ? `<div class="card" style="margin-bottom:16px;"><p style="margin:0;">${ev.description}</p></div>` : ''}
      ${isCancelled ? `<div class="card" style="margin-bottom:16px;"><p class="text-error" style="margin:0;">Abgesagt: ${ev.cancellationReason || '–'}</p></div>` : ''}

      <!-- Broadcast-Nachricht -->
      <div class="card" style="margin-bottom:16px;">
        <h4 style="margin:0 0 6px;">📢 Nachricht an alle Mitglieder</h4>
        <p class="text-muted" style="margin:0 0 8px;font-size:0.85rem;">Wird auf jeder Teilnehmer-Termincard angezeigt.</p>
        <textarea id="event-broadcast" rows="2" placeholder="z.B. Bitte Sportschuhe mitbringen, Halle B statt A...">${ev.trainerBroadcast || ''}</textarea>
        <button class="btn-secondary" id="save-broadcast" style="margin-top:0;">Nachricht speichern</button>
        <span id="broadcast-saved" class="text-muted" style="font-size:0.85rem;margin-left:10px;display:none;">✓ Gespeichert</span>
      </div>

      <!-- Anwesenheitsliste -->
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
          ${!isCancelled ? `
            <button class="btn-danger"    id="cancel-event-btn">${trainerCount > 1 ? 'Mich abmelden / Training absagen' : 'Training absagen'}</button>
            <button class="btn-secondary" id="trainer-late-btn">Verspätung melden</button>
          ` : ''}
        </div>
        ${ev.trainerLateNote ? `<div class="chip chip-warning" style="margin-top:10px;">⚠️ Verspätung: ${ev.trainerLateNote}</div>` : ''}
      </div>
      <div id="detail-error" class="text-error" style="margin-top:8px;"></div>
    `;

    document.getElementById('detail-back').onclick = () => loadTrainerDashboard();

    // Info-Buttons
    container.querySelectorAll('.info-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showModal({ title: 'Allgemeine Notiz', body: `<p>${decodeURIComponent(btn.dataset.note)}</p>`, confirmLabel: 'OK', onConfirm: () => {} });
      };
    });

    // --- Broadcast speichern (FIX: Wert aus Textarea korrekt lesen)
    document.getElementById('save-broadcast')?.addEventListener('click', async () => {
      const textarea = document.getElementById('event-broadcast');
      const msg      = textarea?.value ?? '';
      try {
        await firestore.collection('events').doc(ev.id).update({
          trainerBroadcast: msg,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const savedEl = document.getElementById('broadcast-saved');
        if (savedEl) { savedEl.style.display = 'inline'; setTimeout(() => savedEl.style.display = 'none', 3000); }
        showToast('Nachricht gespeichert.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Fehler beim Speichern der Nachricht.', 'error');
      }
    });

    // Checkbox <-> Select sync
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

    // --- Anwesenheit speichern (setzt trainerSet: true)
    document.getElementById('save-all-attendance')?.addEventListener('click', async () => {
      const errorEl = document.getElementById('detail-error');
      try {
        const batch = firestore.batch();
        container.querySelectorAll('.status-select').forEach(sel => {
          const internalInput = container.querySelector(`.trainer-note-internal[data-att-id="${sel.dataset.attId}"]`);
          const memberInput   = container.querySelector(`.trainer-note-member[data-att-id="${sel.dataset.attId}"]`);
          batch.update(firestore.collection('eventAttendance').doc(sel.dataset.attId), {
            status:              sel.value,
            trainerSet:          true,   // <-- Mitglied kann danach nicht mehr ändern
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
        console.error(e);
        errorEl.textContent = 'Fehler beim Speichern.';
      }
    });

    // Training absagen
    document.getElementById('cancel-event-btn')?.addEventListener('click', () => {
      const user = window.currentUser.firebaseUser;
      const tc   = (ev.trainers || []).length;
      showModal({
        title: 'Training absagen',
        body: `
          <p>${tc > 1 ? 'Nur dich abmelden oder Training komplett absagen?' : 'Begründung eingeben:'}</p>
          <label>Begründung (optional)</label>
          <input type="text" id="cancel-reason" placeholder="z.B. Krankheit" />
          ${tc > 1 ? `
            <div style="margin-top:8px;">
              <label style="display:flex;align-items:center;gap:8px;color:var(--color-text);"><input type="radio" name="cancel-type" value="self" checked /> Nur ich melde mich ab</label>
              <label style="display:flex;align-items:center;gap:8px;color:var(--color-text);"><input type="radio" name="cancel-type" value="all" /> Training komplett absagen</label>
            </div>` : ''}
        `,
        confirmLabel: 'Bestätigen',
        onConfirm: async () => {
          const reason = document.getElementById('cancel-reason')?.value || '';
          const type   = document.querySelector('input[name="cancel-type"]:checked')?.value || 'all';
          if (type === 'self' && tc > 1) {
            await firestore.collection('events').doc(ev.id).update({
              trainers: firebase.firestore.FieldValue.arrayRemove(user.uid),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Du wurdest abgemeldet.', 'success');
          } else {
            await firestore.collection('events').doc(ev.id).update({
              status: 'cancelled', cancellationReason: reason,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Training abgesagt.', 'success');
          }
          loadTrainerDashboard();
        }
      });
    });

    // Verspätung melden
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
          await firestore.collection('events').doc(ev.id).update({
            trainerLateNote: reason,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          showToast('Verspätung gemeldet.', 'success');
          openTrainerEventDetail(ev);
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
