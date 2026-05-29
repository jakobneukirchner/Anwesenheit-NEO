// js/auth.js

async function getUserData(uid) {
  try {
    const doc = await firestore.collection('users').doc(uid).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (e) { console.error('getUserData:', e); return null; }
}

firebaseAuth.onAuthStateChanged(async (fbUser) => {
  const loginScreen  = document.getElementById('login-screen');
  const appContent   = document.getElementById('app-content');
  const appBar       = document.getElementById('app-bar');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileProfile = document.getElementById('mobile-profile-btn');

  if (!fbUser) {
    window.currentUser = null;
    if (appContent)  appContent.innerHTML = '';
    if (loginScreen) loginScreen.hidden = false;
    if (appBar)      appBar.hidden = true;
    removeDashboardSwitcher();
    const old = document.getElementById('sys-msg-banner');
    if (old) old.remove();
    return;
  }

  if (loginScreen) loginScreen.hidden = true;
  if (appBar)      appBar.hidden = false;
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
    signOutBtn.onclick = () => {
      firebaseAuth.signOut();
    };
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
  teacher:     getRoleLabel ? getRoleLabel('teacher') : 'Trainer',
  member:      getRoleLabel ? getRoleLabel('member') : 'Mitglieder',
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

// ── Login-Formular ────────────────────────────────────────────────────────────
const loginForm     = document.getElementById('login-form');
const emailInput    = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const errorEl       = document.getElementById('login-error');
const submitBtn     = document.getElementById('login-submit-btn');
const btnText       = document.getElementById('login-btn-text');
const spinner       = document.getElementById('login-spinner');
const togglePw      = document.getElementById('toggle-pw');

if (togglePw) {
  togglePw.addEventListener('click', () => {
    const isText = passwordInput.type === 'text';
    passwordInput.type = isText ? 'password' : 'text';
    togglePw.querySelector('.material-icons').textContent = isText ? 'visibility' : 'visibility_off';
  });
}

// Echtzeit-Hinweis wenn E-Mail leer bleibt und Fokus verlassen wird
if (emailInput) {
  emailInput.addEventListener('blur', () => {
    if (!emailInput.value.trim()) {
      errorEl.innerHTML = `
        <div class="login-error-box" style="background:rgba(245,124,0,0.08);border-color:var(--color-warning,#e65100);color:var(--color-warning,#e65100);">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">info</span>
          Bitte gib deine E-Mail-Adresse ein.
        </div>`;
    } else {
      errorEl.innerHTML = '';
    }
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email) {
      errorEl.innerHTML = `
        <div class="login-error-box" style="background:rgba(245,124,0,0.08);border-color:var(--color-warning,#e65100);color:var(--color-warning,#e65100);">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">warning</span>
          Bitte gib deine E-Mail-Adresse ein.
        </div>`;
      emailInput.focus();
      return;
    }
    if (!password) {
      errorEl.innerHTML = `
        <div class="login-error-box">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">lock</span>
          Bitte gib dein Passwort ein.
        </div>`;
      passwordInput.focus();
      return;
    }

    if (!checkLoginRateLimit()) {
      errorEl.innerHTML = `
        <div class="login-error-box">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">timer</span>
          Zu viele Versuche. Bitte warte kurz.
        </div>`;
      return;
    }

    btnText.textContent = 'Anmelden...';
    spinner.hidden = false;
    submitBtn.disabled = true;
    errorEl.innerHTML = '';

    try {
      await firebaseAuth.signInWithEmailAndPassword(email, password);
      recordLoginSuccess();
    } catch (err) {
      recordLoginFailure();
      btnText.textContent = 'Anmelden';
      spinner.hidden = true;
      submitBtn.disabled = false;

      let msg = 'Anmeldung fehlgeschlagen.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'E-Mail oder Passwort falsch.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Ungültige E-Mail-Adresse.';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Konto vorläufig gesperrt. Bitte warte oder setze das Passwort zurück.';
      } else if (err.code === 'auth/network-request-failed') {
        msg = 'Netzwerkfehler. Bitte überprüfe deine Internetverbindung.';
      }
      errorEl.innerHTML = `<div class="login-error-box"><span class="material-icons" style="font-size:16px;vertical-align:middle;">error_outline</span> ${msg}</div>`;
    }
  });
}
