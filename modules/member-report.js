// modules/member-report.js
// "Meine Mitglieder" – Teilnahmeberichte & PDF-Export für Betreuer und Koordinatoren

/**
 * Lädt das Meine-Mitglieder-Dashboard.
 * @param {string} mode - 'trainer' (eigene Mitglieder) oder 'coordinator' (alle Mitglieder)
 */
async function loadMemberReportDashboard(mode = 'trainer') {
  const container = document.getElementById('app-content');
  const myUid     = window.currentUser?.firebaseUser?.uid;
  container.innerHTML = `<div class="loading-center">Lade Mitgliederberichte...</div>`;

  try {
    // ── 1. Mitglieder laden ──────────────────────────────────────────────────
    let members = [];

    if (mode === 'coordinator') {
      // Alle Mitglieder
      const snap = await firestore.collection('users').orderBy('displayName').get();
      snap.forEach(doc => {
        const d = doc.data();
        if ((d.roles || []).includes('member')) {
          members.push({ id: doc.id, ...d });
        }
      });
    } else {
      // Nur Mitglieder, die der Trainer betreut (= in Gruppen des Trainers)
      const trainerDoc  = await firestore.collection('users').doc(myUid).get();
      const trainerData = trainerDoc.exists ? trainerDoc.data() : {};
      const trainerGroups = trainerData.groups || [];

      if (!trainerGroups.length) {
        // Fallback: alle Mitglieder anzeigen wenn Trainer keiner Gruppe zugewiesen
        const snap = await firestore.collection('users').orderBy('displayName').get();
        snap.forEach(doc => {
          const d = doc.data();
          if ((d.roles || []).includes('member')) members.push({ id: doc.id, ...d });
        });
      } else {
        const memberSet = new Set();
        for (const gid of trainerGroups) {
          const gDoc = await firestore.collection('groups').doc(gid).get();
          if (gDoc.exists) {
            (gDoc.data().members || []).forEach(uid => memberSet.add(uid));
          }
        }
        await Promise.all([...memberSet].map(async uid => {
          const uDoc = await firestore.collection('users').doc(uid).get();
          if (uDoc.exists) {
            const d = uDoc.data();
            if ((d.roles || []).includes('member')) members.push({ id: uid, ...d });
          }
        }));
        members.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'de'));
      }
    }

    // ── 2. Vergangene Termine der letzten 180 Tage laden ────────────────────
    const since = new Date();
    since.setDate(since.getDate() - 180);
    const sinceTs = firebase.firestore.Timestamp.fromDate(since);
    const now     = new Date();

    const evSnap = await firestore.collection('events')
      .where('startTime', '>=', sinceTs)
      .orderBy('startTime', 'desc')
      .get();

    const allPastEvents = [];
    evSnap.forEach(doc => {
      const d = doc.data();
      const t = d.startTime?.toDate?.();
      if (t && t <= now) allPastEvents.push({ id: doc.id, ...d });
    });

    // ── 3. Attendance je Mitglied auswerten ──────────────────────────────────
    const memberStats = await Promise.all(members.map(async member => {
      const attSnap = await firestore.collection('eventAttendance')
        .where('userId', '==', member.id)
        .get();

      const attMap = {};
      attSnap.forEach(doc => { attMap[doc.data().eventId] = doc.data(); });

      const memberGroupIds = member.groups || [];
      const relevantEvents = allPastEvents.filter(ev => {
        const inGroup = ev.groupId && memberGroupIds.includes(ev.groupId);
        const direct  = (ev.directMembers || []).includes(member.id);
        const hasAtt  = !!attMap[ev.id];
        return inGroup || direct || hasAtt;
      });

      let present         = 0;
      let absentExcused   = 0;
      let absentUnexcused = 0;
      let total           = 0;

      relevantEvents.forEach(ev => {
        if (ev.status === 'cancelled' || ev.status === 'skipped') return;
        total++;
        const att = attMap[ev.id];
        if (!att) {
          if (ev.mode === 'opt_out') absentUnexcused++;
          else total--; // nie angemeldet → nicht werten
        } else {
          switch (att.status) {
            case 'present':
            case 'late_excused':
            case 'late_unexcused':  present++;         break;
            case 'absent_excused':  absentExcused++;   break;
            case 'absent_unexcused': absentUnexcused++; break;
            case 'cancelled':       total--;            break; // abgemeldet → nicht werten
            case 'confirmation_pending': /* ausstehend → als fehlend werten */ absentUnexcused++; break;
            default: total--;
          }
        }
      });

      const absTotal       = absentExcused + absentUnexcused;
      const attendanceRate = total > 0 ? Math.round((present / total) * 100) : null;
      const excusedRate    = absTotal > 0 ? Math.round((absentExcused / absTotal) * 100) : null;
      const absenceRate    = total > 0 ? Math.round((absTotal / total) * 100) : null;

      return {
        member,
        total,
        present,
        absentExcused,
        absentUnexcused,
        attendanceRate,
        absenceRate,
        excusedRate,
        relevantEventCount: relevantEvents.filter(ev => ev.status !== 'cancelled' && ev.status !== 'skipped').length
      };
    }));

    // ── 4. Render ────────────────────────────────────────────────────────────
    const title = mode === 'coordinator'
      ? 'Alle Mitglieder – Teilnahmeberichte'
      : 'Meine Mitglieder – Teilnahmeberichte';

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="margin:0 0 4px;">${title}</h2>
          <p class="text-muted" style="margin:0;font-size:0.84rem;">
            Zeitraum: letzte 180 Tage &nbsp;·&nbsp; ${members.length} Mitglied${members.length !== 1 ? 'er' : ''}
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-secondary" id="report-filter-btn"
            style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">filter_list</span> Filter
          </button>
          <button class="btn-primary" id="report-pdf-btn"
            style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">picture_as_pdf</span> Als PDF exportieren
          </button>
        </div>
      </div>

      <div id="report-filter-bar" style="display:none;margin-bottom:12px;">
        <div class="card" style="padding:12px 16px;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
            <div>
              <label style="font-size:0.82rem;font-weight:500;">Sortieren nach</label>
              <select id="report-sort" style="font-size:0.85rem;margin-bottom:0;margin-top:4px;min-width:180px;">
                <option value="name">Name (A–Z)</option>
                <option value="attendance_asc">Teilnahmequote (aufsteigend)</option>
                <option value="attendance_desc">Teilnahmequote (absteigend)</option>
                <option value="absence_desc">Fehlquote (absteigend)</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.82rem;font-weight:500;">Min. Termine</label>
              <input type="number" id="report-min-events" value="0" min="0"
                style="font-size:0.85rem;margin-bottom:0;margin-top:4px;width:80px;" />
            </div>
            <button class="btn-primary" id="report-apply-filter"
              style="padding:6px 16px;font-size:0.85rem;">Anwenden</button>
          </div>
        </div>
      </div>

      <div id="report-table-container"></div>
    `;

    document.getElementById('report-filter-btn').onclick = () => {
      const bar = document.getElementById('report-filter-bar');
      bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('report-pdf-btn').onclick     = () => exportReportAsPDF(memberStats, title);
    document.getElementById('report-apply-filter').onclick = () => renderReportTable(memberStats);

    renderReportTable(memberStats);

  } catch (e) {
    console.error(e);
    container.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
  }
}

/* ── Tabelle rendern ───────────────────────────────────────────────────────── */
function renderReportTable(stats) {
  const tableEl = document.getElementById('report-table-container');
  if (!tableEl) return;

  const sortBy = document.getElementById('report-sort')?.value || 'name';
  const minEvt = parseInt(document.getElementById('report-min-events')?.value) || 0;
  let filtered = stats.filter(s => s.relevantEventCount >= minEvt);

  switch (sortBy) {
    case 'name':
      filtered.sort((a, b) => (a.member.displayName || '').localeCompare(b.member.displayName || '', 'de'));
      break;
    case 'attendance_asc':
      filtered.sort((a, b) => (a.attendanceRate ?? -1) - (b.attendanceRate ?? -1));
      break;
    case 'attendance_desc':
      filtered.sort((a, b) => (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1));
      break;
    case 'absence_desc':
      filtered.sort((a, b) => (b.absenceRate ?? -1) - (a.absenceRate ?? -1));
      break;
  }

  if (!filtered.length) {
    tableEl.innerHTML = '<p class="text-muted" style="padding:16px 0;">Keine Mitglieder gefunden.</p>';
    return;
  }

  const rateColor = (rate, invert = false) => {
    if (rate === null) return 'var(--color-text-muted)';
    if (invert) {
      if (rate >= 30) return 'var(--color-error)';
      if (rate >= 15) return 'var(--color-warning)';
      return 'var(--color-success)';
    } else {
      if (rate >= 80) return 'var(--color-success)';
      if (rate >= 50) return 'var(--color-warning)';
      return 'var(--color-error)';
    }
  };

  tableEl.innerHTML = `
    <div style="overflow-x:auto;">
      <table id="report-main-table" style="width:100%;min-width:700px;">
        <thead>
          <tr>
            <th>Mitglied</th>
            <th style="text-align:center;">Termine<br><span style="font-weight:400;font-size:0.78rem;color:var(--color-text-muted);">(gewertet)</span></th>
            <th style="text-align:center;">Anwesend</th>
            <th style="text-align:center;">Teilnahmequote</th>
            <th style="text-align:center;">Fehlquote</th>
            <th style="text-align:center;">Entsch.-Quote</th>
            <th style="text-align:center;">Unentsch.<br>gefehlt</th>
            <th style="text-align:center;">Entsch.<br>gefehlt</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => {
            const m       = s.member;
            const attRate = s.attendanceRate !== null ? `${s.attendanceRate}%` : '–';
            const absRate = s.absenceRate    !== null ? `${s.absenceRate}%`    : '–';
            const excRate = s.excusedRate    !== null ? `${s.excusedRate}%`    : '–';
            return `
              <tr>
                <td>
                  <div style="font-weight:500;">${m.displayName || '–'}</div>
                  <div style="font-size:0.8rem;color:var(--color-text-muted);">${m.email || ''}</div>
                </td>
                <td style="text-align:center;font-weight:600;">${s.total}</td>
                <td style="text-align:center;">${s.present}</td>
                <td style="text-align:center;font-weight:700;color:${rateColor(s.attendanceRate)};">${attRate}</td>
                <td style="text-align:center;font-weight:700;color:${rateColor(s.absenceRate, true)};">${absRate}</td>
                <td style="text-align:center;font-weight:600;color:var(--color-warning);">${excRate}</td>
                <td style="text-align:center;color:var(--color-error);">${s.absentUnexcused}</td>
                <td style="text-align:center;color:var(--color-warning);">${s.absentExcused}</td>
                <td>
                  <button class="btn-secondary member-report-detail-btn" data-uid="${m.id}"
                    style="padding:3px 12px;font-size:0.82rem;white-space:nowrap;">
                    Details
                  </button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  tableEl.querySelectorAll('.member-report-detail-btn').forEach(btn => {
    btn.onclick = () => {
      const stat = filtered.find(s => s.member.id === btn.dataset.uid);
      if (stat) showMemberReportDetail(stat);
    };
  });
}

/* ── Detail-Modal für einzelnes Mitglied ──────────────────────────────────── */
async function showMemberReportDetail(stat) {
  const m = stat.member;
  const since = new Date();
  since.setDate(since.getDate() - 180);
  const sinceTs = firebase.firestore.Timestamp.fromDate(since);
  const now     = new Date();

  const attSnap = await firestore.collection('eventAttendance')
    .where('userId', '==', m.id)
    .get();
  const attMap = {};
  attSnap.forEach(doc => { attMap[doc.data().eventId] = doc.data(); });

  const evSnap = await firestore.collection('events')
    .where('startTime', '>=', sinceTs)
    .orderBy('startTime', 'desc')
    .get();

  const memberGroupIds = m.groups || [];
  const events = [];
  evSnap.forEach(doc => {
    const d = doc.data();
    const t = d.startTime?.toDate?.();
    if (!t || t > now) return;
    const inGroup = d.groupId && memberGroupIds.includes(d.groupId);
    const direct  = (d.directMembers || []).includes(m.id);
    const hasAtt  = !!attMap[doc.id];
    if ((inGroup || direct || hasAtt) && d.status !== 'cancelled') {
      events.push({ id: doc.id, ...d });
    }
  });

  const statusLabel = (att, ev) => {
    if (!att) {
      return ev?.mode === 'opt_out'
        ? `<span class="chip chip-error" style="font-size:0.78rem;">Unentsch. gefehlt</span>`
        : `<span class="chip" style="font-size:0.78rem;background:var(--color-surface-offset);">Nicht angemeldet</span>`;
    }
    const map = {
      present:              `<span class="chip chip-success" style="font-size:0.78rem;">Anwesend</span>`,
      late_excused:         `<span class="chip chip-success" style="font-size:0.78rem;">Anwesend (verspätet)</span>`,
      late_unexcused:       `<span class="chip chip-warning" style="font-size:0.78rem;">Verspätet (unentsch.)</span>`,
      absent_excused:       `<span class="chip chip-warning" style="font-size:0.78rem;">Entsch. gefehlt</span>`,
      absent_unexcused:     `<span class="chip chip-error" style="font-size:0.78rem;">Unentsch. gefehlt</span>`,
      cancelled:            `<span class="chip" style="font-size:0.78rem;background:var(--color-surface-offset);">Abgemeldet</span>`,
      confirmation_pending: `<span class="chip chip-warning" style="font-size:0.78rem;">Ausstehend</span>`,
    };
    return map[att.status] || `<span class="chip" style="font-size:0.78rem;">${att.status}</span>`;
  };

  const rows = events.map(ev => {
    const start = ev.startTime?.toDate?.();
    const att   = attMap[ev.id];
    return `<tr>
      <td style="font-size:0.85rem;white-space:nowrap;">${start ? formatDateTime(start) : '–'}</td>
      <td style="font-size:0.85rem;font-weight:500;">${ev.title || '–'}</td>
      <td>${statusLabel(att, ev)}</td>
      <td style="font-size:0.82rem;color:var(--color-text-muted);">${att?.trainerNoteMember || att?.memberNote || ''}</td>
    </tr>`;
  }).join('');

  showModal({
    title: `Detailbericht: ${m.displayName || m.email}`,
    body: `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <div class="card" style="margin:0;flex:1;min-width:90px;text-align:center;padding:12px;">
          <p class="text-muted" style="margin:0 0 4px;font-size:0.78rem;">Termine</p>
          <p style="margin:0;font-weight:700;font-size:1.4rem;">${stat.total}</p>
        </div>
        <div class="card" style="margin:0;flex:1;min-width:90px;text-align:center;padding:12px;">
          <p class="text-muted" style="margin:0 0 4px;font-size:0.78rem;">Teilnahmequote</p>
          <p style="margin:0;font-weight:700;font-size:1.4rem;color:${stat.attendanceRate >= 80 ? 'var(--color-success)' : stat.attendanceRate >= 50 ? 'var(--color-warning)' : 'var(--color-error)'};">
            ${stat.attendanceRate !== null ? stat.attendanceRate + '%' : '–'}
          </p>
        </div>
        <div class="card" style="margin:0;flex:1;min-width:90px;text-align:center;padding:12px;">
          <p class="text-muted" style="margin:0 0 4px;font-size:0.78rem;">Fehlquote</p>
          <p style="margin:0;font-weight:700;font-size:1.4rem;color:${stat.absenceRate >= 30 ? 'var(--color-error)' : stat.absenceRate >= 15 ? 'var(--color-warning)' : 'var(--color-success)'};">
            ${stat.absenceRate !== null ? stat.absenceRate + '%' : '–'}
          </p>
        </div>
        <div class="card" style="margin:0;flex:1;min-width:90px;text-align:center;padding:12px;">
          <p class="text-muted" style="margin:0 0 4px;font-size:0.78rem;">Entschuldigt-Quote</p>
          <p style="margin:0;font-weight:700;font-size:1.4rem;color:var(--color-warning);">
            ${stat.excusedRate !== null ? stat.excusedRate + '%' : '–'}
          </p>
        </div>
      </div>
      <div style="overflow-x:auto;max-height:380px;overflow-y:auto;">
        <table style="min-width:480px;">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Termin</th>
              <th>Status</th>
              <th>Notiz</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" class="text-muted" style="padding:16px;">Keine Daten im Zeitraum.</td></tr>'}
          </tbody>
        </table>
      </div>`,
    confirmLabel: 'Schließen',
    onConfirm: () => {}
  });
}

/* ── PDF-Export ────────────────────────────────────────────────────────────── */
function exportReportAsPDF(stats, title) {
  const since = new Date();
  since.setDate(since.getDate() - 180);
  const periodFrom = since.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const printDate  = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const appName    = document.getElementById('app-title')?.textContent || 'Anwesenheit';

  const tableRows = stats.map(s => {
    const attRate = s.attendanceRate !== null ? `${s.attendanceRate}%` : '–';
    const absRate = s.absenceRate    !== null ? `${s.absenceRate}%`    : '–';
    const excRate = s.excusedRate    !== null ? `${s.excusedRate}%`    : '–';

    const attColor = s.attendanceRate >= 80 ? '#2e7d32' : s.attendanceRate >= 50 ? '#e65100' : '#c62828';
    const absColor = s.absenceRate    >= 30 ? '#c62828' : s.absenceRate    >= 15 ? '#e65100' : '#2e7d32';

    return `
      <tr>
        <td>
          <strong>${s.member.displayName || '–'}</strong>
          <br><small style="color:#666;">${s.member.email || ''}</small>
        </td>
        <td style="text-align:center;">${s.total}</td>
        <td style="text-align:center;">${s.present}</td>
        <td style="text-align:center;font-weight:700;color:${attColor};">${attRate}</td>
        <td style="text-align:center;font-weight:700;color:${absColor};">${absRate}</td>
        <td style="text-align:center;">${excRate}</td>
        <td style="text-align:center;">${s.absentUnexcused}</td>
        <td style="text-align:center;">${s.absentExcused}</td>
      </tr>`;
  }).join('');

  const printWin = window.open('', '_blank');
  if (!printWin) {
    if (typeof showToast === 'function') showToast('Popup-Blocker aktiv – bitte erlauben.', 'warning');
    return;
  }

  printWin.document.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; padding: 28px 36px; }
    h1 { font-size: 17pt; margin-bottom: 4px; }
    .meta { color: #555; font-size: 9pt; margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f0f0f0; }
    th { padding: 8px 10px; text-align: left; font-size: 9pt; font-weight: 600; border-bottom: 2px solid #ccc; }
    td { padding: 7px 10px; font-size: 9.5pt; border-bottom: 1px solid #e8e8e8; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .footer { margin-top: 24px; font-size: 8pt; color: #888; border-top: 1px solid #ccc; padding-top: 8px; display: flex; justify-content: space-between; }
    .no-print { display: flex; gap: 8px; margin-bottom: 18px; }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">
    Erstellt am ${printDate} &nbsp;·&nbsp;
    Zeitraum: ${periodFrom} – ${printDate} &nbsp;·&nbsp;
    ${stats.length} Mitglied${stats.length !== 1 ? 'er' : ''} &nbsp;·&nbsp;
    ${appName}
  </p>
  <div class="no-print">
    <button onclick="window.print()"
      style="padding:7px 18px;background:#01696f;color:#fff;border:none;border-radius:5px;font-size:11pt;cursor:pointer;">
      🖨️ Drucken / Als PDF speichern
    </button>
    <button onclick="window.close()"
      style="padding:7px 18px;background:#eee;color:#333;border:none;border-radius:5px;font-size:11pt;cursor:pointer;">
      Schließen
    </button>
  </div>
  <table>
    <thead>
      <tr>
        <th>Mitglied</th>
        <th style="text-align:center;">Termine</th>
        <th style="text-align:center;">Anwesend</th>
        <th style="text-align:center;">Teilnahmequote</th>
        <th style="text-align:center;">Fehlquote</th>
        <th style="text-align:center;">Entschuldigt-Quote</th>
        <th style="text-align:center;">Unentsch. gefehlt</th>
        <th style="text-align:center;">Entsch. gefehlt</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">
    <span>${appName} – Teilnahmebericht</span>
    <span>Generiert: ${printDate}</span>
  </div>
</body>
</html>`);
  printWin.document.close();
  setTimeout(() => printWin.print(), 500);
}
