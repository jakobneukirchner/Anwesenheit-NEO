// js/rate-limit.js
// Rate-Limiting fuer Mitglieder-Aktionen (An-/Abmelden etc.)
// Admin / Koordinator / Trainer sind ausgenommen

const RATE_LIMIT_MAX_ACTIONS = 100;
const RATE_LIMIT_WINDOW_MS   = 10 * 60 * 1000; // 10 Minuten

const rateLimitStore = { actions: [] };

function isPrivilegedUser() {
  const user = window.currentUser;
  if (!user) return false;
  const roles = user.roles || [];
  return roles.includes('admin') || roles.includes('coordinator') || roles.includes('teacher');
}

function recordActionAndCheckAllowed() {
  if (isPrivilegedUser()) return true;
  const now = Date.now();
  rateLimitStore.actions = rateLimitStore.actions.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (rateLimitStore.actions.length >= RATE_LIMIT_MAX_ACTIONS) return false;
  rateLimitStore.actions.push(now);
  return true;
}

async function guardedAction(fn, onDeny) {
  if (!recordActionAndCheckAllowed()) {
    if (onDeny) onDeny();
    else showToast('Zu viele Aktionen in kurzer Zeit. Bitte kurz warten.', 'warning');
    return;
  }
  return fn();
}
