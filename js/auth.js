// js/auth.js

async function getUserData(uid) {
  try {
    const doc = await firestore.collection('users').doc(uid).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (e) { console.error('getUserData:', e); return null; }
}

firebaseAuth.onAuthStateChanged(async (fbUser) => {
  const loginScreen  = document.getElementById('login-screen');
  const appRoot      = document.getElementById('app-root');
  const appContent   = document.getElementById('app-content');
  const mobileProfile = document.getElementById('mobile-profile-btn');

  if (!fbUser) {
    window.currentUser = null;
    if (appContent)  appContent.innerHTML = '';
    if (loginScreen) loginScreen.hidden = false;
    if (appRoot)     appRoot.hidden = true;
    removeDashboardSwitcher();
    const old = document.getElementById('sys-msg-banner');
    if (old) old.remove();
    return;
  }

  if (loginScreen) loginScreen.hidden = true;
  if (appRoot)     appRoot.hidden = false;
  if (appContent)  appContent.innerHTML = '<div class="loading-center">Lade...</div>';

  const userData = await getUserData(fbUser.uid);
  if (!userData) {
    firebaseAuth.signOut();
    return;
  }

  window.currentUser = {
    firebaseUser: fbUser,
    ...userData,
    roles: userData.roles || ['member'],
    groups: userData.groups || []
  };

  // Desktop: Profil-Button / Abmelden
  const desktopBar = document.querySelector('#app-actions-desktop');
  if (desktopBar) {
    let profileBtn = desktopBar.querySelector('#profile-btn');
    if (!profileBtn) {
      profileBtn = document.createElement('button');
      profileBtn.id = 'profile-btn';
      profileBtn.className = 'icon-btn';
      profileBtn.setAttribute('aria-label', 'Profil');
      profileBtn.innerHTML = '<span class="material-icons">account_circle</span>';
      desktopBar.appendChild(profileBtn);
    }
    profileBtn.onclick = () => loadProfilePage();

    let signOutBtn = desktopBar.querySelector('#signout-btn');
    if (!signOutBtn) {
      signOutBtn = document.createElement('button');
      signOutBtn.id = 'signout-btn';
      signOutBtn.className = 'icon-btn';
      signOutBtn.setAttribute('aria-label', 'Abmelden');
      signOutBtn.title = 'Abmelden';
      signOutBtn.innerHTML = '<span class="material-icons">logout</span>';
      desktopBar.appendChild(signOutBtn);
    }
    signOutBtn.onclick = () => firebaseAuth.signOut();
  }

  if (mobileProfile) {
    mobileProfile.hidden = false;
    mobileProfile.onclick = () => {
      if (window._mobileDrawerClose) window._mobileDrawerClose();
      loadProfilePage();
    };
  }

  await applyBranding();
  routeToDashboard(window.currentUser.roles);
  if (typeof renderSystemMessageBanner === 'function') renderSystemMessageBanner();
});

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
  admin:       'Admin',
  coordinator: 'Koordinator',
  teacher:     'Trainer',
  member:      'Mitglieder',
  myMembers:   'Meine Mitglieder'
};

const ROLE_ICONS = {
  admin:       'admin_panel_settings',
  coordinator: 'supervisor_account',
  teacher:     'sports',
  member:      'group',
  statistics:  'bar_chart',
  myMembers:   'people_alt'
};

const STATS_ROLES      = ['admin', 'coordinator', 'teacher'];
const MY_MEMBERS_ROLES = ['admin', 'coordinator', 'teacher'];

function routeToDashboard(roles, forceRole) {
  const role = forceRole || getPrimaryRole(roles);
  window.currentDashboardRole = role;
  renderDashboardSwitcher(roles);
  (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
}

function _applyActive(btn, isActive) {
  btn.style.fontWeight    = isActive ? '600' : '400';
  btn.style.color         = isActive ? 'var(--color-primary)' : '';
  btn.style.borderBottom  = isActive ? '2px solid var(--color-primary)' : '2px solid transparent';
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
      btn.innerHTML = `<span class="material-icons">${ROLE_ICONS[role] || 'dashboard'}</span><span class="btn-label">${label}</span>`;
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

    if (hasStats) {
      if (available.length > 1) wrapper.appendChild(_makeSeparator());
      wrapper.appendChild(makeBtn('statistics', 'Statistiken'));
    }
    if (hasMyMembers) {
      wrapper.appendChild(_makeSeparator());
      wrapper.appendChild(makeBtn('myMembers', 'Meine Mitglieder'));
    }

    desktopBar.insertBefore(wrapper, desktopBar.firstChild);
  }

  const mobileContainer = document.getElementById('mobile-role-switcher');
  if (mobileContainer) {
    mobileContainer.innerHTML = '';
    const allRoles = [
      ...(available.length > 1 ? available : []),
      ...(hasStats      ? ['statistics'] : []),
      ...(hasMyMembers  ? ['myMembers']  : [])
    ];
    allRoles.forEach(role => {
      const btn = document.createElement('button');
      btn.className = 'icon-btn role-switch-btn';
      btn.dataset.role = role;
      btn.setAttribute('aria-label', ROLE_LABELS_SWITCHER[role] || role);
      btn.title = ROLE_LABELS_SWITCHER[role] || role;
      btn.innerHTML = `<span class="material-icons">${ROLE_ICONS[role] || 'dashboard'}</span>`;
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

// ── Login-Formular ────────────────────────────────────────────
const loginForm     = document.getElementById('login-form');
const emailInput    = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const errorEl       = document.getElementById('login-error');
const submitBtn     = document.getElementById('login-submit-btn');
const btnText       = document.getElementById('login-btn-text');
const spinner       = document.getElementById('login-spinner');
const togglePw      = document.getElementById('toggle-pw');

// Hilfsfunktion: Lade-Zustand des Buttons
function setLoginLoading(loading) {
  if (!submitBtn) return;
  submitBtn.disabled = loading;
  if (btnText)  btnText.textContent = loading ? 'Anmelden…' : 'Anmelden';
  if (spinner)  spinner.hidden = !loading;
}

// Sicherstellen dass Button beim Laden der Seite immer klickbar ist
setLoginLoading(false);

if (togglePw && passwordInput) {
  togglePw.addEventListener('click', () => {
    const isText = passwordInput.type === 'text';
    passwordInput.type = isText ? 'password' : 'text';
    togglePw.querySelector('.material-icons').textContent = isText ? 'visibility' : 'visibility_off';
  });
}

if (emailInput) {
  emailInput.addEventListener('blur', () => {
    if (!emailInput.value.trim() && errorEl) {
      errorEl.innerHTML = `
        <div class="login-error-box" style="background:rgba(245,124,0,0.08);border-color:var(--color-warning,#e65100);color:var(--color-warning,#e65100);">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">info</span>
          Bitte gib deine E-Mail-Adresse ein.
        </div>`;
    } else if (errorEl) {
      errorEl.innerHTML = '';
    }
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email    = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email) {
      if (errorEl) errorEl.innerHTML = `
        <div class="login-error-box" style="background:rgba(245,124,0,0.08);border-color:var(--color-warning,#e65100);color:var(--color-warning,#e65100);">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">warning</span>
          Bitte gib deine E-Mail-Adresse ein.
        </div>`;
      emailInput && emailInput.focus();
      return;
    }
    if (!password) {
      if (errorEl) errorEl.innerHTML = `
        <div class="login-error-box">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">lock</span>
          Bitte gib dein Passwort ein.
        </div>`;
      passwordInput && passwordInput.focus();
      return;
    }

    if (typeof checkLoginRateLimit === 'function' && !checkLoginRateLimit()) {
      if (errorEl) errorEl.innerHTML = `
        <div class="login-error-box">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">timer</span>
          Zu viele Versuche. Bitte warte kurz.
        </div>`;
      return;
    }

    if (errorEl) errorEl.innerHTML = '';
    setLoginLoading(true);

    try {
      await firebaseAuth.signInWithEmailAndPassword(email, password);
      if (typeof recordLoginSuccess === 'function') recordLoginSuccess();
      // Button bleibt disabled – onAuthStateChanged blendet Login-Screen aus
    } catch (err) {
      if (typeof recordLoginFailure === 'function') recordLoginFailure();

      let msg = 'Anmeldung fehlgeschlagen.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'E-Mail oder Passwort falsch.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Ungültige E-Mail-Adresse.';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Konto voräufig gesperrt. Bitte warte oder setze das Passwort zurück.';
      } else if (err.code === 'auth/network-request-failed') {
        msg = 'Netzwerkfehler. Bitte überprüfe deine Internetverbindung.';
      }
      if (errorEl) errorEl.innerHTML = `<div class="login-error-box"><span class="material-icons" style="font-size:16px;vertical-align:middle;">error_outline</span> ${msg}</div>`;
    } finally {
      // Immer zurücksetzen – egal ob Fehler oder nicht (außer bei Erfolg wird login-screen eh ausgeblendet)
      setLoginLoading(false);
    }
  });
}

// ── Passwort vergessen ─────────────────────────────────────────
const forgotBtn = document.getElementById('forgot-pw-btn');
if (forgotBtn) {
  forgotBtn.addEventListener('click', async () => {
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) {
      if (errorEl) errorEl.innerHTML = `
        <div class="login-error-box" style="background:rgba(245,124,0,0.08);border-color:var(--color-warning,#e65100);color:var(--color-warning,#e65100);">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">info</span>
          Bitte trag zuerst deine E-Mail-Adresse ein.
        </div>`;
      emailInput && emailInput.focus();
      return;
    }
    forgotBtn.disabled = true;
    forgotBtn.textContent = 'Sende…';
    try {
      await firebaseAuth.sendPasswordResetEmail(email);
      if (errorEl) errorEl.innerHTML = `
        <div class="login-error-box" style="background:rgba(67,122,34,0.08);border-color:var(--color-success,#437a22);color:var(--color-success,#437a22);">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">mark_email_read</span>
          E-Mail gesendet! Bitte prüfe dein Postfach.
        </div>`;
    } catch (err) {
      let msg = 'Fehler beim Senden.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
        msg = 'Kein Konto mit dieser E-Mail-Adresse gefunden.';
      }
      if (errorEl) errorEl.innerHTML = `<div class="login-error-box"><span class="material-icons" style="font-size:16px;vertical-align:middle;">error_outline</span> ${msg}</div>`;
    } finally {
      forgotBtn.disabled = false;
      forgotBtn.textContent = 'Passwort vergessen?';
    }
  });
}
