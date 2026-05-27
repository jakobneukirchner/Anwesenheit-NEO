// js/auth.js

async function getUserData(uid) {
  const doc = await firestore.collection('users').doc(uid).get();
  if (!doc.exists) return { roles: [], displayName: '' };
  return doc.data();
}

applyBranding();

firebaseAuth.onAuthStateChanged(async (user) => {
  const logoutBtn     = document.getElementById('logout-btn');
  const profileBtn    = document.getElementById('profile-btn');
  const userNameEl    = document.getElementById('app-user-name');
  const mobileLogout  = document.getElementById('mobile-logout-btn');
  const mobileProfile = document.getElementById('mobile-profile-btn');
  const mobileNameEl  = document.getElementById('mobile-user-name');

  if (!user) {
    if (logoutBtn) logoutBtn.hidden = true;
    if (profileBtn) profileBtn.hidden = true;
    if (userNameEl) userNameEl.textContent = '';
    if (mobileLogout) mobileLogout.hidden = true;
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
    mobileLogout.onclick = () => {
      if (window._mobileDrawerClose) window._mobileDrawerClose();
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
  statistics:  () => loadStatisticsDashboard()
};

const ROLE_LABELS_SWITCHER = {
  admin: 'Admin',
  coordinator: 'Koordinator',
  teacher: 'Trainer',
  member: 'Mitglieder'
};

const ROLE_ICONS = {
  admin: 'admin_panel_settings',
  coordinator: 'supervisor_account',
  teacher: 'sports',
  member: 'group',
  statistics: 'bar_chart'
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
  const hasStats = STATS_ROLES.some(r => roles.includes(r));
  if (available.length <= 1 && !hasStats) return;

  const desktopBar = document.querySelector('#app-actions-desktop');
  if (desktopBar) {
    const wrapper = document.createElement('div');
    wrapper.id = 'role-switcher';
    Object.assign(wrapper.style, { display: 'flex', alignItems: 'center', gap: '2px', marginRight: '6px' });

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

    if (available.length > 1) available.forEach(r => wrapper.appendChild(makeBtn(r, ROLE_LABELS_SWITCHER[r] || r)));
    if (hasStats) {
      if (available.length > 1) {
        const sep = document.createElement('span');
        sep.textContent = '|';
        Object.assign(sep.style, { color: 'rgba(255,255,255,0.35)', fontSize: '0.9rem', padding: '0 2px' });
        wrapper.appendChild(sep);
      }
      wrapper.appendChild(makeBtn('statistics', 'Statistiken'));
    }
    desktopBar.insertBefore(wrapper, desktopBar.firstChild);
  }

  const mobileContainer = document.getElementById('mobile-role-switcher');
  if (mobileContainer) {
    mobileContainer.innerHTML = '';
    const allRoles = [...(available.length > 1 ? available : []), ...(hasStats ? ['statistics'] : [])];
    allRoles.forEach(role => {
      const label = role === 'statistics' ? 'Statistiken' : (ROLE_LABELS_SWITCHER[role] || role);
      const btn = document.createElement('button');
      btn.className = 'mobile-role-btn' + (role === window.currentDashboardRole ? ' active' : '');
      btn.dataset.role = role;
      btn.innerHTML = `<span class="material-icons">${ROLE_ICONS[role] || 'dashboard'}</span><span>${label}</span>`;
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
  btn.style.opacity = isActive ? '1' : '0.65';
  btn.style.background = isActive ? 'rgba(255,255,255,0.18)' : 'none';
  btn.style.fontWeight = isActive ? '700' : '400';
}
function _updateSwitcherActive(wrapper, activeRole) {
  if (!wrapper) return;
  wrapper.querySelectorAll('.role-switch-btn').forEach(b => _applyActive(b, b.dataset.role === activeRole));
}
function _updateMobileActive(activeRole) {
  document.querySelectorAll('.mobile-role-btn').forEach(b => b.classList.toggle('active', b.dataset.role === activeRole));
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
    <div class="card login-card" id="login-card" style="max-width:400px;margin:48px auto;">
      <h2 style="margin-top:0;">Anmelden</h2>
      <form id="login-form">
        <label>E-Mail-Adresse</label>
        <input type="email" id="login-email" required autocomplete="email" />
        <label>Passwort</label>
        <input type="password" id="login-password" required autocomplete="current-password" />
        <div style="margin-top:14px;">
          <button type="submit" class="btn-primary" id="login-submit-btn" style="width:100%;justify-content:center;">
            <span class="material-icons" id="login-btn-icon">login</span>
            <span id="login-btn-label">Anmelden</span>
          </button>
        </div>
        <div style="text-align:center;margin-top:10px;">
          <button type="button" class="btn-text" id="forgot-pw-btn" style="font-size:0.85rem;">
            <span class="material-icons">lock_reset</span>
            <span>Passwort vergessen?</span>
          </button>
        </div>
        <div id="login-error" style="margin-top:8px;"></div>
      </form>

      <!-- Ladeoverlay innerhalb der Karte -->
      <div id="login-loading-overlay" style="
        display:none;
        position:absolute;inset:0;
        background:rgba(255,255,255,0.82);
        border-radius:var(--radius-medium);
        z-index:10;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:12px;
      ">
        <div class="login-spinner"></div>
        <span style="font-size:0.9rem;color:var(--color-text-muted);">Anmeldung läuft&hellip;</span>
      </div>
    </div>
  `;

  // Karte braucht position:relative für das Overlay
  document.getElementById('login-card').style.position = 'relative';

  const form      = document.getElementById('login-form');
  const errorEl   = document.getElementById('login-error');
  const overlay   = document.getElementById('login-loading-overlay');
  const submitBtn = document.getElementById('login-submit-btn');
  const emailInput = document.getElementById('login-email');

  function showLoading(on) {
    overlay.style.display = on ? 'flex' : 'none';
    submitBtn.disabled = on;
  }

  function showError(msg) {
    const card = document.getElementById('login-card');
    errorEl.innerHTML = `
      <div class="login-error-box">
        <span class="material-icons" style="font-size:18px;flex-shrink:0;">error</span>
        <span>${msg}</span>
      </div>`;
    if (card) {
      card.classList.remove('login-shake');
      void card.offsetWidth;
      card.classList.add('login-shake');
    }
  }

  // Echtzeit-Hinweis wenn E-Mail leer bleibt und Fokus verlassen wird
  emailInput.addEventListener('blur', () => {
    if (!emailInput.value.trim()) {
      errorEl.innerHTML = `
        <div class="login-error-box" style="background:rgba(245,124,0,0.08);border-color:var(--color-warning,#e65100);color:var(--color-warning,#e65100);">
          <span class="material-icons" style="font-size:18px;flex-shrink:0;">info</span>
          <span>Bitte gib deine E-Mail-Adresse ein.</span>
        </div>`;
    } else {
      // Hinweis wegräumen wenn wieder was drin steht
      const box = errorEl.querySelector('.login-error-box');
      if (box && box.querySelector('span:last-child')?.textContent?.includes('E-Mail-Adresse')) {
        errorEl.innerHTML = '';
      }
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const email    = emailInput.value.trim();
    const password = document.getElementById('login-password').value;

    // Explizite Prüfung: E-Mail leer?
    if (!email) {
      showError('Bitte gib deine E-Mail-Adresse ein.');
      emailInput.focus();
      return;
    }

    errorEl.innerHTML = '';
    showLoading(true);
    try {
      await firebaseAuth.signInWithEmailAndPassword(email, password);
      // onAuthStateChanged übernimmt Navigation
    } catch (err) {
      console.error(err);
      showLoading(false);
      const msgs = {
        'auth/user-not-found':    'Benutzer nicht gefunden.',
        'auth/wrong-password':    'Falsches Passwort.',
        'auth/invalid-email':     'Ungültige E-Mail-Adresse.',
        'auth/too-many-requests': 'Zu viele Versuche. Bitte warte kurz.',
        'auth/invalid-credential':'E-Mail oder Passwort falsch.'
      };
      showError(msgs[err.code] || 'Anmeldung fehlgeschlagen.');
    }
  };

  document.getElementById('forgot-pw-btn').onclick = async () => {
    const email = emailInput.value.trim();
    if (!email) { showError('Bitte zuerst E-Mail-Adresse eingeben.'); emailInput.focus(); return; }
    try {
      await firebaseAuth.sendPasswordResetEmail(email);
      errorEl.innerHTML = `<div style="color:var(--color-success);font-size:0.85rem;margin-top:4px;display:flex;align-items:center;gap:6px;"><span class="material-icons" style="font-size:16px;">check_circle</span>Passwort-Reset-E-Mail wurde gesendet.</div>`;
    } catch (err) {
      showError('Fehler: ' + (err.message || err.code));
    }
  };
}
