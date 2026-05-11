// js/utils.js

function formatDateTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDate(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleDateString('de-DE', { dateStyle: 'medium' });
}

function formatTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString('de-DE', { timeStyle: 'short' });
}

function createElement(tag, className, html) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function showToast(message, type = 'info') {
  const existing = document.getElementById('neo-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'neo-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    padding: '12px 20px',
    borderRadius: '8px',
    fontWeight: '500',
    fontSize: '0.92rem',
    zIndex: 9999,
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    color: '#fff',
    backgroundColor:
      type === 'error'   ? '#c62828' :
      type === 'success' ? '#2e7d32' :
      type === 'warning' ? '#e65100' : '#1565c0',
    transition: 'opacity 0.4s',
    opacity: '1'
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

function showModal({ title, body, confirmLabel = 'OK', cancelLabel = 'Abbrechen', onConfirm, onCancel }) {
  const overlay = createElement('div', '');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0',
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9998
  });

  const modal = createElement('div', 'card');
  Object.assign(modal.style, {
    maxWidth: '420px', width: '90%', margin: '0'
  });
  modal.innerHTML = `
    <h3 style="margin-top:0">${title}</h3>
    <div>${body}</div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
      <button class="btn-secondary" id="modal-cancel">${cancelLabel}</button>
      <button class="btn-primary"   id="modal-confirm">${confirmLabel}</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('#modal-cancel').onclick  = () => { overlay.remove(); if (onCancel) onCancel(); };
  modal.querySelector('#modal-confirm').onclick = () => { overlay.remove(); if (onConfirm) onConfirm(); };
}

function getRoleLabel(roleKey) {
  const labels = window.roleLabels || {};
  const defaults = { admin: 'Admin', coordinator: 'Koordinator', teacher: 'Trainer', member: 'Mitglied' };
  return labels[roleKey] || defaults[roleKey] || roleKey;
}
