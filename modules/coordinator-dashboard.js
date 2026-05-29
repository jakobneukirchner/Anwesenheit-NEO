// modules/coordinator-dashboard.js
async function loadCoordinatorDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `
    <div class="tab-bar" id="coord-tab-bar">
      <button class="tab-btn" data-tab="users">Mitglieder</button>
      <button class="tab-btn" data-tab="groups">Gruppen</button>
      <button class="tab-btn" data-tab="schedule">Terminplanung</button>
      <button class="tab-btn" data-tab="settings">Einstellungen</button>
      <button class="tab-btn" data-tab="messages">Nachrichten</button>
    </div>
    <div id="tab-users"></div>
    <div id="tab-groups" hidden></div>
    <div id="tab-schedule" hidden></div>
    <div id="tab-settings" hidden></div>
    <div id="tab-messages" hidden></div>`;

  const tabs   = { users: null, groups: null, schedule: null, settings: null, messages: null };
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
  // PLACEHOLDER - full content follows
}