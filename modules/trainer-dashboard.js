// modules/trainer-dashboard.js
// Trainer-Dashboard: Keine Terminanzeige.
// Trainer verwalten Termine ausschliesslich ueber die Betreuer-Ansicht in den Terminen selbst.
// Dieses Dashboard dient nur als Einstiegspunkt fuer die Meine-Mitglieder-Ansicht.

async function loadTrainerDashboard() {
  const container = document.getElementById('app-content');
  const tLabel    = getRoleLabel('teacher');
  const mLabel    = getRoleLabel('member');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0 0 4px;">${tLabel}-Bereich</h2>
        <p class="text-muted" style="margin:0;font-size:0.88rem;">Nutze die Navigation oben, um zwischen den Bereichen zu wechseln.</p>
      </div>
    </div>

    <div class="card" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:var(--space-12) var(--space-8);">
      <span class="material-icons" style="font-size:48px;color:var(--color-text-faint);margin-bottom:12px;">event_busy</span>
      <h3 style="margin:0 0 8px;">Keine Termine</h3>
      <p class="text-muted" style="max-width:38ch;margin:0 0 20px;">
        Als ${tLabel} siehst du hier keine Terminliste. Termine werden direkt über die Terminplanung verwaltet.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        <button class="btn-primary" onclick="loadMemberReportDashboard()" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">people_alt</span>
          Meine ${mLabel}
        </button>
      </div>
    </div>
  `;
}

// renderAttendanceRow und showAddMemberToEventDialog werden von coordinator-dashboard.js
// oder bei Bedarf direkt aufgerufen. Diese Datei definiert nur das leere Trainer-Dashboard.

function renderTrainerEventCard(event, isPast, settings) {
  // Stub – wird nicht mehr verwendet, bleibt fuer Rueckwaertskompatibilitaet
  return document.createElement('div');
}

function showAddMemberToEventDialog(eventId, currentMemberIds, allUsers, onAdded) {
  const mLabel  = getRoleLabel('member');
  const members = allUsers.filter(u => (u.roles || []).some(r => ['member','teacher','coordinator','admin'].includes(r)));

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
  });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:12px;width:min(520px,95vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden;">
      <div style="padding:18px 22px 14px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h3 style="margin:0 0 2px;">Person zu Termin hinzufügen</h3>
          <p class="text-muted" style="margin:0;font-size:0.82rem;">Auch außerhalb der Gruppe möglich</p>
        </div>
        <button id="amt-close" style="background:none;border:none;font-size:1.4rem;color:var(--color-text-muted);cursor:pointer;">&times;</button>
      </div>
      <div style="padding:10px 22px;border-bottom:1px solid var(--color-border);">
        <input type="search" id="amt-search" placeholder="Person suchen..." style="margin-bottom:0;" />
      </div>
      <div id="amt-list" style="flex:1;overflow-y:auto;padding:8px 22px;"></div>
      <div style="padding:14px 22px;border-top:1px solid var(--color-border);text-align:right;">
        <button id="amt-cancel" class="btn-secondary">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const listEl   = overlay.querySelector('#amt-list');
  const searchEl = overlay.querySelector('#amt-search');
  const close    = () => overlay.remove();
  overlay.querySelector('#amt-close').onclick  = close;
  overlay.querySelector('#amt-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const renderList = (q = '') => {
    listEl.innerHTML = '';
    const filtered = members.filter(u =>
      !q || (u.displayName || u.email || '').toLowerCase().includes(q.toLowerCase())
    );
    if (!filtered.length) {
      listEl.innerHTML = '<p class="text-muted" style="padding:12px 0;">Keine Personen gefunden.</p>';
      return;
    }
    filtered.forEach(u => {
      const isAlready = currentMemberIds.has(u.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--color-border);gap:12px;';
      row.innerHTML = `
        <div>
          <div style="font-weight:500;">${u.displayName || u.email || u.id}</div>
          <div style="font-size:0.8rem;color:var(--color-text-muted);">${u.email || ''} &nbsp;
            ${(u.roles||[]).map(r=>`<span class="chip" style="font-size:0.72rem;padding:1px 6px;">${getRoleLabel(r)}</span>`).join(' ')}
          </div>
        </div>
        <button class="${isAlready ? 'btn-secondary' : 'btn-primary'}" style="padding:4px 14px;font-size:0.85rem;white-space:nowrap;" ${isAlready ? 'disabled' : ''}>
          ${isAlready ? 'Bereits dabei' : 'Hinzufügen'}
        </button>
      `;
      if (!isAlready) {
        row.querySelector('button').onclick = async () => {
          try {
            await firestore.collection('events').doc(eventId).update({
              directMembers: firebase.firestore.FieldValue.arrayUnion(u.id),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            const evDoc = await firestore.collection('events').doc(eventId).get();
            const mode = evDoc.exists ? (evDoc.data().mode || 'opt_in') : 'opt_in';
            const initStatus = mode === 'confirmation' ? 'confirmation_pending' : 'registered';
            await firestore.collection('eventAttendance').doc(`${eventId}_${u.id}`).set({
              eventId, userId: u.id, status: initStatus, trainerSet: false,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            currentMemberIds.add(u.id);
            showToast(`${u.displayName || u.email} hinzugefügt.`, 'success');
            close();
            if (onAdded) onAdded();
          } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
        };
      }
      listEl.appendChild(row);
    });
  };

  renderList();
  searchEl.oninput = () => renderList(searchEl.value);
}

function renderAttendanceRow(event, member, att, isPast, eventMode, settings, onChanged) {
  const row    = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 0;border-bottom:1px solid var(--color-border);';

  const statusOptions = [
    { value: 'registered',           label: 'Angemeldet' },
    { value: 'confirmation_pending', label: 'Ausst. Bestätigung' },
    { value: 'present',              label: 'Anwesend' },
    { value: 'absent_excused',       label: 'Entsch. gefehlt' },
    { value: 'absent_unexcused',     label: 'Unentsch. gefehlt' },
    { value: 'late_excused',         label: 'Verspätet (E)' },
    { value: 'late_unexcused',       label: 'Verspätet (U)' },
    { value: 'cancelled',            label: 'Abgemeldet' },
  ];

  const defaultStatus = eventMode === 'confirmation' ? 'confirmation_pending'
    : eventMode === 'opt_out' ? 'registered' : 'none';
  const currentStatus = att?.status || defaultStatus;

  const statusBadgeColor = {
    present:              'var(--color-success)',
    registered:           'var(--color-primary)',
    confirmation_pending: 'var(--color-warning)',
    absent_excused:       'var(--color-warning)',
    absent_unexcused:     'var(--color-error)',
    late_excused:         'var(--color-warning)',
    late_unexcused:       'var(--color-warning)',
    cancelled:            'var(--color-text-muted)',
    none:                 'var(--color-text-muted)',
  }[currentStatus] || 'var(--color-text-muted)';

  const confirmPendingNote = currentStatus === 'confirmation_pending'
    ? `<span style="font-size:0.78rem;color:var(--color-warning);margin-left:4px;"><span class="material-icons" style="font-size:12px;vertical-align:middle;">pending</span> Ausstehend</span>` : '';

  row.innerHTML = `
    <div style="flex:1;min-width:140px;">
      <div style="font-weight:500;">${member.displayName || member.email || member.id}</div>
      <div style="font-size:0.8rem;color:var(--color-text-muted);display:flex;align-items:center;gap:4px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusBadgeColor};"></span>
        ${statusOptions.find(o => o.value === currentStatus)?.label || currentStatus}${confirmPendingNote}
      </div>
    </div>
    <select data-role="status-select" style="flex:1;min-width:160px;margin-bottom:0;">
      ${statusOptions.map(o => `<option value="${o.value}" ${currentStatus === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn-secondary" data-action="save-status" style="padding:4px 12px;">Speichern</button>
      <button class="btn-secondary" data-action="note"        style="padding:4px 12px;">Notiz</button>
      <button class="btn-danger"    data-action="remove-termin" style="padding:4px 12px;">Termin absagen</button>
    </div>
  `;

  row.querySelector('[data-action="save-status"]').onclick = async () => {
    const newStatus = row.querySelector('[data-role="status-select"]').value;
    await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
      eventId: event.id, userId: member.id,
      status: newStatus, trainerSet: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast('Status gespeichert.', 'success');
    if (onChanged) onChanged();
  };

  row.querySelector('[data-action="note"]').onclick = () => {
    showModal({
      title: `Notiz für ${member.displayName || member.email}`,
      body: `
        <label>Notiz für ${getRoleLabel('member')} (sichtbar für das Mitglied)</label>
        <textarea id="tn-member-note" rows="3">${att?.trainerNoteMember || ''}</textarea>
        <label style="margin-top:8px;">Interne Notiz (nur für Betreuer)</label>
        <textarea id="tn-internal-note" rows="2">${att?.trainerNoteInternal || ''}</textarea>
      `,
      confirmLabel: 'Speichern',
      onConfirm: async () => {
        await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
          eventId: event.id, userId: member.id,
          trainerNoteMember:   document.getElementById('tn-member-note')?.value || '',
          trainerNoteInternal: document.getElementById('tn-internal-note')?.value || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Notiz gespeichert.', 'success');
        if (onChanged) onChanged();
      }
    });
  };

  row.querySelector('[data-action="remove-termin"]').onclick = () => {
    showModal({
      title: 'Termin absagen',
      body: `<p>Soll <strong>${member.displayName || member.email}</strong> von diesem Termin abgemeldet werden?</p>`,
      confirmLabel: 'Termin absagen',
      onConfirm: async () => {
        await firestore.collection('eventAttendance').doc(`${event.id}_${member.id}`).set({
          eventId: event.id, userId: member.id,
          status: 'cancelled', trainerSet: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Termin abgesagt.', 'success');
        if (onChanged) onChanged();
      }
    });
  };

  return row;
}

function trainerCancelEvent(event, onDone) {
  showModal({
    title: 'Termin absagen',
    body: `
      <p>Soll der Termin <strong>${event.title || 'Termin'}</strong> für alle abgesagt werden?</p>
      <label>Begründung (optional)</label>
      <input type="text" id="cancel-reason" placeholder="z.B. kein ${getRoleLabel('teacher')} verfügbar" />
    `,
    confirmLabel: 'Termin absagen',
    onConfirm: async () => {
      const reason = document.getElementById('cancel-reason')?.value.trim() || '';
      await firestore.collection('events').doc(event.id).update({
        status: 'cancelled',
        cancellationReason: reason,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast('Termin abgesagt.', 'success');
      if (onDone) onDone();
    }
  });
}
