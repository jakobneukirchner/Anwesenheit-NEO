// js/auth.js

async function getUserData(uid) {
  const doc = await firestore.collection('users').doc(uid).get();
  if (!doc.exists) return { roles: [], displayName: '' };
  return doc.data();
}

applyBranding();

firebaseAuth.onAuthStateChanged(async (user) => {
  const logoutBtn  = document.getElementById('logout-btn');
  const profileBtn = document.getElementById('profile-btn');
  const userNameEl = document.getElementById('app-user-name');
  const menuBtn    = document.getElementById('mobile-menu-btn');

  // Mobile Drawer Buttons
  const mobileLogout  = document.getElementById('mobile-logout-btn');
  const mobileProfile = document.getElementById('mobile-profile-btn');
  const mobileNameEl  = document.getElementById('mobile-user-name');

  if (!user) {
    if (logoutBtn)  logoutBtn.hidden  = true;
    if (profileBtn) profileBtn.hidden = true;
    if (userNameEl) userNameEl.textContent = '';
    if (menuBtn)  { menuBtn.hidden = true; menuBtn._authVisible = false; }
    if (mobileLogout)  mobileLogout.hidden  = true;
    if (mobileProfile) mobileProfile.hidden = true;
    removeDashboardSwitcher();
    renderLoginPage();
    return;
  }

  const userData = await getUserData(user.uid);
  window.currentUser = {
    firebaseUser: user,
    roles: userData.roles || [],
    displayName: userData.displayName || user.email
  };

  const displayName = window.currentUser.displayName;

  if (userNameEl) {
    userNameEl.textContent = displayName;
    userNameEl.onclick = () => loadProfilePage();
  }
  if (mobileNameEl) mobileNameEl.textContent = displayName;

  if (logoutBtn) {
    logoutBtn.hidden = false;
    logoutBtn.onclick = () => firebaseAuth.signOut();
  }
  if (profileBtn) {
    profileBtn.hidden = false;
    profileBtn.onclick = () => loadProfilePage();
  }
  if (mobileLogout) {
    mobileLogout.hidden = false;
    mobileLogout.onclick = () => { if(window._mobileDrawerClose) window._mobileDrawerClose(); firebaseAuth.signOut(); };
  }
  if (mobileProfile) {
    mobileProfile.hidden = false;
    mobileProfile.onclick = () => { if(window._mobileDrawerClose) window._mobileDrawerClose(); loadProfilePage(); };
  }
  if (menuBtn) {
    menuBtn._authVisible = true;
    if (window._checkBreakpoint) window._checkBreakpoint();
  }

  await applyBranding();
  routeToDashboard(window.currentUser.roles);
});

const ROLE_ORDER = ['admin', 'coordinator', 'teacher', 'member'];

function getPrimaryRole(roles) {
  for (const r of ROLE_ORDER) { if (roles.includes(r)) return r; }
  return 'member';
}

const DASHBOARD_LOADERS = {
  admin:       () => loadAdminDashboard(),
  coordinator: () => loadCoordinatorDashboard(),
  teacher:     () => loadTrainerDashboard(),
  member:      () => loadMemberDashboard(),
  statistics:  () => loadStatisticsDashboard()
};

const ROLE_LABELS_SWITCHER = {
  admin:       'Admin',
  coordinator: 'Koordinator',
  teacher:     'Trainer',
  member:      'Mitglieder'
};

const ROLE_ICONS = {
  admin:       'admin_panel_settings',
  coordinator: 'supervisor_account',
  teacher:     'sports',
  member:      'group',
  statistics:  'bar_chart'
};

const STATS_ROLES = ['admin', 'coordinator', 'teacher'];

function routeToDashboard(roles, forceRole) {
  const role = forceRole || getPrimaryRole(roles);
  window.currentDashboardRole = role;
  renderDashboardSwitcher(roles);
  (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
}

function renderDashboardSwitcher(roles) {
  removeDashboardSwitcher();
  const available = ROLE_ORDER.filter(r => roles.includes(r));
  const hasStats  = STATS_ROLES.some(r => roles.includes(r));
  if (available.length <= 1 && !hasStats) return;

  // ── Desktop Switcher ──
  const bar = document.querySelector('#app-actions-desktop');
  if (bar) {
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
        if (window._mobileDrawerClose) window._mobileDrawerClose();
      };
      return btn;
    };

    if (available.length > 1) {
      available.forEach(r => wrapper.appendChild(makeBtn(r, ROLE_LABELS_SWITCHER[r] || r)));
    }
    if (hasStats) {
      if (available.length > 1) {
        const sep = document.createElement('span');
        sep.textContent = '|';
        Object.assign(sep.style, { color:'rgba(255,255,255,0.35)', fontSize:'0.9rem', padding:'0 2px' });
        wrapper.appendChild(sep);
      }
      wrapper.appendChild(makeBtn('statistics', 'Statistiken'));
    }
    bar.insertBefore(wrapper, bar.firstChild);
  }

  // ── Mobile Drawer Switcher ──
  const mobileContainer = document.getElementById('mobile-role-switcher');
  if (mobileContainer) {
    mobileContainer.innerHTML = '';
    const allRoles = [...(available.length > 1 ? available : []), ...(hasStats ? ['statistics'] : [])];
    allRoles.forEach(role => {
      const label = role === 'statistics' ? 'Statistiken' : (ROLE_LABELS_SWITCHER[role] || role);
      const btn   = document.createElement('button');
      btn.className = 'mobile-role-btn' + (role === window.currentDashboardRole ? ' active' : '');
      btn.dataset.role = role;
      btn.innerHTML = `<span class="material-icons">${ROLE_ICONS[role] || 'dashboard'}</span>${label}`;
      btn.onclick = () => {
        window.currentDashboardRole = role;
        _updateSwitcherActive(document.getElementById('role-switcher'), role);
        _updateMobileActive(role);
        (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
        if (window._mobileDrawerClose) window._mobileDrawerClose();
      };
      mobileContainer.appendChild(btn);
    });
  }
}

function _applyActive(btn, isActive) {
  btn.style.opacity    = isActive ? '1' : '0.65';
  btn.style.background = isActive ? 'rgba(255,255,255,0.18)' : 'none';
  btn.style.fontWeight = isActive ? '700' : '400';
}

function _updateSwitcherActive(wrapper, activeRole) {
  if (!wrapper) return;
  wrapper.querySelectorAll('.role-switch-btn').forEach(b => _applyActive(b, b.dataset.role === activeRole));
}

function _updateMobileActive(activeRole) {
  document.querySelectorAll('.mobile-role-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.role === activeRole);
  });
}

function removeDashboardSwitcher() {
  const el = document.getElementById('role-switcher');
  if (el) el.remove();
  const mc = document.getElementById('mobile-role-switcher');
  if (mc) mc.innerHTML = '';
}

function renderLoginPage() {
  const container = document.getElementById('app-content');
  container.innerHTML = `
    <div class="card" style="max-width:400px;margin:48px auto;">
      <h2 style="margin-top:0;">Anmelden</h2>
      <form id="login-form">
        <label>E-Mail-Adresse</label>
        <input type="email" id="login-email" required autocomplete="email" />
        <label>Passwort</label>
        <input type="password" id="login-password" required autocomplete="current-password" />
        <div style="margin-top:14px;">
          <button type="submit" class="btn-primary" style="width:100%;">Anmelden</button>
        </div>
        <div style="text-align:center;margin-top:10px;">
          <button type="button" class="btn-text" id="forgot-pw-btn" style="font-size:0.85rem;">Passwort vergessen?</button>
        </div>
        <div id="login-error" class="text-error" style="margin-top:8px;"></div>
      </form>
    </div>
  `;

  const form    = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      await firebaseAuth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      console.error(err);
      const msgs = {
        'auth/user-not-found':    'Benutzer nicht gefunden.',
        'auth/wrong-password':    'Falsches Passwort.',
        'auth/invalid-email':     'Ungueltige E-Mail-Adresse.',
        'auth/too-many-requests': 'Zu viele Versuche. Bitte warte kurz.',
        'auth/invalid-credential':'E-Mail oder Passwort falsch.'
      };
      errorEl.textContent = msgs[err.code] || 'Anmeldung fehlgeschlagen.';
    }
  };

  document.getElementById('forgot-pw-btn').onclick = async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email) { errorEl.textContent = 'Bitte zuerst E-Mail eingeben.'; return; }
    try {
      await firebaseAuth.sendPasswordResetEmail(email);
      errorEl.style.color = 'var(--color-success)';
      errorEl.textContent = 'Passwort-Reset-E-Mail wurde gesendet.';
    } catch (err) {
      errorEl.style.color = '';
      errorEl.textContent = 'Fehler: ' + (err.message || err.code);
    }
  };
}
