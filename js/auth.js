// js/auth.js

async function getUserData(uid) {
  try {
    const doc = await firestore.collection('users').doc(uid).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (e) { console.error('getUserData:', e); return null; }
}

function hideAuthLoading() {
  const el = document.getElementById('auth-loading');
  if (el) el.classList.add('hidden');
}
function showLogin() {
  hideAuthLoading();
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-root').classList.add('hidden');
}
function showApp() {
  hideAuthLoading();
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-root').classList.remove('hidden');
}

/* ─── Auto-Refresh ──────────────────────────────────────────────────────────── */
let _autoRefreshTimer = null;

function startAutoRefresh(seconds) {
  stopAutoRefresh();
  const ms = parseInt(seconds) * 1000;
  if (!ms || ms < 5000) return;
  _autoRefreshTimer = setInterval(() => {
    if (!window.currentUser) return;
    window._silentRefresh = true;
    try {
      routeToDashboard(window.currentUser.roles, window.currentDashboardRole);
    } finally {
      window._silentRefresh = false;
    }
  }, ms);
}

function stopAutoRefresh() {
  if (_autoRefreshTimer) {
    clearInterval(_autoRefreshTimer);
    _autoRefreshTimer = null;
  }
}
/* ─────────────────────────────────────────────────────────────────────────── */

firebaseAuth.onAuthStateChanged(async (fbUser) => {
  if (!fbUser) {
    window.currentUser = null;
    stopAutoRefresh();
    if (typeof stopNotificationsListener === 'function') stopNotificationsListener();
    const appContent = document.getElementById('app-content');
    if (appContent) appContent.innerHTML = '';
    showLogin();
    removeDashboardSwitcher();
    const old = document.getElementById('sys-msg-banner');
    if (old) old.remove();
    return;
  }

  showApp();
  const appContent = document.getElementById('app-content');
  if (appContent) appContent.innerHTML = '<div class="loading-center">Lade...</div>';

  const userData = await getUserData(fbUser.uid);
  if (!userData) { firebaseAuth.signOut(); return; }

  window.currentUser = {
    firebaseUser: fbUser,
    ...userData,
    roles:  userData.roles  || ['member'],
    groups: userData.groups || []
  };

  const profileBtn = document.getElementById('profile-btn');
  const logoutBtn  = document.getElementById('logout-btn');
  if (profileBtn) { profileBtn.hidden = false; profileBtn.onclick = () => loadProfilePage(); }
  if (logoutBtn)  { logoutBtn.hidden  = false; logoutBtn.onclick  = () => firebaseAuth.signOut(); }

  const mobileProfile = document.getElementById('mobile-profile-btn');
  const mobileLogout  = document.getElementById('mobile-logout-btn');
  if (mobileProfile) {
    mobileProfile.hidden = false;
    mobileProfile.onclick = () => { if (window._mobileDrawerClose) window._mobileDrawerClose(); loadProfilePage(); };
  }
  if (mobileLogout) {
    mobileLogout.hidden = false;
    mobileLogout.onclick = () => firebaseAuth.signOut();
  }

  const nameEl = document.getElementById('app-user-name');
  if (nameEl) nameEl.textContent = userData.name || fbUser.email || '';
  const mobileNameEl = document.getElementById('mobile-user-name');
  if (mobileNameEl) mobileNameEl.textContent = userData.name || fbUser.email || '';

  try { await applyBranding(); } catch(e) { console.warn('applyBranding Fehler:', e); }

  startAutoRefresh(window.appSettings?.autoRefreshSeconds ?? 0);

  // Notification-Bell initialisieren & Listener starten
  if (typeof initNotificationBell      === 'function') initNotificationBell();
  if (typeof startNotificationsListener === 'function') startNotificationsListener();

  routeToDashboard(window.currentUser.roles);
  if (typeof renderSystemMessageBanner === 'function') renderSystemMessageBanner();
});

// ── Dashboard-Routing ──────────────────────────────────────────────────────────
const ROLE_ORDER = ['admin', 'coordinator', 'teacher', 'member'];
function getPrimaryRole(roles) {
  for (const r of ROLE_ORDER) if (roles.includes(r)) return r;
  return 'member';
}
const DASHBOARD_LOADERS = {
  admin:       () => loadAdminDashboard(),
  coordinator: () => loadCoordinatorDashboard(),
  teacher:     () => loadTrainerDashboard(),
  member:      () => loadMemberDashboard(),
  statistics:  () => loadStatisticsDashboard(),
  myMembers:   () => loadMemberReportDashboard()
};
const ROLE_LABELS_SWITCHER = {
  admin: 'Admin', coordinator: 'Koordinator', teacher: 'Trainer',
  member: 'Mitglieder', myMembers: 'Meine Mitglieder'
};
const ROLE_ICONS = {
  admin: 'admin_panel_settings', coordinator: 'supervisor_account',
  teacher: 'sports', member: 'group', statistics: 'bar_chart', myMembers: 'people_alt'
};
const STATS_ROLES      = ['admin', 'coordinator', 'teacher'];
const MY_MEMBERS_ROLES = ['admin', 'coordinator', 'teacher'];

function routeToDashboard(roles, forceRole) {
  const role = forceRole || getPrimaryRole(roles);
  window.currentDashboardRole = role;
  if (!window._silentRefresh) renderDashboardSwitcher(roles);
  (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
}

function _applyActive(btn, isActive) {
  btn.style.fontWeight   = isActive ? '600' : '400';
  btn.style.color        = isActive ? 'var(--color-primary)' : '';
  btn.style.borderBottom = isActive ? '2px solid var(--color-primary)' : '2px solid transparent';
}
function _makeSeparator() {
  const s = document.createElement('div');
  Object.assign(s.style, { width:'1px', height:'20px', background:'var(--color-border)', margin:'0 4px', flexShrink:'0' });
  return s;
}
function _updateSwitcherActive(wrapper, role) {
  if (!wrapper) return;
  wrapper.querySelectorAll('.role-switch-btn').forEach(b => _applyActive(b, b.dataset.role === role));
}
function _updateMobileActive(role) {
  const mc = document.getElementById('mobile-role-switcher');
  if (mc) mc.querySelectorAll('.role-switch-btn').forEach(b => _applyActive(b, b.dataset.role === role));
}

function renderDashboardSwitcher(roles) {
  removeDashboardSwitcher();
  const available    = ROLE_ORDER.filter(r => roles.includes(r));
  const hasStats     = STATS_ROLES.some(r => roles.includes(r));
  const hasMyMembers = MY_MEMBERS_ROLES.some(r => roles.includes(r));
  if (available.length <= 1 && !hasStats && !hasMyMembers) return;

  const desktopBar = document.querySelector('#app-actions-desktop');
  if (desktopBar) {
    const wrapper = document.createElement('div');
    wrapper.id = 'role-switcher';
    Object.assign(wrapper.style, { display:'flex', alignItems:'center', gap:'2px', marginRight:'6px' });
    const makeBtn = (role, label) => {
      const btn = document.createElement('button');
      btn.className = 'btn-text role-switch-btn';
      btn.dataset.role = role;
      btn.innerHTML = `<span class="material-icons">${ROLE_ICONS[role]||'dashboard'}</span><span class="btn-label">${label}</span>`;
      _applyActive(btn, role === window.currentDashboardRole);
      btn.onclick = () => {
        window.currentDashboardRole = role;
        _updateSwitcherActive(wrapper, role);
        _updateMobileActive(role);
        (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
      };
      return btn;
    };
    if (available.length > 1) available.forEach(r => {
      const label = typeof getRoleLabel === 'function' ? getRoleLabel(r) : (ROLE_LABELS_SWITCHER[r] || r);
      wrapper.appendChild(makeBtn(r, label));
    });
    if (hasStats)     { if (available.length > 1) wrapper.appendChild(_makeSeparator()); wrapper.appendChild(makeBtn('statistics', 'Statistiken')); }
    if (hasMyMembers) { wrapper.appendChild(_makeSeparator()); wrapper.appendChild(makeBtn('myMembers', 'Meine Mitglieder')); }
    desktopBar.insertBefore(wrapper, desktopBar.firstChild);
  }

  const mobileContainer = document.getElementById('mobile-role-switcher');
  if (mobileContainer) {
    mobileContainer.innerHTML = '';
    [
      ...(available.length > 1 ? available : []),
      ...(hasStats     ? ['statistics'] : []),
      ...(hasMyMembers ? ['myMembers']  : [])
    ].forEach(role => {
      const btn = document.createElement('button');
      btn.className = 'icon-btn role-switch-btn';
      btn.dataset.role = role;
      btn.setAttribute('aria-label', ROLE_LABELS_SWITCHER[role] || role);
      btn.title = ROLE_LABELS_SWITCHER[role] || role;
      btn.innerHTML = `<span class="material-icons">${ROLE_ICONS[role]||'dashboard'}</span>`;
      _applyActive(btn, role === window.currentDashboardRole);
      btn.onclick = () => {
        window.currentDashboardRole = role;
        _updateMobileActive(role);
        _updateSwitcherActive(document.getElementById('role-switcher'), role);
        (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
      };
      mobileContainer.appendChild(btn);
    });
  }
}
function removeDashboardSwitcher() {
  const rs = document.getElementById('role-switcher');
  if (rs) rs.remove();
}

// ── Login-Formular ────────────────────────────────────────────────────────────
const loginForm     = document.getElementById('login-form');
const emailInput    = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const errorEl       = document.getElementById('login-error');
const submitBtn     = document.getElementById('login-submit-btn');
const btnText       = document.getElementById('login-btn-text');
const spinner       = document.getElementById('login-spinner');

function setLoginLoading(loading) {
  if (submitBtn) submitBtn.disabled = loading;
  if (btnText)   btnText.textContent = loading ? 'Anmelden…' : 'Anmelden';
  if (spinner)   spinner.classList.toggle('hidden', !loading);
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = emailInput    ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value     : '';
    if (!email)    { if (errorEl) errorEl.textContent = 'Bitte E-Mail eingeben.';    emailInput?.focus();    return; }
    if (!password) { if (errorEl) errorEl.textContent = 'Bitte Passwort eingeben.'; passwordInput?.focus(); return; }
    if (errorEl) errorEl.textContent = '';
    setLoginLoading(true);
    try {
      await firebaseAuth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      let msg = 'Anmeldung fehlgeschlagen.';
      if (['auth/user-not-found','auth/wrong-password','auth/invalid-credential'].includes(err.code)) msg = 'E-Mail oder Passwort falsch.';
      else if (err.code === 'auth/invalid-email')          msg = 'Ungültige E-Mail-Adresse.';
      else if (err.code === 'auth/too-many-requests')      msg = 'Zu viele Versuche. Bitte kurz warten.';
      else if (err.code === 'auth/network-request-failed') msg = 'Kein Netzwerk.';
      if (errorEl) errorEl.textContent = msg;
    } finally {
      setLoginLoading(false);
    }
  });
}

const forgotBtn = document.getElementById('forgot-pw-btn');
if (forgotBtn) {
  forgotBtn.addEventListener('click', async () => {
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) { if (errorEl) errorEl.textContent = 'Bitte zuerst E-Mail eingeben.'; emailInput?.focus(); return; }
    forgotBtn.disabled = true;
    forgotBtn.textContent = 'Sende…';
    try {
      await firebaseAuth.sendPasswordResetEmail(email);
      if (errorEl) { errorEl.style.color = 'var(--color-success)'; errorEl.textContent = 'E-Mail gesendet! Bitte Postfach prüfen.'; }
    } catch {
      if (errorEl) { errorEl.style.color = ''; errorEl.textContent = 'Kein Konto mit dieser E-Mail gefunden.'; }
    } finally {
      forgotBtn.disabled = false;
      forgotBtn.textContent = 'Passwort vergessen?';
    }
  });
}
