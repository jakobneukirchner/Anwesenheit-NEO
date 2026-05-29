// js/utils.js

/**
 * Hilfsfunktion für den stillen Auto-Refresh:
 * Rendert neuen HTML-Inhalt in einen unsichtbaren Temp-Container,
 * dann wird NUR der Inhalt per swap ausgetauscht.
 * Offene Modals, Textfelder außerhalb von container etc. bleiben unangetastet.
 *
 * @param {HTMLElement} container  - Das Ziel-Element
 * @param {string}      newHtml    - Der neue innerHTML-String
 */
function silentSwap(container, newHtml) {
  if (!container) return;
  const scrollY = container.scrollTop;
  container.innerHTML = newHtml;
  container.scrollTop = scrollY;
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function formatDate(date) {
  if (!date) return '';
  return date.toLocaleDateString('de-DE', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(date) {
  if (!date) return '';
  return date.toLocaleDateString('de-DE', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
    + ', ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
}

function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
}

function getRoleLabel(role) {
  return (window.roleLabels && window.roleLabels[role]) || role;
}

let _toastTimer = null;
function showToast(message, type = 'info') {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

/**
 * showModal – FIX: Confirm-Button wartet jetzt auf onConfirm() bevor das Modal schließt.
 * Wenn onConfirm() false zurückgibt (sync oder async), bleibt das Modal offen.
 * Während onConfirm läuft, ist der Button deaktiviert (verhindert Doppelklick).
 */
function showModal({ title, body, confirmLabel = 'OK', cancelLabel = 'Abbrechen', onConfirm, onCancel, danger = false }) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button class="modal-close" aria-label="Schließen">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        <button class="btn-secondary" id="modal-cancel">${cancelLabel}</button>
        <button class="${danger ? 'btn-danger' : 'btn-primary'}" id="modal-confirm">${confirmLabel}</button>
      </div>
    </div>
  `;
  overlay.classList.add('active');

  const close = () => overlay.classList.remove('active');

  overlay.querySelector('.modal-close').onclick = () => { close(); onCancel?.(); };
  overlay.querySelector('#modal-cancel').onclick  = () => { close(); onCancel?.(); };

  overlay.querySelector('#modal-confirm').onclick = async () => {
    const btn = overlay.querySelector('#modal-confirm');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '…';
    try {
      const result = await onConfirm?.();
      // Nur schließen wenn onConfirm NICHT false zurückgibt
      if (result !== false) {
        close();
      }
    } catch (err) {
      showToast('Fehler: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  };
}

let _rateLimitActions = [];
function guardedAction(fn) {
  const settings = window.appSettings || {};
  const user = window.currentUser;
  const privilegedRoles = ['admin', 'coordinator', 'teacher'];
  const isPrivileged = user?.roles?.some(r => privilegedRoles.includes(r));
  if (!isPrivileged) {
    const maxActions    = settings.rateLimitMaxActions    || 100;
    const windowMinutes = settings.rateLimitWindowMinutes || 10;
    const windowMs = windowMinutes * 60 * 1000;
    const now = Date.now();
    _rateLimitActions = _rateLimitActions.filter(t => now - t < windowMs);
    if (_rateLimitActions.length >= maxActions) {
      showToast(`Zu viele Aktionen. Bitte warte ${windowMinutes} Minuten.`, 'warning');
      return;
    }
    _rateLimitActions.push(now);
  }
  return fn();
}
