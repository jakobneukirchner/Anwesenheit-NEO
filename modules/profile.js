// modules/profile.js

async function loadProfilePage() {
  const container = document.getElementById('app-content');
  const fbUser    = window.currentUser.firebaseUser;
  container.innerHTML = `<div class="loading-center">Lade Profil...</div>`;

  try {
    const userDoc  = await firestore.collection('users').doc(fbUser.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
        <button class="btn-secondary" id="profile-back" style="padding:6px 16px;">&larr; Zurück</button>
        <h2 style="margin:0;">Mein Konto</h2>
      </div>

      <!-- Profil -->
      <div class="card">
        <h3 style="margin-top:0;">Profil</h3>
        <label>Anzeigename</label>
        <input type="text" id="prof-name" value="${userData.displayName || ''}" />
        <label>E-Mail-Adresse</label>
        <input type="email" id="prof-email" value="${fbUser.email || ''}" />
        <label>Allgemeine Notiz (nur für Trainer/Koordinatoren sichtbar)</label>
        <textarea id="prof-note" rows="3" placeholder="z.B. gesundheitliche Hinweise, Besonderheiten...">${userData.generalNote || ''}</textarea>
        <button class="btn-primary" id="prof-save" style="margin-top:4px;">Profil speichern</button>
        <div id="prof-error" class="text-error" style="margin-top:6px;"></div>
      </div>

      <!-- Passwort -->
      <div class="card" style="margin-top:16px;">
        <h3 style="margin-top:0;">Passwort ändern</h3>
        <label>Aktuelles Passwort</label>
        <input type="password" id="pw-current" autocomplete="current-password" />
        <label>Neues Passwort (mind. 6 Zeichen)</label>
        <input type="password" id="pw-new" autocomplete="new-password" />
        <label>Neues Passwort bestätigen</label>
        <input type="password" id="pw-confirm" autocomplete="new-password" />
        <button class="btn-primary" id="pw-save" style="margin-top:4px;">Passwort ändern</button>
        <div id="pw-error" class="text-error" style="margin-top:6px;"></div>
      </div>

      <!-- Weggeklickte Nachrichten -->
      <div class="card" style="margin-top:16px;">
        <h3 style="margin-top:0;">Weggeklickte Nachrichten</h3>
        <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:12px;">
          Nachrichten die du weggeklickt hast, aber noch aktiv sind.
        </p>
        <div id="dismissed-msgs-container"></div>
      </div>
    `;

    document.getElementById('profile-back').onclick = () => {
      routeToDashboard(window.currentUser.roles);
    };

    // Weggeklickte Nachrichten laden
    if (typeof renderDismissedMessagesSection === 'function') {
      renderDismissedMessagesSection(document.getElementById('dismissed-msgs-container'));
    }

    // --- Profil speichern
    document.getElementById('prof-save').onclick = async () => {
      const errEl = document.getElementById('prof-error');
      errEl.textContent = '';
      const newName  = document.getElementById('prof-name').value.trim();
      const newEmail = document.getElementById('prof-email').value.trim();
      const newNote  = document.getElementById('prof-note').value.trim();

      if (!newName) { errEl.textContent = 'Name darf nicht leer sein.'; return; }
      if (!newEmail) { errEl.textContent = 'E-Mail darf nicht leer sein.'; return; }

      try {
        // E-Mail in Firebase Auth ändern
        if (newEmail !== fbUser.email) {
          await fbUser.updateEmail(newEmail);
        }
        // Firestore-User-Doc aktualisieren
        await firestore.collection('users').doc(fbUser.uid).update({
          displayName: newName,
          email:       newEmail,
          generalNote: newNote,
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
        });
        window.currentUser.displayName = newName;
        const userNameEl = document.getElementById('app-user-name');
        if (userNameEl) userNameEl.textContent = newName;
        showToast('Profil gespeichert.', 'success');
      } catch (e) {
        console.error(e);
        const msgs = {
          'auth/requires-recent-login': 'Bitte melde dich erneut an, um E-Mail zu ändern.',
          'auth/email-already-in-use':  'Diese E-Mail wird bereits verwendet.',
          'auth/invalid-email':         'Ungültige E-Mail-Adresse.',
        };
        errEl.textContent = msgs[e.code] || ('Fehler: ' + e.message);
      }
    };

    // --- Passwort ändern
    document.getElementById('pw-save').onclick = async () => {
      const errEl   = document.getElementById('pw-error');
      errEl.textContent = '';
      const current  = document.getElementById('pw-current').value;
      const newPw    = document.getElementById('pw-new').value;
      const confirm  = document.getElementById('pw-confirm').value;

      if (!current) { errEl.textContent = 'Bitte aktuelles Passwort eingeben.'; return; }
      if (newPw.length < 6) { errEl.textContent = 'Neues Passwort muss mind. 6 Zeichen haben.'; return; }
      if (newPw !== confirm) { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }

      try {
        // Re-Authentifizierung erforderlich
        const credential = firebase.auth.EmailAuthProvider.credential(fbUser.email, current);
        await fbUser.reauthenticateWithCredential(credential);
        await fbUser.updatePassword(newPw);
        document.getElementById('pw-current').value = '';
        document.getElementById('pw-new').value     = '';
        document.getElementById('pw-confirm').value = '';
        showToast('Passwort erfolgreich geändert.', 'success');
      } catch (e) {
        console.error(e);
        const msgs = {
          'auth/wrong-password':        'Aktuelles Passwort ist falsch.',
          'auth/too-many-requests':     'Zu viele Versuche. Bitte warte.',
          'auth/weak-password':         'Passwort ist zu schwach.',
          'auth/invalid-credential':    'Aktuelles Passwort ist falsch.',
        };
        errEl.textContent = msgs[e.code] || ('Fehler: ' + e.message);
      }
    };

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden des Profils.</p>';
  }
}
