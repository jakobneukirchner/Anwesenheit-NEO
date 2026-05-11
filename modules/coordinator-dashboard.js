// modules/coordinator-dashboard.js
// Koordinator-Dashboard: Benutzer, Gruppen, Termine (inkl. Wiederholungen), Settings

async function loadCoordinatorDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `
    <h2 style="margin-top:0;">Koordinator-Dashboard</h2>
    <div class="tabs">
      <button class="tab-btn active" data-tab="users">Benutzer</button>
      <button class="tab-btn"        data-tab="groups">Gruppen</button>
      <button class="tab-btn"        data-tab="schedule">Terminplanung</button>
      <button class="tab-btn"        data-tab="settings">Einstellungen</button>
    </div>
    <div id="tab-users"></div>
    <div id="tab-groups"   hidden></div>
    <div id="tab-schedule" hidden></div>
    <div id="tab-settings" hidden></div>
  `;

  const tabs = { users: null, groups: null, schedule: null, settings: null };
  const tabEls = {
    users:    document.getElementById('tab-users'),
    groups:   document.getElementById('tab-groups'),
    schedule: document.getElementById('tab-schedule'),
    settings: document.getElementById('tab-settings')
  };

  const loaders = {
    users:    () => renderUsersTab(tabEls.users),
    groups:   () => renderGroupsTab(tabEls.groups),
    schedule: () => renderScheduleTab(tabEls.schedule),
    settings: () => renderCoordSettingsTab(tabEls.settings)
  };

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.keys(tabEls).forEach(k => { tabEls[k].hidden = k !== btn.dataset.tab; });
      if (!tabs[btn.dataset.tab]) {
        tabs[btn.dataset.tab] = true;
        loaders[btn.dataset.tab]();
      }
    };
  });

  // Initiales Tab laden
  loaders.users();
}

/* ===================== USERS TAB ===================== */
async function renderUsersTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Benutzer...</div>`;
  try {
    const snap = await firestore.collection('users').orderBy('displayName').get();
    const users = [];
    snap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;">Benutzer (${users.length})</h3>
        <button class="btn-primary" id="add-user-btn">+ Benutzer anlegen</button>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Name</th><th>E-Mail</th><th>Rollen</th><th>Aktionen</th></tr></thead>
          <tbody id="users-tbody">
            ${users.map(u => `
              <tr>
                <td>${u.displayName || '–'}</td>
                <td>${u.email || '–'}</td>
                <td>${(u.roles || []).map(r => `<span class="chip">${getRoleLabel(r)}</span>`).join('')}</td>
                <td>
                  <button class="btn-secondary" data-user-id="${u.id}" data-action="edit-user" style="padding:4px 10px;">Bearbeiten</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    el.querySelector('#add-user-btn').onclick = () => showUserForm(null, el);
    el.querySelectorAll('[data-action="edit-user"]').forEach(btn => {
      const user = users.find(u => u.id === btn.dataset.userId);
      btn.onclick = () => showUserForm(user, el);
    });
  } catch (e) {
    el.innerHTML = '<p class="text-error">Fehler beim Laden der Benutzer.</p>';
  }
}

function showUserForm(user, parentEl) {
  const isNew = !user;
  showModal({
    title: isNew ? 'Neuen Benutzer anlegen' : 'Benutzer bearbeiten',
    body: `
      <label>Anzeigename</label>
      <input type="text" id="uf-name" value="${user?.displayName || ''}" />
      <label>E-Mail</label>
      <input type="email" id="uf-email" value="${user?.email || ''}" ${!isNew ? 'readonly' : ''} />
      ${isNew ? `<label>Passwort (wird per Firebase gesetzt)</label><input type="password" id="uf-pw" />` : ''}
      <label>Rollen (mehrere möglich)</label>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        ${['admin','coordinator','teacher','member'].map(r => `
          <label style="display:flex;align-items:center;gap:4px;color:var(--color-text);">
            <input type="checkbox" data-role="${r}" ${(user?.roles || []).includes(r) ? 'checked' : ''} />
            ${getRoleLabel(r)}
          </label>
        `).join('')}
      </div>
    `,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const name   = document.getElementById('uf-name')?.value.trim();
      const email  = document.getElementById('uf-email')?.value.trim();
      const roles  = ['admin','coordinator','teacher','member']
        .filter(r => document.querySelector(`input[data-role="${r}"]`)?.checked);

      if (!name || !email) { showToast('Name und E-Mail erforderlich.', 'error'); return; }

      if (isNew) {
        // Nur Firestore-Eintrag – Firebase Auth-User muss separat über Firebase Console oder Admin SDK angelegt werden
        const newRef = firestore.collection('users').doc();
        await newRef.set({
          displayName: name, email, roles, groups: [], isActive: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Benutzer angelegt. Firebase Auth bitte separat einrichten.', 'info');
      } else {
        await firestore.collection('users').doc(user.id).update({ displayName: name, roles });
        showToast('Benutzer aktualisiert.', 'success');
      }
      renderUsersTab(parentEl);
    }
  });
}

/* ===================== GROUPS TAB ===================== */
async function renderGroupsTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Gruppen...</div>`;
  try {
    const snap = await firestore.collection('groups').orderBy('name').get();
    const groups = [];
    snap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;">Trainingsgruppen (${groups.length})</h3>
        <button class="btn-primary" id="add-group-btn">+ Gruppe anlegen</button>
      </div>
      <div class="dashboard-grid">
        ${groups.map(g => `
          <div class="card" style="margin-bottom:0;">
            <h4 style="margin:0 0 4px;">${g.name}</h4>
            <p class="text-muted" style="margin:0 0 8px;font-size:0.88rem;">${g.description || ''}</p>
            <button class="btn-secondary" data-group-id="${g.id}" data-action="manage-group" style="padding:4px 10px;">Verwalten</button>
          </div>
        `).join('')}
        ${!groups.length ? '<p class="text-muted">Noch keine Gruppen angelegt.</p>' : ''}
      </div>
    `;

    el.querySelector('#add-group-btn').onclick = () => showGroupForm(null, el);
    el.querySelectorAll('[data-action="manage-group"]').forEach(btn => {
      const group = groups.find(g => g.id === btn.dataset.groupId);
      btn.onclick = () => showGroupManage(group, el);
    });
  } catch (e) {
    el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
  }
}

function showGroupForm(group, parentEl) {
  const isNew = !group;
  showModal({
    title: isNew ? 'Neue Gruppe' : 'Gruppe bearbeiten',
    body: `
      <label>Gruppenname</label>
      <input type="text" id="gf-name" value="${group?.name || ''}" />
      <label>Beschreibung</label>
      <input type="text" id="gf-desc" value="${group?.description || ''}" />
    `,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const name = document.getElementById('gf-name')?.value.trim();
      const desc = document.getElementById('gf-desc')?.value.trim();
      if (!name) { showToast('Name erforderlich.', 'error'); return; }
      if (isNew) {
        await firestore.collection('groups').add({ name, description: desc, members: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        showToast('Gruppe angelegt.', 'success');
      } else {
        await firestore.collection('groups').doc(group.id).update({ name, description: desc });
        showToast('Gruppe aktualisiert.', 'success');
      }
      renderGroupsTab(parentEl);
    }
  });
}

async function showGroupManage(group, parentEl) {
  // Alle User laden & Mitglieder der Gruppe verwalten
  const usersSnap = await firestore.collection('users').orderBy('displayName').get();
  const allUsers  = [];
  usersSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
  const groupMemberIds = group.members || [];

  showModal({
    title: `Gruppe: ${group.name}`,
    body: `
      <p class="text-muted">Mitglieder zuweisen / entfernen:</p>
      <div style="max-height:260px;overflow-y:auto;">
        ${allUsers.map(u => `
          <label style="display:flex;align-items:center;gap:8px;padding:4px 0;color:var(--color-text);">
            <input type="checkbox" data-member-id="${u.id}" ${groupMemberIds.includes(u.id) ? 'checked' : ''} />
            ${u.displayName || u.email}
          </label>
        `).join('')}
      </div>
    `,
    confirmLabel: 'Speichern',
    onConfirm: async () => {
      const selectedIds = allUsers
        .filter(u => document.querySelector(`input[data-member-id="${u.id}"]`)?.checked)
        .map(u => u.id);

      const batch = firestore.batch();
      batch.update(firestore.collection('groups').doc(group.id), { members: selectedIds });

      // users.groups synchronisieren
      allUsers.forEach(u => {
        const wasIn  = groupMemberIds.includes(u.id);
        const isNowIn = selectedIds.includes(u.id);
        if (wasIn === isNowIn) return;
        const ref = firestore.collection('users').doc(u.id);
        if (isNowIn) batch.update(ref, { groups: firebase.firestore.FieldValue.arrayUnion(group.id) });
        else         batch.update(ref, { groups: firebase.firestore.FieldValue.arrayRemove(group.id) });
      });

      await batch.commit();
      showToast('Gruppenm itglieder aktualisiert.', 'success');
      renderGroupsTab(parentEl);
    }
  });
}

/* ===================== SCHEDULE TAB ===================== */
async function renderScheduleTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Termine...</div>`;
  try {
    const snap = await firestore.collection('events')
      .orderBy('startTime', 'desc').limit(50).get();
    const events = [];
    snap.forEach(doc => events.push({ id: doc.id, ...doc.data() }));

    // Gruppen für Dropdown
    const groupsSnap = await firestore.collection('groups').orderBy('name').get();
    const groups     = [];
    groupsSnap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;">Termine</h3>
        <button class="btn-primary" id="add-event-btn">+ Termin anlegen</button>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Titel</th><th>Start</th><th>Gruppe</th><th>Status</th><th>Wiederholung</th><th></th></tr></thead>
          <tbody>
            ${events.map(ev => {
              const start = ev.startTime?.toDate?.();
              return `
                <tr>
                  <td>${ev.title || '–'}</td>
                  <td>${start ? formatDateTime(start) : '–'}</td>
                  <td>${ev.groupId || '–'}</td>
                  <td><span class="chip ${ev.status === 'cancelled' ? 'chip-error' : 'chip-success'}">${ev.status || 'planned'}</span></td>
                  <td>${ev.recurrence !== 'none' ? ev.recurrence : '–'}</td>
                  <td><button class="btn-secondary" data-event-id="${ev.id}" data-action="edit-event" style="padding:4px 10px;">Bearbeiten</button></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    el.querySelector('#add-event-btn').onclick = () => showEventForm(null, groups, el);
    el.querySelectorAll('[data-action="edit-event"]').forEach(btn => {
      const ev = events.find(e => e.id === btn.dataset.eventId);
      btn.onclick = () => showEventForm(ev, groups, el);
    });
  } catch (e) {
    el.innerHTML = '<p class="text-error">Fehler beim Laden der Termine.</p>';
  }
}

function showEventForm(event, groups, parentEl) {
  const isNew = !event;
  const startVal = event?.startTime?.toDate ? toDatetimeLocal(event.startTime.toDate()) : '';
  const endVal   = event?.endTime?.toDate   ? toDatetimeLocal(event.endTime.toDate())   : '';

  showModal({
    title: isNew ? 'Neuen Termin anlegen' : 'Termin bearbeiten',
    body: `
      <label>Titel</label>
      <input type="text" id="ef-title" value="${event?.title || ''}" />
      <label>Beschreibung</label>
      <textarea id="ef-desc" rows="2">${event?.description || ''}</textarea>
      <label>Start</label>
      <input type="datetime-local" id="ef-start" value="${startVal}" />
      <label>Ende</label>
      <input type="datetime-local" id="ef-end"   value="${endVal}" />
      <label>Trainingsgruppe</label>
      <select id="ef-group">
        <option value="">– keine –</option>
        ${groups.map(g => `<option value="${g.id}" ${event?.groupId === g.id ? 'selected' : ''}>${g.name}</option>`).join('')}
      </select>
      <label>Mindest-Teilnehmerzahl (0 = kein Minimum)</label>
      <input type="number" id="ef-min" value="${event?.minParticipants ?? 0}" min="0" />
      <label>Anmeldefrist (Minuten vor Beginn)</label>
      <input type="number" id="ef-deadline" value="${event?.signupDeadlineMinutes ?? 60}" min="0" />
      <label>Anmeldemodus</label>
      <select id="ef-mode">
        <option value="opt_in"  ${event?.mode === 'opt_in'  || !event?.mode ? 'selected' : ''}>Anmeldebasiert (aktiv anmelden)</option>
        <option value="opt_out" ${event?.mode === 'opt_out' ? 'selected' : ''}>Abmeldebasiert (aktiv abmelden)</option>
      </select>
      <label>Wiederholung</label>
      <select id="ef-recurrence">
        <option value="none"   ${event?.recurrence === 'none'   || !event?.recurrence ? 'selected' : ''}>Einmalig</option>
        <option value="weekly" ${event?.recurrence === 'weekly' ? 'selected' : ''}>Wöchentlich</option>
        <option value="biweekly" ${event?.recurrence === 'biweekly' ? 'selected' : ''}>Zweiwöchentlich</option>
        <option value="monthly" ${event?.recurrence === 'monthly' ? 'selected' : ''}>Monatlich</option>
      </select>
      <div id="ef-recurrence-end-wrap">
        <label>Wiederholung bis</label>
        <input type="date" id="ef-recurrence-end" value="${event?.recurrenceEnd || ''}" />
      </div>
    `,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const title      = document.getElementById('ef-title')?.value.trim();
      const desc       = document.getElementById('ef-desc')?.value.trim();
      const startStr   = document.getElementById('ef-start')?.value;
      const endStr     = document.getElementById('ef-end')?.value;
      const groupId    = document.getElementById('ef-group')?.value || null;
      const minPart    = parseInt(document.getElementById('ef-min')?.value) || 0;
      const deadline   = parseInt(document.getElementById('ef-deadline')?.value) || 60;
      const mode       = document.getElementById('ef-mode')?.value || 'opt_in';
      const recurrence = document.getElementById('ef-recurrence')?.value || 'none';
      const recEnd     = document.getElementById('ef-recurrence-end')?.value || null;

      if (!title || !startStr) { showToast('Titel und Startzeit erforderlich.', 'error'); return; }

      const startTs = firebase.firestore.Timestamp.fromDate(new Date(startStr));
      const endTs   = endStr ? firebase.firestore.Timestamp.fromDate(new Date(endStr)) : null;

      const data = {
        title, description: desc,
        startTime: startTs, endTime: endTs,
        groupId, minParticipants: minPart,
        signupDeadlineMinutes: deadline,
        mode, recurrence, recurrenceEnd: recEnd,
        status: event?.status || 'planned',
        trainers: event?.trainers || [],
        directMembers: event?.directMembers || [],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (isNew) {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();

        if (recurrence !== 'none' && recEnd) {
          // Wiederholende Termine anlegen
          const instances = generateRecurringDates(new Date(startStr), endStr ? new Date(endStr) : null, recurrence, new Date(recEnd));
          const batch = firestore.batch();
          instances.forEach(({ start, end }) => {
            const ref = firestore.collection('events').doc();
            batch.set(ref, {
              ...data,
              startTime: firebase.firestore.Timestamp.fromDate(start),
              endTime:   end ? firebase.firestore.Timestamp.fromDate(end) : null,
              recurrenceGroup: Date.now().toString()
            });
          });
          await batch.commit();
          showToast(`${instances.length} Wiederholungstermine angelegt.`, 'success');
        } else {
          await firestore.collection('events').add(data);
          showToast('Termin angelegt.', 'success');
        }
      } else {
        await firestore.collection('events').doc(event.id).update(data);
        showToast('Termin aktualisiert.', 'success');
      }
      renderScheduleTab(parentEl);
    }
  });
}

function generateRecurringDates(startDate, endDate, recurrence, until) {
  const intervals = { weekly: 7, biweekly: 14, monthly: null };
  const results   = [];
  let current     = new Date(startDate);
  let currentEnd  = endDate ? new Date(endDate) : null;
  const duration  = currentEnd ? currentEnd.getTime() - current.getTime() : 0;

  while (current <= until) {
    results.push({ start: new Date(current), end: currentEnd ? new Date(currentEnd) : null });
    if (recurrence === 'monthly') {
      current.setMonth(current.getMonth() + 1);
      if (currentEnd) currentEnd = new Date(current.getTime() + duration);
    } else {
      const days = intervals[recurrence] || 7;
      current.setDate(current.getDate() + days);
      if (currentEnd) currentEnd = new Date(current.getTime() + duration);
    }
    if (results.length > 200) break; // Sicherheitslimit
  }
  return results;
}

function toDatetimeLocal(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ===================== COORDINATOR SETTINGS TAB ===================== */
async function renderCoordSettingsTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Einstellungen...</div>`;
  try {
    const doc  = await firestore.collection('settings').doc('global').get();
    const data = doc.exists ? doc.data() : {};

    el.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0;">Allgemeine Einstellungen</h3>
        <label>Standard-Mindestteilnehmer (0 = deaktiviert)</label>
        <input type="number" id="cs-min-part" value="${data.defaultMinParticipants ?? 0}" min="0" />
        <label>Standard-Anmeldefrist (Minuten vor Beginn)</label>
        <input type="number" id="cs-signup-deadline" value="${data.defaultSignupDeadlineMinutes ?? 60}" min="0" />
        <label>Standard-Anmeldemodus</label>
        <select id="cs-mode">
          <option value="opt_in"  ${data.defaultMode === 'opt_in'  || !data.defaultMode ? 'selected' : ''}>Anmeldebasiert</option>
          <option value="opt_out" ${data.defaultMode === 'opt_out' ? 'selected' : ''}>Abmeldebasiert</option>
        </select>
        <label>Teilnehmer-Sichtbarkeit für Mitglieder</label>
        <select id="cs-vis">
          <option value="names" ${data.visibilityMode === 'names' ? 'selected' : ''}>Namen anzeigen</option>
          <option value="count" ${data.visibilityMode === 'count' || !data.visibilityMode ? 'selected' : ''}>Nur Anzahl</option>
          <option value="none"  ${data.visibilityMode === 'none'  ? 'selected' : ''}>Nichts anzeigen</option>
        </select>
        <hr class="divider" />
        <h4>Rollen-Labels (Anzeigename)</h4>
        ${['admin','coordinator','teacher','member'].map(r => `
          <label>${r}</label>
          <input type="text" id="rl-${r}" value="${data.roleLabels?.[r] || getRoleLabel(r)}" />
        `).join('')}
        <button class="btn-primary" id="cs-save">Einstellungen speichern</button>
        <div id="cs-msg" class="text-success"></div>
      </div>
    `;

    el.querySelector('#cs-save').onclick = async () => {
      const updates = {
        defaultMinParticipants:      parseInt(document.getElementById('cs-min-part')?.value) || 0,
        defaultSignupDeadlineMinutes:parseInt(document.getElementById('cs-signup-deadline')?.value) || 60,
        defaultMode:                 document.getElementById('cs-mode')?.value || 'opt_in',
        visibilityMode:              document.getElementById('cs-vis')?.value  || 'count',
        roleLabels: {
          admin:       document.getElementById('rl-admin')?.value       || 'Admin',
          coordinator: document.getElementById('rl-coordinator')?.value || 'Koordinator',
          teacher:     document.getElementById('rl-teacher')?.value     || 'Trainer',
          member:      document.getElementById('rl-member')?.value      || 'Mitglied'
        }
      };
      await firestore.collection('settings').doc('global').set(updates, { merge: true });
      window.roleLabels = updates.roleLabels;
      window.appSettings = { ...(window.appSettings || {}), ...updates };
      showToast('Einstellungen gespeichert.', 'success');
    };
  } catch (e) {
    el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
  }
}
