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
  const userNameEl = document.getElementById('app-user-name');

  if (!user) {
    if (logoutBtn)  logoutBtn.hidden = true;
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

  if (userNameEl) userNameEl.textContent = window.currentUser.displayName;
  if (logoutBtn) {
    logoutBtn.hidden = false;
    logoutBtn.onclick = () => firebaseAuth.signOut();
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
  member:      () => loadMemberDashboard()
};

const ROLE_LABELS_SWITCHER = {
  admin:       'Admin-Dashboard',
  coordinator: 'Koordinator-Dashboard',
  teacher:     'Trainer-Dashboard',
  member:      'Mitglieder-Dashboard'
};

function routeToDashboard(roles, forceRole) {
  const role = forceRole || getPrimaryRole(roles);
  window.currentDashboardRole = role;
  renderDashboardSwitcher(roles);
  (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
}

function renderDashboardSwitcher(roles) {
  removeDashboardSwitcher();

  // Nur anzeigen wenn User mehrere Rollen hat
  const available = ROLE_ORDER.filter(r => roles.includes(r));
  if (available.length <= 1) return;

  const bar = document.querySelector('.app-actions');
  if (!bar) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'role-switcher';
  Object.assign(wrapper.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginRight: '8px'
  });

  available.forEach(role => {
    const btn = document.createElement('button');
    btn.className = 'btn-text role-switch-btn';
    btn.textContent = ROLE_LABELS_SWITCHER[role] || role;
    btn.dataset.role = role;
    Object.assign(btn.style, {
      fontSize: '0.82rem',
      padding: '4px 10px',
      borderRadius: '4px',
      opacity: role === window.currentDashboardRole ? '1' : '0.65',
      background: role === window.currentDashboardRole ? 'rgba(255,255,255,0.18)' : 'none',
      fontWeight: role === window.currentDashboardRole ? '700' : '400'
    });
    btn.onclick = () => {
      window.currentDashboardRole = role;
      // Alle Buttons aktualisieren
      wrapper.querySelectorAll('.role-switch-btn').forEach(b => {
        const active = b.dataset.role === role;
        b.style.opacity = active ? '1' : '0.65';
        b.style.background = active ? 'rgba(255,255,255,0.18)' : 'none';
        b.style.fontWeight = active ? '700' : '400';
      });
      (DASHBOARD_LOADERS[role] || DASHBOARD_LOADERS.member)();
    };
    wrapper.appendChild(btn);
  });

  bar.insertBefore(wrapper, bar.firstChild);
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
}
