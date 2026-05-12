// js/auth.js

async function getUserData(uid) {
  const doc = await firestore.collection('users').doc(uid).get();
  if (!doc.exists) return { roles: [], displayName: '' };
  return doc.data();
}

// Branding so früh wie möglich laden – noch vor Login
applyBranding();

firebaseAuth.onAuthStateChanged(async (user) => {
  const logoutBtn  = document.getElementById('logout-btn');
  const profileBtn = document.getElementById('profile-btn');
  const userNameEl = document.getElementById('app-user-name');

  if (!user) {
    if (logoutBtn)  logoutBtn.hidden  = true;
    if (profileBtn) profileBtn.hidden = true;
    if (userNameEl) userNameEl.textContent = '';
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

  if (userNameEl) {
    userNameEl.textContent = window.currentUser.displayName;
    userNameEl.onclick = () => loadProfilePage();
  }
  if (logoutBtn) {
    logoutBtn.hidden = false;
    logoutBtn.onclick = () => firebaseAuth.signOut();
  }
  if (profileBtn) {
    profileBtn.hidden = false;
    profileBtn.onclick = () => loadProfilePage();
  }

  await applyBranding();
  routeToDashboard(window.currentUser.roles);
});

// Rollen-Priorität für normales Routing
const ROLE_ORDER = ['admin', 'coordinator', 'teacher', 'member'];

function getPrimaryRole(roles) {
  for (const r of ROLE_ORDER) {
    if (roles.includes(r)) return r;
  }
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

// Rollen die Zugriff auf Statistiken haben
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

  // Nur anzeigen wenn mehr als 1 Rolle ODER Statistiken verfügbar
  if (available.length <= 1 && !hasStats) return;

  const bar = document.querySelector('.app-actions');
  if (!bar) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'role-switcher';
  Object.assign(wrapper.style, { display:'flex', alignItems:'center', gap:'4px', marginRight:'8px' });

  // Dashboard-Buttons (nur wenn mehrere Rollen)
  if (available.length > 1) {
    available.forEach(role => {
      const btn = document.createElement('button');
      btn.className = 'btn-text role-switch-btn';
      btn.textContent = ROLE_LABELS_SWITCHER[role] || role;
      btn.dataset.role = role;
      Object.assign(btn.style, {
        fontSize: '0.82rem', padding: '4px 10px', borderRadius: '4px',
        opacity:    role === window.currentDashboardRole ? '1' : '0.65',
        background: role === window.currentDashboardRole ? 'rgba(255,255,255,0.18)' : 'none',
        fontWeight: role === window.currentDashboardRole ? '700' : '400'
      });
      btn.onclick = () => {
        window.currentDashboardRole = role;
        _updateSwitcherActive(wrapper, role);
        (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
      };
      wrapper.appendChild(btn);
    });
  }

  // Statistiken-Button für berechtigte Rollen
  if (hasStats) {
    // Trennlinie wenn schon andere Buttons da sind
    if (available.length > 1) {
      const sep = document.createElement('span');
      sep.textContent = '|';
      Object.assign(sep.style, { color: 'rgba(255,255,255,0.35)', fontSize: '0.9rem', padding: '0 2px' });
      wrapper.appendChild(sep);
    }

    const statsBtn = document.createElement('button');
    statsBtn.className = 'btn-text role-switch-btn';
    statsBtn.textContent = '\uD83D\uDCCA Statistiken';
    statsBtn.dataset.role = 'statistics';
    Object.assign(statsBtn.style, {
      fontSize: '0.82rem', padding: '4px 10px', borderRadius: '4px',
      opacity:    window.currentDashboardRole === 'statistics' ? '1' : '0.65',
      background: window.currentDashboardRole === 'statistics' ? 'rgba(255,255,255,0.18)' : 'none',
      fontWeight: window.currentDashboardRole === 'statistics' ? '700' : '400'
    });
    statsBtn.onclick = () => {
      window.currentDashboardRole = 'statistics';
      _updateSwitcherActive(wrapper, 'statistics');
      loadStatisticsDashboard();
    };
    wrapper.appendChild(statsBtn);
  }

  bar.insertBefore(wrapper, bar.firstChild);
}

function _updateSwitcherActive(wrapper, activeRole) {
  wrapper.querySelectorAll('.role-switch-btn').forEach(b => {
    const active = b.dataset.role === activeRole;
    b.style.opacity    = active ? '1' : '0.65';
    b.style.background = active ? 'rgba(255,255,255,0.18)' : 'none';
    b.style.fontWeight = active ? '700' : '400';
  });
}

function removeDashboardSwitcher() {
  const el = document.getElementById('role-switcher');
  if (el) el.remove();
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
        'auth/invalid-email':     'Ungültige E-Mail-Adresse.',
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
