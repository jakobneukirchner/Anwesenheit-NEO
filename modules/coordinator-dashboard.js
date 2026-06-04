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

  const tabs   = { users: false, groups: false, schedule: false, settings: false, messages: false };
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
      if (!tabs[btn.dataset.tab]) {
        tabs[btn.dataset.tab] = true;
        loaders[btn.dataset.tab]();
      }
    };
  });

  // Ersten Tab sofort laden – Flag VORHER setzen, damit kein Doppel-Render
  tabs['users'] = true;
  loaders.users();
}
