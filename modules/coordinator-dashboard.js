// modules/coordinator-dashboard.js

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
    co