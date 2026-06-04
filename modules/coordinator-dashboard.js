let scheduleViewMode = 'list';

async function loadCoordinatorDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `
    <h2 style="margin-top:0;">Koordinator-Dashboard</h2>
    <div id="coord-system-messages-banner"></div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="users">Benutzer</button>
      <button class="tab-btn" data-tab="groups">Gruppen</button>
      <button class="tab-btn" data-tab="schedule">Terminplanung</button>
      <button class="tab-btn" data-tab="settings">Einstellungen</button>
      <button class="tab-btn" data-tab="messages">Nachrichten</button>
    </div>
    <div id="tab-users"></div>
    <div id="tab-groups" hidden></div>
    <div id="tab-schedule" hidden></div>
    <div id="tab-settings" hidden></div>
    <div id="tab-messages" hidden></div>
  `;

  _renderCoordSystemMessagesBanner(document.getElementById('coord-system-messages-banner'));

  const tabs   = { users: null, groups: null, schedule: null, settings: null, messages: null};
  const tabEls = {
    users:    document.getElementById('tab-users'),
    groups:   document.getElementById('tab-groups'),
    schedule: document.getElementById('tab-schedule'),
    settings: document.getElementById('tab-settings'),
    messages: document.getElementById('tab-messages')
  };
  const loaders = {
    users:    () => renderUsersTab(tabEls.users),
    groups:   () => renderGroupsTab(tabEls.groups),
    schedule: () => renderScheduleTab(tabEls.schedule),
    settings: () => renderCoordSettingsTab(tabEls.settings),
    messages: () => renderSystemMessagesTab(tabEls.messages)
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

/* ── systemMessages-Banner für Koordinatoren ─────────────────────────────────── */
async function _renderCoordSystemMessagesBanner(bannerEl) {
  if (!bannerEl) return;
  try {
    const uid = window.currentUser?.firebaseUser?.uid;
    if (!uid) return;

    const snap = await firestore.collection('systemMessages')
      .where('active', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const messages = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.recipients === 'all' || (d.recipients === 'users' && (d.recipientUsers || []).includes(uid))) {
        messages.push({ id: doc.id, ...d });
      }
    });

    if (!messages.length) { bannerEl.innerHTML = ''; return; }

    const typeStyles = {
      warning: { bg: 'rgba(245,124,0,0.10)', border: 'var(--color-warning,#f57c00)', icon: 'warning', iconColor: 'var(--color-warning,#f57c00)' },
      error:   { bg: 'rgba(211,47,47,0.08)',  border: 'var(--color-error,#d32f2f)',   icon: 'error',   iconColor: 'var(--color-error,#d32f2f)'   },
      info:    { bg: 'rgba(2,136,209,0.08)',   border: 'var(--color-primary)',         icon: 'info',    iconColor: 'var(--color-primary)'          },
      success: { bg: 'rgba(46,125,50,0.08)',   border: 'var(--color-success,#2e7d32)', icon: 'check_circle', iconColor: 'var(--color-success,#2e7d32)' },
    };

    bannerEl.innerHTML = messages.map(msg => {
      const s = typeStyles[msg.type] || typeStyles.info;
      return `
        <div data-sysmsg-id="${msg.id}" style="display:flex;align-items:flex-start;gap:10px;background:${s.bg};border-left:4px solid ${s.border};border-radius:6px;padding:10px 14px;margin-bottom:8px;flex-wrap:wrap;">
          <span class="material-icons" style="font-size:20px;color:${s.iconColor};flex-shrink:0;margin-top:1px;">${s.icon}</span>
          <div style="flex:1;min-width:0;">
            ${msg.title ? `<div style="font-weight:700;margin-bottom:2px;">${escapeHtml(msg.title)}</div>` : ''}
            <div style="font-size:0.88rem;color:var(--color-text);">${escapeHtml(msg.message || '')}</div>
          </div>
          <button data-dismiss-sysmsg="${msg.id}" style="background:none;border:none;cursor:pointer;padding:2px;flex-shrink:0;color:var(--color-text-muted);line-height:1;" title="Ausblenden">
            <span class="material-icons" style="font-size:18px;">close</span>
          </button>
        </div>`;
    }).join('');

    bannerEl.querySelectorAll('[data-dismiss-sysmsg]').forEach(btn => {
      btn.onclick = async () => {
        const msgId = btn.dataset.dismissSysmsg;
        try {
          await firestore.collection('systemMessages').doc(msgId).update({ active: false });
        } catch(e) { /* ignorieren falls keine Schreibrechte */ }
        const msgEl = bannerEl.querySelector(`[data-sysmsg-id="${msgId}"]`);
        if (msgEl) msgEl.remove();
      };
    });
  } catch(e) {
    console.warn('systemMessages-Banner konnte nicht geladen werden:', e);
  }
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

async function showUserForm(user, parentEl) {
  const isNew = !user;
  showModal({
    title: isNew ? 'Neuen Benutzer anlegen' : 'Benutzer bearbeiten',
    body: `
      <label>Anzeigename</label>
      <input type="text" id="uf-name" value="${user?.displayName||''}" />
      <label>E-Mail</label>
      <input type="email" id="uf-email" value="${user?.email||''}" ${!isNew ? 'readonly style="opacity:0.6;"' : ''} />
      ${isNew ? `<label>Passwort (temporär)</label><input type="password" id="uf-pw" placeholder="Mindestens 6 Zeichen" />` : ''}
      <label>Rollen</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
        ${['admin','coordinator','teacher','member'].map(r => `
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" name="uf-role" value="${r}" ${(user?.roles||[]).includes(r)?'checked':''} />
            ${getRoleLabel(r)}
          </label>`).join('')}
      </div>
      <label style="margin-top:8px;">Gruppen</label>
      <div id="uf-groups-loading" style="font-size:0.85rem;color:var(--color-text-muted);">Lade Gruppen...</div>
    `,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const name  = document.getElementById('uf-name').value.trim();
      const email = document.getElementById('uf-email').value.trim();
      const pw    = isNew ? document.getElementById('uf-pw')?.value : null;
      const roles = [...document.querySelectorAll('input[name="uf-role"]:checked')].map(i => i.value);
      const groupCheckboxes = document.querySelectorAll('input[name="uf-group"]');
      const groups = [...groupCheckboxes].filter(i => i.checked).map(i => i.value);

      if (!name) { showToast('Bitte Namen eingeben.', 'error'); return false; }
      if (isNew && !email) { showToast('Bitte E-Mail eingeben.', 'error'); return false; }
      if (isNew && (!pw || pw.length < 6)) { showToast('Passwort mind. 6 Zeichen.', 'error'); return false; }

      try {
        if (isNew) {
          const apiKey = window.FIREBASE_API_KEY;
          const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pw, returnSecureToken: true })
          });
          const data = await res.json();
          if (data.error) { showToast('Firebase-Fehler: ' + data.error.message, 'error'); return false; }
          await firestore.collection('users').doc(data.localId).set({ displayName: name, email, roles, groups });
          showToast('Benutzer angelegt.', 'success');
        } else {
          await firestore.collection('users').doc(user.id).update({ displayName: name, roles, groups });
          showToast('Benutzer aktualisiert.', 'success');
        }
        renderUsersTab(parentEl);
      } catch (e) {
        console.error(e);
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });

  try {
    const gSnap = await firestore.collection('groups').orderBy('name').get();
    const groupsContainer = document.getElementById('uf-groups-loading');
    if (!groupsContainer) return;
    const allGroups = [];
    gSnap.forEach(doc => allGroups.push({ id: doc.id, ...doc.data() }));
    if (!allGroups.length) { groupsContainer.textContent = 'Keine Gruppen vorhanden.'; return; }
    groupsContainer.id = 'uf-groups-list';
    groupsContainer.innerHTML = allGroups.map(g => `
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" name="uf-group" value="${g.id}" ${(user?.groups||[]).includes(g.id)?'checked':''} />
        ${g.name}
      </label>`).join('');
    groupsContainer.style.display = 'flex';
    groupsContainer.style.flexWrap = 'wrap';
    groupsContainer.style.gap = '8px';
    groupsContainer.style.marginTop = '4px';
  } catch(e) {
    const el2 = document.getElementById('uf-groups-loading');
    if (el2) el2.textContent = 'Gruppen konnten nicht geladen werden.';
  }
}

async function confirmDeleteUser(user, parentEl) {
  showModal({
    title: 'Benutzer löschen',
    body: `<p>Soll <strong>${user.displayName || user.email}</strong> wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden.</p>`,
    confirmLabel: 'Löschen',
    onConfirm: async () => {
      try {
        const gSnap = await firestore.collection('groups').get();
        const batch = firestore.batch();
        gSnap.forEach(doc => {
          const members = (doc.data().members || []).filter(id => id !== user.id);
          batch.update(doc.ref, { members });
        });
        await batch.commit();
        await firestore.collection('users').doc(user.id).delete();
        showToast('Benutzer gelöscht.', 'success');
        renderUsersTab(parentEl);
      } catch(e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
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

    const usersSnap = await firestore.collection('users').orderBy('displayName').get();
    const allUsers = [];
    usersSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
        <h3 style="margin:0;">Gruppen (${groups.length})</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div style="position:relative;">
            <span class="material-icons" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:16px;color:var(--color-text-muted);pointer-events:none;">search</span>
            <input type="text" id="group-search" placeholder="Gruppe suchen…" style="padding:6px 10px 6px 30px;border:1px solid var(--color-border);border-radius:6px;font-size:0.88rem;background:var(--color-surface);color:var(--color-text);width:200px;" />
          </div>
          <button class="btn-primary" id="add-group-btn">+ Gruppe anlegen</button>
        </div>
      </div>
      <div id="groups-list">
        ${renderGroupCards(groups, allUsers)}
      </div>`;

    el.querySelector('#group-search').addEventListener('input', function() {
      const q = this.value.toLowerCase();
      const filtered = groups.filter(g =>
        (g.name||'').toLowerCase().includes(q) ||
        (g.description||'').toLowerCase().includes(q)
      );
      el.querySelector('#groups-list').innerHTML = renderGroupCards(filtered, allUsers);
      attachGroupCardEvents(filtered, groups, allUsers, el);
    });

    el.querySelector('#add-group-btn').onclick = () => showGroupForm(null, allUsers, el);
    attachGroupCardEvents(groups, groups, allUsers, el);
  } catch (e) {
    console.error(e);
    el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
  }
}

function renderGroupCards(groups, allUsers) {
  if (!groups.length) return '<p class="text-muted" style="margin-top:16px;">Keine Gruppen gefunden.</p>';
  return groups.map(g => {
    const members = (g.members || []).map(uid => allUsers.find(u => u.id === uid)).filter(Boolean);
    const trainers = allUsers.filter(u => (u.roles||[]).includes('teacher') && (g.trainers||[]).includes(u.id));
    return `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div>
            <strong>${g.name}</strong>
            ${g.description ? `<p class="text-muted" style="margin:4px 0 0;font-size:0.88rem;">${g.description}</p>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn-secondary" data-gid="${g.id}" data-action="edit" style="padding:4px 10px;">Bearbeiten</button>
            <button class="btn-danger"    data-gid="${g.id}" data-action="del"  style="padding:4px 10px;">Löschen</button>
          </div>
        </div>
        ${trainers.length ? `<div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-size:0.78rem;color:var(--color-text-muted);">${getRoleLabel('teacher')}:</span>${trainers.map(t=>`<span class="chip" style="background:var(--color-primary-highlight);">${t.displayName||t.email}</span>`).join('')}</div>` : ''}
        <div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:0.78rem;color:var(--color-text-muted);">Mitglieder:</span>
          ${members.length
            ? members.map(u => `<span class="chip">${u.displayName || u.email}</span>`).join('')
            : '<span class="text-muted" style="font-size:0.85rem;">Keine</span>'}
        </div>
      </div>`;
  }).join('');
}

function attachGroupCardEvents(filteredGroups, allGroups, allUsers, el) {
  el.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.onclick = () => showGroupForm(allGroups.find(g => g.id === btn.dataset.gid), allUsers, el);
  });
  el.querySelectorAll('[data-action="del"]').forEach(btn => {
    btn.onclick = () => confirmDeleteGroup(allGroups.find(g => g.id === btn.dataset.gid), el);
  });
}

async function showGroupForm(group, allUsers, parentEl) {
  const isNew = !group;
  const members  = allUsers.filter(u => (u.roles||[]).includes('member') || !(u.roles||[]).some(r=>['teacher','coordinator','admin'].includes(r)));
  const trainers = allUsers.filter(u => (u.roles||[]).includes('teacher'));

  const searchableList = (searchId, listId, items, name, selected) => `
    <div style="position:relative;margin-bottom:6px;">
      <span class="material-icons" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--color-text-muted);pointer-events:none;">search</span>
      <input type="text" id="${searchId}" placeholder="Suchen…" style="width:100%;padding:5px 8px 5px 28px;border:1px solid var(--color-border);border-radius:5px;font-size:0.83rem;background:var(--color-surface);color:var(--color-text);" />
    </div>
    <div id="${listId}" style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;padding:2px 0;">
      ${items.map(u => `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.88rem;padding:2px 0;">
          <input type="checkbox" name="${name}" value="${u.id}" ${(selected||[]).includes(u.id)?'checked':''} />
          ${u.displayName||u.email}
        </label>`).join('')}
    </div>`;

  showModal({
    title: isNew ? 'Neue Gruppe anlegen' : 'Gruppe bearbeiten',
    body: `
      <label>Gruppenname</label>
      <input type="text" id="gf-name" value="${group?.name||''}" />
      <label>Beschreibung</label>
      <input type="text" id="gf-desc" value="${group?.description||''}" />
      <label style="margin-top:10px;">${getRoleLabel('teacher')} (${trainers.length})</label>
      ${searchableList('gf-trainer-search','gf-trainer-list', trainers, 'gf-trainer', group?.trainers||[])}
      <label style="margin-top:10px;">Mitglieder (${allUsers.length})</label>
      ${searchableList('gf-member-search','gf-member-list', allUsers, 'gf-member', group?.members||[])}
    `,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const name     = document.getElementById('gf-name').value.trim();
      const desc     = document.getElementById('gf-desc').value.trim();
      const members  = [...document.querySelectorAll('input[name="gf-member"]:checked')].map(i => i.value);
      const trainersSel = [...document.querySelectorAll('input[name="gf-trainer"]:checked')].map(i => i.value);
      if (!name) { showToast('Bitte Gruppenname eingeben.', 'error'); return false; }
      try {
        if (isNew) {
          await firestore.collection('groups').add({ name, description: desc, members, trainers: trainersSel });
        } else {
          await firestore.collection('groups').doc(group.id).update({ name, description: desc, members, trainers: trainersSel });
        }
        showToast(isNew ? 'Gruppe angelegt.' : 'Gruppe gespeichert.', 'success');
        renderGroupsTab(parentEl);
      } catch(e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });

  requestAnimationFrame(() => {
    const wireSearch = (inputId, listId, items, name, selected) => {
      const input = document.getElementById(inputId);
      const list  = document.getElementById(listId);
      if (!input || !list) return;
      input.addEventListener('input', function() {
        const q = this.value.toLowerCase();
        const filtered = items.filter(u => (u.displayName||u.email||'').toLowerCase().includes(q));
        const checked = new Set([...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i=>i.value));
        list.innerHTML = filtered.map(u => `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.88rem;padding:2px 0;">
            <input type="checkbox" name="${name}" value="${u.id}" ${checked.has(u.id)?'checked':''} />
            ${u.displayName||u.email}
          </label>`).join('');
      });
    };
    wireSearch('gf-trainer-search','gf-trainer-list', trainers, 'gf-trainer', group?.trainers||[]);
    wireSearch('gf-member-search', 'gf-member-list',  allUsers, 'gf-member',  group?.members||[]);
  });
}

function confirmDeleteGroup(group, parentEl) {
  showModal({
    title: 'Gruppe löschen',
    body: `<p>Soll die Gruppe <strong>${group.name}</strong> wirklich gelöscht werden?</p>`,
    confirmLabel: 'Löschen',
    onConfirm: async () => {
      try {
        await firestore.collection('groups').doc(group.id).delete();
        showToast('Gruppe gelöscht.', 'success');
        renderGroupsTab(parentEl);
      } catch(e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });
}

/* ===================== SCHEDULE TAB ===================== */

/* ── Auto-Absage: offene Anfragen nach Frist als abwesend markieren ─────────── */
async function _checkAutoCancelRequests() {
  try {
    const fristMin = window.appSettings?.autoCancelRequestMinutes ?? 0;
    if (!fristMin || fristMin <= 0) return;

    const now = new Date();
    const cutoff = new Date(now.getTime() - fristMin * 60 * 1000);

    const evSnap = await firestore.collection('events')
      .where('startTime', '<', cutoff)
      .get();
    if (evSnap.empty) return;

    const eventIds = [];
    evSnap.forEach(doc => eventIds.push(doc.id));

    const chunks = [];
    for (let i = 0; i < eventIds.length; i += 10) chunks.push(eventIds.slice(i, i + 10));

    for (const chunk of chunks) {
      const regSnap = await firestore.collection('registrations')
        .where('eventId', 'in', chunk)
        .where('status', '==', 'requested')
        .get();
      if (regSnap.empty) continue;
      const batch = firestore.batch();
      regSnap.forEach(doc => batch.update(doc.ref, { status: 'absent', autoCancelled: true }));
      await batch.commit();
    }
  } catch (e) {
    console.warn('_checkAutoCancelRequests fehlgeschlagen:', e);
  }
}

async function renderScheduleTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Termine...</div>`;
  try {
    await _checkAutoCancelRequests();

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
    // Gruppen global verfügbar machen (für substitution.js)
    window._allGroups = groups;

    // ── Kein-Betreuer-Alerts ────────────────────────────────────────────────
    const alertSnap = await firestore.collection('systemMessages')
      .where('active', '==', true)
      .where('_msgType', '==', 'no_trainer_alert')
      .get();
    const alertEventIds = new Set();
    alertSnap.forEach(doc => {
      const eid = doc.data()._eventId;
      if (eid) alertEventIds.add(eid);
    });

    // ── Vertretungsanfragen-Alerts (pending) ────────────────────────────────
    const subSnap = await firestore.collection('systemMessages')
      .where('active', '==', true)
      .where('_msgType', '==', 'substitution')
      .get();
    const substitutionEventIds = new Set();
    subSnap.forEach(doc => {
      const eid = doc.data()._eventId;
      if (eid) substitutionEventIds.add(eid);
    });

    // ── Akzeptierte Vertretungen ─────────────────────────────────────────────
    // Map: eventId → { trainerName, trainerUid, note }
    const acceptedSnap = await firestore.collection('substitution_requests')
      .where('status', '==', 'accepted')
      .get();
    const substitutionAcceptedMap = new Map();
    acceptedSnap.forEach(doc => {
      const d = doc.data();
      if (d.eventId) {
        substitutionAcceptedMap.set(d.eventId, {
          trainerName: d.requestedToName || '–',
          trainerUid:  d.requestedTo     || null,
          requestedByName: d.requestedByName || '–',
          note:        d.note            || ''
        });
      }
    });

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <h3 style="margin:0;">Termine</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div id="bulk-actions" style="display:none;gap:6px;align-items:center;">
            <span id="bulk-count" style="font-size:0.85rem;color:var(--color-text-muted);white-space:nowrap;"></span>
            <button id="sch-skip-selected" class="btn-secondary" style="padding:6px 14px;display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:16px;">event_busy</span> Ausfallen lassen
            </button>
            <button id="sch-unskip-selected" class="btn-secondary" style="padding:6px 14px;display:inline-flex;align-items:center;gap:4px;">
              <span class="material-icons" style="font-size:16px;">event_available</span> Ausfall aufheben
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

    const contentEl    = el.querySelector('#schedule-content');
    const bulkBar      = el.querySelector('#bulk-actions');
    const bulkCount    = el.querySelector('#bulk-count');
    const skipSelBtn   = el.querySelector('#sch-skip-selected');
    const unskipSelBtn = el.querySelector('#sch-unskip-selected');
    const delSelBtn    = el.querySelector('#sch-delete-selected');

    const renderView = () => scheduleViewMode === 'list'
      ? renderEventList(contentEl, events, groups, el, bulkBar, bulkCount, skipSelBtn, unskipSelBtn, delSelBtn, alertEventIds, substitutionEventIds, substitutionAcceptedMap)
      : renderCalendarView(contentEl, events, groups, el);

    el.querySelector('#view-list').onclick = () => { scheduleViewMode='list'; el.querySelector('#view-list').classList.add('active'); el.querySelector('#view-calendar').classList.remove('active'); renderView(); };
    el.querySelector('#view-calendar').onclick = () => { scheduleViewMode='calendar'; el.querySelector('#view-calendar').classList.add('active'); el.querySelector('#view-list').classList.remove('active'); renderView(); };
    el.querySelector('#add-event-btn').onclick = () => showEventForm(null, groups, el);
    renderView();
  } catch (e) { console.error(e); el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>'; }
}

/* ── Wiederholungs-Scope-Dialog ─────────────────────────────────────────────── */
function askRecurrenceScope(eventDate) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,0.45)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999
    });
    const dateStr = eventDate ? ` (${formatDateTime(eventDate)})` : '';
    overlay.innerHTML = `
      <div class="card" style="max-width:420px;width:92%;margin:0;">
        <h3 style="margin-top:0;">Terminwiederholung bearbeiten</h3>
        <p style="color:var(--color-text-muted);font-size:0.92rem;margin-bottom:12px;">Für welche Termine sollen die Änderungen übernommen werden?</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn-secondary" id="scope-single" style="justify-content:flex-start;gap:10px;padding:10px 14px;text-align:left;">
            <span class="material-icons" style="font-size:20px;color:var(--color-primary);flex-shrink:0;">event</span>
            <div><strong>Nur diesen Termin</strong>${dateStr}<div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:2px;">Alle anderen Termine bleiben unverändert</div></div>
          </button>
          <button class="btn-secondary" id="scope-following" style="justify-content:flex-start;gap:10px;padding:10px 14px;text-align:left;">
            <span class="material-icons" style="font-size:20px;color:var(--color-primary);flex-shrink:0;">event_repeat</span>
            <div><strong>Diesen und alle folgenden Termine</strong><div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:2px;">Ändert diesen Termin und alle späteren in der Reihe</div></div>
          </button>
          <button class="btn-secondary" id="scope-all" style="justify-content:flex-start;gap:10px;padding:10px 14px;text-align:left;">
            <span class="material-icons" style="font-size:20px;color:var(--color-primary);flex-shrink:0;">calendar_month</span>
            <div><strong>Alle Termine der Reihe</strong><div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:2px;">Ändert jeden Termin mit gleicher recurrenceId</div></div>
          </button>
          <button class="btn-text" id="scope-cancel" style="margin-top:4px;">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#scope-single').onclick   = () => { overlay.remove(); resolve('single'); };
    overlay.querySelector('#scope-following').onclick = () => { overlay.remove(); resolve('following'); };
    overlay.querySelector('#scope-all').onclick       = () => { overlay.remove(); resolve('all'); };
    overlay.querySelector('#scope-cancel').onclick    = () => { overlay.remove(); resolve(null); };
  });
}

/* ── Ausfallen-lassen-Dialog ────────────────────────────────────────────────── */
async function confirmSkipEvents(selectedIds, events, parentEl) {
  const toSkip = events.filter(e => selectedIds.has(e.id) && e.status !== 'skipped');
  const already = selectedIds.size - toSkip.length;
  if (!toSkip.length) { showToast('Alle gewählten Termine sind bereits ausgefallen.', 'info'); return; }

  showModal({
    title: `${toSkip.length} Termin${toSkip.length>1?'e':''} ausfallen lassen`,
    body: `
      <p style="margin-top:0;">${already>0?`<em>${already} Termin${already>1?'e sind':' ist'} bereits ausgefallen und wird übersprungen.</em><br><br>`:''}Bitte gib eine Begründung für den Ausfall ein:</p>
      <label>Begründung</label>
      <input type="text" id="skip-reason" placeholder="z.B. Krankheit, Raumausfall…" style="width:100%;" />
    `,
    confirmLabel: 'Ausfallen lassen',
    onConfirm: async () => {
      const reason = document.getElementById('skip-reason').value.trim();
      if (!reason) { showToast('Bitte eine Begründung eingeben.', 'error'); return false; }
      try {
        const chunks = [];
        for (let i = 0; i < toSkip.length; i += 500) chunks.push(toSkip.slice(i, i+500));
        for (const chunk of chunks) {
          const b = firestore.batch();
          chunk.forEach(ev => b.update(firestore.collection('events').doc(ev.id), { status: 'skipped', skipReason: reason }));
          await b.commit();
        }
        showToast(`${toSkip.length} Termin${toSkip.length>1?'e':''} als ausgefallen markiert.`, 'success');
        renderScheduleTab(parentEl);
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); return false; }
    }
  });
}

/* ── Ausfall-aufheben-Dialog ────────────────────────────────────────────────── */
async function confirmUnskipEvents(selectedIds, events, parentEl) {
  const toUnskip = events.filter(e => selectedIds.has(e.id) && e.status === 'skipped');
  if (!toUnskip.length) { showToast('Keine ausgefallenen Termine in der Auswahl.', 'info'); return; }

  showModal({
    title: `Ausfall bei ${toUnskip.length} Termin${toUnskip.length>1?'en':''} aufheben`,
    body: `<p>Soll der Ausfall bei den gewählten Terminen wirklich aufgehoben werden?</p>`,
    confirmLabel: 'Ausfall aufheben',
    onConfirm: async () => {
      try {
        const chunks = [];
        for (let i = 0; i < toUnskip.length; i += 500) chunks.push(toUnskip.slice(i, i+500));
        for (const chunk of chunks) {
          const batch = firestore.batch();
          chunk.forEach(ev => batch.update(firestore.collection('events').doc(ev.id), {
            status: firebase.firestore.FieldValue.delete(),
            skipReason: firebase.firestore.FieldValue.delete()
          }));
          await batch.commit();
        }
        showToast(`Ausfall bei ${toUnskip.length} Termin${toUnskip.length>1?'en':''} aufgehoben.`, 'success');
        renderScheduleTab(parentEl);
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); return false; }
    }
  });
}

/* ── Löschen-Dialog ─────────────────────────────────────────────────────────── */
async function confirmDeleteEvents(selectedIds, events, parentEl) {
  const toDelete = events.filter(e => selectedIds.has(e.id));
  if (!toDelete.length) return;

  showModal({
    title: `${toDelete.length} Termin${toDelete.length>1?'e':''} löschen`,
    body: `<p>Sollen die gewählten Termine wirklich <strong>dauerhaft gelöscht</strong> werden? Alle Anmeldungen gehen verloren.</p>`,
    confirmLabel: 'Löschen',
    onConfirm: async () => {
      try {
        const chunks = [];
        for (let i = 0; i < toDelete.length; i += 500) chunks.push(toDelete.slice(i, i+500));
        for (const chunk of chunks) {
          const b = firestore.batch();
          chunk.forEach(ev => b.delete(firestore.collection('events').doc(ev.id)));
          await b.commit(); }
        showToast(`${toDelete.length} Termin${toDelete.length>1?'e':''} gelöscht.`, 'success');
        renderScheduleTab(parentEl);
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); return false; }
    }
  });
}

/* ── Terminliste ──────────────────────────────────────────────────────────── */
function renderEventList(
  el, events, groups, parentEl,
  bulkBar, bulkCount, skipSelBtn, unskipSelBtn, delSelBtn,
  alertEventIds = new Set(),
  substitutionEventIds = new Set(),
  substitutionAcceptedMap = new Map()
) {
  const selected = new Set();

  const updateBulk = () => {
    const n = selected.size;
    bulkBar.style.display = n > 0 ? 'flex' : 'none';
    if (bulkCount) bulkCount.textContent = `${n} ausgewählt`;
  };

  if (skipSelBtn)   skipSelBtn.onclick   = () => confirmSkipEvents(selected, events, parentEl);
  if (unskipSelBtn) unskipSelBtn.onclick = () => confirmUnskipEvents(selected, events, parentEl);
  if (delSelBtn)    delSelBtn.onclick    = () => confirmDeleteEvents(selected, events, parentEl);

  if (!events.length) {
    el.innerHTML = '<p class="text-muted" style="margin-top:16px;">Keine Termine vorhanden.</p>';
    return;
  }

  const groupMap = {};
  groups.forEach(g => groupMap[g.id] = g.name);

  // Sortierzustand
  let sortCol = 'date';   // 'date' | 'title' | 'group'
  let sortDir = 'desc';   // 'asc' | 'desc'

  const getSortedEvents = (list) => [...list].sort((a, b) => {
    let valA, valB;
    if (sortCol === 'date') {
      valA = (a.startTime?.toDate ? a.startTime.toDate() : new Date(a.startTime)).getTime();
      valB = (b.startTime?.toDate ? b.startTime.toDate() : new Date(b.startTime)).getTime();
    } else if (sortCol === 'title') {
      valA = (a.title || '').toLowerCase();
      valB = (b.title || '').toLowerCase();
    } else if (sortCol === 'group') {
      valA = (groupMap[a.groupId] || '').toLowerCase();
      valB = (groupMap[b.groupId] || '').toLowerCase();
    }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const groupOptions = groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <div style="position:relative;">
        <span class="material-icons" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:16px;color:var(--color-text-muted);pointer-events:none;">search</span>
        <input type="text" id="ev-search" placeholder="Titel suchen…" style="padding:6px 10px 6px 30px;border:1px solid var(--color-border);border-radius:6px;font-size:0.88rem;background:var(--color-surface);color:var(--color-text);width:200px;" />
      </div>
      <select id="ev-filter-group" style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:0.88rem;background:var(--color-surface);color:var(--color-text);">
        <option value="">Alle Gruppen</option>
        ${groupOptions}
      </select>
      <select id="ev-filter-status" style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:0.88rem;background:var(--color-surface);color:var(--color-text);">
        <option value="">Alle Status</option>
        <option value="active">Aktiv</option>
        <option value="skipped">Ausgefallen</option>
      </select>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.88rem;color:var(--color-text-muted);margin-left:auto;">
        <input type="checkbox" id="sel-all" /> Alle auswählen
      </label>
    </div>
    <div style="width:100%;overflow-x:auto;">
      <table style="width:100%;min-width:680px;">
        <thead>
          <tr>
            <th style="width:32px;"></th>
            <th class="sortable-header" data-sort="title" style="cursor:pointer;user-select:none;">Titel <span class="sort-indicator" data-col="title"></span></th>
            <th class="sortable-header" data-sort="date"  style="cursor:pointer;user-select:none;">Datum <span class="sort-indicator" data-col="date"></span></th>
            <th class="sortable-header" data-sort="group" style="cursor:pointer;user-select:none;">Gruppe <span class="sort-indicator" data-col="group"></span></th>
            <th>Modus</th>
            <th>Status</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody id="events-tbody"></tbody>
      </table>
    </div>`;

  const tbody    = el.querySelector('#events-tbody');
  const searchEl = el.querySelector('#ev-search');
  const groupFil = el.querySelector('#ev-filter-group');
  const statFil  = el.querySelector('#ev-filter-status');

  const updateSortIndicators = () => {
    el.querySelectorAll('.sort-indicator').forEach(span => {
      const col = span.dataset.col;
      span.textContent = col === sortCol ? (sortDir === 'asc' ? '▲' : '▼') : '';
    });
  };

  /* ── Detail-Popup für akzeptierte Vertretung ──────────────────────────── */
  const showSubstitutionDetail = (info, anchorEl) => {
    document.getElementById('sub-detail-popup')?.remove();

    const popup = document.createElement('div');
    popup.id = 'sub-detail-popup';
    Object.assign(popup.style, {
      position: 'fixed',
      zIndex: '9999',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      padding: '12px 16px',
      minWidth: '220px',
      maxWidth: '300px',
      fontSize: '0.88rem',
      lineHeight: '1.5'
    });
    popup.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <span class="material-icons" style="font-size:18px;color:var(--color-success,#2e7d32);">check_circle</span>
        <strong style="font-size:0.92rem;">Vertretung bestätigt</strong>
        <button id="sub-popup-close" style="margin-left:auto;background:none;border:none;cursor:pointer;padding:0;color:var(--color-text-muted);line-height:1;">
          <span class="material-icons" style="font-size:16px;">close</span>
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div><span style="color:var(--color-text-muted);">Vertretung durch:</span><br><strong>${escapeHtml(info.trainerName)}</strong></div>
        <div style="margin-top:2px;"><span style="color:var(--color-text-muted);">Angefragt von:</span><br>${escapeHtml(info.requestedByName)}</div>
        ${info.note ? `<div style="margin-top:4px;padding-top:6px;border-top:1px solid var(--color-border);color:var(--color-text-muted);font-style:italic;">${escapeHtml(info.note)}</div>` : ''}
      </div>`;

    document.body.appendChild(popup);

    const rect = anchorEl.getBoundingClientRect();
    const popupW = 300;
    let left = rect.left;
    if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
    popup.style.left = `${Math.max(8, left)}px`;
    popup.style.top  = `${rect.bottom + 6}px`;

    const close = () => popup.remove();
    popup.querySelector('#sub-popup-close').onclick = close;

    const outsideClick = (e) => {
      if (!popup.contains(e.target) && e.target !== anchorEl) {
        close();
        document.removeEventListener('click', outsideClick, true);
      }
    };
    setTimeout(() => document.addEventListener('click', outsideClick, true), 100);
  };

  const renderRows = () => {
    const q       = searchEl.value.toLowerCase();
    const gFilter = groupFil.value;
    const sFilter = statFil.value;
    tbody.innerHTML = '';

    const filtered = events.filter(ev => {
      const matchTitle  = !q       || (ev.title||'').toLowerCase().includes(q);
      const matchGroup  = !gFilter || ev.groupId === gFilter;
      const isSkipped   = ev.status === 'skipped';
      const matchStatus = !sFilter || (sFilter==='skipped' ? isSkipped : !isSkipped);
      return matchTitle && matchGroup && matchStatus;
    });

    const visible = getSortedEvents(filtered);

    if (!visible.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-muted);">Keine Termine gefunden.</td></tr>`;
      return;
    }

    visible.forEach(ev => {
      const startDate  = ev.startTime?.toDate ? ev.startTime.toDate() : new Date(ev.startTime);
      const isSkipped  = ev.status === 'skipped';
      const accepted   = substitutionAcceptedMap.get(ev.id);
      const hasAccepted = !!accepted && !isSkipped;
      const hasAlert   = alertEventIds.has(ev.id) && !hasAccepted;
      const hasSub     = substitutionEventIds.has(ev.id) && !hasAccepted;

      const row = document.createElement('tr');

      if (isSkipped) row.style.opacity = '0.6';

      if (hasAccepted) {
        row.style.background = 'rgba(46,125,50,0.06)';
        row.style.borderLeft = '3px solid var(--color-success,#2e7d32)';
      } else if (hasAlert) {
        row.style.background = 'rgba(245,124,0,0.08)';
        row.style.borderLeft = '3px solid var(--color-warning,#f57c00)';
      } else if (hasSub) {
        row.style.background = 'rgba(2,136,209,0.07)';
        row.style.borderLeft = '3px solid var(--color-primary)';
      }

      const noTrainerBadge = hasAlert
        ? `<span class="chip chip-warning" style="font-size:0.72rem;display:inline-flex;align-items:center;gap:3px;vertical-align:middle;margin-left:4px;"><span class="material-icons" style="font-size:12px;">warning</span>Kein Betreuer</span>`
        : '';

      const subBadge = hasSub
        ? `<span class="chip" style="font-size:0.72rem;display:inline-flex;align-items:center;gap:3px;vertical-align:middle;margin-left:4px;background:var(--color-primary-highlight);color:var(--color-primary);border:1px solid var(--color-primary);"><span class="material-icons" style="font-size:12px;">swap_horiz</span>Vertretung angefragt</span>`
        : '';

      const infoBtn = hasAccepted
        ? `<button class="sub-info-btn" title="Vertretungsdetails anzeigen" style="background:none;border:none;cursor:pointer;padding:0 2px;vertical-align:middle;margin-left:4px;color:var(--color-success,#2e7d32);line-height:1;">
             <span class="material-icons" style="font-size:16px;">info</span>
           </button>`
        : '';

      row.innerHTML = `
        <td><input type="checkbox" class="ev-check" data-id="${ev.id}" ${selected.has(ev.id) ? 'checked' : ''} /></td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${isSkipped ? '<span class="material-icons" style="font-size:14px;color:var(--color-error);" title="Ausgefallen">event_busy</span>' : ''}
            <span style="${isSkipped?'text-decoration:line-through;':''}">${ev.title||'(kein Titel)'}</span>
            ${ev.recurrenceId ? '<span class="chip" style="font-size:0.72rem;padding:1px 5px;">Reihe</span>' : ''}
            ${noTrainerBadge}
            ${subBadge}
            ${infoBtn}
          </div>
          ${isSkipped && ev.skipReason ? `<div style="font-size:0.78rem;color:var(--color-text-muted);margin-top:2px;">Grund: ${ev.skipReason}</div>` : ''}
          ${hasAccepted ? `<div style="font-size:0.78rem;color:var(--color-success,#2e7d32);margin-top:2px;"><span class="material-icons" style="font-size:12px;vertical-align:middle;">check_circle</span> Vertretung: ${escapeHtml(accepted.trainerName)}</div>` : ''}
        </td>
        <td style="white-space:nowrap;">${formatDateTime(startDate)}</td>
        <td>${groupMap[ev.groupId] || '–'}</td>
        <td><span class="chip" style="font-size:0.78rem;">${translateMode(ev.mode||'open')}</span></td>
        <td>${isSkipped ? '<span style="color:var(--color-error);font-size:0.82rem;">Ausgefallen</span>' : '<span style="color:var(--color-success);font-size:0.82rem;">Aktiv</span>'}</td>
        <td style="white-space:nowrap;">
          <button class="btn-secondary" data-action="edit" style="padding:4px 8px;font-size:0.82rem;">Bearbeiten</button>
          <button class="btn-secondary" data-action="sub" title="Vertretung anfragen"
            style="padding:4px 8px;font-size:0.82rem;margin-left:4px;${isSkipped?'opacity:0.4;pointer-events:none;':''}">
            <span class="material-icons" style="font-size:14px;vertical-align:middle;">swap_horiz</span> Vertretung
          </button>
          <button class="btn-danger" data-action="del" style="padding:4px 8px;font-size:0.82rem;margin-left:4px;">Löschen</button>
        </td>`;

      row.querySelector('[data-action="edit"]').onclick = () => showEventForm(ev, groups, parentEl);
      row.querySelector('[data-action="del"]').onclick  = () => confirmDeleteEvents(new Set([ev.id]), events, parentEl);
      if (!isSkipped) {
        row.querySelector('[data-action="sub"]').onclick = () => openSubstitutionRequestModal(ev);
      }
      if (hasAccepted) {
        const infoBtnEl = row.querySelector('.sub-info-btn');
        if (infoBtnEl) {
          infoBtnEl.onclick = (e) => {
            e.stopPropagation();
            showSubstitutionDetail(accepted, infoBtnEl);
          };
        }
      }
      row.querySelector('.ev-check').onchange = function() {
        this.checked ? selected.add(ev.id) : selected.delete(ev.id);
        updateBulk();
      };
      tbody.appendChild(row);
    });

    updateBulk();
  };

  el.querySelectorAll('.sortable-header').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = col === 'date' ? 'desc' : 'asc';
      }
      updateSortIndicators();
      renderRows();
    });
  });

  searchEl.addEventListener('input', renderRows);
  groupFil.addEventListener('change', renderRows);
  statFil.addEventListener('change', renderRows);

  el.querySelector('#sel-all').onchange = function() {
    el.querySelectorAll('.ev-check').forEach(cb => {
      cb.checked = this.checked;
      this.checked ? selected.add(cb.dataset.id) : selected.delete(cb.dataset.id);
    });
    updateBulk();
  };

  updateSortIndicators();
  renderRows();
}

function translateMode(mode) {
  return { open:'Aktiv anmelden', closed:'Abmeldebasiert', confirmation:'Bestätigung' }[mode] || mode;
}

/* ── Kalenderansicht ──────────────────────────────────────────────────────────── */
function renderCalendarView(el, events, groups, parentEl) {
  const groupMap = {};
  groups.forEach(g => groupMap[g.id] = g.name);

  const now = new Date();
  let viewYear  = now.getFullYear();
  let viewMonth = now.getMonth();

  function render() {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay  = new Date(viewYear, viewMonth+1, 0);
    const startDow = (firstDay.getDay() + 6) % 7;

    const monthEvents = events.filter(ev => {
      const d = ev.startTime?.toDate ? ev.startTime.toDate() : new Date(ev.startTime);
      return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
    });

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <button class="btn-secondary" id="cal-prev" style="padding:4px 12px;">&lsaquo;</button>
        <strong style="min-width:140px;text-align:center;">${firstDay.toLocaleString('de-DE',{month:'long',year:'numeric'})}</strong>
        <button class="btn-secondary" id="cal-next" style="padding:4px 12px;">&rsaquo;</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;">
        ${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d=>`<div style="text-align:center;font-size:0.78rem;font-weight:600;color:var(--color-text-muted);padding:4px 0;">${d}</div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;" id="cal-grid"></div>`;

    el.querySelector('#cal-prev').onclick = () => { viewMonth--; if(viewMonth<0){viewMonth=11;viewYear--;} render(); };
    el.querySelector('#cal-next').onclick = () => { viewMonth++; if(viewMonth>11){viewMonth=0;viewYear++;} render(); };

    const grid = el.querySelector('#cal-grid');
    const totalCells = Math.ceil((startDow + lastDay.getDate()) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startDow + 1;
      const cell = document.createElement('div');
      cell.style.cssText = 'min-height:80px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:4px;padding:4px;';

      if (dayNum < 1 || dayNum > lastDay.getDate()) {
        cell.style.background = 'var(--color-surface-offset)';
        grid.appendChild(cell);
        continue;
      }

      const dayEvents = monthEvents.filter(ev => {
        const d = ev.startTime?.toDate ? ev.startTime.toDate() : new Date(ev.startTime);
        return d.getDate() === dayNum;
      });

      cell.innerHTML = `<div style="font-size:0.78rem;font-weight:600;color:var(--color-text-muted);margin-bottom:3px;">${dayNum}</div>`;

      dayEvents.forEach(ev => {
        const chip = document.createElement('div');
        const isSkipped = ev.status === 'skipped';
        chip.style.cssText = `font-size:0.72rem;padding:2px 5px;border-radius:3px;margin-bottom:2px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:${isSkipped?'var(--color-surface-offset)':'var(--color-primary-highlight)'};color:${isSkipped?'var(--color-text-muted)':'var(--color-primary)'};${isSkipped?'text-decoration:line-through;':''}`;
        chip.textContent = ev.title || '(kein Titel)';
        chip.title = ev.title || '';
        chip.onclick = () => showEventForm(ev, groups, parentEl);
        cell.appendChild(chip);
      });

      grid.appendChild(cell);
    }
  }

  render();
}

/* ── Hilfsfunktion: durchsuchbare Checkbox-Liste (für Termin-Formular) ────────── */
function buildSearchableCheckboxList(containerId, searchId, items, name, selected, placeholder) {
  return `
    <div style="position:relative;margin-bottom:6px;">
      <span class="material-icons" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--color-text-muted);pointer-events:none;">search</span>
      <input type="text" id="${searchId}" placeholder="${placeholder||'Suchen…'}" style="width:100%;padding:5px 8px 5px 28px;border:1px solid var(--color-border);border-radius:5px;font-size:0.83rem;background:var(--color-surface);color:var(--color-text);" />
    </div>
    <div id="${containerId}" style="display:flex;flex-direction:column;gap:3px;max-height:140px;overflow-y:auto;padding:2px 0;">
      ${items.map(u => `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.88rem;padding:2px 0;">
          <input type="checkbox" name="${name}" value="${u.id}" ${(selected||[]).includes(u.id)?'checked':''} />
          ${u.displayName||u.email}
          ${u._role ? `<span style="font-size:0.75rem;color:var(--color-text-muted);">(${u._role})</span>` : ''}
        </label>`).join('')}
    </div>`;
}

function wireCheckboxSearch(searchId, containerId, items, name) {
  requestAnimationFrame(() => {
    const input = document.getElementById(searchId);
    const list  = document.getElementById(containerId);
    if (!input || !list) return;
    input.addEventListener('input', function() {
      const q = this.value.toLowerCase();
      const checked = new Set([...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i=>i.value));
      const filtered = items.filter(u => (u.displayName||u.email||'').toLowerCase().includes(q));
      list.innerHTML = filtered.map(u => `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.88rem;padding:2px 0;">
          <input type="checkbox" name="${name}" value="${u.id}" ${checked.has(u.id)?'checked':''} />
          ${u.displayName||u.email}
          ${u._role ? `<span style="font-size:0.75rem;color:var(--color-text-muted);">(${u._role})</span>` : ''}
        </label>`).join('');
    });
  });
}

/* ── Termin-Formular ──────────────────────────────────────────────────────────── */
async function showEventForm(event, groups, parentEl) {
  const isNew = !event;

  const toLocal = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const allTrainers = window._allTrainers || [];

  let allUsers = [];
  try {
    const uSnap = await firestore.collection('users').orderBy('displayName').get();
    uSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
  } catch(e) { console.warn('Could not load users for form', e); }

  const allUsersWithRole = allUsers.map(u => ({
    ...u,
    _role: (u.roles||[]).map(r=>getRoleLabel(r)).join(', ') || '–'
  }));

  const currentTrainers = event?.trainers || event?.trainer || [];
  const currentMembers  = event?.members  || [];

  const globalCancelWindow = window.appSettings?.cancellationWindowMinutes ?? 60;
  const eventCancelWindow  = (typeof event?.cancellationWindowMinutes === 'number')
    ? event.cancellationWindowMinutes : '';

  showModal({
    title: isNew ? 'Neuen Termin anlegen' : 'Termin bearbeiten',
    body: `
      <label>Titel</label>
      <input type="text" id="ef-title" value="${event?.title||''}" />
      <label>Gruppe</label>
      <select id="ef-group">
        <option value="">– keine Gruppe –</option>
        ${groups.map(g=>`<option value="${g.id}" ${event?.groupId===g.id?'selected':''}>${g.name}</option>`).join('')}
      </select>
      <label>Anmeldemodus</label>
      <select id="ef-mode">
        <option value="open"         ${(event?.mode||'open')==='open'?'selected':''}>Aktiv anmelden</option>
        <option value="closed"       ${event?.mode==='closed'?'selected':''}>Abmeldebasiert</option>
        <option value="confirmation" ${event?.mode==='confirmation'?'selected':''}>Bestätigung</option>
      </select>
      <label>Start</label>
      <input type="datetime-local" id="ef-start" value="${toLocal(event?.startTime)}" />
      <label>Ende (optional)</label>
      <input type="datetime-local" id="ef-end"   value="${toLocal(event?.endTime)}" />
      <label>Ort (optional)</label>
      <input type="text" id="ef-location" value="${event?.location||''}" />
      <label>Beschreibung (optional)</label>
      <textarea id="ef-desc" rows="2" style="width:100%;">${event?.description||''}</textarea>

      <details style="margin-top:10px;" ${eventCancelWindow !== '' ? 'open' : ''}>
        <summary style="cursor:pointer;font-size:0.88rem;color:var(--color-text-muted);display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:15px;">timer_off</span>
          Rückzugsfenster (individuell)
        </summary>
        <div style="margin-top:8px;">
          <p class="text-muted" style="margin:0 0 8px;font-size:0.83rem;">
            Positiver Wert = X Min. nach Start &nbsp;|&nbsp; Negativer Wert = X Min. vor Start<br>
            <em>Leer = globaler Standard (${globalCancelWindow} Min.)</em>
          </p>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" id="ef-cancel-window" value="${eventCancelWindow}" placeholder="${globalCancelWindow} (global)" style="max-width:120px;" />
            <span style="font-size:0.85rem;color:var(--color-text-muted);">Minuten</span>
          </div>
        </div>
      </details>

      <label style="margin-top:12px;">${getRoleLabel('teacher')} (${allTrainers.length})</label>
      ${buildSearchableCheckboxList('ef-trainer-list','ef-trainer-search', allTrainers, 'ef-trainer', currentTrainers, 'Betreuer suchen…')}

      <details style="margin-top:12px;">
        <summary style="cursor:pointer;font-size:0.88rem;color:var(--color-text-muted);">Zusätzliche Teilnehmer – außerhalb Gruppe (${allUsers.length})</summary>
        <div style="margin-top:8px;">
          ${buildSearchableCheckboxList('ef-extra-list','ef-extra-search', allUsersWithRole, 'ef-extra-member', currentMembers, 'Person suchen…')}
        </div>
      </details>

      ${isNew ? `
      <details style="margin-top:10px;" id="recur-details">
        <summary style="cursor:pointer;font-size:0.88rem;color:var(--color-text-muted);">Wiederholung</summary>
        <div style="margin-top:8px;">
          <select id="ef-recur">
            <option value="">Keine Wiederholung</option>
            <option value="weekly">Wöchentlich</option>
            <option value="biweekly">Zweiwöchentlich</option>
            <option value="monthly">Monatlich</option>
          </select>
          <label style="margin-top:8px;">Wiederholen bis</label>
          <input type="date" id="ef-until" />
        </div>
      </details>` : ''}
    `,
    confirmLabel: isNew ? 'Anlegen' : 'Speichern',
    onConfirm: async () => {
      const title    = document.getElementById('ef-title').value.trim();
      const groupId  = document.getElementById('ef-group').value;
      const mode     = document.getElementById('ef-mode').value;
      const startStr = document.getElementById('ef-start').value;
      const endStr   = document.getElementById('ef-end').value;
      const location = document.getElementById('ef-location').value.trim();
      const desc     = document.getElementById('ef-desc').value.trim();
      const trainers = [...document.querySelectorAll('input[name="ef-trainer"]:checked')].map(i=>i.value);
      const extraMembers = [...document.querySelectorAll('input[name="ef-extra-member"]:checked')].map(i=>i.value);

      const cancelWindowRaw = document.getElementById('ef-cancel-window').value.trim();
      const cancelWindowVal = cancelWindowRaw !== '' ? parseInt(cancelWindowRaw, 10) : null;

      if (!title)    { showToast('Bitte Titel eingeben.',     'error'); return false; }
      if (!startStr) { showToast('Bitte Startzeit eingeben.', 'error'); return false; }
      if (!endStr)   { showToast('Kein Ende gesetzt – Termin wird ohne Endzeit gespeichert.', 'info'); }

      const startTime = new Date(startStr);
      const endTime   = endStr ? new Date(endStr) : null;

      const payload = { title, groupId: groupId||null, mode, startTime, trainers, members: extraMembers };
      if (endTime)   payload.endTime   = endTime;
      if (location)  payload.location  = location;
      if (desc)      payload.description = desc;
      if (cancelWindowVal !== null && !isNaN(cancelWindowVal)) {
        payload.cancellationWindowMinutes = cancelWindowVal;
      } else {
        payload.cancellationWindowMinutes = firebase.firestore.FieldValue.delete();
      }

      try {
        if (isNew) {
          const recurVal = document.getElementById('ef-recur')?.value;
          const untilVal = document.getElementById('ef-until')?.value;

          const payloadNew = { ...payload };
          if (cancelWindowVal === null || isNaN(cancelWindowVal)) {
            delete payloadNew.cancellationWindowMinutes;
          }

          if (recurVal && untilVal) {
            const untilDate = new Date(untilVal);
            untilDate.setHours(23,59,59,999);
            const dates = generateRecurringDates(startTime, endTime, recurVal, untilDate);
            const recurrenceId = Date.now().toString(36);
            const batch = firestore.batch();
            dates.forEach(({start, end}) => {
              const ref = firestore.collection('events').doc();
              const p = { ...payloadNew, startTime: start, recurrenceId };
              if (end) p.endTime = end;
              batch.set(ref, p);
            });
            await batch.commit();
            showToast(`${dates.length} Termine angelegt.`, 'success');
          } else {
            await firestore.collection('events').add(payloadNew);
            showToast('Termin angelegt.', 'success');
          }
        } else {
          if (event.recurrenceId) {
            const scope = await askRecurrenceScope(startTime);
            if (!scope) return false;

            if (scope === 'single') {
              await firestore.collection('events').doc(event.id).update(payload);
            } else if (scope === 'following') {
              const snap = await firestore.collection('events')
                .where('recurrenceId', '==', event.recurrenceId)
                .where('startTime', '>=', event.startTime)
                .get();
              const b = firestore.batch();
              snap.forEach(doc => b.update(doc.ref, payload));
              await b.commit();
            } else if (scope === 'all') {
              const snap = await firestore.collection('events')
                .where('recurrenceId', '==', event.recurrenceId)
                .get();
              const b = firestore.batch();
              snap.forEach(doc => b.update(doc.ref, payload));
              await b.commit();
            }
          } else {
            await firestore.collection('events').doc(event.id).update(payload);
          }
          showToast('Termin gespeichert.', 'success');
        }
        renderScheduleTab(parentEl);
      } catch(e) {
        console.error(e);
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });

  wireCheckboxSearch('ef-trainer-search', 'ef-trainer-list', allTrainers, 'ef-trainer');
  wireCheckboxSearch('ef-extra-search',   'ef-extra-list',   allUsersWithRole, 'ef-extra-member');
}

/* ── Hilfsfunktion: Wiederholungsdaten generieren ────────────────────────────── */
function generateRecurringDates(startTime, endTime, recur, until) {
  const dates = [];
  let cur = new Date(startTime);
  const duration = endTime ? endTime - startTime : null;
  while (cur <= until) {
    const end = duration !== null ? new Date(cur.getTime() + duration) : null;
    dates.push({ start: new Date(cur), end });
    if (recur === 'weekly')         cur.setDate(cur.getDate() + 7);
    else if (recur === 'biweekly') cur.setDate(cur.getDate() + 14);
    else if (recur === 'monthly')  cur.setMonth(cur.getMonth() + 1);
    else break;
  }
  return dates;
}
/* ===================== SETTINGS TAB ===================== */
async function renderCoordSettingsTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Einstellungen...</div>`;
  try {
    const doc = await firestore.collection('settings').doc('global').get();
    const d   = doc.exists ? doc.data() : {};

    el.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0;">Teilnehmer &amp; Termine</h3>

        <label>Standard-Mindestteilnehmerzahl</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Wie viele Anmeldungen ein Termin mindestens braucht, damit er stattfindet.
        </p>
        <input type="number" id="cs-min-participants"
               value="${d.defaultMinParticipants ?? 1}" min="0" step="1"
               style="max-width:160px;" />

        <label style="margin-top:16px;">Standard-Vorschau (Tage)</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Wie viele Tage im Voraus Termine für Mitglieder sichtbar sind.
        </p>
        <input type="number" id="cs-lookahead"
               value="${d.defaultEventLookAhead ?? 30}" min="1" step="1"
               style="max-width:160px;" />

        <label style="margin-top:16px;">Standard-Modus</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Vorausgewählter Anmeldemodus beim Erstellen neuer Termine.
        </p>
        <select id="cs-default-mode" style="max-width:280px;">
          <option value="opt-in"    ${(d.defaultMode||'open')==='opt-in'    ?'selected':''}>Anmeldebasiert</option>
          <option value="confirmation" ${(d.defaultMode||'')==='confirmation'     ?'selected':''}>Bestätigung</option>
          <option value="opt-out"  ${(d.defaultMode||'')==='opt-out'      ?'selected':''}>Abmedlebasiert</option>
        </select>

        <label style="margin-top:16px;">Teilnehmer-Sichtbarkeit für Mitglieder</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Was dürfen Mitglieder über andere Anmeldungen sehen?
        </p>
        <select id="cs-visibility-mode" style="max-width:320px;">
          <option value="none"  ${(d.visibilityMode||'count')==='none'  ?'selected':''}>Nichts (weder Namen noch Anzahl)</option>
          <option value="count" ${(d.visibilityMode||'count')==='count' ?'selected':''}>Nur Anzahl der Angemeldeten</option>
          <option value="names" ${(d.visibilityMode||'')==='names'      ?'selected':''}>Namen der Angemeldeten</option>
        </select>
      </div>

      <div class="card">
        <h3 style="margin-top:0;">Fristen &amp; Zeitfenster</h3>

        <label>Anmeldefrist (Minuten vor Termin)</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Bis wie viele Minuten vor Beginn können sich Mitglieder noch anmelden. 0 = keine Frist.
        </p>
        <input type="number" id="cs-signup-deadline"
               value="${d.defaultSignupDeadlineMinutes ?? 0}" min="0" step="5"
               style="max-width:160px;" />

        <label style="margin-top:16px;">Abmeldefrist (Minuten vor Termin)</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Bis wie viele Minuten vor Beginn können Mitglieder ihre Anmeldung zurückziehen. 0 = keine Frist.
        </p>
        <input type="number" id="cs-withdraw-window"
               value="${d.withdrawWindowMinutes ?? 0}" min="0" step="5"
               style="max-width:160px;" />

        <label style="margin-top:16px;">Absagefenster (Minuten vor Termin)</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Wie lange vor Beginn ein Termin noch abgesagt werden kann. 0 = keine Beschränkung.
        </p>
        <input type="number" id="cs-cancel-window"
               value="${d.cancellationWindowMinutes ?? 0}" min="0" step="5"
               style="max-width:160px;" />

        <label style="margin-top:16px;">Bestätigungsfenster (Minuten)</label>
        <p class="text-muted" style="margin-top:0;font-size:0.85rem;">
          Wie lange ein Mitglied Zeit hat, eine Anfrage-Anmeldung zu bestätigen.
        </p>
        <input type="number" id="cs-confirm-window"
               value="${d.confirmationWindowMinutes ?? 60}" min="1" step="5"
               style="max-width:160px;" />
      </div>

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px;">
        <button class="btn-primary" id="cs-save"
                style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">save</span>
          Einstellungen speichern
        </button>
        <span id="cs-save-status" style="font-size:0.85rem;color:var(--color-text-muted);"></span>
      </div>
    `;

    el.querySelector('#cs-save').onclick = async () => {
      const btn      = el.querySelector('#cs-save');
      const statusEl = el.querySelector('#cs-save-status');
      btn.disabled   = true;
      statusEl.textContent = '';

      const values = {
        defaultMinParticipants:       parseInt(document.getElementById('cs-min-participants').value) || 0,
        defaultEventLookAhead:        parseInt(document.getElementById('cs-lookahead').value)         || 30,
        defaultMode:                  document.getElementById('cs-default-mode').value,
        visibilityMode:               document.getElementById('cs-visibility-mode').value,
        defaultSignupDeadlineMinutes: parseInt(document.getElementById('cs-signup-deadline').value)   || 0,
        withdrawWindowMinutes:        parseInt(document.getElementById('cs-withdraw-window').value)   || 0,
        cancellationWindowMinutes:    parseInt(document.getElementById('cs-cancel-window').value)     || 0,
        confirmationWindowMinutes:    parseInt(document.getElementById('cs-confirm-window').value)    || 60,
      };

      try {
        await firestore.collection('settings').doc('global').set(values, { merge: true });
        if (window.appSettings) Object.assign(window.appSettings, values);
        showToast('Einstellungen gespeichert.', 'success');
        statusEl.textContent = '✓ Gespeichert.';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      } catch (e) {
        console.error('Einstellungen speichern fehlgeschlagen:', e);
        showToast('Fehler beim Speichern: ' + e.message, 'error');
        statusEl.textContent = '✗ Fehler.';
      } finally {
        btn.disabled = false;
      }
    };

  } catch (e) {
    console.error('renderCoordSettingsTab Fehler:', e);
    el.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
  }
}
