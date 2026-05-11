// modules/trainer-dashboard.js
// Trainer-Dashboard: Anwesenheit verwalten, Termin absagen, eigene Verspätung melden

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  const user = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Trainer-Termine...</div>`;

  try {
    // Alle Termine, denen dieser Trainer zugewiesen ist
    const snap = await firestore.collection('events')
      .where('trainers', 'array-contains', user.uid)
      .get();

    let events = [];
    snap.forEach(doc => events.push({ id: doc.id, ...doc.data() }));
    events.sort((a, b) => {
      const aT = a.startTime?.toMillis ? a.startTime.toMillis() : 0;
      const bT = b.startTime?.toMillis ? b.startTime.toMillis() : 0;
      return aT - bT;
    });

    const now      = new Date();
    const upcoming = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past     = events.filter(e => { const t = e.startTime?.toDate?.(); return !t || t <= now; });

    container.innerHTML = `
      <h2 style="margin-top:0;">Trainer-Dashboard</h2>
      <div class="tabs">
        <button class="tab-btn active" data-tab="upcoming">Kommende Termine</button>
        <button class="tab-btn"        data-tab="past">Vergangene Termine</button>
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
    else upcoming.forEach(ev => upcomingEl.appendChild(renderTrainerEventCard(ev, false)));

    if (!past.length) pastEl.innerHTML = '<p class="text-muted">Keine vergangenen Termine.</p>';
    else past.forEach(ev => pastEl.appendChild(renderTrainerEventCard(ev, true)));

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
  }
}

async function renderTrainerEventCard(event, isPast) {
  const card  = createElement('div', 'card');
  const start = event.startTime?.toDate?.();
  const end   = event.endTime?.toDate?.();

  // Teilnehmerliste laden
  const attendanceSnap = await firestore.collection('eventAttendance')
    .where('eventId', '==', event.id).get();
  const attendances = [];
  attendanceSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

  const statusOptions = [
    { value: 'present',          label: 'Anwesend' },
    { value: 'absent_excused',   label: 'Entschuldigt gefehlt' },
    { value: 'absent_unexcused', label: 'Unentschuldigt gefehlt' },
    { value: 'late_excused',     label: 'Verspätet (entschuldigt)' },
    { value: 'late_unexcused',   label: 'Verspätet (unentschuldigt)' },
    { value: 'registered',       label: 'Angemeldet (noch offen)' },
    { value: 'cancelled',        label: 'Abgemeldet' }
  ];

  const attendanceRows = attendances.map(att => {
    const opts = statusOptions.map(o =>
      `<option value="${o.value}" ${att.status === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    return `
      <tr>
        <td>${att.userId}</td>
        <td>
          <select data-att-id="${att.id}" data-event-id="${event.id}">
            ${opts}
          </select>
        </td>
        <td><span class="text-muted" style="font-size:0.82rem;">${att.memberNote || ''}</span></td>
        <td><input type="text" placeholder="Trainer-Hinweis" data-trainer-note="${att.id}" value="${att.trainerNote || ''}" style="min-width:120px;" /></td>
      </tr>
    `;
  }).join('');

  const isCancelled = event.status === 'cancelled';
  const trainerCount = (event.trainers || []).length;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
      <div>
        <h3 style="margin:0 0 4px;">${event.title || 'Termin'}</h3>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">${start ? formatDateTime(start) : ''}${end ? ' – ' + formatTime(end) : ''}</p>
      </div>
      ${isCancelled ? '<span class="chip chip-error">Abgesagt</span>' : '<span class="chip chip-success">Aktiv</span>'}
    </div>
    ${isCancelled ? `<p class="text-muted">Begründung: ${event.cancellationReason || '–'}</p>` : ''}
    <hr class="divider" />
    <h4 style="margin:0 0 8px;">Teilnehmerliste (${attendances.length})</h4>
    ${attendances.length ? `
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>User-ID</th><th>Status</th><th>Hinweis Mitglied</th><th>Trainer-Notiz</th></tr></thead>
          <tbody id="att-rows-${event.id}">${attendanceRows}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn-primary" data-action="save-attendance">Anwesenheit speichern</button>
      </div>
    ` : '<p class="text-muted">Noch keine Teilnehmer.</p>'}
    <hr class="divider" />
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${!isCancelled ? `
        <button class="btn-danger"     data-action="cancel-event">${trainerCount > 1 ? 'Mich abmelden / Training ausfallen lassen' : 'Training absagen'}</button>
        <button class="btn-secondary" data-action="trainer-late">Eigene Verspätung melden</button>
      ` : ''}
    </div>
    <div data-role="error" class="text-error"></div>
  `;

  // Anwesenheit speichern
  const saveBtn = card.querySelector('[data-action="save-attendance"]');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      try {
        const selects = card.querySelectorAll('select[data-att-id]');
        const batch   = firestore.batch();
        selects.forEach(sel => {
          const noteInput = card.querySelector(`input[data-trainer-note="${sel.dataset.attId}"]`);
          const ref       = firestore.collection('eventAttendance').doc(sel.dataset.attId);
          batch.update(ref, {
            status:      sel.value,
            trainerNote: noteInput ? noteInput.value : '',
            updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        showToast('Anwesenheit gespeichert.', 'success');
      } catch (e) {
        card.querySelector('[data-role="error"]').textContent = 'Fehler beim Speichern.';
      }
    };
  }

  // Training absagen
  const cancelBtn = card.querySelector('[data-action="cancel-event"]');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      const user = window.currentUser.firebaseUser;
      const trainerCount = (event.trainers || []).length;
      let actionLabel;
      if (trainerCount > 1) {
        actionLabel = 'Willst du dich nur abmelden oder das Training ausfallen lassen?';
      } else {
        actionLabel = 'Training absagen – Begründung eingeben:';
      }
      showModal({
        title: 'Training absagen',
        body: `
          <p>${actionLabel}</p>
          <label>Begründung (optional)</label>
          <input type="text" id="cancel-reason" placeholder="z.B. Krankheit" />
          ${trainerCount > 1 ? `
            <div style="margin-top:8px;">
              <label><input type="radio" name="cancel-type" value="self" checked /> Nur ich melde mich ab</label>
              <label><input type="radio" name="cancel-type" value="all" /> Training komplett ausfallen lassen</label>
            </div>
          ` : ''}
        `,
        confirmLabel: 'Bestätigen',
        onConfirm: async () => {
          const reason   = document.getElementById('cancel-reason')?.value || '';
          const typeRadio = document.querySelector('input[name="cancel-type"]:checked');
          const cancelType = typeRadio ? typeRadio.value : 'all';

          if (cancelType === 'self' && trainerCount > 1) {
            // Nur diesen Trainer aus dem Event entfernen
            await firestore.collection('events').doc(event.id).update({
              trainers: firebase.firestore.FieldValue.arrayRemove(user.uid),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Du wurdest vom Termin abgemeldet.', 'success');
          } else {
            // Training ausfallen lassen
            await firestore.collection('events').doc(event.id).update({
              status: 'cancelled',
              cancellationReason: reason,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Training wurde abgesagt.', 'success');
          }
          loadTrainerDashboard();
        }
      });
    };
  }

  // Eigene Verspätung melden
  const lateBtn = card.querySelector('[data-action="trainer-late"]');
  if (lateBtn) {
    lateBtn.onclick = () => {
      showModal({
        title: 'Verspätung melden',
        body: `
          <label>Begründung / voraussichtliche Verspätung</label>
          <input type="text" id="late-reason" placeholder="z.B. ca. 15 Minuten Verspätung" />
        `,
        confirmLabel: 'Melden',
        onConfirm: async () => {
          const reason = document.getElementById('late-reason')?.value || '';
          await firestore.collection('events').doc(event.id).update({
            trainerLateNote: reason,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          showToast('Verspätung wurde gemeldet.', 'success');
          loadTrainerDashboard();
        }
      });
    };
  }

  return card;
}
