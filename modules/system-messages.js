// modules/system-messages.js
// System-Nachrichten: Banner für alle Dashboards + Verwaltungs-Tab für Koordinatoren

/* ─── Typen & visuelle Konfiguration ─────────────────────────────────────────── */
const MSG_TYPES = {
  info:    { icon: 'info',          label: 'Info',    bg: 'var(--color-blue-highlight)',     border: 'var(--color-blue)',     text: 'var(--color-blue)',    critical: false },
  warning: { icon: 'warning',       label: 'Warnung', bg: 'var(--color-warning-highlight)',  border: 'var(--color-warning)', text: 'var(--color-warning)', critical: true  },
  danger:  { icon: 'error',         label: 'Achtung', bg: 'var(--color-error-highlight)',    border: 'var(--color-error)',   text: 'var(--color-error)',   critical: true  },
  success: { icon: 'check_circle',  label: 'Erfolg',  bg: 'var(--color-success-highlight)', border: 'var(--color-success)', text: 'var(--color-success)', critical: false },
};

/* ─── Banner CSS (injiziert einmalig) ────────────────────────────────────────── */
(function injectBannerStyles() {
  if (document.getElementById('sys-msg-style')) return;
  const s = document.createElement('style');
  s.id = 'sys-msg-style';
  s.textContent = `
    #sys-msg-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      font-size: 0.88rem;
      line-height: 1.4;
      border-bottom: 2px solid transparent;
      transition: background 0.2s, border-color 0.2s;
      position: relative;
      flex-wrap: wrap;
    }
    #sys-msg-banner .smb-icon { font-size: 20px; flex-shrink: 0; }
    #sys-msg-banner .smb-title { font-weight: 600; margin-right: 4px; }
    #sys-msg-banner .smb-text { flex: 1; min-width: 0; }
    #sys-msg-banner .smb-more {
      background: none; border: none; cursor: pointer;
      font-size: 0.82rem; text-decoration: underline; padding: 0; white-space: nowrap;
      color: inherit; flex-shrink: 0;
    }
    #sys-msg-banner .smb-dismiss {
      background: none; border: none; cursor: pointer;
      font-size: 20px; padding: 0; line-height: 1; flex-shrink: 0;
      color: inherit; opacity: 0.65;
    }
    #sys-msg-banner .smb-dismiss:hover { opacity: 1; }
    .sys-msg-card {
      border-left: 3px solid;
      border-radius: var(--radius-md);
      padding: 12px 14px;
      margin-bottom: 10px;
      font-size: 0.88rem;
    }
    .sys-msg-card:last-child { margin-bottom: 0; }
    .sys-msg-card .smc-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .sys-msg-card .smc-icon { font-size: 18px; flex-shrink: 0; }
    .sys-msg-card .smc-title { font-weight: 600; }
    .sys-msg-card .smc-meta { font-size: 0.78rem; margin-top: 6px; opacity: 0.7; }

    /* Kritisches Nachrichten-Modal */
    .sys-critical-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 9000;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      animation: sysMsgFadeIn 0.2s ease;
    }
    @keyframes sysMsgFadeIn { from { opacity:0; } to { opacity:1; } }
    .sys-critical-modal {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: 0 8px 40px rgba(0,0,0,0.22);
      max-width: 520px;
      width: 100%;
      max-height: 80vh;
      overflow-y: auto;
      padding: 0;
      animation: sysMsgSlideIn 0.25s cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes sysMsgSlideIn { from { transform: translateY(24px); opacity:0; } to { transform: translateY(0); opacity:1; } }
    .sys-critical-modal-header {
      display: flex; align-items: center; gap: 10px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--color-border);
    }
    .sys-critical-modal-header .scm-icon { font-size: 26px; flex-shrink: 0; }
    .sys-critical-modal-header h3 { margin: 0; font-size: 1rem; }
    .sys-critical-modal-body { padding: 16px 20px; }
    .sys-critical-modal-footer {
      padding: 12px 20px 18px;
      display: flex; justify-content: flex-end;
    }

    /* Weggeklickte Nachrichten in Profil */
    .dismissed-msg-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      margin-bottom: 8px;
      font-size: 0.88rem;
    }
    .dismissed-msg-card:last-child { margin-bottom: 0; }
    .dismissed-msg-card .dmc-body { flex: 1; }
    .dismissed-msg-card .dmc-title { font-weight: 600; margin-bottom: 2px; }
    .dismissed-msg-card .dmc-restore {
      background: none; border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      cursor: pointer; font-size: 0.78rem; padding: 2px 8px; white-space: nowrap;
      color: var(--color-text-muted);
    }
    .dismissed-msg-card .dmc-restore:hover { color: var(--color-text); border-color: var(--color-text-muted); }
  `;
  document.head.appendChild(s);
})();

/* ─── Dismiss-State (sessionStorage, 30min TTL) ──────────────────────────────── */
const _DISMISS_KEY  = 'neo_dismissed_msgs';
const _DISMISS_TTL  = 30 * 60 * 1000;
const _FIRST_LOAD_KEY = 'neo_first_load_ts';

function _loadDismissed() {
  try {
    const raw = sessionStorage.getItem(_DISMISS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    const now = Date.now();
    Object.keys(data).forEach(k => { if (now - data[k] > _DISMISS_TTL) delete data[k]; });
    return data;
  } catch { return {}; }
}

function _saveDismissed(data) {
  try { sessionStorage.setItem(_DISMISS_KEY, JSON.stringify(data)); } catch {}
}

let _dismissedMap = _loadDismissed();

function _isDismissed(id) {
  const ts = _dismissedMap[id];
  if (!ts) return false;
  if (Date.now() - ts > _DISMISS_TTL) { delete _dismissedMap[id]; _saveDismissed(_dismissedMap); return false; }
  return true;
}

function _dismiss(id) {
  _dismissedMap[id] = Date.now();
  _saveDismissed(_dismissedMap);
}

function _undismiss(id) {
  delete _dismissedMap[id];
  _saveDismissed(_dismissedMap);
}

/* ─── Erstes-Laden-Marker (30min TTL) ───────────────────────────────────────── */
function _isFirstLoad() {
  try {
    const ts = parseInt(sessionStorage.getItem(_FIRST_LOAD_KEY) || '0', 10);
    const now = Date.now();
    if (!ts || now - ts > _DISMISS_TTL) {
      sessionStorage.setItem(_FIRST_LOAD_KEY, String(now));
      return true;
    }
    return false;
  } catch { return true; }
}

/* ─── Hilfsfunktionen ────────────────────────────────────────────────────────── */
function _msgIsActive(msg) {
  const now = Date.now();
  if (!msg.active) return false;
  if (msg.startAt) {
    const start = msg.startAt.toDate ? msg.startAt.toDate() : new Date(msg.startAt);
    if (start.getTime() > now) return false;
  }
  if (msg.endAt) {
    const end = msg.endAt.toDate ? msg.endAt.toDate() : new Date(msg.endAt);
    if (end.getTime() < now) return false;
  }
  return true;
}

function _msgMatchesUser(msg) {
  const uid    = window.currentUser?.firebaseUser?.uid;
  const groups = window.currentUser?.groups || [];
  if (!msg.recipients || msg.recipients === 'all') return true;
  if (msg.recipients === 'users') {
    return Array.isArray(msg.recipientUsers) && msg.recipientUsers.includes(uid);
  }
  if (msg.recipients === 'groups') {
    return Array.isArray(msg.recipientGroups) && msg.recipientGroups.some(gid => groups.includes(gid));
  }
  return true;
}

function _formatMsgDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

/* ─── App-Bar Element finden (ID oder Klasse) ────────────────────────────────── */
function _getAppBarEl() {
  return document.getElementById('app-bar') || document.querySelector('.app-bar') || null;
}

/* ─── Kritische Nachrichten als Vollbild-Modal ───────────────────────────────── */
function _showCriticalModal(criticalMsgs) {
  const overlay = document.createElement('div');
  overlay.className = 'sys-critical-modal-overlay';

  // Im Modal: Gültig-bis wird angezeigt
  const cards = criticalMsgs.map(m => {
    const cfg   = MSG_TYPES[m.type] || MSG_TYPES.warning;
    const until = m.endAt ? `<div class="smc-meta">Gültig bis ${_formatMsgDate(m.endAt)}</div>` : '';
    return `
      <div class="sys-msg-card" style="background:${cfg.bg};border-color:${cfg.border};color:${cfg.text};">
        <div class="smc-header">
          <span class="material-icons smc-icon">${cfg.icon}</span>
          <span class="smc-title">${m.title || cfg.label}</span>
        </div>
        <div>${m.message || ''}</div>
        ${until}
      </div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="sys-critical-modal">
      <div class="sys-critical-modal-header" style="color:var(--color-error);">
        <span class="material-icons scm-icon">notification_important</span>
        <h3>Wichtige Hinweise</h3>
      </div>
      <div class="sys-critical-modal-body">${cards}</div>
      <div class="sys-critical-modal-footer">
        <button class="btn-primary" id="sys-critical-close">Verstanden</button>
      </div>
    </div>`;

  overlay.querySelector('#sys-critical-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

/* ─── Banner rendern ─────────────────────────────────────────────────────────── */
async function renderSystemMessageBanner() {
  const old = document.getElementById('sys-msg-banner');
  if (old) old.remove();

  let msgs = [];
  try {
    const snap = await firestore.collection('systemMessages').get();
    snap.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
  } catch (e) { return; }

  const isFirst = _isFirstLoad();

  const allActive = msgs
    .filter(m => _msgIsActive(m) && _msgMatchesUser(m))
    .sort((a, b) => {
      const order = { danger:0, warning:1, info:2, success:3 };
      return (order[a.type]??2) - (order[b.type]??2);
    });

  // Beim ersten Laden (innerhalb 30min): kritische Nachrichten als Modal
  if (isFirst) {
    const criticals = allActive.filter(m => (MSG_TYPES[m.type]||{}).critical && !_isDismissed(m.id));
    if (criticals.length) {
      setTimeout(() => _showCriticalModal(criticals), 400);
    }
  }

  // Banner: alle nicht-dismissten aktiven Nachrichten
  const bannerMsgs = allActive.filter(m => !_isDismissed(m.id));
  if (!bannerMsgs.length) return;

  const appBar = _getAppBarEl();
  if (!appBar) return;

  const main = bannerMsgs[0];
  const rest = bannerMsgs.slice(1);
  const cfg  = MSG_TYPES[main.type] || MSG_TYPES.info;

  const banner = document.createElement('div');
  banner.id = 'sys-msg-banner';
  banner.style.background  = cfg.bg;
  banner.style.borderColor = cfg.border;
  banner.style.color       = cfg.text;

  // Banner: kein 'Gültig bis' – nur Icon, Titel und Nachrichtentext
  banner.innerHTML = `
    <span class="material-icons smb-icon">${cfg.icon}</span>
    <div class="smb-text">
      ${main.title ? `<span class="smb-title">${main.title}:</span>` : ''}
      ${main.message || ''}
    </div>
    ${rest.length ? `<button class="smb-more">${rest.length} weitere</button>` : ''}
    <button class="smb-dismiss" title="Schließen" aria-label="Schließen">
      <span class="material-icons" style="font-size:18px;">close</span>
    </button>`;

  banner.querySelector('.smb-dismiss').onclick = () => {
    _dismiss(main.id);
    banner.remove();
    renderSystemMessageBanner();
  };

  if (rest.length) {
    banner.querySelector('.smb-more').onclick = () => showAllMessagesModal(bannerMsgs);
  }

  appBar.insertAdjacentElement('afterend', banner);
}

/* ─── Alle Nachrichten Modal ─────────────────────────────────────────────────── */
function showAllMessagesModal(msgs) {
  // Im Modal: Gültig-bis wird angezeigt
  const cards = msgs.map(m => {
    const cfg = MSG_TYPES[m.type] || MSG_TYPES.info;
    const until = m.endAt ? `<div class="smc-meta">Gültig bis ${_formatMsgDate(m.endAt)}</div>` : '';
    return `
      <div class="sys-msg-card" style="background:${cfg.bg};border-color:${cfg.border};color:${cfg.text};">
        <div class="smc-header">
          <span class="material-icons smc-icon">${cfg.icon}</span>
          <span class="smc-title">${m.title || cfg.label}</span>
          <span class="chip" style="font-size:0.72rem;margin-left:auto;">${cfg.label}</span>
        </div>
        <div>${m.message || ''}</div>
        ${until}
      </div>`;
  }).join('');

  showModal({
    title: 'Systemnachrichten',
    body: `<div style="max-height:70vh;overflow-y:auto;">${cards}</div>`,
    confirmLabel: null,
    cancelLabel: 'Schließen'
  });
}

/* ─── Weggeklickte Nachrichten: für Profil-Seite ─────────────────────────────── */
async function getDismissedMessagesData() {
  const activeIds = Object.keys(_dismissedMap).filter(id => _isDismissed(id));
  if (!activeIds.length) return [];

  let msgs = [];
  try {
    const snap = await firestore.collection('systemMessages').get();
    snap.forEach(doc => {
      const d = { id: doc.id, ...doc.data() };
      if (activeIds.includes(d.id) && _msgIsActive(d) && _msgMatchesUser(d)) msgs.push(d);
    });
  } catch { return []; }
  return msgs;
}

function undismissMessage(id) {
  _undismiss(id);
  renderSystemMessageBanner();
}

async function renderDismissedMessagesSection(containerEl) {
  const msgs = await getDismissedMessagesData();

  if (!msgs.length) {
    containerEl.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted);margin:0;">Keine weggeklickten Nachrichten vorhanden.</p>';
    return;
  }

  // In der Profil-Sektion: Gültig-bis wird angezeigt
  containerEl.innerHTML = msgs.map(m => {
    const cfg = MSG_TYPES[m.type] || MSG_TYPES.info;
    return `
      <div class="dismissed-msg-card" style="background:${cfg.bg};border-color:${cfg.border};">
        <span class="material-icons" style="font-size:18px;color:${cfg.text};flex-shrink:0;">${cfg.icon}</span>
        <div class="dmc-body">
          <div class="dmc-title" style="color:${cfg.text};">${m.title || cfg.label}</div>
          <div style="color:var(--color-text);">${m.message || ''}</div>
          ${m.endAt ? `<div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:3px;">Gültig bis ${_formatMsgDate(m.endAt)}</div>` : ''}
        </div>
        <button class="dmc-restore" data-msg-id="${m.id}">Wieder anzeigen</button>
      </div>`;
  }).join('');

  containerEl.querySelectorAll('.dmc-restore').forEach(btn => {
    btn.onclick = () => {
      undismissMessage(btn.dataset.msgId);
      renderDismissedMessagesSection(containerEl);
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   KOORDINATOR-VERWALTUNG
═══════════════════════════════════════════════════════════════════════════════ */

async function renderSystemMessagesTab(el) {
  el.innerHTML = `<div class="loading-center">Lade Nachrichten...</div>`;
  try {
    const snap = await firestore.collection('systemMessages').get();
    const msgs = [];
    snap.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
    msgs.sort((a, b) => {
      const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return tb - ta;
    });

    const gSnap = await firestore.collection('groups').get();
    const allGroups = [];
    gSnap.forEach(doc => allGroups.push({ id: doc.id, ...doc.data() }));
    allGroups.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;">Systemnachrichten (${msgs.length})</h3>
        <button class="btn-primary" id="sm-add-btn" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">add</span> Neue Nachricht
        </button>
      </div>
      ${msgs.length ? _renderMsgTable(msgs) : '<p class="text-muted">Noch keine Nachrichten vorhanden.</p>'}`;

    el.querySelector('#sm-add-btn').onclick = () => showMsgForm(null, allGroups, el);

    el.querySelectorAll('[data-sm-action="toggle"]').forEach(btn => {
      btn.onclick = () => _toggleMsg(btn.dataset.id, btn.dataset.active === 'true', el);
    });
    el.querySelectorAll('[data-sm-action="edit"]').forEach(btn => {
      btn.onclick = () => showMsgForm(msgs.find(m => m.id === btn.dataset.id), allGroups, el);
    });
    el.querySelectorAll('[data-sm-action="delete"]').forEach(btn => {
      btn.onclick = () => _confirmDeleteMsg(msgs.find(m => m.id === btn.dataset.id), el);
    });
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
  }
}

function _renderMsgTable(msgs) {
  const rows = msgs.map(m => {
    const cfg   = MSG_TYPES[m.type] || MSG_TYPES.info;
    const start = m.startAt ? _formatMsgDate(m.startAt) : '–';
    const end   = m.endAt   ? _formatMsgDate(m.endAt)   : '∞';
    const recip = m.recipients === 'groups' ? 'Gruppen'
                : m.recipients === 'users'  ? 'Benutzer'
                : 'Alle';
    return `
      <tr>
        <td>
          <span class="chip" style="background:${cfg.bg};color:${cfg.text};border:1px solid ${cfg.border};font-size:0.78rem;">
            <span class="material-icons" style="font-size:13px;vertical-align:middle;">${cfg.icon}</span>
            ${cfg.label}
          </span>
        </td>
        <td>
          <strong>${m.title || '–'}</strong>
          <div style="font-size:0.78rem;color:var(--color-text-muted);margin-top:2px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.message || ''}</div>
        </td>
        <td style="font-size:0.82rem;white-space:nowrap;">${recip}</td>
        <td style="font-size:0.78rem;white-space:nowrap;">${start}<br>→ ${end}</td>
        <td>
          ${m.active
            ? `<span style="color:var(--color-success);font-size:0.82rem;display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">check_circle</span>Aktiv</span>`
            : `<span style="color:var(--color-text-muted);font-size:0.82rem;display:inline-flex;align-items:center;gap:4px;"><span class="material-icons" style="font-size:14px;">pause_circle</span>Inaktiv</span>`}
        </td>
        <td style="white-space:nowrap;">
          <button class="btn-secondary" data-sm-action="toggle" data-id="${m.id}" data-active="${m.active}"
            style="padding:3px 10px;font-size:0.8rem;">${m.active ? 'Deaktivieren' : 'Aktivieren'}</button>
          <button class="btn-secondary" data-sm-action="edit" data-id="${m.id}"
            style="padding:3px 10px;font-size:0.8rem;margin-left:4px;">Bearbeiten</button>
          <button class="btn-danger" data-sm-action="delete" data-id="${m.id}"
            style="padding:3px 10px;font-size:0.8rem;margin-left:4px;">Löschen</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="width:100%;overflow-x:auto;">
      <table style="width:100%;min-width:640px;">
        <thead>
          <tr>
            <th>Typ</th><th>Titel / Nachricht</th><th>Empfänger</th>
            <th>Zeitraum</th><th>Status</th><th>Aktionen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function _toggleMsg(id, currentlyActive, parentEl) {
  try {
    await firestore.collection('systemMessages').doc(id).update({ active: !currentlyActive });
    showToast(currentlyActive ? 'Nachricht deaktiviert.' : 'Nachricht aktiviert.', 'success');
    renderSystemMessagesTab(parentEl);
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  }
}

function _confirmDeleteMsg(msg, parentEl) {
  showModal({
    title: 'Nachricht löschen',
    body: `<p>Soll die Nachricht <strong>${msg.title || '(ohne Titel)'}</strong> wirklich gelöscht werden?</p>`,
    confirmLabel: 'Löschen',
    onConfirm: async () => {
      try {
        await firestore.collection('systemMessages').doc(msg.id).delete();
        showToast('Nachricht gelöscht.', 'success');
        renderSystemMessagesTab(parentEl);
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });
}

/* ─── Nachricht anlegen / bearbeiten ─────────────────────────────────────────── */
async function showMsgForm(msg, allGroups, parentEl) {
  const isNew = !msg;

  const toLocalDt = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const hasPeriod = !!(msg?.startAt || msg?.endAt);

  showModal({
    title: isNew ? 'Neue Systemnachricht' : 'Nachricht bearbeiten',
    body: `
      <label>Typ</label>
      <select id="sm-type">
        ${Object.entries(MSG_TYPES).map(([k,v]) =>
          `<option value="${k}" ${(msg?.type||'info')===k?'selected':''}>${v.label}</option>`
        ).join('')}
      </select>

      <label>Titel</label>
      <input type="text" id="sm-title" value="${msg?.title||''}" placeholder="Kurzer Titel (optional)" />

      <label>Nachricht</label>
      <textarea id="sm-message" rows="3" style="width:100%;">${msg?.message||''}</textarea>

      <label style="margin-top:10px;">Empfänger</label>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;" id="sm-recip-radios">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="sm-recip" value="all" ${(!msg?.recipients||msg.recipients==='all')?'checked':''}/>
          Alle Benutzer
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="sm-recip" value="groups" ${msg?.recipients==='groups'?'checked':''}/>
          Bestimmte Gruppen
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="sm-recip" value="users" ${msg?.recipients==='users'?'checked':''}/>
          Bestimmte Benutzer
        </label>
      </div>

      <div id="sm-groups-section" style="margin-top:8px;display:${msg?.recipients==='groups'?'block':'none'};">
        <div id="sm-groups-list" style="display:flex;flex-direction:column;gap:3px;max-height:140px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px;">
          <!-- Wird per JS befüllt -->
        </div>
      </div>

      <div id="sm-users-section" style="margin-top:8px;display:${msg?.recipients==='users'?'block':'none'};">
        <div style="position:relative;margin-bottom:6px;">
          <span class="material-icons" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--color-text-muted);pointer-events:none;">search</span>
          <input type="text" id="sm-user-search" placeholder="Benutzer suchen…"
            style="width:100%;padding:5px 8px 5px 28px;border:1px solid var(--color-border);border-radius:5px;font-size:0.83rem;background:var(--color-surface);color:var(--color-text);" />
        </div>
        <div id="sm-users-list" style="display:flex;flex-direction:column;gap:3px;max-height:120px;overflow-y:auto;">
          <span style="font-size:0.82rem;color:var(--color-text-muted);">Lade Benutzer…</span>
        </div>
      </div>

      <label style="margin-top:12px;">Zeitraum</label>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="sm-period" value="permanent" ${!hasPeriod?'checked':''}/>
          Dauerhaft ♾
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="sm-period" value="range" ${hasPeriod?'checked':''}/>
          Von–Bis
        </label>
      </div>
      <div id="sm-period-section" style="margin-top:8px;display:${hasPeriod?'grid':'none'};grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label>Von</label>
          <input type="datetime-local" id="sm-start" value="${toLocalDt(msg?.startAt)}" />
        </div>
        <div>
          <label>Bis</label>
          <input type="datetime-local" id="sm-end" value="${toLocalDt(msg?.endAt)}" />
        </div>
      </div>

      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:12px;">
        <input type="checkbox" id="sm-active" ${(msg?.active!==false)?'checked':''}/>
        Sofort aktiv
      </label>
    `,
    confirmLabel: isNew ? 'Erstellen' : 'Speichern',
    onConfirm: async () => {
      const type    = document.getElementById('sm-type').value;
      const title   = document.getElementById('sm-title').value.trim();
      const message = document.getElementById('sm-message').value.trim();
      const recip   = document.querySelector('input[name="sm-recip"]:checked')?.value || 'all';
      const period  = document.querySelector('input[name="sm-period"]:checked')?.value || 'permanent';
      const active  = document.getElementById('sm-active').checked;

      if (!message) { showToast('Bitte Nachrichtentext eingeben.', 'error'); return false; }

      const payload = { type, title, message, recipients: recip, active };

      if (recip === 'groups') {
        payload.recipientGroups = [...document.querySelectorAll('input[name="sm-group"]:checked')].map(i=>i.value);
        if (!payload.recipientGroups.length) { showToast('Bitte mindestens eine Gruppe wählen.', 'error'); return false; }
      }
      if (recip === 'users') {
        payload.recipientUsers = [...document.querySelectorAll('input[name="sm-user"]:checked')].map(i=>i.value);
        if (!payload.recipientUsers.length) { showToast('Bitte mindestens einen Benutzer wählen.', 'error'); return false; }
      }

      if (period === 'range') {
        const startStr = document.getElementById('sm-start').value;
        const endStr   = document.getElementById('sm-end').value;
        if (startStr) payload.startAt = new Date(startStr);
        if (endStr)   payload.endAt   = new Date(endStr);
      }
      if (period === 'permanent' && !isNew) {
        payload.startAt = firebase.firestore.FieldValue.delete();
        payload.endAt   = firebase.firestore.FieldValue.delete();
      }

      try {
        if (isNew) {
          payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          await firestore.collection('systemMessages').add(payload);
          showToast('Nachricht erstellt.', 'success');
        } else {
          delete payload.createdAt;
          await firestore.collection('systemMessages').doc(msg.id).update(payload);
          showToast('Nachricht gespeichert.', 'success');
        }
        renderSystemMessagesTab(parentEl);
      } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
        return false;
      }
    }
  });

  requestAnimationFrame(() => {
    const groupsList = document.getElementById('sm-groups-list');
    if (groupsList) {
      if (allGroups.length) {
        groupsList.innerHTML = allGroups.map(g => `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.88rem;">
            <input type="checkbox" name="sm-group" value="${g.id}"
              ${(msg?.recipientGroups||[]).includes(g.id)?'checked':''}/>
            ${g.name || g.id}
          </label>`).join('');
      } else {
        groupsList.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted);margin:0;">Keine Gruppen vorhanden.</p>';
      }
    }

    document.querySelectorAll('input[name="sm-recip"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('sm-groups-section').style.display = radio.value==='groups' ? 'block' : 'none';
        document.getElementById('sm-users-section').style.display  = radio.value==='users'  ? 'block' : 'none';
      });
    });
    document.querySelectorAll('input[name="sm-period"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('sm-period-section').style.display = radio.value==='range' ? 'grid' : 'none';
      });
    });
    _loadUsersForMsgForm(msg?.recipientUsers || []);
  });
}

async function _loadUsersForMsgForm(selected) {
  const listEl   = document.getElementById('sm-users-list');
  const searchEl = document.getElementById('sm-user-search');
  if (!listEl || !searchEl) return;

  let allUsers = [];
  try {
    const snap = await firestore.collection('users').get();
    snap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
    allUsers.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '', 'de'));
  } catch (e) {
    listEl.innerHTML = '<span style="font-size:0.82rem;color:var(--color-error);">Fehler beim Laden.</span>';
    return;
  }

  const renderUsers = (list) => {
    const checked = new Set([...document.querySelectorAll('input[name="sm-user"]:checked')].map(i=>i.value));
    listEl.innerHTML = list.map(u => `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.88rem;">
        <input type="checkbox" name="sm-user" value="${u.id}"
          ${(selected.includes(u.id)||checked.has(u.id))?'checked':''}/>
        ${u.displayName||u.email}
        <span style="font-size:0.75rem;color:var(--color-text-muted);">${(u.roles||[]).map(r=>getRoleLabel(r)).join(', ')}</span>
      </label>`).join('') || '<span style="font-size:0.82rem;color:var(--color-text-muted);">Keine Benutzer gefunden.</span>';
  };

  renderUsers(allUsers);

  searchEl.addEventListener('input', function() {
    const q = this.value.toLowerCase();
    renderUsers(allUsers.filter(u => (u.displayName||u.email||'').toLowerCase().includes(q)));
  });
}
