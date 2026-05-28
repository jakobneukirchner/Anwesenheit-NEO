// modules/admin-dashboard.js
// Admin-Dashboard: alles wie Koordinator + systemkritische Settings

async function loadAdminDashboard() {
  const container = document.getElementById('app-content');
  const aLabel = getRoleLabel('admin');
  container.innerHTML = `
    <h2 style="margin-top:0;">${aLabel}-Dashboard</h2>
    <div class="tabs">
      <button class="tab-btn" data-tab="users">Benutzer</button>
      <button class="tab-btn" data-tab="groups">Gruppen</button>
      <button class="tab-btn" data-tab="schedule">Terminplanung</button>
      <button class="tab-btn" data-tab="settings">Einstellungen</button>
      <button class="tab-btn" data-tab="system">System</button>
    </div>
    <div id="tab-users"    hidden></div>
    <div id="tab-groups"   hidden></div>
    <div id="tab-schedule" hidden></div>
    <div id="tab-settings" hidden></div>
    <div id="tab-system"   hidden></div>
  `;

  const tabEls = {
    users:    document.getElementById('tab-users'),
    groups:   document.getElementById('tab-groups'),
    schedule: document.getElementById('tab-schedule'),
    settings: document.getElementById('tab-settings'),
    system:   document.getElementById('tab-system')
  };
  const loaded = {};

  const loaders = {
    users:    () => renderUsersTab(tabEls.users),
    groups:   () => renderGroupsTab(tabEls.groups),
    schedule: () => renderScheduleTab(tabEls.schedule),
    settings: () => renderCoordSettingsTab(tabEls.settings),
    system:   () => renderAdminSystemTab(tabEls.system)
  };

  const switchTab = (tabKey) => {
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabKey));
    Object.keys(tabEls).forEach(k => { tabEls[k].hidden = k !== tabKey; });
    if (!loaded[tabKey]) {
      loaded[tabKey] = true;
      loaders[tabKey]();
    }
  };

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  // Ersten Tab beim Start aktivieren und laden
  switchTab('users');
}

async function renderAdminSystemTab(el) {
  el.innerHTML = `<div class="loading-center">Lade System-Einstellungen...</div>`;
  try {
    const doc  = await firestore.collection('settings').doc('global').get();
    const data = doc.exists ? doc.data() : {};

    const rl = data.roleLabels || {};
    const labelTeacher     = rl.teacher     || 'Trainer';
    const labelCoordinator = rl.coordinator || 'Koordinator';
    const labelAdmin       = rl.admin       || 'Admin';
    const labelMember      = rl.member      || 'Mitglied';

    el.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0;">Branding</h3>
        <label>App-Titel / Vereinsname</label>
        <input type="text" id="as-title" value="${data.brandingTitle || ''}" placeholder="z.B. Verein XY" />
        <label>Logo-URL</label>
        <input type="url" id="as-logo" value="${data.logoUrl || ''}" placeholder="https://..." />
        <label>Favicon-URL</label>
        <input type="url" id="as-favicon" value="${data.faviconUrl || ''}" placeholder="https://..." />
        <button class="btn-primary" id="as-save-branding" style="margin-bottom:0;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">save</span>
          Branding speichern
        </button>
      </div>

      <div class="card">
        <h3 style="margin-top:0;">Rate-Limit &amp; Sicherheit</h3>
        <p class="text-muted">Gilt f&uuml;r ${labelMember}s (${labelTeacher} / ${labelCoordinator} / ${labelAdmin} ausgenommen)</p>
        <label>Max. Aktionen pro Zeitfenster</label>
        <input type="number" id="as-rl-max" value="${data.rateLimitMaxActions || 100}" min="1" />
        <label>Zeitfenster (Minuten)</label>
        <input type="number" id="as-rl-win" value="${data.rateLimitWindowMinutes || 10}" min="1" />
        <button class="btn-primary" id="as-save-rl" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">save</span>
          Rate-Limit speichern
        </button>
      </div>

      <div class="card">
        <h3 style="margin-top:0;">Authentifizierung</h3>
        <p class="text-muted">Hinweis: Auth-Methoden werden in der Firebase Console verwaltet. Hier kannst du interne Optionen steuern.</p>
        <label style="display:flex;align-items:center;gap:8px;color:var(--color-text);">
          <input type="checkbox" id="as-allow-pw" ${data.authAllowPassword !== false ? 'checked' : ''} />
          E-Mail/Passwort-Anmeldung aktiviert
        </label>
        <button class="btn-primary" id="as-save-auth" style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">save</span>
          Auth-Einstellungen speichern
        </button>
      </div>
    `;

    el.querySelector('#as-save-branding').onclick = async () => {
      const title   = document.getElementById('as-title')?.value.trim();
      const logo    = document.getElementById('as-logo')?.value.trim();
      const favicon = document.getElementById('as-favicon')?.value.trim();
      await firestore.collection('settings').doc('global').set({ brandingTitle: title, logoUrl: logo, faviconUrl: favicon }, { merge: true });
      await applyBranding();
      showToast('Branding gespeichert.', 'success');
    };

    el.querySelector('#as-save-rl').onclick = async () => {
      const max = parseInt(document.getElementById('as-rl-max')?.value) || 100;
      const win = parseInt(document.getElementById('as-rl-win')?.value) || 10;
      await firestore.collection('settings').doc('global').set({ rateLimitMaxActions: max, rateLimitWindowMinutes: win }, { merge: true });
      showToast('Rate-Limit gespeichert.', 'success');
    };

    el.querySelector('#as-save-auth').onclick = async () => {
      const allowPw = document.getElementById('as-allow-pw')?.checked;
      await firestore.collection('settings').doc('global').set({ authAllowPassword: allowPw }, { merge: true });
      showToast('Auth-Einstellungen gespeichert.', 'success');
    };

  } catch (e) {
    el.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
  }
}
