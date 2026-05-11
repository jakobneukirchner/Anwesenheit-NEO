// js/auth.js

async function getUserData(uid) {
  const doc = await firestore.collection('users').doc(uid).get();
  if (!doc.exists) return { roles: [], displayName: '' };
  return doc.data();
}

firebaseAuth.onAuthStateChanged(async (user) => {
  const logoutBtn   = document.getElementById('logout-btn');
  const userNameEl  = document.getElementById('app-user-name');

  if (!user) {
    if (logoutBtn)  logoutBtn.hidden = true;
    if (userNameEl) userNameEl.textContent = '';
    renderLoginPage();
    return;
  }

  const userData = await getUserData(user.uid);
  window.currentUser = { firebaseUser: user, roles: userData.roles || [], displayName: userData.displayName || user.email };

  if (userNameEl) userNameEl.textContent = window.currentUser.displayName;
  if (logoutBtn) {
    logoutBtn.hidden = false;
    logoutBtn.onclick = () => firebaseAuth.signOut();
  }

  await applyBranding();
  routeToDashboard(window.currentUser.roles);
});

function routeToDashboard(roles) {
  if (roles.includes('admin'))       return loadAdminDashboard();
  if (roles.includes('coordinator')) return loadCoordinatorDashboard();
  if (roles.includes('teacher'))     return loadTrainerDashboard();
  return loadMemberDashboard();
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
        'auth/user-not-found':   'Benutzer nicht gefunden.',
        'auth/wrong-password':   'Falsches Passwort.',
        'auth/invalid-email':    'Ungültige E-Mail-Adresse.',
        'auth/too-many-requests':'Zu viele Versuche. Bitte warte kurz.'
      };
      errorEl.textContent = msgs[err.code] || 'Anmeldung fehlgeschlagen.';
    }
  };
}
