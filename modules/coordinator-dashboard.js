// modules/coordinator-dashboard.js

async function loadCoordinatorDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `
    <h2 style="margin-top:0;">Koordinator-Dashboard</h2>
    <div class="tabs">
      <button class="tab-btn active" data-tab="users">Benutzer</button>
      <button class="tab-btn" data-tab="groups">Gruppen</button>
      <button class="tab-btn" data-tab="schedule">Terminplanung</button>
      <button class="tab-btn" data-tab="settings">Einstellungen</button>
    </div>
    <div id="tab-users"></div>
    <div id="tab-groups" hidden></div>
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
        <h3 style="margin:0;">Benutzer (${users.length})</h3>
        <button class="btn-primary" id="add-user-btn">+ Benutzer anlegen</button>
      </div>
      <div style="width:100%;overflow-x:auto;">
        <table style="width:100%;table-layout:auto;min-width:500px;">
          <thead><tr><th>Name</th><th>E-Mail</th><th>Rollen</th><th style="white-space:nowrap;">Aktionen</th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>${u.displayName || '–'}</td>
                <td>${u.email || '–'}</td>
                <td>${(u.roles||[]).map(r=>`<span class="chip">${getRoleLabel(r)}</span>`).join('')}</td>
                <td style="white-space:nowrap;">
                  <button class="btn-secondary" data-uid="${u.id}" data-action="edit" style="padding:4px 10px;">Bearbeiten</button>
                  <button class="btn-danger"    data-uid="${u.id}" data-action="del"  style="padding:4px 10px;margin-left:4px;">Löschen</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    el.querySelector('#add-user-btn').onclick = () => showUserForm(null, el);
    el.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.onclick = () => showUserForm(users.find(u => u.id === btn.dataset.uid), el);
    });
    el.querySelectorAll('[data-action="del"]').forEach(btn => {
      btn.onclick = () => confirmDeleteUser(users.find(u => u.id === btn.dataset.uid), el);
    });
  } catch (e) {
    console.error(e);
    el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
  }
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
      ${isNew ? `<label>Passwort</label><input type="password" id="uf-pw" placeholder="Mindestens 6 Zeichen" />` : ''}
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
      const roles = ['admin','coordinator','teacher','member'].filter(r => document.querySelector(`input[data-role="${r}"]`)?.checked);
      if (!name || !email) { showToast('Name und E-Mail erforderlich.', 'error'); return false; }
      if (isNew && (!pw || pw.length < 6)) { showToast('Passwort muss mind. 6 Zeichen haben.', 'error'); return false; }
      if (isNew) {
        try {
          const res  = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${window.FIREBASE_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pw, returnSecureToken: false })
          });
          const data = await res.json();
          if (data.error) { showToast('Firebase Auth Fehler: ' + data.error.message, 'error'); return false; }
          await firestore.collection('users').doc(data.localId).set({
            displayName: name, email, roles, groups: [], isActive: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          showToast('Benutzer angelegt.', 'success');
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); return false; }
      } else {
        await firestore.collection('users').doc(user.id).update({ displayName: name, roles });
        showToast('Benutzer aktualisiert.', 'success');
      }
      renderUsersTab(parentEl);
    }
  });
}

function confirmDeleteUser(user, parentEl) {
  if (!user) return;
  showModal({
    title: 'Benutzer löschen',
    body: `<p>Soll <strong>${user.displayName||user.email||user.id}</strong> gelöscht werden?</p>
           <p class="text-muted">Firestore-Daten, Gruppenzugehörigkeiten und Attendance-Einträge werden entfernt. Der Firebase-Auth-Account muss ggf. manuell in der Firebase Console gelöscht werden.</p>`,
    confirmLabel: 'Löschen',
    onConfirm: async () => {
      try {
        const batch = firestore.batch();
        batch.delete(firestore.collection('users').doc(user.id));
        const gSnap = await firestore.collection('groups').get();
        gSnap.forEach(doc => batch.update(doc.ref, { members: firebase.firestore.FieldValue.arrayRemove(user.id) }));
        const eSnap = await firestore.collection('events').get();
        eSnap.forEach(doc => batch.update(doc.ref, {
          trainers:      firebase.firestore.FieldValue.arrayRemove(user.id),
          directMembers: firebase.firestore.FieldValue.arrayRemove(user.id)
        }));
        const aSnap = await firestore.collection('eventAttendance').where('userId','==',user.id).get();
        aSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        showToast('Benutzer gelöscht.', 'success');
        renderUsersTab(parentEl);
      } catch (e) { console.error(e); showToast('Fehler beim Löschen.', 'error'); return false; }
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
        <h3 style="margin:0;">Gruppen (${groups.length})</h3>
        <button class="btn-primary" id="add-group-btn">+ Gruppe anlegen</button>
      </div>
      <div style="width:100%;overflow-x:auto;">
        <table style="width:100%;table-layout:auto;min-width:400px;">
          <thead><tr><th>Name</th><th>Beschreibung</th><th style="white-space:nowrap;">Aktionen</th></tr></thead>
          <tbody>
            ${groups.map(g => `
              <tr>
                <td style="font-weight:500;">${g.name}</td>
                <td class="text-muted" style="font-size:0.88rem;">${g.description||''}</td>
                <td style="white-space:nowrap;">
                  <button class="btn-secondary" data-gid="${g.id}" data-action="members" style="padding:5px 12px;">Mitglieder</button>
                  <button class="btn-secondary" data-gid="${g.id}" data-action="edit"    style="padding:5px 12px;margin-left:4px;">Bearbeiten</button>
                </td>
              </tr>`).join('')}
            ${!groups.length ? '<tr><td colspan="3" class="text-muted">Noch keine Gruppen angelegt.</td></tr>' : ''}
          </tbody>
        </table>
      </div>`;
    el.querySelector('#add-group-btn').onclick = () => showGroupForm(null, el);
    el.querySelectorAll('[data-action="edit"]').forEach(btn => btn.onclick = () => showGroupForm(groups.find(g => g.id === btn.dataset.gid), el));
    el.querySelectorAll('[data-action="members"]').forEach(btn => btn.onclick = () => showGroupMembersDialog(groups.find(g => g.id === btn.dataset.gid), el));
  } catch (e) { el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>'; }
}

function showGroupForm(group, parentEl) {
  const isNew = !group;
  showModal({
    title: isNew ? 'Neue Gruppe' : 'Gruppe bearbeiten',
    body: `
      <label>Gruppenname</label><input type="text" id="gf-name" value="${group?.name||''}" />
      <label>Beschreibung</label><input type="text" id="gf-desc" value="${group?.description||''}" />`,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const name = document.getElementById('gf-name')?.value.trim();
      const desc = document.getElementById('gf-desc')?.value.trim();
      if (!name) { showToast('Gruppenname erforderlich.', 'error'); return false; }
      if (isNew) await firestore.collection('groups').add({ name, description: desc||'', members: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      else await firestore.collection('groups').doc(group.id).update({ name, description: desc||'' });
      showToast(isNew ? 'Gruppe angelegt.' : 'Gruppe aktualisiert.', 'success');
      renderGroupsTab(parentEl);
    }
  });
}

async function showGroupMembersDialog(group, parentEl) {
  const usersSnap = await firestore.collection('users').orderBy('displayName').get();
  const allUsers  = [];
  usersSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
  const availableUsers = allUsers.filter(u => !!u.id);
  const memberIds = (group.members||[]).filter(id => availableUsers.some(u => u.id === id));

  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position:'fixed', inset:'0', backgroundColor:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9998 });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:12px;width:min(600px,95vw);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden;">
      <div style="padding:20px 24px 16px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
        <div><h3 style="margin:0 0 2px;">${group.name}</h3><p class="text-muted" style="margin:0;font-size:0.85rem;">Mitglieder verwalten</p></div>
        <button id="mgd-close" style="background:none;border:none;font-size:1.4rem;color:var(--color-text-muted);cursor:pointer;">&times;</button>
      </div>
      <div style="padding:12px 24px;border-bottom:1px solid var(--color-border);display:flex;gap:12px;align-items:center;">
        <input type="search" id="mgd-search" placeholder="Mitglieder suchen..." style="flex:1;margin-bottom:0;" />
        <span id="mgd-counter" class="chip chip-info" style="white-space:nowrap;">${memberIds.length} / ${availableUsers.length} ausgewählt</span>
      </div>
      <div style="padding:8px 24px;display:flex;gap:8px;border-bottom:1px solid var(--color-border);">
        <button id="mgd-all"  class="btn-secondary" style="padding:4px 12px;font-size:0.85rem;">Alle auswählen</button>
        <button id="mgd-none" class="btn-secondary" style="padding:4px 12px;font-size:0.85rem;">Alle abwählen</button>
      </div>
      <div id="mgd-list" style="flex:1;overflow-y:auto;padding:8px 24px;"></div>
      <div style="padding:16px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:10px;">
        <button id="mgd-cancel" class="btn-secondary">Abbrechen</button>
        <button id="mgd-save"   class="btn-primary">Speichern</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl    = overlay.querySelector('#mgd-list');
  const searchEl  = overlay.querySelector('#mgd-search');
  const counterEl = overlay.querySelector('#mgd-counter');
  const selected  = new Set(memberIds);

  const updateCounter = () => { counterEl.textContent = `${selected.size} / ${availableUsers.length} ausgewählt`; };

  const renderList = (filter = '') => {
    listEl.innerHTML = '';
    const filtered = availableUsers.filter(u => !filter || (u.displayName||u.email||'').toLowerCase().includes(filter.toLowerCase()));
    if (!filtered.length) { listEl.innerHTML = '<p class="text-muted" style="padding:16px 0;">Keine Benutzer gefunden.</p>'; updateCounter(); return; }
    filtered.forEach(u => {
      const row = document.createElement('label');
      row.className = 'member-row';
      Object.assign(row.style, { display:'flex', alignItems:'center', gap:'14px', padding:'10px 12px', borderRadius:'8px', cursor:'pointer', marginBottom:'2px', backgroundColor: selected.has(u.id) ? 'rgba(21,101,192,0.08)' : 'transparent' });
      row.innerHTML = `
        <input type="checkbox" data-uid="${u.id}" ${selected.has(u.id)?'checked':''} style="width:18px;height:18px;flex-shrink:0;" />
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.displayName||'(kein Name)'}</div>
          <div class="text-muted" style="font-size:0.82rem;">${u.email||''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${(u.roles||[]).map(r=>`<span class="chip" style="font-size:0.75rem;padding:2px 8px;">${getRoleLabel(r)}</span>`).join('')}</div>`;
      const cb = row.querySelector('input');
      cb.onchange = () => { if (cb.checked) { selected.add(u.id); row.style.backgroundColor='rgba(21,101,192,0.08)'; } else { selected.delete(u.id); row.style.backgroundColor='transparent'; } updateCounter(); };
      listEl.appendChild(row);
    });
    updateCounter();
  };

  renderList();
  searchEl.oninput = () => renderList(searchEl.value);
  overlay.querySelector('#mgd-all').onclick  = () => { availableUsers.forEach(u => selected.add(u.id));    renderList(searchEl.value); };
  overlay.querySelector('#mgd-none').onclick = () => { selected.clear(); renderList(searchEl.value); };
  const close = () => overlay.remove();
  overlay.querySelector('#mgd-close').onclick  = close;
  overlay.querySelector('#mgd-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#mgd-save').onclick = async () => {
    const ids   = [...selected];
    const batch = firestore.batch();
    batch.update(firestore.collection('groups').doc(group.id), { members: ids });
    availableUsers.forEach(u => {
      const was = memberIds.includes(u.id), isNow = ids.includes(u.id);
      if (was === isNow) return;
      const ref = firestore.collection('users').doc(u.id);
      if (isNow) batch.update(ref, { groups: firebase.firestore.FieldValue.arrayUnion(group.id) });
      else       batch.update(ref, { groups: firebase.firestore.FieldValue.arrayRemove(group.id) });
    });
    await batch.commit();
    showToast('Gruppenmitglieder gespeichert.', 'success');
    close(); renderGroupsTab(parentEl);
  };
}

/* ===================== SCHEDULE TAB ===================== */
let scheduleViewMode = 'list';
let calendarDate     = new Date();

async function renderScheduleTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Termine...</div>`;
  try {
    const snap = await firestore.collection('events').orderBy('startTime','desc').limit(200).get();
    const events = [];
    snap.forEach(doc => events.push({ id: doc.id, ...doc.data() }));
    const groupsSnap = await firestore.collection('groups').orderBy('name').get();
    const groups = [];
    groupsSnap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));
    const trainersSnap = await firestore.collection('users').orderBy('displayName').get();
    const allTrainers = [];
    trainersSnap.forEach(doc => {
      const d = doc.data();
      if ((d.roles||[]).includes('teacher')) allTrainers.push({ id: doc.id, ...d });
    });
    window._allTrainers = allTrainers;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <h3 style="margin:0;">Termine</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div id="bulk-actions" style="display:none;gap:6px;align-items:center;">
            <span id="bulk-count" style="font-size:0.85rem;color:var(--color-text-muted);white-space:nowrap;"></span>
            <button id="sch-skip-selected" class="btn-secondary" style="padding:6px 14px;display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:16px;">event_busy</span> Ausfallen lassen
            </button>
            <button id="sch-delete-selected" class="btn-danger" style="padding:6px 14px;">Löschen</button>
          </div>
          <div style="display:flex;border:1px solid var(--color-border);border-radius:6px;overflow:hidden;">
            <button id="view-list"     class="view-toggle-btn ${scheduleViewMode==='list'    ?'active':''}"><span class="material-icons" style="font-size:16px;vertical-align:middle;">list</span> Liste</button>
            <button id="view-calendar" class="view-toggle-btn ${scheduleViewMode==='calendar'?'active':''}"><span class="material-icons" style="font-size:16px;vertical-align:middle;">calendar_month</span> Kalender</button>
          </div>
          <button class="btn-primary" id="add-event-btn">+ Termin</button>
        </div>
      </div>
      <div id="schedule-content"></div>`;

    const contentEl  = el.querySelector('#schedule-content');
    const bulkBar    = el.querySelector('#bulk-actions');
    const bulkCount  = el.querySelector('#bulk-count');
    const skipSelBtn = el.querySelector('#sch-skip-selected');
    const delSelBtn  = el.querySelector('#sch-delete-selected');

    const renderView = () => scheduleViewMode === 'list'
      ? renderEventList(contentEl, events, groups, el, bulkBar, bulkCount, skipSelBtn, delSelBtn)
      : renderCalendarView(contentEl, events, groups, el);

    el.querySelector('#view-list').onclick = () => { scheduleViewMode='list'; el.querySelector('#view-list').classList.add('active'); el.querySelector('#view-calendar').classList.remove('active'); renderView(); };
    el.querySelector('#view-calendar').onclick = () => { scheduleViewMode='calendar'; el.querySelector('#view-calendar').classList.add('active'); el.querySelector('#view-list').classList.remove('active'); renderView(); };
    el.querySelector('#add-event-btn').onclick = () => showEventForm(null, groups, el);
    renderView();
  } catch (e) { console.error(e); el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>'; }
}

/* ── Hilfsfunktion: gibt alle Ereignisse einer recurrenceGroup zurück,
   sortiert nach startTime aufsteigend ── */
function getSeriesEvents(allEvents, recurrenceGroup) {
  return allEvents
    .filter(e => e.recurrenceGroup === recurrenceGroup)
    .sort((a,b) => (a.startTime?.toMillis?.()??0) - (b.startTime?.toMillis?.()??0));
}

/* ── Wiederholungs-Scope-Dialog ──────────────────────────────────────────────
   Zeigt einen Dialog mit den Optionen:
     'single'    – Nur diesen Termin
     'following' – Diesen und alle nachfolgenden
     'all'       – Alle Termine der Serie
   Gibt den gewählten Scope als Promise<string|null> zurück (null = abgebrochen).
*/
function askRecurrenceScope(extraOption) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:'fixed', inset:'0', backgroundColor:'rgba(0,0,0,0.55)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:10100
    });

    const options = [
      { value:'single',    label:'Nur diesen Termin' },
      { value:'following', label:'Diesen und alle nachfolgenden Termine' },
      { value:'all',       label:'Alle Termine der Serie' },
    ];
    if (extraOption) options.push(extraOption);

    overlay.innerHTML = `
      <div style="background:var(--color-surface);border-radius:12px;width:min(460px,95vw);box-shadow:0 8px 40px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="padding:20px 24px 14px;border-bottom:1px solid var(--color-border);">
          <h3 style="margin:0;">Wiederholungstermin bearbeiten</h3>
          <p class="text-muted" style="margin:6px 0 0;font-size:0.88rem;">Dieser Termin ist Teil einer Serie. Für welche Termine soll die Änderung gelten?</p>
        </div>
        <div style="padding:16px 24px;display:flex;flex-direction:column;gap:10px;">
          ${options.map(o => `
            <label style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;border:1px solid var(--color-border);cursor:pointer;background:var(--color-bg);">
              <input type="radio" name="rec-scope" value="${o.value}" style="width:17px;height:17px;flex-shrink:0;margin-bottom:0;" />
              <span>${o.label}</span>
            </label>`).join('')}
        </div>
        <div style="padding:14px 24px 20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--color-border);">
          <button id="rsd-cancel" class="btn-secondary">Abbrechen</button>
          <button id="rsd-confirm" class="btn-primary">Übernehmen</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // Erste Option vorauswählen
    overlay.querySelector('input[name="rec-scope"]').checked = true;

    overlay.querySelector('#rsd-cancel').onclick = () => { overlay.remove(); resolve(null); };
    overlay.querySelector('#rsd-confirm').onclick = () => {
      const val = overlay.querySelector('input[name="rec-scope"]:checked')?.value || null;
      overlay.remove();
      resolve(val);
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
  });
}

/* ── Bulk-Ausfallen-Dialog ───────────────────────────────────────────────────
   Öffnet einen Dialog mit Begründungsfeld und setzt status='skipped' für alle
   übergebenen Termine.
*/
function confirmSkipEvents(eventsToSkip, allEvents, groups, parentEl) {
  const recGroups    = [...new Set(eventsToSkip.filter(e=>e.recurrenceGroup).map(e=>e.recurrenceGroup))];
  const hasRecurrence = recGroups.length > 0;

  showModal({
    title: 'Termine als ausgefallen markieren',
    body: `
      <p><strong>${eventsToSkip.length}</strong> Termin(e) werden als ausgefallen markiert:</p>
      <ul style="font-size:0.9rem;max-height:130px;overflow-y:auto;padding-left:18px;margin:8px 0 12px;">
        ${eventsToSkip.slice(0,8).map(e=>`<li>${e.title||'Termin'} – ${e.startTime?.toDate?formatDateTime(e.startTime.toDate()):''}</li>`).join('')}
        ${eventsToSkip.length>8?`<li>... und ${eventsToSkip.length-8} weitere</li>`:''}
      </ul>
      <label>Begründung (optional, für alle ausgewählten Termine)</label>
      <input type="text" id="bulk-skip-reason" placeholder="z.B. Feiertag, kein Betreuer verfügbar..." />
      ${hasRecurrence ? `
        <div style="margin-top:12px;background:var(--color-bg);border-radius:8px;padding:12px;border:1px solid var(--color-border);">
          <p style="margin:0 0 8px;font-weight:500;font-size:0.9rem;">Wiederholungstermine in der Auswahl:</p>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);"><input type="radio" name="skip-scope" value="selected" checked /> Nur ausgewählte (${eventsToSkip.length})</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);margin-top:6px;"><input type="radio" name="skip-scope" value="all-recurrence" /> Alle Wiederholungen der betroffenen Serien</label>
        </div>` : ''}
    `,
    confirmLabel: 'Ausfallen lassen',
    onConfirm: async () => {
      const reason = document.getElementById('bulk-skip-reason')?.value.trim() || '';
      let toSkip = [...eventsToSkip];
      if (hasRecurrence && document.querySelector('input[name="skip-scope"]:checked')?.value === 'all-recurrence') {
        toSkip = allEvents.filter(e => recGroups.includes(e.recurrenceGroup));
        eventsToSkip.filter(e=>!e.recurrenceGroup).forEach(e => { if (!toSkip.find(t=>t.id===e.id)) toSkip.push(e); });
      }
      for (let i=0; i<toSkip.length; i+=499) {
        const b = firestore.batch();
        toSkip.slice(i,i+499).forEach(e => {
          b.update(firestore.collection('events').doc(e.id), {
            status: 'skipped',
            skipReason: reason || firebase.firestore.FieldValue.delete(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await b.commit();
      }
      showToast(`${toSkip.length} Termin(e) als ausgefallen markiert.`, 'success');
      renderScheduleTab(parentEl);
    }
  });
}

function renderEventList(el, events, groups, parentEl, bulkBar, bulkCount, skipSelBtn, delSelBtn) {
  if (!events.length) { el.innerHTML = '<p class="text-muted">Keine Termine vorhanden.</p>'; return; }
  const sorted = [...events].sort((a,b) => (a.startTime?.toMillis?.()??0) - (b.startTime?.toMillis?.()??0));
  el.innerHTML = `
    <div style="width:100%;overflow-x:auto;">
      <table style="width:100%;table-layout:auto;min-width:600px;">
        <thead><tr>
          <th style="width:36px;"><input type="checkbox" id="sel-all" style="width:16px;height:16px;" /></th>
          <th>Titel</th><th>Start</th><th>Gruppe</th><th>Status</th><th>Wiederholung</th><th style="white-space:nowrap;">Aktionen</th>
        </tr></thead>
        <tbody>
          ${sorted.map(ev => {
            const s = ev.startTime?.toDate?.();
            const g = groups.find(g => g.id === ev.groupId)?.name || '–';
            return `<tr>
              <td><input type="checkbox" class="ev-cb" data-id="${ev.id}" style="width:16px;height:16px;"></td>
              <td>${ev.title||'–'}</td>
              <td style="white-space:nowrap;">${s?formatDateTime(s):'–'}</td>
              <td>${g}</td>
              <td><span class="chip ${ev.status==='cancelled'?'chip-error':ev.status==='skipped'?'chip-warning':'chip-success'}">${ev.status==='cancelled'?'Abgesagt':ev.status==='skipped'?'Ausgefallen':'geplant'}</span></td>
              <td>${ev.recurrenceGroup?`<span class="chip" style="font-size:0.78rem;">Serie</span>`:'–'}</td>
              <td style="white-space:nowrap;">
                <button class="btn-secondary" data-action="edit" data-id="${ev.id}" style="padding:3px 10px;">Bearbeiten</button>
                <button class="btn-danger" data-action="del" data-id="${ev.id}" style="padding:3px 10px;margin-left:4px;">Löschen</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const updateBulkBar = () => {
    const checked = [...el.querySelectorAll('.ev-cb:checked')];
    if (checked.length > 0) {
      bulkBar.style.display = 'flex';
      bulkCount.textContent = `${checked.length} ausgewählt`;
    } else {
      bulkBar.style.display = 'none';
      bulkCount.textContent = '';
    }
    const selAll = el.querySelector('#sel-all');
    const all    = [...el.querySelectorAll('.ev-cb')];
    selAll.checked       = all.length > 0 && all.every(c=>c.checked);
    selAll.indeterminate = !selAll.checked && all.some(c=>c.checked);
  };

  const selAll = el.querySelector('#sel-all');
  selAll.onchange = () => { el.querySelectorAll('.ev-cb').forEach(c => c.checked=selAll.checked); updateBulkBar(); };
  el.querySelectorAll('.ev-cb').forEach(cb => { cb.onchange = updateBulkBar; });
  el.querySelectorAll('[data-action="edit"]').forEach(btn => btn.onclick = () => showEventForm(events.find(e=>e.id===btn.dataset.id), groups, parentEl));
  el.querySelectorAll('[data-action="del"]').forEach(btn  => btn.onclick = () => confirmDeleteEvents([events.find(e=>e.id===btn.dataset.id)], events, groups, parentEl));

  skipSelBtn.onclick = () => {
    const ids = [...el.querySelectorAll('.ev-cb:checked')].map(c=>c.dataset.id);
    confirmSkipEvents(events.filter(e=>ids.includes(e.id)), events, groups, parentEl);
  };
  delSelBtn.onclick = () => {
    const ids = [...el.querySelectorAll('.ev-cb:checked')].map(c=>c.dataset.id);
    confirmDeleteEvents(events.filter(e=>ids.includes(e.id)), events, groups, parentEl);
  };
}

function confirmDeleteEvents(eventsToDelete, allEvents, groups, parentEl) {
  const recGroups    = [...new Set(eventsToDelete.filter(e=>e.recurrenceGroup).map(e=>e.recurrenceGroup))];
  const hasRecurrence = recGroups.length > 0;
  showModal({
    title: 'Termine löschen',
    body: `
      <p>Sollen <strong>${eventsToDelete.length}</strong> Termin(e) gelöscht werden?</p>
      <ul style="font-size:0.9rem;max-height:140px;overflow-y:auto;padding-left:18px;">
        ${eventsToDelete.slice(0,10).map(e=>`<li>${e.title||'Termin'} – ${e.startTime?.toDate?formatDateTime(e.startTime.toDate()):''}</li>`).join('')}
        ${eventsToDelete.length>10?`<li>... und ${eventsToDelete.length-10} weitere</li>`:''}
      </ul>
      ${hasRecurrence ? `
        <div style="margin-top:12px;background:var(--color-bg);border-radius:8px;padding:12px;">
          <p style="margin:0 0 8px;font-weight:500;">Wiederholungstermine gefunden:</p>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);"><input type="radio" name="del-scope" value="selected" checked /> Nur ausgewählte (${eventsToDelete.length})</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--color-text);margin-top:6px;"><input type="radio" name="del-scope" value="all-recurrence" /> Alle Wiederholungen löschen</label>
        </div>` : ''}
    `,
    confirmLabel: 'Löschen',
    onConfirm: async () => {
      let toDelete = [...eventsToDelete];
      if (document.querySelector('input[name="del-scope"]:checked')?.value === 'all-recurrence' && hasRecurrence) {
        toDelete = allEvents.filter(e => recGroups.includes(e.recurrenceGroup));
        eventsToDelete.filter(e=>!e.recurrenceGroup).forEach(e => { if (!toDelete.find(t=>t.id===e.id)) toDelete.push(e); });
      }
      for (let i=0; i<toDelete.length; i+=499) { const b=firestore.batch(); toDelete.slice(i,i+499).forEach(e=>b.delete(firestore.collection('events').doc(e.id))); await b.commit(); }
      showToast(`${toDelete.length} Termin(e) gelöscht.`, 'success');
      renderScheduleTab(parentEl);
    }
  });
}

function renderCalendarView(el, events, groups, parentEl) {
  const year=calendarDate.getFullYear(), month=calendarDate.getMonth();
  const monthName = calendarDate.toLocaleString('de-DE',{month:'long',year:'numeric'});
  const firstDay=new Date(year,month,1), lastDay=new Date(year,month+1,0);
  let startWd=firstDay.getDay(); startWd=startWd===0?6:startWd-1;
  const monthEvents=events.filter(ev=>{const d=ev.startTime?.toDate?.();return d&&d.getFullYear()===year&&d.getMonth()===month;});
  const byDay={}; monthEvents.forEach(ev=>{const d=ev.startTime.toDate().getDate();if(!byDay[d])byDay[d]=[];byDay[d].push(ev);});
  const today=new Date();
  let html=`<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <button id="cal-prev" class="btn-secondary" style="padding:6px 14px;">&larr;</button>
    <h3 style="margin:0;flex:1;text-align:center;">${monthName}</h3>
    <button id="cal-next" class="btn-secondary" style="padding:6px 14px;">&rarr;</button>
    <button id="cal-today" class="btn-primary" style="padding:6px 14px;">Heute</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">
    ${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d=>`<div style="text-align:center;font-weight:600;font-size:0.82rem;color:var(--color-text-muted);padding:6px 0;">${d}</div>`).join('')}`;
  for(let i=0;i<startWd;i++) html+=`<div style="min-height:90px;"></div>`;
  for(let day=1;day<=lastDay.getDate();day++){
    const isToday=today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===day;
    const de=byDay[day]||[];
    const pills=de.slice(0,3).map(ev=>`<div class="cal-event-pill" data-ev-id="${ev.id}" style="font-size:0.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:3px;padding:1px 5px;margin-bottom:1px;cursor:pointer;background:${ev.status==='cancelled'?'var(--color-error)':ev.status==='skipped'?'var(--color-warning)':'var(--color-primary)'};color:#fff;">${ev.title||'Termin'}</div>`).join('');
    const more=de.length>3?`<div style="font-size:0.7rem;color:var(--color-text-muted);">+${de.length-3} mehr</div>`:'';
    html+=`<div style="min-height:90px;border:1px solid var(--color-border);border-radius:6px;padding:4px;background:${isToday?'rgba(21,101,192,0.07)':'var(--color-surface)'};">
      <div style="font-size:0.82rem;font-weight:${isToday?700:400};color:${isToday?'var(--color-primary)':'var(--color-text)'};margin-bottom:3px;">${day}</div>
      ${pills}${more}
    </div>`;
  }
  html+=`</div>`;
  el.innerHTML=html;
  el.querySelector('#cal-prev').onclick=()=>{calendarDate=new Date(year,month-1,1);renderCalendarView(el,events,groups,parentEl);};
  el.querySelector('#cal-next').onclick=()=>{calendarDate=new Date(year,month+1,1);renderCalendarView(el,events,groups,parentEl);};
  el.querySelector('#cal-today').onclick=()=>{calendarDate=new Date();renderCalendarView(el,events,groups,parentEl);};
  el.querySelectorAll('.cal-event-pill').forEach(p=>{ p.onclick=()=>{const ev=events.find(e=>e.id===p.dataset.evId);if(ev)showEventForm(ev,groups,parentEl);}; });
}

async function showEventForm(event, groups, parentEl) {
  const isNew       = !event;
  const startVal    = event?.startTime?.toDate ? toDatetimeLocal(event.startTime.toDate()) : '';
  const endVal      = event?.endTime?.toDate   ? toDatetimeLocal(event.endTime.toDate())   : '';
  const allTrainers = window._allTrainers || [];
  const selTrainers = new Set(event?.trainers || []);
  const teacherLabel = getRoleLabel('teacher');
  const isPartOfSeries = !isNew && !!event?.recurrenceGroup;

  // Alle Events der gleichen Serie für Scope-Operationen vorladen
  let seriesEvents = [];
  if (isPartOfSeries) {
    try {
      const serSnap = await firestore.collection('events')
        .where('recurrenceGroup', '==', event.recurrenceGroup).get();
      serSnap.forEach(doc => seriesEvents.push({ id: doc.id, ...doc.data() }));
      seriesEvents.sort((a,b) => (a.startTime?.toMillis?.()??0) - (b.startTime?.toMillis?.()??0));
    } catch(e) { console.error('Serie laden:', e); }
  }

  const trainerListHtml = allTrainers.length
    ? allTrainers.map(t => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;color:var(--color-text);background:${selTrainers.has(t.id)?'rgba(21,101,192,0.08)':'transparent'};" class="trainer-pick-row">
          <input type="checkbox" class="trainer-pick-cb" data-tid="${t.id}" ${selTrainers.has(t.id)?'checked':''} style="width:17px;height:17px;margin-bottom:0;" />
          <span style="font-weight:500;">${t.displayName||t.email||t.id}</span>
          <span class="text-muted" style="font-size:0.82rem;">${t.email||''}</span>
        </label>`).join('')
    : `<p class="text-muted" style="font-size:0.88rem;">Keine ${teacherLabel} gefunden.</p>`;

  const currentMode = event?.mode || 'opt_in';

  showModal({
    title: isNew ? 'Neuen Termin anlegen' : 'Termin bearbeiten',
    body: `
      ${isPartOfSeries ? `<div style="background:rgba(21,101,192,0.07);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px;font-size:0.88rem;color:var(--color-primary);">
        <span class="material-icons" style="font-size:17px;">repeat</span>
        Dieser Termin ist Teil einer Wiederholungsserie (${seriesEvents.length} Termine). Beim Speichern wird gefragt, für welche Termine die Änderungen gelten sollen.
      </div>` : ''}
      <label>Titel</label><input type="text" id="ef-title" value="${event?.title||''}" />
      <label>Beschreibung</label><textarea id="ef-desc" rows="2">${event?.description||''}</textarea>
      <label>Start</label><input type="datetime-local" id="ef-start" value="${startVal}" />
      <label>Ende</label><input type="datetime-local" id="ef-end" value="${endVal}" />
      <label>Gruppe</label>
      <select id="ef-group">
        <option value="">– keine –</option>
        ${groups.map(g=>`<option value="${g.id}" ${event?.groupId===g.id?'selected':''}>${g.name}</option>`).join('')}
      </select>
      <label>${teacherLabel} auswählen</label>
      <div style="border:1px solid var(--color-border);border-radius:6px;padding:4px 0;max-height:180px;overflow-y:auto;background:var(--color-bg-elevated);">
        <div style="padding:6px 8px 4px;border-bottom:1px solid var(--color-border);">
          <input type="search" id="ef-trainer-search" placeholder="${teacherLabel} suchen..." style="margin-bottom:0;font-size:0.88rem;" />
        </div>
        <div id="ef-trainer-list" style="padding:4px 0;">${trainerListHtml}</div>
      </div>
      <label>Mindest-Teilnehmerzahl</label><input type="number" id="ef-min" value="${event?.minParticipants??0}" min="0" />
      <label>Anmeldefrist (Minuten vor Beginn)</label><input type="number" id="ef-deadline" value="${event?.signupDeadlineMinutes??60}" min="0" />
      <label>Anmeldemodus</label>
      <select id="ef-mode">
        <option value="opt_in"       ${currentMode==='opt_in'      ?'selected':''}>Anmeldebasiert – Mitglieder melden sich aktiv an</option>
        <option value="opt_out"      ${currentMode==='opt_out'     ?'selected':''}>Abmeldebasiert – Mitglieder sind standardmäßig angemeldet</option>
        <option value="confirmation" ${currentMode==='confirmation'?'selected':''}>Bestätigung – vorgemerkt, muss aktiv bestätigt werden</option>
      </select>
      <label>Wiederholung</label>
      <select id="ef-recurrence">
        <option value="none"     ${!event?.recurrence||event?.recurrence==='none'    ?'selected':''}>Einmalig</option>
        <option value="weekly"   ${event?.recurrence==='weekly'  ?'selected':''}>Wöchentlich</option>
        <option value="biweekly" ${event?.recurrence==='biweekly'?'selected':''}>Zweiwöchentlich</option>
        <option value="monthly"  ${event?.recurrence==='monthly' ?'selected':''}>Monatlich</option>
      </select>
      <label>Wiederholung bis</label><input type="date" id="ef-recurrence-end" value="${event?.recurrenceEnd||''}" />
      ${!isNew && event?.status !== 'cancelled' ? `
        <hr class="divider" />
        <div style="background:rgba(245,124,0,0.07);border-radius:8px;padding:12px;border:1px solid var(--color-warning,#f57c00);">
          <p style="margin:0 0 6px;font-weight:600;color:var(--color-warning,#f57c00);display:flex;align-items:center;gap:6px;"><span class="material-icons" style="font-size:18px;">block</span> Termin ausfallen lassen</p>
          <p class="text-muted" style="margin:0 0 8px;font-size:0.85rem;">Mitglieder sehen den Termin als ausgefallen.</p>
          <label>Begründung (optional)</label>
          <input type="text" id="ef-skip-reason" placeholder="z.B. Feiertag, kein ${teacherLabel} verfügbar..." value="${event?.skipReason||''}" />
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
            <button type="button" class="btn-danger" id="ef-skip-btn" style="padding:6px 16px;">
              ${event?.status==='skipped' ? 'Ausgefallen-Status aufheben' : 'Termin als ausgefallen markieren'}
            </button>
            ${isPartOfSeries && event?.status !== 'skipped' ? `
              <button type="button" class="btn-danger" id="ef-skip-following-btn" style="padding:6px 16px;display:inline-flex;align-items:center;gap:4px;">
                <span class="material-icons" style="font-size:15px;">event_busy</span> Diesen + nachfolgende ausfallen
              </button>
              <button type="button" class="btn-secondary" id="ef-delete-following-btn" style="padding:6px 16px;display:inline-flex;align-items:center;gap:4px;color:var(--color-error);">
                <span class="material-icons" style="font-size:15px;">delete_sweep</span> Nachfolgende löschen
              </button>` : ''}
          </div>
        </div>` : ''}
    `,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const title    = document.getElementById('ef-title')?.value.trim();
      const desc     = document.getElementById('ef-desc')?.value.trim();
      const startStr = document.getElementById('ef-start')?.value;
      const endStr   = document.getElementById('ef-end')?.value;
      const groupId  = document.getElementById('ef-group')?.value||null;
      const trainers = [...document.querySelectorAll('.trainer-pick-cb:checked')].map(cb => cb.dataset.tid);
      const minPart  = parseInt(document.getElementById('ef-min')?.value)||0;
      const deadline = parseInt(document.getElementById('ef-deadline')?.value)||60;
      const mode     = document.getElementById('ef-mode')?.value||'opt_in';
      const recurrence = document.getElementById('ef-recurrence')?.value||'none';
      const recEnd   = document.getElementById('ef-recurrence-end')?.value||null;
      if (!title||!startStr) { showToast('Titel und Startzeit erforderlich.','error'); return false; }
      const startTs = firebase.firestore.Timestamp.fromDate(new Date(startStr));
      const endTs   = endStr ? firebase.firestore.Timestamp.fromDate(new Date(endStr)) : null;
      const data = {
        title, description:desc||'', startTime:startTs, endTime:endTs, groupId, trainers,
        minParticipants:minPart, signupDeadlineMinutes:deadline, mode, recurrence,
        recurrenceEnd:recEnd, status:event?.status||'planned',
        directMembers:event?.directMembers||[],
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      };

      if (isNew) {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        if (recurrence!=='none'&&recEnd) {
          const instances = generateRecurringDates(new Date(startStr), endStr?new Date(endStr):null, recurrence, new Date(recEnd));
          const batch=firestore.batch(); const rgId=`rg_${Date.now()}`;
          instances.forEach(({start,end})=>{ const ref=firestore.collection('events').doc(); batch.set(ref,{...data,startTime:firebase.firestore.Timestamp.fromDate(start),endTime:end?firebase.firestore.Timestamp.fromDate(end):null,recurrenceGroup:rgId}); });
          await batch.commit(); showToast(`${instances.length} Wiederholungstermine angelegt.`,'success');
        } else {
          await firestore.collection('events').add(data);
          showToast('Termin angelegt.','success');
        }
        renderScheduleTab(parentEl);
        return;
      }

      // ── Bestehendes Event: Scope-Dialog wenn Serie
      if (isPartOfSeries) {
        const scope = await askRecurrenceScope();
        if (!scope) return false; // Abgebrochen

        const eventStartMs = event.startTime?.toMillis?.() ?? 0;

        if (scope === 'single') {
          await firestore.collection('events').doc(event.id).update(data);
          showToast('Termin aktualisiert (nur dieser Termin).','success');

        } else if (scope === 'following') {
          const toUpdate = seriesEvents.filter(e => (e.startTime?.toMillis?.()??0) >= eventStartMs);
          const diffMs   = new Date(startStr).getTime() - event.startTime.toDate().getTime();
          const batch    = firestore.batch();
          toUpdate.forEach(e => {
            const newStart = new Date(e.startTime.toDate().getTime() + diffMs);
            const newEnd   = e.endTime ? new Date(e.endTime.toDate().getTime() + diffMs) : null;
            batch.update(firestore.collection('events').doc(e.id), {
              ...data,
              startTime: firebase.firestore.Timestamp.fromDate(newStart),
              endTime:   newEnd ? firebase.firestore.Timestamp.fromDate(newEnd) : null
            });
          });
          await batch.commit();
          showToast(`${toUpdate.length} Termin(e) aktualisiert (dieser + nachfolgende).`,'success');

        } else if (scope === 'all') {
          const diffMs = new Date(startStr).getTime() - event.startTime.toDate().getTime();
          const batch  = firestore.batch();
          seriesEvents.forEach(e => {
            const newStart = new Date(e.startTime.toDate().getTime() + diffMs);
            const newEnd   = e.endTime ? new Date(e.endTime.toDate().getTime() + diffMs) : null;
            batch.update(firestore.collection('events').doc(e.id), {
              ...data,
              startTime: firebase.firestore.Timestamp.fromDate(newStart),
              endTime:   newEnd ? firebase.firestore.Timestamp.fromDate(newEnd) : null
            });
          });
          await batch.commit();
          showToast(`${seriesEvents.length} Termin(e) der Serie aktualisiert.`,'success');
        }
      } else {
        await firestore.collection('events').doc(event.id).update(data);
        showToast('Termin aktualisiert.','success');
      }
      renderScheduleTab(parentEl);
    }
  });

  setTimeout(() => {
    const searchEl = document.getElementById('ef-trainer-search');
    const listEl   = document.getElementById('ef-trainer-list');
    if (searchEl && listEl) {
      searchEl.oninput = () => {
        const q = searchEl.value.toLowerCase();
        listEl.querySelectorAll('.trainer-pick-row').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      };
      listEl.querySelectorAll('.trainer-pick-cb').forEach(cb => {
        cb.onchange = () => { cb.closest('.trainer-pick-row').style.background = cb.checked ? 'rgba(21,101,192,0.08)' : 'transparent'; };
      });
    }

    // ── Ausfallen-Button (einzelner Termin / ganzer Scope)
    const skipBtn = document.getElementById('ef-skip-btn');
    if (skipBtn) {
      skipBtn.onclick = async () => {
        const reason    = document.getElementById('ef-skip-reason')?.value.trim() || '';
        const isSkipped = event?.status === 'skipped';

        if (!isSkipped && isPartOfSeries) {
          const scope = await askRecurrenceScope();
          if (!scope) return;
          const eventStartMs = event.startTime?.toMillis?.() ?? 0;

          if (scope === 'single') {
            await firestore.collection('events').doc(event.id).update({
              status: 'skipped', skipReason: reason || firebase.firestore.FieldValue.delete(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } else if (scope === 'following') {
            const toSkip = seriesEvents.filter(e => (e.startTime?.toMillis?.()??0) >= eventStartMs);
            const batch  = firestore.batch();
            toSkip.forEach(e => batch.update(firestore.collection('events').doc(e.id), {
              status: 'skipped', skipReason: reason || firebase.firestore.FieldValue.delete(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }));
            await batch.commit();
            showToast(`${toSkip.length} Termin(e) als ausgefallen markiert.`, 'success');
          } else if (scope === 'all') {
            const batch = firestore.batch();
            seriesEvents.forEach(e => batch.update(firestore.collection('events').doc(e.id), {
              status: 'skipped', skipReason: reason || firebase.firestore.FieldValue.delete(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }));
            await batch.commit();
            showToast(`${seriesEvents.length} Termin(e) als ausgefallen markiert.`, 'success');
          }
        } else {
          await firestore.collection('events').doc(event.id).update({
            status:     isSkipped ? 'planned' : 'skipped',
            skipReason: isSkipped ? firebase.firestore.FieldValue.delete() : reason,
            updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
          });
          showToast(isSkipped ? 'Ausgefallen-Status aufgehoben.' : 'Termin als ausgefallen markiert.', 'success');
        }

        document.querySelector('.modal-overlay')?.remove();
        renderScheduleTab(parentEl);
      };
    }

    // ── "Diesen + nachfolgende ausfallen lassen"
    const skipFollowingBtn = document.getElementById('ef-skip-following-btn');
    if (skipFollowingBtn && isPartOfSeries) {
      skipFollowingBtn.onclick = async () => {
        const reason       = document.getElementById('ef-skip-reason')?.value.trim() || '';
        const eventStartMs = event.startTime?.toMillis?.() ?? 0;
        const toSkip       = seriesEvents.filter(e => (e.startTime?.toMillis?.()??0) >= eventStartMs);
        const batch        = firestore.batch();
        toSkip.forEach(e => batch.update(firestore.collection('events').doc(e.id), {
          status: 'skipped', skipReason: reason || firebase.firestore.FieldValue.delete(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
        await batch.commit();
        showToast(`${toSkip.length} Termin(e) als ausgefallen markiert.`, 'success');
        document.querySelector('.modal-overlay')?.remove();
        renderScheduleTab(parentEl);
      };
    }

    // ── "Nachfolgende löschen"
    const deleteFollowingBtn = document.getElementById('ef-delete-following-btn');
    if (deleteFollowingBtn && isPartOfSeries) {
      deleteFollowingBtn.onclick = () => {
        const eventStartMs  = event.startTime?.toMillis?.() ?? 0;
        // "Nachfolgende" = alle NACH diesem Termin (dieser selbst bleibt)
        const toDelete      = seriesEvents.filter(e => (e.startTime?.toMillis?.()??0) > eventStartMs);
        if (!toDelete.length) { showToast('Keine nachfolgenden Termine gefunden.', 'warning'); return; }
        showModal({
          title: 'Nachfolgende Termine löschen',
          body: `<p>Es werden <strong>${toDelete.length}</strong> nachfolgende Termin(e) dieser Serie endgültig gelöscht. Dieser Termin bleibt erhalten.</p>
                 <p class="text-muted">Diese Aktion kann nicht rückgängig gemacht werden.</p>`,
          confirmLabel: 'Löschen',
          onConfirm: async () => {
            for (let i=0; i<toDelete.length; i+=499) {
              const b = firestore.batch();
              toDelete.slice(i,i+499).forEach(e => b.delete(firestore.collection('events').doc(e.id)));
              await b.commit();
            }
            showToast(`${toDelete.length} nachfolgende Termin(e) gelöscht.`, 'success');
            document.querySelector('.modal-overlay')?.remove();
            renderScheduleTab(parentEl);
          }
        });
      };
    }
  }, 50);
}

function generateRecurringDates(startDate, endDate, recurrence, until) {
  const results=[]; let current=new Date(startDate); let currentEnd=endDate?new Date(endDate):null;
  const duration=currentEnd?currentEnd.getTime()-current.getTime():0;
  while(current<=until&&results.length<200){
    results.push({start:new Date(current),end:currentEnd?new Date(currentEnd):null});
    if(recurrence==='monthly') current.setMonth(current.getMonth()+1);
    else current.setDate(current.getDate()+(recurrence==='biweekly'?14:7));
    if(currentEnd) currentEnd=new Date(current.getTime()+duration);
  }
  return results;
}

function toDatetimeLocal(date) {
  const pad=n=>String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ===================== SETTINGS TAB ===================== */
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
          <option value="opt_in"       ${(!data.defaultMode||data.defaultMode==='opt_in')      ?'selected':''}>Anmeldebasiert – Mitglieder melden sich aktiv an</option>
          <option value="opt_out"      ${data.defaultMode==='opt_out'      ?'selected':''}>Abmeldebasiert – Mitglieder sind standardmäßig angemeldet</option>
          <option value="confirmation" ${data.defaultMode==='confirmation' ?'selected':''}>Bestätigung – vorgemerkt, muss aktiv bestätigt werden</option>
        </select>
        <label>Bestätigungsfenster (Minuten relativ zu Terminbeginn)</label>
        <p class="text-muted" style="margin:-4px 0 6px;font-size:0.84rem;">
          Deadline = Terminbeginn + dieser Wert.<br>
          <strong>Negativ</strong> (z.B. −30): Fenster schließt 30 Min <em>vor</em> Terminbeginn.<br>
          <strong>0</strong>: Fenster schließt genau zum Terminbeginn.<br>
          <strong>Positiv</strong> (z.B. 60): Fenster schließt 60 Min <em>nach</em> Terminbeginn.
        </p>
        <input type="number" id="cs-confirm-window" value="${data.confirmationWindowMinutes??60}" />
        <label>Termine-Vorschau (Tage in die Zukunft, Standard für alle Nutzer)</label>
        <input type="number" id="cs-lookahead" value="${data.defaultEventLookAhead??30}" min="1" max="365" />
        <label>Teilnehmer-Sichtbarkeit für Mitglieder</label>
        <select id="cs-vis">
          <option value="names" ${data.visibilityMode==='names'?'selected':''}>Namen anzeigen</option>
          <option value="count" ${!data.visibilityMode||data.visibilityMode==='count'?'selected':''}>Nur Anzahl</option>
          <option value="none"  ${data.visibilityMode==='none' ?'selected':''}>Nichts anzeigen</option>
        </select>
        <label>Rückzugsfenster für Mitglieder (Minuten nach Anmeldung)</label>
        <p class="text-muted" style="margin:-4px 0 6px;font-size:0.84rem;">Wie lange ein Mitglied seine Anmeldung zurückziehen kann. Einmalig pro Termin.</p>
        <input type="number" id="cs-withdraw-window" value="${data.withdrawWindowMinutes??60}" min="1" />
        <hr class="divider" />
        <h4>Rollen-Labels</h4>
        ${['admin','coordinator','teacher','member'].map(r=>`<label>${getRoleLabel(r)}</label><input type="text" id="rl-${r}" value="${data.roleLabels?.[r]||getRoleLabel(r)}" />`).join('')}
        <button class="btn-primary" id="cs-save" style="margin-top:4px;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">save</span>
          Einstellungen speichern
        </button>
      </div>`;
    el.querySelector('#cs-save').onclick = async () => {
      const updates = {
        defaultMinParticipants:       parseInt(document.getElementById('cs-min-part')?.value)||0,
        defaultSignupDeadlineMinutes: parseInt(document.getElementById('cs-signup-deadline')?.value)||60,
        defaultMode:                  document.getElementById('cs-mode')?.value||'opt_in',
        confirmationWindowMinutes:    parseInt(document.getElementById('cs-confirm-window')?.value) ?? 60,
        defaultEventLookAhead:        parseInt(document.getElementById('cs-lookahead')?.value)||30,
        visibilityMode:               document.getElementById('cs-vis')?.value||'count',
        withdrawWindowMinutes:        parseInt(document.getElementById('cs-withdraw-window')?.value)||60,
        roleLabels: {
          admin:       document.getElementById('rl-admin')?.value||'Admin',
          coordinator: document.getElementById('rl-coordinator')?.value||'Koordinator',
          teacher:     document.getElementById('rl-teacher')?.value||'Trainer',
          member:      document.getElementById('rl-member')?.value||'Mitglied'
        }
      };
      await firestore.collection('settings').doc('global').set(updates,{merge:true});
      window.roleLabels=updates.roleLabels; window.appSettings={...(window.appSettings||{}),...updates};
      showToast('Einstellungen gespeichert.','success');
    };
  } catch(e) { el.innerHTML='<p class="text-error">Fehler beim Laden.</p>'; }
}
