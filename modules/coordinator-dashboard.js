// modules/coordinator-dashboard.js

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
  const tabs   = { users: null, groups: null, schedule: null, settings: null };
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
      if (!tabs[btn.dataset.tab]) { tabs[btn.dataset.tab] = true; loaders[btn.dataset.tab](); }
    };
  });
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
          <tbody>
            ${users.map(u => `
              <tr>
                <td>${u.displayName || '–'}</td>
                <td>${u.email || '–'}</td>
                <td>${(u.roles||[]).map(r=>`<span class="chip">${getRoleLabel(r)}</span>`).join('')}</td>
                <td><button class="btn-secondary" data-user-id="${u.id}" data-action="edit-user" style="padding:4px 10px;">Bearbeiten</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    el.querySelector('#add-user-btn').onclick = () => showUserForm(null, el);
    el.querySelectorAll('[data-action="edit-user"]').forEach(btn => {
      btn.onclick = () => showUserForm(users.find(u => u.id === btn.dataset.userId), el);
    });
  } catch(e) { el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>'; }
}

function showUserForm(user, parentEl) {
  const isNew = !user;
  showModal({
    title: isNew ? 'Neuen Benutzer anlegen' : 'Benutzer bearbeiten',
    body: `
      <label>Anzeigename</label>
      <input type="text" id="uf-name" value="${user?.displayName||''}" />
      <label>E-Mail</label>
      <input type="email" id="uf-email" value="${user?.email||''}" ${!isNew?'readonly':''} />
      ${isNew ? `
        <label>Passwort</label>
        <input type="password" id="uf-pw" placeholder="Mindestens 6 Zeichen" />
      ` : ''}
      <label>Rollen (mehrere möglich)</label>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px;">
        ${['admin','coordinator','teacher','member'].map(r => `
          <label style="display:flex;align-items:center;gap:6px;color:var(--color-text);cursor:pointer;">
            <input type="checkbox" data-role="${r}" ${(user?.roles||[]).includes(r)?'checked':''} />
            ${getRoleLabel(r)}
          </label>`).join('')}
      </div>`,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const name  = document.getElementById('uf-name')?.value.trim();
      const email = document.getElementById('uf-email')?.value.trim();
      const pw    = document.getElementById('uf-pw')?.value;
      const roles = ['admin','coordinator','teacher','member']
        .filter(r => document.querySelector(`input[data-role="${r}"]`)?.checked);
      if (!name || !email) { showToast('Name und E-Mail erforderlich.', 'error'); return false; }
      if (isNew && (!pw || pw.length < 6)) { showToast('Passwort muss mind. 6 Zeichen haben.', 'error'); return false; }
      if (isNew) {
        try {
          // Firebase Auth User anlegen via REST (kein Admin SDK nötig)
          const apiKey = window.FIREBASE_API_KEY;
          const res = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password: pw, returnSecureToken: false }) }
          );
          const data = await res.json();
          if (data.error) { showToast('Firebase Auth Fehler: ' + data.error.message, 'error'); return false; }
          const uid = data.localId;
          await firestore.collection('users').doc(uid).set({
            displayName: name, email, roles, groups: [], isActive: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          showToast('Benutzer angelegt und in Firebase Auth registriert.', 'success');
        } catch(e) { showToast('Fehler beim Anlegen: ' + e.message, 'error'); return false; }
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
            <p class="text-muted" style="margin:0 0 10px;font-size:0.88rem;">${g.description||''}</p>
            <div style="display:flex;gap:8px;">
              <button class="btn-secondary" data-group-id="${g.id}" data-action="manage-group" style="padding:5px 12px;">Mitglieder</button>
              <button class="btn-secondary" data-group-id="${g.id}" data-action="edit-group"   style="padding:5px 12px;">Bearbeiten</button>
            </div>
          </div>`).join('')}
        ${!groups.length ? '<p class="text-muted">Noch keine Gruppen angelegt.</p>' : ''}
      </div>`;
    el.querySelector('#add-group-btn').onclick = () => showGroupForm(null, el);
    el.querySelectorAll('[data-action="edit-group"]').forEach(btn => {
      btn.onclick = () => showGroupForm(groups.find(g => g.id === btn.dataset.groupId), el);
    });
    el.querySelectorAll('[data-action="manage-group"]').forEach(btn => {
      btn.onclick = () => showGroupMembersDialog(groups.find(g => g.id === btn.dataset.groupId), el);
    });
  } catch(e) { el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>'; }
}

function showGroupForm(group, parentEl) {
  const isNew = !group;
  showModal({
    title: isNew ? 'Neue Gruppe' : 'Gruppe bearbeiten',
    body: `
      <label>Gruppenname</label>
      <input type="text" id="gf-name" value="${group?.name||''}" />
      <label>Beschreibung</label>
      <input type="text" id="gf-desc" value="${group?.description||''}" />`,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const name = document.getElementById('gf-name')?.value.trim();
      const desc = document.getElementById('gf-desc')?.value.trim();
      if (!name) { showToast('Gruppenname erforderlich.', 'error'); return false; }
      if (isNew) {
        await firestore.collection('groups').add({ name, description: desc||'', members: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        showToast('Gruppe angelegt.', 'success');
      } else {
        await firestore.collection('groups').doc(group.id).update({ name, description: desc||'' });
        showToast('Gruppe aktualisiert.', 'success');
      }
      renderGroupsTab(parentEl);
    }
  });
}

async function showGroupMembersDialog(group, parentEl) {
  const usersSnap = await firestore.collection('users').orderBy('displayName').get();
  const allUsers  = [];
  usersSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
  const memberIds = group.members || [];

  // Vollbild-Dialog (kein showModal, eigenes Overlay für bessere UX)
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:'fixed', inset:'0', backgroundColor:'rgba(0,0,0,0.5)',
    display:'flex', alignItems:'center', justifyContent:'center', zIndex:9998
  });

  overlay.innerHTML = `
    <div class="members-dialog" style="
      background:var(--color-surface); border-radius:12px; width:min(600px,95vw);
      max-height:85vh; display:flex; flex-direction:column;
      box-shadow:0 8px 40px rgba(0,0,0,0.3); overflow:hidden;">

      <!-- Header -->
      <div style="padding:20px 24px 16px; border-bottom:1px solid var(--color-border);
                  display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3 style="margin:0 0 2px;">${group.name}</h3>
          <p class="text-muted" style="margin:0;font-size:0.85rem;">Mitglieder verwalten</p>
        </div>
        <button id="mgd-close" style="background:none;border:none;font-size:1.4rem;
          color:var(--color-text-muted);cursor:pointer;padding:4px 8px;border-radius:4px;">&times;</button>
      </div>

      <!-- Suchleiste + Counter -->
      <div style="padding:12px 24px; border-bottom:1px solid var(--color-border);
                  display:flex; gap:12px; align-items:center;">
        <input type="search" id="mgd-search" placeholder="Mitglieder suchen..."
          style="flex:1;margin-bottom:0;" />
        <span id="mgd-counter" class="chip chip-info" style="white-space:nowrap;">
          ${memberIds.length} / ${allUsers.length} ausgewählt
        </span>
      </div>

      <!-- Schnellauswahl -->
      <div style="padding:8px 24px; display:flex; gap:8px; border-bottom:1px solid var(--color-border);">
        <button id="mgd-select-all"   class="btn-secondary" style="padding:4px 12px;font-size:0.85rem;">Alle auswählen</button>
        <button id="mgd-deselect-all" class="btn-secondary" style="padding:4px 12px;font-size:0.85rem;">Alle abwählen</button>
      </div>

      <!-- Mitgliederliste -->
      <div id="mgd-list" style="flex:1; overflow-y:auto; padding:8px 24px;"></div>

      <!-- Footer -->
      <div style="padding:16px 24px; border-top:1px solid var(--color-border);
                  display:flex; justify-content:flex-end; gap:10px;">
        <button id="mgd-cancel"  class="btn-secondary">Abbrechen</button>
        <button id="mgd-save"    class="btn-primary">Speichern</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const listEl    = overlay.querySelector('#mgd-list');
  const searchEl  = overlay.querySelector('#mgd-search');
  const counterEl = overlay.querySelector('#mgd-counter');

  // Aktuell ausgewählte IDs als Set
  const selected = new Set(memberIds);

  function renderList(filter = '') {
    listEl.innerHTML = '';
    const filtered = allUsers.filter(u =>
      !filter || (u.displayName||u.email||'').toLowerCase().includes(filter.toLowerCase())
    );
    if (!filtered.length) {
      listEl.innerHTML = '<p class="text-muted" style="padding:16px 0;">Keine Benutzer gefunden.</p>';
      return;
    }
    filtered.forEach(u => {
      const isChecked = selected.has(u.id);
      const row = document.createElement('label');
      row.className = 'member-row';
      Object.assign(row.style, {
        display:'flex', alignItems:'center', gap:'14px',
        padding:'10px 12px', borderRadius:'8px', cursor:'pointer',
        transition:'background 0.1s', marginBottom:'2px',
        backgroundColor: isChecked ? 'rgba(21,101,192,0.08)' : 'transparent'
      });
      row.innerHTML = `
        <input type="checkbox" data-uid="${u.id}" ${isChecked?'checked':''}
          style="width:18px;height:18px;flex-shrink:0;margin-bottom:0;" />
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${u.displayName || '(kein Name)'}
          </div>
          <div class="text-muted" style="font-size:0.82rem;">${u.email||''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
          ${(u.roles||[]).map(r=>`<span class="chip" style="font-size:0.75rem;padding:2px 8px;">${getRoleLabel(r)}</span>`).join('')}
        </div>`;
      const cb = row.querySelector('input[type="checkbox"]');
      cb.onchange = () => {
        if (cb.checked) { selected.add(u.id); row.style.backgroundColor = 'rgba(21,101,192,0.08)'; }
        else            { selected.delete(u.id); row.style.backgroundColor = 'transparent'; }
        counterEl.textContent = `${selected.size} / ${allUsers.length} ausgewählt`;
      };
      listEl.appendChild(row);
    });
  }

  renderList();

  searchEl.oninput = () => renderList(searchEl.value);

  overlay.querySelector('#mgd-select-all').onclick = () => {
    allUsers.forEach(u => selected.add(u.id));
    renderList(searchEl.value);
    counterEl.textContent = `${selected.size} / ${allUsers.length} ausgewählt`;
  };
  overlay.querySelector('#mgd-deselect-all').onclick = () => {
    selected.clear();
    renderList(searchEl.value);
    counterEl.textContent = `0 / ${allUsers.length} ausgewählt`;
  };

  const close = () => overlay.remove();
  overlay.querySelector('#mgd-close').onclick  = close;
  overlay.querySelector('#mgd-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#mgd-save').onclick = async () => {
    const selectedIds = [...selected];
    const batch = firestore.batch();
    batch.update(firestore.collection('groups').doc(group.id), { members: selectedIds });
    allUsers.forEach(u => {
      const wasIn   = memberIds.includes(u.id);
      const isNowIn = selectedIds.includes(u.id);
      if (wasIn === isNowIn) return;
      const ref = firestore.collection('users').doc(u.id);
      if (isNowIn) batch.update(ref, { groups: firebase.firestore.FieldValue.arrayUnion(group.id) });
      else         batch.update(ref, { groups: firebase.firestore.FieldValue.arrayRemove(group.id) });
    });
    await batch.commit();
    showToast('Gruppenmitglieder gespeichert.', 'success');
    close();
    renderGroupsTab(parentEl);
  };
}

/* ===================== SCHEDULE TAB ===================== */
let scheduleViewMode = 'list'; // 'list' | 'calendar'
let calendarDate    = new Date();

async function renderScheduleTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Termine...</div>`;
  try {
    const snap = await firestore.collection('events').orderBy('startTime', 'desc').limit(200).get();
    const events = [];
    snap.forEach(doc => events.push({ id: doc.id, ...doc.data() }));

    const groupsSnap = await firestore.collection('groups').orderBy('name').get();
    const groups = [];
    groupsSnap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <h3 style="margin:0;">Termine</h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="sch-delete-selected" class="btn-danger" hidden style="padding:6px 14px;">Ausgewählte löschen</button>
          <div style="display:flex;border:1px solid var(--color-border);border-radius:6px;overflow:hidden;">
            <button id="view-list"     class="view-toggle-btn ${scheduleViewMode==='list'?'active':''}">🗒 Liste</button>
            <button id="view-calendar" class="view-toggle-btn ${scheduleViewMode==='calendar'?'active':''}">&#128197; Kalender</button>
          </div>
          <button class="btn-primary" id="add-event-btn">+ Termin</button>
        </div>
      </div>
      <div id="schedule-content"></div>`;

    const contentEl  = el.querySelector('#schedule-content');
    const deleteSelBtn = el.querySelector('#sch-delete-selected');

    const renderView = () => {
      if (scheduleViewMode === 'list') renderEventList(contentEl, events, groups, el, deleteSelBtn);
      else                             renderCalendarView(contentEl, events, groups, el);
    };

    el.querySelector('#view-list').onclick = () => {
      scheduleViewMode = 'list';
      el.querySelector('#view-list').classList.add('active');
      el.querySelector('#view-calendar').classList.remove('active');
      renderView();
    };
    el.querySelector('#view-calendar').onclick = () => {
      scheduleViewMode = 'calendar';
      el.querySelector('#view-calendar').classList.add('active');
      el.querySelector('#view-list').classList.remove('active');
      renderView();
    };

    el.querySelector('#add-event-btn').onclick = () => showEventForm(null, groups, el);
    renderView();
  } catch(e) {
    console.error(e);
    el.innerHTML = '<p class="text-error">Fehler beim Laden der Termine.</p>';
  }
}

/* --- Listenansicht --- */
function renderEventList(el, events, groups, parentEl, deleteSelBtn) {
  if (!events.length) { el.innerHTML = '<p class="text-muted">Keine Termine vorhanden.</p>'; return; }

  const sorted = [...events].sort((a,b) => {
    const at = a.startTime?.toMillis?.() || 0;
    const bt = b.startTime?.toMillis?.() || 0;
    return at - bt;
  });

  el.innerHTML = `
    <div style="overflow-x:auto;">
      <table id="events-table">
        <thead>
          <tr>
            <th style="width:36px;">
              <input type="checkbox" id="select-all-events" title="Alle auswählen" style="width:16px;height:16px;margin-bottom:0;" />
            </th>
            <th>Titel</th><th>Start</th><th>Gruppe</th><th>Status</th><th>Wiederholung</th><th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(ev => {
            const start = ev.startTime?.toDate?.();
            const gName = groups.find(g => g.id === ev.groupId)?.name || '–';
            return `<tr data-event-id="${ev.id}">
              <td><input type="checkbox" class="event-select-cb" data-id="${ev.id}" style="width:16px;height:16px;margin-bottom:0;"></td>
              <td>${ev.title||'–'}</td>
              <td style="white-space:nowrap;">${start ? formatDateTime(start) : '–'}</td>
              <td>${gName}</td>
              <td><span class="chip ${ev.status==='cancelled'?'chip-error':ev.status==='done'?'':'chip-success'}">${ev.status||'planned'}</span></td>
              <td>${ev.recurrence && ev.recurrence!=='none' ? ev.recurrence : '–'}</td>
              <td style="white-space:nowrap;">
                <button class="btn-secondary" data-action="edit-event"   data-id="${ev.id}" style="padding:3px 10px;">Bearbeiten</button>
                <button class="btn-danger"    data-action="delete-event" data-id="${ev.id}" style="padding:3px 10px;margin-left:4px;">Löschen</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  // Select-All Checkbox
  const selectAll = el.querySelector('#select-all-events');
  selectAll.onchange = () => {
    el.querySelectorAll('.event-select-cb').forEach(cb => cb.checked = selectAll.checked);
    deleteSelBtn.hidden = !selectAll.checked;
  };
  el.querySelectorAll('.event-select-cb').forEach(cb => {
    cb.onchange = () => {
      const anyChecked = [...el.querySelectorAll('.event-select-cb')].some(c => c.checked);
      deleteSelBtn.hidden = !anyChecked;
      selectAll.checked = [...el.querySelectorAll('.event-select-cb')].every(c => c.checked);
    };
  });

  // Einzeln bearbeiten
  el.querySelectorAll('[data-action="edit-event"]').forEach(btn => {
    const ev = events.find(e => e.id === btn.dataset.id);
    btn.onclick = () => showEventForm(ev, groups, parentEl);
  });

  // Einzeln löschen
  el.querySelectorAll('[data-action="delete-event"]').forEach(btn => {
    const ev = events.find(e => e.id === btn.dataset.id);
    btn.onclick = () => confirmDeleteEvents([ev], events, groups, parentEl);
  });

  // Mehrfach löschen
  deleteSelBtn.onclick = () => {
    const ids = [...el.querySelectorAll('.event-select-cb:checked')].map(c => c.dataset.id);
    const evs = events.filter(e => ids.includes(e.id));
    confirmDeleteEvents(evs, events, groups, parentEl);
  };
}

function confirmDeleteEvents(eventsToDelete, allEvents, groups, parentEl) {
  // Prüfen ob Wiederholungsgruppen vorhanden
  const recGroups = [...new Set(eventsToDelete.filter(e => e.recurrenceGroup).map(e => e.recurrenceGroup))];
  const hasRecurrence = recGroups.length > 0;

  let extraOptions = '';
  if (hasRecurrence) {
    extraOptions = `
      <div style="margin-top:12px;background:var(--color-bg);border-radius:8px;padding:12px;">
        <p style="margin:0 0 8px;font-weight:500;">Wiederholungstermine gefunden:</p>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);">
          <input type="radio" name="del-scope" value="selected" checked />
          Nur die ausgewählten Termine löschen (${eventsToDelete.length})
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);margin-top:6px;">
          <input type="radio" name="del-scope" value="all-recurrence" />
          Alle zugehörigen Wiederholungstermine löschen
        </label>
      </div>`;
  }

  showModal({
    title: 'Termine löschen',
    body: `
      <p>Sollen <strong>${eventsToDelete.length}</strong> Termin(e) unwiderruflich gelöscht werden?</p>
      <ul style="font-size:0.9rem;max-height:140px;overflow-y:auto;padding-left:18px;">
        ${eventsToDelete.slice(0,10).map(e => `<li>${e.title||'Termin'} – ${e.startTime?.toDate ? formatDateTime(e.startTime.toDate()) : ''}</li>`).join('')}
        ${eventsToDelete.length > 10 ? `<li>... und ${eventsToDelete.length-10} weitere</li>` : ''}
      </ul>
      ${extraOptions}`,
    confirmLabel: 'Löschen',
    onConfirm: async () => {
      const scope = document.querySelector('input[name="del-scope"]:checked')?.value || 'selected';
      let toDelete = [...eventsToDelete];

      if (scope === 'all-recurrence' && hasRecurrence) {
        // Alle Events derselben Wiederholungsgruppe sammeln
        toDelete = allEvents.filter(e => recGroups.includes(e.recurrenceGroup));
        // Plus nicht-wiederkehrende aus Auswahl
        eventsToDelete.filter(e => !e.recurrenceGroup).forEach(e => {
          if (!toDelete.find(t => t.id === e.id)) toDelete.push(e);
        });
      }

      // In Batches löschen (max 500 pro Batch)
      const chunks = [];
      for (let i = 0; i < toDelete.length; i += 499) chunks.push(toDelete.slice(i, i+499));
      for (const chunk of chunks) {
        const batch = firestore.batch();
        chunk.forEach(e => batch.delete(firestore.collection('events').doc(e.id)));
        await batch.commit();
      }
      showToast(`${toDelete.length} Termin(e) gelöscht.`, 'success');
      renderScheduleTab(parentEl);
    }
  });
}

/* --- Kalenderansicht --- */
function renderCalendarView(el, events, groups, parentEl) {
  const year  = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const monthName = calendarDate.toLocaleString('de-DE', { month: 'long', year: 'numeric' });

  const firstDay  = new Date(year, month, 1);
  const lastDay   = new Date(year, month + 1, 0);
  // Wochentag des 1. (0=So -> 1=Mo)
  let startWd = firstDay.getDay(); // 0=So
  startWd = startWd === 0 ? 6 : startWd - 1; // -> 0=Mo

  // Events dieses Monats
  const monthEvents = events.filter(ev => {
    const d = ev.startTime?.toDate?.();
    return d && d.getFullYear() === year && d.getMonth() === month;
  });

  // Events nach Tag gruppieren
  const byDay = {};
  monthEvents.forEach(ev => {
    const d = ev.startTime.toDate().getDate();
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(ev);
  });

  const today = new Date();

  // Kalender-HTML bauen
  let calHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <button id="cal-prev" class="btn-secondary" style="padding:6px 14px;">&larr;</button>
      <h3 style="margin:0;flex:1;text-align:center;">${monthName}</h3>
      <button id="cal-next" class="btn-secondary" style="padding:6px 14px;">&rarr;</button>
      <button id="cal-today" class="btn-primary"  style="padding:6px 14px;">Heute</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">
      ${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d =>
        `<div style="text-align:center;font-weight:600;font-size:0.82rem;color:var(--color-text-muted);padding:6px 0;">${d}</div>`
      ).join('')}`;

  // Leerzellen am Anfang
  for (let i = 0; i < startWd; i++) {
    calHtml += `<div style="min-height:90px;"></div>`;
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const isToday = today.getFullYear()===year && today.getMonth()===month && today.getDate()===day;
    const dayEvents = byDay[day] || [];
    const evPills = dayEvents.slice(0,3).map(ev =>
      `<div class="cal-event-pill ${ev.status==='cancelled'?'cancelled':''}" data-ev-id="${ev.id}"
        style="font-size:0.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
               border-radius:3px;padding:1px 5px;margin-bottom:1px;cursor:pointer;
               background:${ev.status==='cancelled'?'var(--color-error)':'var(--color-primary)'};
               color:#fff;">
        ${ev.title||'Termin'}
      </div>`
    ).join('');
    const more = dayEvents.length > 3 ? `<div style="font-size:0.7rem;color:var(--color-text-muted);">+${dayEvents.length-3} mehr</div>` : '';

    calHtml += `
      <div style="min-height:90px;border:1px solid var(--color-border);border-radius:6px;padding:4px;
                  background:${isToday?'rgba(21,101,192,0.07)':'var(--color-surface)'};
                  position:relative;">
        <div style="font-size:0.82rem;font-weight:${isToday?'700':'400'};
                    color:${isToday?'var(--color-primary)':'var(--color-text)'};
                    margin-bottom:3px;">${day}</div>
        ${evPills}${more}
      </div>`;
  }
  calHtml += `</div>`;

  el.innerHTML = calHtml;

  el.querySelector('#cal-prev').onclick = () => {
    calendarDate = new Date(year, month - 1, 1);
    renderCalendarView(el, events, groups, parentEl);
  };
  el.querySelector('#cal-next').onclick = () => {
    calendarDate = new Date(year, month + 1, 1);
    renderCalendarView(el, events, groups, parentEl);
  };
  el.querySelector('#cal-today').onclick = () => {
    calendarDate = new Date();
    renderCalendarView(el, events, groups, parentEl);
  };

  // Klick auf Termin-Pill -> bearbeiten
  el.querySelectorAll('.cal-event-pill').forEach(pill => {
    pill.onclick = () => {
      const ev = events.find(e => e.id === pill.dataset.evId);
      if (ev) showEventForm(ev, groups, parentEl);
    };
  });
}

/* ===================== EVENT FORM ===================== */
function showEventForm(event, groups, parentEl) {
  const isNew    = !event;
  const startVal = event?.startTime?.toDate ? toDatetimeLocal(event.startTime.toDate()) : '';
  const endVal   = event?.endTime?.toDate   ? toDatetimeLocal(event.endTime.toDate())   : '';

  showModal({
    title: isNew ? 'Neuen Termin anlegen' : 'Termin bearbeiten',
    body: `
      <label>Titel</label>
      <input type="text" id="ef-title" value="${event?.title||''}" />
      <label>Beschreibung</label>
      <textarea id="ef-desc" rows="2">${event?.description||''}</textarea>
      <label>Start</label>
      <input type="datetime-local" id="ef-start" value="${startVal}" />
      <label>Ende</label>
      <input type="datetime-local" id="ef-end"   value="${endVal}" />
      <label>Trainingsgruppe</label>
      <select id="ef-group">
        <option value="">– keine –</option>
        ${groups.map(g=>`<option value="${g.id}" ${event?.groupId===g.id?'selected':''}>${g.name}</option>`).join('')}
      </select>
      <label>Mindest-Teilnehmerzahl (0 = kein Minimum)</label>
      <input type="number" id="ef-min" value="${event?.minParticipants??0}" min="0" />
      <label>Anmeldefrist (Minuten vor Beginn)</label>
      <input type="number" id="ef-deadline" value="${event?.signupDeadlineMinutes??60}" min="0" />
      <label>Anmeldemodus</label>
      <select id="ef-mode">
        <option value="opt_in"  ${!event?.mode||event?.mode==='opt_in' ?'selected':''}>Anmeldebasiert</option>
        <option value="opt_out" ${event?.mode==='opt_out'?'selected':''}>Abmeldebasiert</option>
      </select>
      <label>Wiederholung</label>
      <select id="ef-recurrence">
        <option value="none"     ${!event?.recurrence||event?.recurrence==='none'    ?'selected':''}>Einmalig</option>
        <option value="weekly"   ${event?.recurrence==='weekly'  ?'selected':''}>Wöchentlich</option>
        <option value="biweekly" ${event?.recurrence==='biweekly'?'selected':''}>Zweiwöchentlich</option>
        <option value="monthly"  ${event?.recurrence==='monthly' ?'selected':''}>Monatlich</option>
      </select>
      <label>Wiederholung bis</label>
      <input type="date" id="ef-recurrence-end" value="${event?.recurrenceEnd||''}" />`,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const title      = document.getElementById('ef-title')?.value.trim();
      const desc       = document.getElementById('ef-desc')?.value.trim();
      const startStr   = document.getElementById('ef-start')?.value;
      const endStr     = document.getElementById('ef-end')?.value;
      const groupId    = document.getElementById('ef-group')?.value || null;
      const minPart    = parseInt(document.getElementById('ef-min')?.value)||0;
      const deadline   = parseInt(document.getElementById('ef-deadline')?.value)||60;
      const mode       = document.getElementById('ef-mode')?.value||'opt_in';
      const recurrence = document.getElementById('ef-recurrence')?.value||'none';
      const recEnd     = document.getElementById('ef-recurrence-end')?.value||null;
      if (!title||!startStr) { showToast('Titel und Startzeit erforderlich.','error'); return false; }
      const startTs = firebase.firestore.Timestamp.fromDate(new Date(startStr));
      const endTs   = endStr ? firebase.firestore.Timestamp.fromDate(new Date(endStr)) : null;
      const data = {
        title, description: desc||'', startTime: startTs, endTime: endTs,
        groupId, minParticipants: minPart, signupDeadlineMinutes: deadline,
        mode, recurrence, recurrenceEnd: recEnd,
        status: event?.status||'planned', trainers: event?.trainers||[],
        directMembers: event?.directMembers||[],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (isNew) {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        if (recurrence !== 'none' && recEnd) {
          const instances = generateRecurringDates(new Date(startStr), endStr?new Date(endStr):null, recurrence, new Date(recEnd));
          const batch = firestore.batch();
          const rgId  = `rg_${Date.now()}`;
          instances.forEach(({start, end}) => {
            const ref = firestore.collection('events').doc();
            batch.set(ref, { ...data,
              startTime: firebase.firestore.Timestamp.fromDate(start),
              endTime:   end ? firebase.firestore.Timestamp.fromDate(end) : null,
              recurrenceGroup: rgId
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
  const results  = [];
  let current    = new Date(startDate);
  let currentEnd = endDate ? new Date(endDate) : null;
  const duration = currentEnd ? currentEnd.getTime() - current.getTime() : 0;
  while (current <= until && results.length < 200) {
    results.push({ start: new Date(current), end: currentEnd ? new Date(currentEnd) : null });
    if (recurrence === 'monthly') current.setMonth(current.getMonth() + 1);
    else current.setDate(current.getDate() + (recurrence === 'biweekly' ? 14 : 7));
    if (currentEnd) currentEnd = new Date(current.getTime() + duration);
  }
  return results;
}

function toDatetimeLocal(date) {
  const pad = n => String(n).padStart(2,'0');
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
        <input type="number" id="cs-min-part" value="${data.defaultMinParticipants??0}" min="0" />
        <label>Standard-Anmeldefrist (Minuten vor Beginn)</label>
        <input type="number" id="cs-signup-deadline" value="${data.defaultSignupDeadlineMinutes??60}" min="0" />
        <label>Standard-Anmeldemodus</label>
        <select id="cs-mode">
          <option value="opt_in"  ${data.defaultMode!=='opt_out'?'selected':''}>Anmeldebasiert</option>
          <option value="opt_out" ${data.defaultMode==='opt_out' ?'selected':''}>Abmeldebasiert</option>
        </select>
        <label>Teilnehmer-Sichtbarkeit für Mitglieder</label>
        <select id="cs-vis">
          <option value="names" ${data.visibilityMode==='names'?'selected':''}>Namen anzeigen</option>
          <option value="count" ${!data.visibilityMode||data.visibilityMode==='count'?'selected':''}>Nur Anzahl</option>
          <option value="none"  ${data.visibilityMode==='none' ?'selected':''}>Nichts anzeigen</option>
        </select>
        <hr class="divider" />
        <h4>Rollen-Labels</h4>
        ${['admin','coordinator','teacher','member'].map(r =>
          `<label>${getRoleLabel(r)}</label><input type="text" id="rl-${r}" value="${data.roleLabels?.[r]||getRoleLabel(r)}" />`
        ).join('')}
        <button class="btn-primary" id="cs-save" style="margin-top:4px;">Einstellungen speichern</button>
      </div>`;
    el.querySelector('#cs-save').onclick = async () => {
      const updates = {
        defaultMinParticipants:       parseInt(document.getElementById('cs-min-part')?.value)||0,
        defaultSignupDeadlineMinutes: parseInt(document.getElementById('cs-signup-deadline')?.value)||60,
        defaultMode:     document.getElementById('cs-mode')?.value||'opt_in',
        visibilityMode:  document.getElementById('cs-vis')?.value ||'count',
        roleLabels: {
          admin:       document.getElementById('rl-admin')?.value      ||'Admin',
          coordinator: document.getElementById('rl-coordinator')?.value||'Koordinator',
          teacher:     document.getElementById('rl-teacher')?.value    ||'Trainer',
          member:      document.getElementById('rl-member')?.value     ||'Mitglied'
        }
      };
      await firestore.collection('settings').doc('global').set(updates, { merge: true });
      window.roleLabels = updates.roleLabels;
      window.appSettings = { ...(window.appSettings||{}), ...updates };
      showToast('Einstellungen gespeichert.', 'success');
    };
  } catch(e) { el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>'; }
}
