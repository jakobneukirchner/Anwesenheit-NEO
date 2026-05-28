// modules/trainer-dashboard.js
// Betreuer-Dashboard im Stil der gelieferten Referenzgrafiken

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Dashboard…</div>`;

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

    const upcoming = filtered.filter(e => {
      const t = e.startTime?.toDate?.();
      return t && t > now;
    });
    const past = filtered.filter(e => {
      const t = e.startTime?.toDate?.();
      return t && t <= now;
    }).sort((a, b) => (b.startTime?.toMillis?.() || 0) - (a.startTime?.toMillis?.() || 0));

    const untilText = formatDateGerman(futureEnd);

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
        <h2 style="margin:0;">${getRoleLabel('teacher')}-Dashboard</h2>
        <p class="text-muted" style="margin:0;font-size:0.9rem;">Termine bis <strong>${untilText}</strong> (${lookAheadDays} Tage im Voraus)</p>
      </div>

      <div class="tabs" style="margin-bottom:14px;">
        <button class="tab-btn active" data-tab="upcoming">Kommende Termine (${upcoming.length})</button>
        <button class="tab-btn" data-tab="past">Vergangene Termine (${past.length})</button>
      </div>

      <div id="trainer-overview-upcoming" style="display:flex;flex-direction:column;gap:12px;"></div>
      <div id="trainer-overview-past" hidden style="display:flex;flex-direction:column;gap:12px;"></div>
      <div id="trainer-detail-view" hidden></div>
    `;

    const upEl = document.getElementById('trainer-overview-upcoming');
    const paEl = document.getElementById('trainer-overview-past');
    const detailEl = document.getElementById('trainer-detail-view');

    if (!upcoming.length) upEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine kommenden Termine.</p></div>`;
    if (!past.length) paEl.innerHTML = `<div class="card"><p class="text-muted" style="margin:0;">Keine vergangenen Termine.</p></div>`;

    for (const ev of upcoming) upEl.appendChild(await renderTrainerOverviewCard(ev, false, detailEl, upEl, paEl));
    for (const ev of past) paEl.appendChild(await renderTrainerOverviewCard(ev, true, detailEl, upEl, paEl));

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const isUpcoming = btn.dataset.tab === 'upcoming';
        upEl.hidden = !isUpcoming;
        paEl.hidden = isUpcoming;
        detailEl.hidden = true;
      };
    });
  } catch (e) {
    console.error(e);
    container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
  }
}

async function renderTrainerOverviewCard(event, isPast, detailEl, upcomingEl, pastEl) {
  const card = createElement('div', 'card');
  card.style.marginBottom = '0';
  if (event.status === 'skipped') card.style.borderLeft = '4px solid var(--color-warning)';
  if (event.status === 'cancelled') card.style.borderLeft = '4px solid var(--color-error)';

  const start = event.startTime?.toDate?.();
  const end = event.endTime?.toDate?.();

  const attendanceSnap = await firestore.collection('eventAttendance').where('eventId', '==', event.id).get();
  const rows = [];
  attendanceSnap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));

  const registered = rows.filter(r => ['registered','present','confirmation_pending','late_excused','late_unexcused'].includes(r.status)).length;
  const total = rows.length;
  const present = rows.filter(r => ['present','late_excused','late_unexcused'].includes(r.status)).length;
  const missing = Math.max(0, (event.minParticipants || 0) - registered);

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
        <button class="btn-primary" data-open-detail="${event.id}" style="padding:7px 14px;">Details ›</button>
      </div>
    </div>
  `;

  card.querySelector('[data-open-detail]').onclick = async () => {
    upcomingEl.hidden = true;
    pastEl.hidden = true;
    detailEl.hidden = false;
    await renderTrainerDetailView(event.id, detailEl, { backTo: isPast ? 'past' : 'upcoming' });
  };

  return card;
}

async function renderTrainerDetailView(eventId, container, options = {}) {
  container.innerHTML = `<div class="loading-center">Lade Termin…</div>`;

  try {
    const eventDoc = await firestore.collection('events').doc(eventId).get();
    if (!eventDoc.exists) throw new Error('Termin nicht gefunden.');
    const event = { id: eventDoc.id, ...eventDoc.data() };
    const start = event.startTime?.toDate?.();
    const end = event.endTime?.toDate?.();
    const isPast = !!(start && start <= new Date());

    const attSnap = await firestore.collection('eventAttendance').where('eventId', '==', event.id).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    const userIds = new Set([...(event.trainers || []), ...attendances.map(a => a.userId)]);
    const userMap = {};
    await Promise.all([...userIds].map(async uid => {
      const uDoc = await firestore.collection('users').doc(uid).get();
      userMap[uid] = uDoc.exists ? { id: uid, ...uDoc.data() } : { id: uid, displayName: uid };
    }));

    const registered = attendances.filter(a => ['registered','present','confirmation_pending','late_excused','late_unexcused'].includes(a.status)).length;
    const present = attendances.filter(a => ['present','late_excused','late_unexcused'].includes(a.status)).length;
    const absent = attendances.filter(a => ['absent_excused','absent_unexcused','cancelled'].includes(a.status)).length;
    const needed = Math.max(0, (event.minParticipants || 0) - registered);
    const minReached = needed === 0;

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
        <button class="btn-secondary" id="trainer-back-btn" style="padding:6px 14px;">← Zurück</button>
        <h2 style="margin:0;">${event.title || 'Termin'}, ${start ? formatDateGermanShort(start) : ''} ${start ? formatTime(start) + ' Uhr' : ''}</h2>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px;">
        ${renderTrainerStatCard('Datum & Zeit', `${start ? formatDateGerman(start) : '–'}, ${start ? formatTime(start) : ''}${end ? ' - ' + formatTime(end) : ''}`)}
        ${renderTrainerStatCard('Angemeldet', `${registered} / ${event.minParticipants || totalOr(registered)}`)}
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
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--color-border);">
                <span>${u.displayName || u.email || uid}</span>
                <span class="chip ${cancelled ? 'chip-error' : 'chip-success'}">${cancelled ? 'Abgemeldet' : 'Eingeplant'}</span>
              </div>`;
          }).join('') || `<span class="text-muted">Keine Betreuer eingetragen.</span>`}
        </div>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div>${event.location || 'Kein Ort angegeben'}</div>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-weight:700;">
          <span class="material-icons" style="font-size:18px;color:var(--color-primary);">campaign</span>
          Nachricht an alle Mitglieder
        </div>
        <p class="text-muted" style="margin:0 0 10px;font-size:0.85rem;">Wird auf jeder Teilnehmer-Termincard als „Nachricht von ${window.currentUser?.profile?.displayName || 'Betreuer'}“ angezeigt.</p>
        <textarea id="trainer-broadcast-input" rows="3" style="width:100%;margin-bottom:10px;" placeholder="z.B. Bitte Sportschuhe mitbringen...">${event.trainerBroadcast || ''}</textarea>
        <div><button class="btn-secondary" id="trainer-save-broadcast" style="padding:7px 14px;">💾 Nachricht speichern</button></div>
      </div>

      <div class="card" style="margin-bottom:12px;overflow-x:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="font-weight:700;">Anwesenheitsliste (${attendances.length})</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-secondary" id="trainer-add-person" style="padding:7px 14px;">👥 Person hinzufügen</button>
            <button class="btn-secondary" id="trainer-mark-all-present" style="padding:7px 14px;">✓ Alle anwesend</button>
            <button class="btn-primary" id="trainer-save-attendance" style="padding:7px 14px;">💾 Speichern</button>
          </div>
        </div>
        <table style="width:100%;min-width:1050px;">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Schnell-Check</th>
              <th>Detailstatus</th>
              <th>Interne Notiz (nur Betreuer)</th>
              <th>Notiz an Mitglied</th>
              <th>Hinweis v. Mitglied</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="trainer-attendance-body"></tbody>
        </table>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:10px;">Aktionen</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn-danger" id="trainer-cancel-self-btn" style="padding:8px 16px;">📅 Abmelden / Termin absagen</button>
          <button class="btn-secondary" id="trainer-late-btn" style="padding:8px 16px;">🕒 Verspätung melden</button>
        </div>
      </div>
    `;

    document.getElementById('trainer-back-btn').onclick = () => {
      container.hidden = true;
      const up = document.getElementById('trainer-overview-upcoming');
      const pa = document.getElementById('trainer-overview-past');
      if (options.backTo === 'past') {
        up.hidden = true;
        pa.hidden = false;
        document.querySelector('.tab-btn[data-tab="past"]')?.click();
      } else {
        up.hidden = false;
        pa.hidden = true;
        document.querySelector('.tab-btn[data-tab="upcoming"]')?.click();
      }
    };

    document.getElementById('trainer-save-broadcast').onclick = async () => {
      const msg = document.getElementById('trainer-broadcast-input').value.trim();
      try {
        await firestore.collection('events').doc(event.id).update({
          trainerBroadcast: msg || firebase.firestore.FieldValue.delete()
        });
        showToast('Nachricht gespeichert.', 'success');
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
      }
    };

    document.getElementById('trainer-add-person').onclick = () => _showAddMemberModal(event, null, async () => {
      await renderTrainerDetailView(event.id, container, options);
    });

    document.getElementById('trainer-mark-all-present').onclick = () => {
      container.querySelectorAll('.trainer-present-check').forEach(cb => {
        if (!cb.disabled) cb.checked = true;
      });
    };

    document.getElementById('trainer-save-attendance').onclick = async () => {
      try {
        const updates = [];
        container.querySelectorAll('[data-att-id]').forEach(row => {
          const attId = row.dataset.attId;
          updates.push(
            firestore.collection('eventAttendance').doc(attId).update({
              status: row.querySelector('.trainer-status-select').value,
              trainerNoteInternal: row.querySelector('.trainer-internal-note').value.trim(),
              trainerNoteMember: row.querySelector('.trainer-member-note').value.trim(),
              trainerSet: true,
              trainerSetAt: new Date()
            })
          );
        });
        await Promise.all(updates);
        showToast('Anwesenheit gespeichert.', 'success');
        await renderTrainerDetailView(event.id, container, options);
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
      }
    };

    document.getElementById('trainer-cancel-self-btn').onclick = () => _cancelTrainerSelf(event, window.currentUser?.firebaseUser?.uid);
    document.getElementById('trainer-late-btn').onclick = () => showToast('Verspätungsfunktion kann als Nächstes ergänzt werden.', 'info');

    const tbody = document.getElementById('trainer-attendance-body');
    for (const att of attendances) {
      const user = userMap[att.userId] || { displayName: att.userId };
      const tr = document.createElement('tr');
      tr.dataset.attId = att.id;

      const selectOptions = [
        ['registered', 'Angemeldet (offen)'],
        ['confirmation_pending', 'Ausstehend (Bestätigung)'],
        ['present', 'Anwesend'],
        ['absent_excused', 'Abgemeldet'],
        ['absent_unexcused', 'Unentschuldigt gefehlt'],
        ['late_excused', 'Verspätet (entsch.)'],
        ['late_unexcused', 'Verspätet (unentsch.)'],
        ['cancelled', 'Termin abgesagt']
      ];

      tr.innerHTML = `
        <td>
          <div style="font-weight:600;">${user.displayName || user.email || att.userId}</div>
          ${att.addedByTrainer ? `<div><span class="chip" style="font-size:0.72rem;">Manuell</span></div>` : ''}
        </td>
        <td>${renderTrainerStatusChip(att.status)}</td>
        <td><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" class="trainer-present-check" ${isPast ? '' : ''} ${['present','late_excused','late_unexcused'].includes(att.status) ? 'checked' : ''}/> Anwesend</label></td>
        <td>
          <select class="trainer-status-select" style="min-width:180px;">
            ${selectOptions.map(([value, label]) => `<option value="${value}" ${att.status === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </td>
        <td><input class="trainer-internal-note" type="text" value="${escapeHtml(att.trainerNoteInternal || '')}" placeholder="Interne Notiz (nur Betreuer)" style="width:100%;min-width:180px;" /></td>
        <td><input class="trainer-member-note" type="text" value="${escapeHtml(att.trainerNoteMember || '')}" placeholder="Notiz an Mitglied" style="width:100%;min-width:160px;" /></td>
        <td><input type="text" value="${escapeHtml(att.memberNote || '')}" disabled style="width:100%;min-width:150px;background:#f7f7f7;" /></td>
        <td><button class="btn-danger trainer-remove-person" style="padding:6px 8px;">🧑‍💻</button></td>
      `;

      const selectEl = tr.querySelector('.trainer-status-select');
      const presentCheck = tr.querySelector('.trainer-present-check');
      presentCheck.onchange = () => {
        if (presentCheck.checked) selectEl.value = 'present';
      };
      selectEl.onchange = () => {
        presentCheck.checked = ['present','late_excused','late_unexcused'].includes(selectEl.value);
        tr.children[1].innerHTML = renderTrainerStatusChip(selectEl.value);
      };
      tr.querySelector('.trainer-remove-person').onclick = async () => {
        showModal({
          title: 'Person entfernen',
          body: `<p>Soll <strong>${user.displayName || user.email || att.userId}</strong> aus diesem Termin entfernt werden?</p>`,
          confirmLabel: 'Entfernen',
          onConfirm: async () => {
            try {
              await firestore.collection('eventAttendance').doc(att.id).delete();
              showToast('Person entfernt.', 'success');
              await renderTrainerDetailView(event.id, container, options);
            } catch (e) {
              showToast('Fehler: ' + e.message, 'error');
              return false;
            }
          }
        });
      };

      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error(e);
    container.innerHTML = `<p class="text-error">Fehler beim Laden der Detailansicht: ${e.message}</p>`;
  }
}

function renderTrainerStatCard(label, value, valueColor = 'var(--color-text)') {
  return `
    <div class="card" style="margin:0;">
      <div class="text-muted" style="font-size:0.82rem;margin-bottom:10px;">${label}</div>
      <div style="font-size:1.65rem;font-weight:700;color:${valueColor};line-height:1.1;">${value}</div>
    </div>`;
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
    registered: ['Angemeldet', 'chip-primary'],
    confirmation_pending: ['Ausstehend', 'chip-warning'],
    present: ['Anwesend', 'chip-success'],
    absent_excused: ['Abgemeldet', 'chip-error'],
    absent_unexcused: ['Unentschuldigt', 'chip-error'],
    late_excused: ['Verspätet (entsch.)', 'chip-warning'],
    late_unexcused: ['Verspätet (unentsch.)', 'chip-warning'],
    cancelled: ['Termin abgesagt', 'chip-error']
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
  if (!available.length) {
    showToast('Alle Mitglieder sind bereits angemeldet.', 'info');
    return;
  }

  showModal({
    title: 'Person hinzufügen',
    body: `
      <p class="text-muted" style="margin-top:0;font-size:0.88rem;">Mitglieder können auch außerhalb der Gruppe hinzugefügt werden.</p>
      <input type="search" id="trainer-add-member-search" placeholder="Mitglied suchen…" style="width:100%;margin-bottom:10px;" />
      <div id="trainer-add-member-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
        ${available.map(u => `
          <label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;background:var(--color-surface-offset);cursor:pointer;">
            <input type="checkbox" name="trainer-add-member" value="${u.id}" />
            <div>
              <div style="font-weight:600;">${u.displayName || '(kein Name)'}</div>
              <div class="text-muted" style="font-size:0.8rem;">${u.email || ''}</div>
            </div>
          </label>`).join('')}
      </div>
    `,
    confirmLabel: 'Hinzufügen',
    onConfirm: async () => {
      const selected = [...document.querySelectorAll('input[name="trainer-add-member"]:checked')].map(i => i.value);
      if (!selected.length) {
        showToast('Bitte mindestens eine Person wählen.', 'error');
        return false;
      }
      try {
        const defaultMode = event.mode || window.appSettings?.defaultMode || 'opt_in';
        const initialStatus = defaultMode === 'confirmation' ? 'confirmation_pending' : 'registered';
        const batch = firestore.batch();
        selected.forEach(uid => {
          const ref = firestore.collection('eventAttendance').doc();
          batch.set(ref, {
            eventId: event.id,
            userId: uid,
            status: initialStatus,
            addedByTrainer: true,
            addedAt: new Date(),
            firstRegisteredAt: new Date()
          });
          batch.update(firestore.collection('events').doc(event.id), {
            directMembers: firebase.firestore.FieldValue.arrayUnion(uid)
          });
        });
        await batch.commit();
        showToast('Person(en) hinzugefügt.', 'success');
        onDone && onDone();
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });

  setTimeout(() => {
    const search = document.getElementById('trainer-add-member-search');
    const list = document.getElementById('trainer-add-member-list');
    if (!search || !list) return;
    search.oninput = () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll('label').forEach(label => {
        label.style.display = label.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
    search.focus();
  }, 60);
}

async function _cancelTrainerSelf(event, trainerUid) {
  showModal({
    title: `Als ${getRoleLabel('teacher')} abmelden`,
    body: `<p>Möchtest du dich für den Termin <strong>${event.title || 'Termin'}</strong> als ${getRoleLabel('teacher')} abmelden?</p>`,
    confirmLabel: 'Abmelden',
    onConfirm: async () => {
      try {
        await firestore.collection('events').doc(event.id).update({
          trainerCancellations: firebase.firestore.FieldValue.arrayUnion(trainerUid)
        });
        showToast('Du wurdest abgemeldet.', 'success');
        loadTrainerDashboard();
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });
}

function formatDateGerman(date) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
function formatDateGermanShort(date) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
function totalOr(v) {
  return v || 0;
}
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
