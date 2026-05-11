// modules/trainer-dashboard.js

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  const user = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Trainer-Termine...</div>`;

  try {
    // Einstellungen laden
    const settingsDoc = await firestore.collection('settings').doc('global').get();
    const settings    = settingsDoc.exists ? settingsDoc.data() : {};
    const defaultLimit = settings.defaultEventLookAhead ?? 30; // Tage

    // User-Doc für Grupppen & individuelle Einstellung laden
    const userDoc  = await firestore.collection('users').doc(user.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const lookAheadDays = userData.eventLookAhead ?? defaultLimit;

    const now    = new Date();
    const cutOff = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

    let events = [];
    const seen = new Set();

    const addEvents = (snap) => {
      snap.forEach(doc => {
        if (!seen.has(doc.id)) {
          seen.add(doc.id);
          events.push({ id: doc.id, ...doc.data() });
        }
      });
    };

    // 1) Direkte Trainer-Zuweisung per trainers-Array
    const trainerSnap = await firestore.collection('events')
      .where('trainers', 'array-contains', user.uid)
      .get();
    addEvents(trainerSnap);

    // 2) Gruppen-Termine (Trainer kann auch über Gruppen zugewiesen sein)
    const userGroups = userData.groups || [];
    for (const groupId of userGroups) {
      const groupSnap = await firestore.collection('events')
        .where('groupId', '==', groupId)
        .get();
      addEvents(groupSnap);
    }

    // Filtern: nur innerhalb des Look-Ahead-Fensters & nicht zu weit in der Vergangenheit (max 90 Tage)
    const pastCutOff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    events = events.filter(e => {
      const t = e.startTime?.toDate?.();
      if (!t) return false;
      return t >= pastCutOff && t <= cutOff;
    });

    events.sort((a, b) => {
      const aT = a.startTime?.toMillis ? a.startTime.toMillis() : 0;
      const bT = b.startTime?.toMillis ? b.startTime.toMillis() : 0;
      return aT - bT;
    });

    const upcoming = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t > now; });
    const past     = events.filter(e => { const t = e.startTime?.toDate?.(); return t && t <= now; });

    container.innerHTML = `
      <h2 style="margin-top:0;">Trainer-Dashboard</h2>
      <p class="text-muted" style="margin-top:-8px;margin-bottom:16px;font-size:0.85rem;">
        Zeige Termine bis <strong>${cutOff.toLocaleDateString('de-DE')}</strong>
        (${lookAheadDays} Tage im Voraus)
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
    else for (const ev of upcoming) upcomingEl.appendChild(await renderTrainerEventCard(ev, false));

    if (!past.length) pastEl.innerHTML = '<p class="text-muted">Keine vergangenen Termine.</p>';
    else for (const ev of past) pastEl.appendChild(await renderTrainerEventCard(ev, true));

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
  }
}

async function renderTrainerEventCard(event, isPast) {
  const card  = createElement('div', 'card');
  const start = event.startTime?.toDate?.();
  const end   = event.endTime?.toDate?.();

  const attendanceSnap = await firestore.collection('eventAttendance')
    .where('eventId', '==', event.id).get();
  const attendances = [];
  attendanceSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

  // Namen der Teilnehmer auflösen
  const userMap = {};
  for (const att of attendances) {
    if (!userMap[att.userId]) {
      const uDoc = await firestore.collection('users').doc(att.userId).get();
      userMap[att.userId] = uDoc.exists ? (uDoc.data().displayName || uDoc.data().email || att.userId) : att.userId;
    }
  }

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
        <td>${userMap[att.userId] || att.userId}</td>
        <td><select data-att-id="${att.id}">${opts}</select></td>
        <td><span class="text-muted" style="font-size:0.82rem;">${att.memberNote || ''}</span></td>
        <td><input type="text" placeholder="Trainer-Hinweis" data-trainer-note="${att.id}" value="${att.trainerNote || ''}" style="min-width:120px;" /></td>
      </tr>
    `;
  }).join('');

  const isCancelled  = event.status === 'cancelled';
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
          <thead><tr><th>Mitglied</th><th>Status</th><th>Hinweis Mitglied</th><th>Trainer-Notiz</th></tr></thead>
          <tbody>${attendanceRows}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;">
        <button class="btn-primary" data-action="save-attendance">Anwesenheit speichern</button>
      </div>
    ` : '<p class="text-muted">Noch keine Teilnehmer.</p>'}
    <hr class="divider" />
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${!isCancelled ? `
        <button class="btn-danger"    data-action="cancel-event">
          ${trainerCount > 1 ? 'Mich abmelden / Training ausfallen lassen' : 'Training absagen'}
        </button>
        <button class="btn-secondary" data-action="trainer-late">Eigene Verspätung melden</button>
      ` : ''}
    </div>
    <div data-role="error" class="text-error"></div>
  `;

  const saveBtn = card.querySelector('[data-action="save-attendance"]');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      try {
        const batch = firestore.batch();
        card.querySelectorAll('select[data-att-id]').forEach(sel => {
          const noteInput = card.querySelector(`input[data-trainer-note="${sel.dataset.attId}"]`);
          batch.update(firestore.collection('eventAttendance').doc(sel.dataset.attId), {
            status: sel.value,
            trainerNote: noteInput?.value || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        showToast('Anwesenheit gespeichert.', 'success');
      } catch (e) {
        console.error(e);
        card.querySelector('[data-role="error"]').textContent = 'Fehler beim Speichern.';
      }
    };
  }

  const cancelBtn = card.querySelector('[data-action="cancel-event"]');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      const user = window.currentUser.firebaseUser;
      const tc   = (event.trainers || []).length;
      showModal({
        title: 'Training absagen',
        body: `
          <p>${tc > 1 ? 'Willst du dich nur abmelden oder das Training ausfallen lassen?' : 'Training absagen – Begründung eingeben:'}</p>
          <label>Begründung (optional)</label>
          <input type="text" id="cancel-reason" placeholder="z.B. Krankheit" />
          ${tc > 1 ? `
            <div style="margin-top:8px;">
              <label style="display:flex;align-items:center;gap:8px;color:var(--color-text);"><input type="radio" name="cancel-type" value="self" checked /> Nur ich melde mich ab</label>
              <label style="display:flex;align-items:center;gap:8px;color:var(--color-text);"><input type="radio" name="cancel-type" value="all" /> Training komplett ausfallen lassen</label>
            </div>` : ''}
        `,
        confirmLabel: 'Bestätigen',
        onConfirm: async () => {
          const reason = document.getElementById('cancel-reason')?.value || '';
          const type   = document.querySelector('input[name="cancel-type"]:checked')?.value || 'all';
          if (type === 'self' && tc > 1) {
            await firestore.collection('events').doc(event.id).update({
              trainers: firebase.firestore.FieldValue.arrayRemove(user.uid),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Du wurdest abgemeldet.', 'success');
          } else {
            await firestore.collection('events').doc(event.id).update({
              status: 'cancelled', cancellationReason: reason,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Training abgesagt.', 'success');
          }
          loadTrainerDashboard();
        }
      });
    };
  }

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
          showToast('Verspätung gemeldet.', 'success');
          loadTrainerDashboard();
        }
      });
    };
  }

  return card;
}
