// modules/notifications.js
// Benachrichtigungs-Glocke: liest system_messages + eventNotifications für den aktuellen Nutzer

(function () {

/* ─── Styles ─────────────────────────────────────────────────────────────────── */
(function injectStyles() {
  if (document.getElementById('notif-style')) return;
  const s = document.createElement('style');
  s.id = 'notif-style';
  s.textContent = `
    /* ── Dropdown ── */
    #notif-dropdown {
      position: fixed;
      top: 52px;
      right: 12px;
      width: min(380px, calc(100vw - 24px));
      max-height: min(520px, calc(100vh - 80px));
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: 0 8px 32px oklch(0.2 0.01 80 / 0.18);
      z-index: 9000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: notifSlideIn 0.2s cubic-bezier(0.16,1,0.3,1) both;
    }
    @keyframes notifSlideIn {
      from { opacity: 0; transform: translateY(-8px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)   scale(1); }
    }
    #notif-dropdown.notif-closing {
      animation: notifSlideOut 0.15s cubic-bezier(0.7,0,1,1) both;
    }
    @keyframes notifSlideOut {
      to { opacity: 0; transform: translateY(-6px) scale(0.97); }
    }

    /* ── Header ── */
    #notif-dropdown .nd-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--color-divider);
      flex-shrink: 0;
    }
    #notif-dropdown .nd-title {
      font-weight: 700;
      font-size: 0.95rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #notif-dropdown .nd-mark-all {
      font-size: 0.78rem;
      color: var(--color-primary);
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--radius-sm, 6px);
      transition: background 0.15s;
    }
    #notif-dropdown .nd-mark-all:hover { background: var(--color-primary-highlight); }

    /* ── List ── */
    #notif-list {
      overflow-y: auto;
      flex: 1;
    }
    #notif-list::-webkit-scrollbar { width: 4px; }
    #notif-list::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }

    /* ── Item ── */
    .notif-item {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-divider);
      cursor: default;
      transition: background 0.12s;
      position: relative;
    }
    .notif-item:last-child { border-bottom: none; }
    .notif-item.notif-unread { background: var(--color-primary-highlight, #cedcd8); }
    .notif-item.notif-unread:hover { background: color-mix(in oklab, var(--color-primary-highlight) 80%, var(--color-divider)); }
    .notif-item:not(.notif-unread):hover { background: var(--color-surface-offset); }

    .notif-item .ni-icon {
      flex-shrink: 0;
      width: 34px; height: 34px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 17px;
    }
    .notif-item .ni-icon.type-substitution_request        { background: var(--color-warning-highlight);  color: var(--color-warning); }
    .notif-item .ni-icon.type-substitution_accepted       { background: var(--color-success-highlight);  color: var(--color-success); }
    .notif-item .ni-icon.type-substitution_declined       { background: var(--color-error-highlight);    color: var(--color-error); }
    .notif-item .ni-icon.type-substitution_auto_cancelled { background: var(--color-error-highlight);    color: var(--color-error); }
    .notif-item .ni-icon.type-event_cancelled             { background: var(--color-error-highlight);    color: var(--color-error); }
    .notif-item .ni-icon.type-default                     { background: var(--color-surface-offset-2);   color: var(--color-text-muted); }

    /* Quelle-Pill: zeigt ob system_message oder eventNotification */
    .ni-source-pill {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      padding: 1px 6px;
      border-radius: 999px;
      margin-bottom: 3px;
      text-transform: uppercase;
    }
    .ni-source-pill.source-event {
      background: var(--color-primary-highlight);
      color: var(--color-primary);
    }
    .ni-source-pill.source-system {
      background: var(--color-surface-offset-2);
      color: var(--color-text-muted);
    }

    .notif-item .ni-body { flex: 1; min-width: 0; }
    .notif-item .ni-text {
      font-size: 0.855rem;
      line-height: 1.45;
      color: var(--color-text);
      word-break: break-word;
    }
    .notif-item .ni-event-title {
      font-size: 0.78rem;
      color: var(--color-text-muted);
      margin-top: 2px;
    }
    .notif-item .ni-time {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      margin-top: 4px;
    }
    .notif-item .ni-dot {
      position: absolute;
      top: 14px; right: 14px;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--color-primary);
      flex-shrink: 0;
    }
    .notif-item .ni-read-btn {
      position: absolute;
      top: 8px; right: 8px;
      background: none; border: none; cursor: pointer;
      color: var(--color-text-faint);
      font-size: 16px;
      padding: 2px;
      border-radius: 50%;
      transition: color 0.12s, background 0.12s;
      display: none;
      align-items: center;
      justify-content: center;
      width: 24px; height: 24px;
    }
    .notif-item:hover .ni-read-btn { display: flex; }
    .notif-item .ni-read-btn:hover { color: var(--color-text); background: var(--color-surface-dynamic); }
    .notif-item:hover .ni-dot { display: none; }

    /* ── Empty ── */
    .nd-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
      color: var(--color-text-muted);
      gap: 10px;
      text-align: center;
    }
    .nd-empty .material-icons { font-size: 38px; color: var(--color-text-faint); }
    .nd-empty p { font-size: 0.88rem; margin: 0; }

    /* ── Shimmer Skeleton ── */
    .nd-skeleton {
      padding: 12px 16px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
      border-bottom: 1px solid var(--color-divider);
    }
    .nd-skel-circle {
      width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
    }
    .nd-skel-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
    .nd-skel-line { height: 12px; border-radius: 4px; }
    .nd-skel-line.short { width: 40%; }
    @keyframes ndShimmer {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
    .nd-skeleton .nd-skel-circle,
    .nd-skeleton .nd-skel-line {
      background: linear-gradient(90deg,
        var(--color-surface-offset) 25%,
        var(--color-surface-dynamic) 50%,
        var(--color-surface-offset) 75%);
      background-size: 200% 100%;
      animation: ndShimmer 1.4s ease-in-out infinite;
    }
  `;
  document.head.appendChild(s);
})();

/* ─── State ─────────────────────────────────────────────────────────────────── */
let _unsubSystem    = null; // Listener für system_messages
let _unsubEvent     = null; // Listener für eventNotifications
let _isOpen         = false;
let _dropdownEl     = null;
let _outsideHandler = null;

// Beide Collections werden in einem einzigen Array zusammengeführt
let _systemNotifs = [];
let _eventNotifs  = [];

/* ─── Typ → Icon ─────────────────────────────────────────────────────────────── */
const TYPE_ICON = {
  substitution_request:        'swap_horiz',
  substitution_accepted:       'check_circle',
  substitution_declined:       'cancel',
  substitution_auto_cancelled: 'cancel',
  event_cancelled:             'event_busy',
};
function _iconFor(type)  { return TYPE_ICON[type] || 'notifications'; }
function _typeClass(type) { return TYPE_ICON[type] ? `type-${type}` : 'type-default'; }

/* ─── Merge & Sort ───────────────────────────────────────────────────────────── */
function _merged() {
  return [..._systemNotifs, ..._eventNotifs].sort((a, b) => {
    const ta = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
    const tb = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
    return tb - ta;
  });
}

/* ─── Zeitformat ─────────────────────────────────────────────────────────────── */
function _relTime(date) {
  if (!date) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return 'Gerade eben';
  if (diff < 3600)  return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const d = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  return `am ${d}`;
}

/* ─── Badge aktualisieren ────────────────────────────────────────────────────── */
function _updateBadge() {
  const count = _merged().filter(n => !n.read).length;
  ['notif-badge', 'mobile-notif-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  });
}

/* ─── Listener starten ───────────────────────────────────────────────────────── */
function startNotificationsListener() {
  if (_unsubSystem) { _unsubSystem(); _unsubSystem = null; }
  if (_unsubEvent)  { _unsubEvent();  _unsubEvent  = null; }

  const uid = window.currentUser?.firebaseUser?.uid;
  if (!uid) return;

  // ── 1. system_messages (bisheriges System) ──────────────────────────────────
  _unsubSystem = firestore
    .collection('system_messages')
    .where('recipientId', '==', uid)
    .onSnapshot(snap => {
      _systemNotifs = [];
      snap.forEach(doc => {
        _systemNotifs.push({ id: doc.id, _source: 'system', ...doc.data() });
      });
      _updateBadge();
      if (_isOpen && _dropdownEl) _renderList();
    }, err => console.warn('notif/system_messages listener error', err));

  // ── 2. eventNotifications (neues System) ────────────────────────────────────
  _unsubEvent = firestore
    .collection('eventNotifications')
    .where('recipientUid', '==', uid)
    .onSnapshot(snap => {
      _eventNotifs = [];
      snap.forEach(doc => {
        const d = doc.data();
        // Normalisierung: text-Feld ableiten falls fehlt
        _eventNotifs.push({
          id:          doc.id,
          _source:     'event',
          text:        d.message || d.text || '',
          read:        d.read || false,
          type:        d.type,
          createdAt:   d.createdAt,
          _eventId:    d.eventId,
          _eventTitle: d.eventTitle,
          _meta:       d._meta || {},
        });
      });
      _updateBadge();
      if (_isOpen && _dropdownEl) _renderList();
    }, err => console.warn('notif/eventNotifications listener error', err));
}

function stopNotificationsListener() {
  if (_unsubSystem) { _unsubSystem(); _unsubSystem = null; }
  if (_unsubEvent)  { _unsubEvent();  _unsubEvent  = null; }
  _systemNotifs = [];
  _eventNotifs  = [];
  _updateBadge();
  _closeDropdown();
}

/* ─── Dropdown öffnen/schließen ─────────────────────────────────────────────── */
function _openDropdown() {
  if (_isOpen) { _closeDropdown(); return; }
  _isOpen = true;

  _dropdownEl = document.createElement('div');
  _dropdownEl.id = 'notif-dropdown';
  _dropdownEl.setAttribute('role', 'dialog');
  _dropdownEl.setAttribute('aria-label', 'Benachrichtigungen');

  const unread = _merged().filter(n => !n.read).length;
  _dropdownEl.innerHTML = `
    <div class="nd-header">
      <div class="nd-title">
        <span class="material-icons" style="font-size:20px;color:var(--color-primary);">notifications</span>
        Benachrichtigungen
      </div>
      ${unread > 0 ? `<button class="nd-mark-all" id="nd-mark-all-btn">Alle als gelesen</button>` : ''}
    </div>
    <div id="notif-list">${_buildSkeletons()}</div>
  `;
  document.body.appendChild(_dropdownEl);

  // Skeleton kurz zeigen, dann echten Inhalt
  setTimeout(() => { if (_dropdownEl) _renderList(); }, 120);

  _dropdownEl.querySelector('#nd-mark-all-btn')?.addEventListener('click', _markAllRead);

  _outsideHandler = (e) => {
    const btn  = document.getElementById('notif-btn');
    const mBtn = document.getElementById('mobile-notif-btn');
    if (
      _dropdownEl &&
      !_dropdownEl.contains(e.target) &&
      !btn?.contains(e.target) &&
      !mBtn?.contains(e.target)
    ) { _closeDropdown(); }
  };
  setTimeout(() => document.addEventListener('click', _outsideHandler), 0);
}

function _closeDropdown() {
  if (!_dropdownEl) { _isOpen = false; return; }
  _dropdownEl.classList.add('notif-closing');
  _dropdownEl.addEventListener('animationend', () => {
    _dropdownEl?.remove();
    _dropdownEl = null;
  }, { once: true });
  if (_outsideHandler) {
    document.removeEventListener('click', _outsideHandler);
    _outsideHandler = null;
  }
  _isOpen = false;
}

function _buildSkeletons() {
  return Array.from({ length: 3 }, () => `
    <div class="nd-skeleton">
      <div class="nd-skel-circle"></div>
      <div class="nd-skel-lines">
        <div class="nd-skel-line"></div>
        <div class="nd-skel-line"></div>
        <div class="nd-skel-line short"></div>
      </div>
    </div>`).join('');
}

/* ─── Liste rendern ──────────────────────────────────────────────────────────── */
function _renderList() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  const all = _merged();

  if (!all.length) {
    list.innerHTML = `
      <div class="nd-empty">
        <span class="material-icons">notifications_none</span>
        <p>Keine Benachrichtigungen</p>
      </div>`;
    _dropdownEl?.querySelector('#nd-mark-all-btn')?.remove();
    return;
  }

  const esc = typeof escapeHtml === 'function' ? escapeHtml : (s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  list.innerHTML = all.map(n => {
    const date     = n.createdAt?.toDate?.() || (n.createdAt ? new Date(n.createdAt) : null);
    const isEvent  = n._source === 'event';
    const pillHtml = isEvent
      ? `<span class="ni-source-pill source-event">Vertretung</span>`
      : `<span class="ni-source-pill source-system">System</span>`;
    const eventTitleHtml = isEvent && n._eventTitle
      ? `<div class="ni-event-title"><span class="material-icons" style="font-size:12px;vertical-align:-2px;margin-right:2px;">event</span>${esc(n._eventTitle)}</div>`
      : '';
    return `
      <div class="notif-item ${n.read ? '' : 'notif-unread'}" data-id="${n.id}" data-source="${n._source}">
        <div class="ni-icon ${_typeClass(n.type)}">
          <span class="material-icons">${_iconFor(n.type)}</span>
        </div>
        <div class="ni-body">
          ${pillHtml}
          <div class="ni-text">${esc(n.text)}</div>
          ${eventTitleHtml}
          ${date ? `<div class="ni-time">${_relTime(date)}</div>` : ''}
        </div>
        ${!n.read ? `<div class="ni-dot"></div>` : ''}
        ${!n.read ? `<button class="ni-read-btn" data-id="${n.id}" data-source="${n._source}" title="Als gelesen markieren" aria-label="Als gelesen markieren"><span class="material-icons" style="font-size:16px;pointer-events:none;">done</span></button>` : ''}
      </div>`;
  }).join('');

  list.querySelectorAll('.ni-read-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _markRead(btn.dataset.id, btn.dataset.source);
    });
  });

  // Mark-all-Btn aktualisieren
  const header = _dropdownEl?.querySelector('.nd-header');
  if (header) {
    const unread   = all.filter(n => !n.read).length;
    const existing = header.querySelector('#nd-mark-all-btn');
    if (unread > 0 && !existing) {
      const btn = document.createElement('button');
      btn.className = 'nd-mark-all';
      btn.id = 'nd-mark-all-btn';
      btn.textContent = 'Alle als gelesen';
      btn.addEventListener('click', _markAllRead);
      header.appendChild(btn);
    } else if (unread === 0 && existing) {
      existing.remove();
    }
  }
}

/* ─── Als gelesen markieren ─────────────────────────────────────────────────── */
async function _markRead(id, source) {
  try {
    const collection = source === 'event' ? 'eventNotifications' : 'system_messages';
    await firestore.collection(collection).doc(id).update({ read: true });
  } catch (e) { console.warn('markRead error', e); }
}

async function _markAllRead() {
  const unread = _merged().filter(n => !n.read);
  if (!unread.length) return;
  const batch = firestore.batch();
  unread.forEach(n => {
    const col = n._source === 'event' ? 'eventNotifications' : 'system_messages';
    batch.update(firestore.collection(col).doc(n.id), { read: true });
  });
  try { await batch.commit(); }
  catch (e) { console.warn('markAllRead error', e); }
}

/* ─── Öffentlicher Helper: eventNotification senden ─────────────────────────── */
/**
 * Erstellt ein Dokument in der eventNotifications-Collection.
 *
 * @param {object} opts
 * @param {string} opts.recipientUid   - UID des Empfängers
 * @param {string} opts.eventId        - Firestore-ID des Events
 * @param {string} opts.eventTitle     - Anzeigename des Events
 * @param {'substitution_request'|'substitution_accepted'|'substitution_declined'|'event_cancelled'} opts.type
 * @param {string} opts.message        - Nachrichtentext
 * @param {object} [opts._meta]        - Optionale Metadaten (requestedByName, trainerName, …)
 */
async function sendEventNotification({ recipientUid, eventId, eventTitle, type, message, _meta = {} }) {
  if (!recipientUid || !eventId || !type || !message) {
    console.warn('sendEventNotification: Pflichtfelder fehlen', { recipientUid, eventId, type, message });
    return;
  }
  try {
    await firestore.collection('eventNotifications').add({
      recipientUid,
      eventId,
      eventTitle: eventTitle || '',
      type,
      message,
      read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      _meta,
    });
  } catch (e) {
    console.warn('sendEventNotification error', e);
  }
}

/* ─── Buttons verdrahten ─────────────────────────────────────────────────────── */
function initNotificationBell() {
  const btn  = document.getElementById('notif-btn');
  const mBtn = document.getElementById('mobile-notif-btn');

  if (btn) {
    btn.addEventListener('click', (e) => { e.stopPropagation(); _openDropdown(); });
  }
  if (mBtn) {
    mBtn.hidden = false;
    mBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const drawer  = document.getElementById('mobile-drawer');
      const overlay = document.getElementById('mobile-drawer-overlay');
      if (drawer)  drawer.hidden  = true;
      if (overlay) overlay.hidden = true;
      _openDropdown();
    });
  }
}

/* ─── Exports ────────────────────────────────────────────────────────────────── */
window.startNotificationsListener = startNotificationsListener;
window.stopNotificationsListener  = stopNotificationsListener;
window.initNotificationBell       = initNotificationBell;
window.sendEventNotification      = sendEventNotification;  // für substitution.js & trainer-dashboard.js

})();
