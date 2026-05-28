// modules/member-report.js
// Dashboard "Meine Mitglieder" – Teilnahmeberichte & PDF-Export
// Betreuer: nur eigene Mitglieder | Koordinator/Admin: alle Mitglieder

async function loadMemberReportDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Mitgliederbericht...</div>`;

  try {
    const roles   = window.currentUser?.roles || [];
    const uid     = window.currentUser?.firebaseUser?.uid;
    const isCoord = roles.includes('coordinator') || roles.includes('admin');
    const mLabel  = getRoleLabel('member');
    const tLabel  = getRoleLabel('teacher');

    // Alle Mitglieder laden (je nach Rolle gefiltert)
    const usersSnap = await firestore.collection('users').orderBy('displayName').get();
    let allMembers = [];
    usersSnap.forEach(doc => {
      const d = doc.data();
      if ((d.roles || []).includes('member')) allMembers.push({ id: doc.id, ...d });
    });

    // Betreuer: nur eigene Mitglieder (die in Gruppen sind, wo er Betreuer ist)
    let reportMembers = allMembers;
    if (!isCoord) {
      // Gruppen ermitteln wo aktueller Betreuer Termine hat
      const trainerEvSnap = await firestore.collection('events')
        .where('trainers', 'array-contains', uid).get();
      const myGroupIds = new Set();
      trainerEvSnap.forEach(doc => { if (doc.data().groupId) myGroupIds.add(doc.data().groupId); });
      // Mitglieder in diesen Gruppen
      const myMemberIds = new Set();
      for (const gid of myGroupIds) {
        const gDoc = await firestore.collection('groups').doc(gid).get();
        if (gDoc.exists) (gDoc.data().members || []).forEach(id => myMemberIds.add(id));
      }
      reportMembers = allMembers.filter(m => myMemberIds.has(m.id));
    }

    // Alle Termine laden (für Quoten-Berechnung)
    const evSnap = await firestore.collection('events').get();
    const allEvents = {};
    evSnap.forEach(doc => { allEvents[doc.id] = { id: doc.id, ...doc.data() }; });

    // Alle Attendance-Datensätze laden
    const attSnap = await firestore.collection('eventAttendance').get();
    const attByMember = {};
    attSnap.forEach(doc => {
      const d = doc.data();
      if (!attByMember[d.userId]) attByMember[d.userId] = [];
      attByMember[d.userId].push({ id: doc.id, ...d });
    });

    // Statistiken pro Mitglied berechnen
    const now = new Date();
    const memberStats = reportMembers.map(member => {
      const atts = (attByMember[member.id] || []).filter(a => {
        const ev = allEvents[a.eventId];
        if (!ev) return false;
        const t = ev.startTime?.toDate?.();
        if (!t || t > now) return false; // nur vergangene Termine
        if (ev.status === 'cancelled' || ev.status === 'skipped') return false;
        return true;
      });

      const total            = atts.length;
      const present          = atts.filter(a => ['present','late_excused','late_unexcused','registered'].includes(a.status)).length;
      const absentExcused    = atts.filter(a => a.status === 'absent_excused').length;
      const absentUnexcused  = atts.filter(a => a.status === 'absent_unexcused').length;
      const cancelled        = atts.filter(a => a.status === 'cancelled').length;
      const pending          = atts.filter(a => a.status === 'confirmation_pending').length;
      const absent           = absentExcused + absentUnexcused;

      const attendanceRate   = total > 0 ? Math.round((present / total) * 100) : null;
      const absenceRate      = total > 0 ? Math.round((absent  / total) * 100) : null;
      const excusedRate      = absent > 0 ? Math.round((absentExcused / absent) * 100) : null;

      return {
        member,
        total, present, absent, absentExcused, absentUnexcused, cancelled, pending,
        attendanceRate, absenceRate, excusedRate,
        atts
      };
    });

    // UI rendern
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:18px;">
        <div>
          <h2 style="margin:0 0 2px;">Meine ${mLabel}</h2>
          <p class="text-muted" style="margin:0;font-size:0.85rem;">${reportMembers.length} ${mLabel} · Teilnahmeberichte & Fehlquoten</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-secondary" id="mr-export-pdf" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">picture_as_pdf</span> PDF exportieren
          </button>
        </div>
      </div>

      <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input type="search" id="mr-search" placeholder="${mLabel} suchen..." style="max-width:280px;margin-bottom:0;" />
        <select id="mr-sort" style="margin-bottom:0;">
          <option value="name">Sortierung: Name</option>
          <option value="attendance-asc">Sortierung: Anwesenheit ↑</option>
          <option value="attendance-desc">Sortierung: Anwesenheit ↓</option>
          <option value="absence-desc">Sortierung: Fehlquote ↓</option>
        </select>
      </div>

      <div id="mr-overview" style="width:100%;overflow-x:auto;"></div>
      <div id="mr-detail"></div>
    `;

    const overviewEl = container.querySelector('#mr-overview');
    const detailEl   = container.querySelector('#mr-detail');
    const searchEl   = container.querySelector('#mr-search');
    const sortEl     = container.querySelector('#mr-sort');

    let currentFilter = '';
    let currentSort   = 'name';

    const renderOverview = () => {
      let data = memberStats.filter(s =>
        !currentFilter || (s.member.displayName || s.member.email || '').toLowerCase().includes(currentFilter)
      );

      if (currentSort === 'name')             data.sort((a,b) => (a.member.displayName||'').localeCompare(b.member.displayName||''));
      if (currentSort === 'attendance-asc')   data.sort((a,b) => (a.attendanceRate??-1) - (b.attendanceRate??-1));
      if (currentSort === 'attendance-desc')  data.sort((a,b) => (b.attendanceRate??-1) - (a.attendanceRate??-1));
      if (currentSort === 'absence-desc')     data.sort((a,b) => (b.absenceRate??-1) - (a.absenceRate??-1));

      if (!data.length) {
        overviewEl.innerHTML = '<p class="text-muted">Keine Mitglieder gefunden.</p>';
        return;
      }

      overviewEl.innerHTML = `
        <table id="mr-table" style="width:100%;table-layout:auto;min-width:680px;">
          <thead>
            <tr>
              <th style="text-align:left;">${mLabel}</th>
              <th style="text-align:center;">Termine</th>
              <th style="text-align:center;">Anwesenheit</th>
              <th style="text-align:center;">Fehlquote</th>
              <th style="text-align:center;">Entschuldigt-Quote</th>
              <th style="text-align:center;">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(s => {
              const attColor  = s.attendanceRate === null ? 'var(--color-text-muted)'
                : s.attendanceRate >= 80 ? 'var(--color-success)'
                : s.attendanceRate >= 60 ? 'var(--color-warning)'
                : 'var(--color-error)';
              const absColor  = s.absenceRate === null ? 'var(--color-text-muted)'
                : s.absenceRate <= 10 ? 'var(--color-success)'
                : s.absenceRate <= 25 ? 'var(--color-warning)'
                : 'var(--color-error)';
              return `
                <tr>
                  <td>
                    <div style="font-weight:500;">${s.member.displayName || '(kein Name)'}</div>
                    <div style="font-size:0.8rem;color:var(--color-text-muted);">${s.member.email || ''}</div>
                  </td>
                  <td style="text-align:center;">${s.total > 0 ? s.total : '<span class="text-muted">–</span>'}</td>
                  <td style="text-align:center;">
                    ${s.attendanceRate !== null
                      ? `<span style="font-weight:600;color:${attColor};">${s.attendanceRate}%</span>
                         <div style="font-size:0.78rem;color:var(--color-text-muted);">${s.present}/${s.total}</div>`
                      : '<span class="text-muted">–</span>'}
                  </td>
                  <td style="text-align:center;">
                    ${s.absenceRate !== null
                      ? `<span style="font-weight:600;color:${absColor};">${s.absenceRate}%</span>
                         <div style="font-size:0.78rem;color:var(--color-text-muted);">${s.absent}/${s.total}</div>`
                      : '<span class="text-muted">–</span>'}
                  </td>
                  <td style="text-align:center;">
                    ${s.excusedRate !== null
                      ? `<span style="font-weight:500;color:var(--color-primary);">${s.excusedRate}%</span>
                         <div style="font-size:0.78rem;color:var(--color-text-muted);">${s.absentExcused}/${s.absent} entsch.</div>`
                      : '<span class="text-muted">–</span>'}
                  </td>
                  <td style="text-align:center;">
                    <button class="btn-secondary" data-uid="${s.member.id}" style="padding:4px 12px;font-size:0.85rem;">Details</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;

      overviewEl.querySelectorAll('[data-uid]').forEach(btn => {
        btn.onclick = () => {
          const stat = memberStats.find(s => s.member.id === btn.dataset.uid);
          if (stat) renderMemberDetail(stat, allEvents, detailEl);
        };
      });
    };

    searchEl.oninput = () => { currentFilter = searchEl.value.toLowerCase(); renderOverview(); };
    sortEl.onchange  = () => { currentSort = sortEl.value; renderOverview(); };

    container.querySelector('#mr-export-pdf').onclick = () => exportReportPdf(memberStats, allEvents, isCoord ? 'Alle Mitglieder' : 'Meine Mitglieder');

    renderOverview();
    if (!reportMembers.length) {
      overviewEl.innerHTML = `<p class="text-muted">Keine ${mLabel} gefunden${isCoord ? '.' : ' – du betreutest noch keine Gruppen oder Mitglieder.'}</p>`;
    }

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-error">Fehler beim Laden: ' + e.message + '</p>';
  }
}

// ── Detailansicht pro Mitglied ────────────────────────────────────────────────
function renderMemberDetail(stat, allEvents, detailEl) {
  const tLabel = getRoleLabel('teacher');
  const now = new Date();

  // Attendances mit Event-Daten verknüpfen
  const rows = stat.atts.map(a => ({
    att: a,
    ev:  allEvents[a.eventId]
  })).filter(r => r.ev)
    .sort((a,b) => (a.ev.startTime?.toMillis?.()??0) - (b.ev.startTime?.toMillis?.()??0));

  const statusLabel = (s) => ({
    registered:           'Angemeldet',
    present:              'Anwesend',
    absent_excused:       'Entsch. gefehlt',
    absent_unexcused:     'Unentsch. gefehlt',
    late_excused:         'Verspätet (E)',
    late_unexcused:       'Verspätet (U)',
    cancelled:            'Abgemeldet',
    confirmation_pending: 'Ausstehend',
    none:                 '–'
  }[s] || s);

  const statusColor = (s) => ({
    present:              'var(--color-success)',
    registered:           'var(--color-primary)',
    absent_excused:       'var(--color-warning)',
    absent_unexcused:     'var(--color-error)',
    late_excused:         'var(--color-warning)',
    late_unexcused:       'var(--color-warning)',
    cancelled:            'var(--color-text-muted)',
    confirmation_pending: 'var(--color-warning)'
  }[s] || 'var(--color-text-muted)');

  const attRate = stat.attendanceRate !== null ? `${stat.attendanceRate}%` : '–';
  const absRate = stat.absenceRate    !== null ? `${stat.absenceRate}%`    : '–';
  const excRate = stat.excusedRate    !== null ? `${stat.excusedRate}%`    : '–';

  detailEl.innerHTML = `
    <div style="margin-top:24px;border-top:2px solid var(--color-border);padding-top:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <div>
          <h3 style="margin:0 0 2px;">${stat.member.displayName || '(kein Name)'}</h3>
          <p class="text-muted" style="margin:0;font-size:0.84rem;">${stat.member.email || ''}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-secondary" id="mr-export-single-pdf" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:15px;">picture_as_pdf</span> Bericht exportieren
          </button>
          <button class="btn-text" id="mr-close-detail" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">close</span> Schließen
          </button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:20px;">
        ${[
          { label: 'Termine gesamt', value: stat.total, icon: 'event' },
          { label: 'Anwesenheit',    value: attRate,    icon: 'check_circle' },
          { label: 'Fehlquote',      value: absRate,    icon: 'cancel' },
          { label: 'Entschuldigt-Quote', value: excRate, icon: 'assignment_late' },
          { label: 'Entsch. Fehlzeiten', value: stat.absentExcused, icon: 'event_busy' },
          { label: 'Unentsch. Fehlzeiten', value: stat.absentUnexcused, icon: 'event_busy' }
        ].map(({ label, value, icon }) => `
          <div class="card" style="padding:14px;text-align:center;">
            <span class="material-icons" style="font-size:22px;color:var(--color-primary);">${icon}</span>
            <div style="font-size:1.3rem;font-weight:700;margin:4px 0 2px;">${value}</div>
            <div style="font-size:0.78rem;color:var(--color-text-muted);">${label}</div>
          </div>
        `).join('')}
      </div>

      <div style="width:100%;overflow-x:auto;">
        <table style="width:100%;min-width:500px;">
          <thead><tr>
            <th>Termin</th>
            <th>Datum</th>
            <th>Status</th>
            <th>Notiz</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(({ att, ev }) => {
              const d = ev.startTime?.toDate?.();
              return `<tr>
                <td>${ev.title || '–'}</td>
                <td style="white-space:nowrap;font-size:0.88rem;">${d ? d.toLocaleDateString('de-DE') : '–'}</td>
                <td>
                  <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.85rem;font-weight:500;color:${statusColor(att.status)};">
                    ${statusLabel(att.status)}
                  </span>
                </td>
                <td style="font-size:0.82rem;color:var(--color-text-muted);">${att.memberNote || att.trainerNoteMember || '–'}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="4" class="text-muted">Keine Einträge vorhanden.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  detailEl.querySelector('#mr-close-detail').onclick = () => { detailEl.innerHTML = ''; };
  detailEl.querySelector('#mr-export-single-pdf').onclick = () => exportSingleMemberPdf(stat, rows);
}

// ── PDF-Export: Alle Mitglieder ───────────────────────────────────────────────
function exportReportPdf(memberStats, allEvents, title) {
  const settings  = window.appSettings || {};
  const orgName   = settings.organisationName || '';
  const now       = new Date();
  const dateStr   = now.toLocaleDateString('de-DE');

  const statusLabel = (s) => ({
    registered:           'Angemeldet',
    present:              'Anwesend',
    absent_excused:       'Entsch. gefehlt',
    absent_unexcused:     'Unentsch. gefehlt',
    late_excused:         'Verspaetet (E)',
    late_unexcused:       'Verspaetet (U)',
    cancelled:            'Abgemeldet',
    confirmation_pending: 'Ausstehend'
  }[s] || s);

  const rows = memberStats.map(s => `
    <tr>
      <td>${s.member.displayName || '–'}</td>
      <td>${s.member.email || '–'}</td>
      <td style="text-align:center;">${s.total}</td>
      <td style="text-align:center;">${s.attendanceRate !== null ? s.attendanceRate + '%' : '–'}</td>
      <td style="text-align:center;">${s.absenceRate    !== null ? s.absenceRate    + '%' : '–'}</td>
      <td style="text-align:center;">${s.excusedRate    !== null ? s.excusedRate    + '%' : '–'}</td>
      <td style="text-align:center;">${s.absentExcused}</td>
      <td style="text-align:center;">${s.absentUnexcused}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; margin: 24px; }
      h1   { font-size: 16pt; margin-bottom: 4px; }
      p.sub { color: #555; font-size: 9pt; margin: 0 0 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      th { background: #1a6b6b; color: #fff; padding: 6px 10px; text-align: left; }
      td { padding: 5px 10px; border-bottom: 1px solid #ddd; }
      tr:nth-child(even) td { background: #f8f8f8; }
      @media print { body { margin: 12px; } }
    </style>
  </head><body>
    <h1>${title}</h1>
    <p class="sub">${orgName ? orgName + ' · ' : ''}Exportiert am ${dateStr}</p>
    <table>
      <thead><tr>
        <th>Name</th><th>E-Mail</th><th>Termine</th>
        <th>Anwesenheit</th><th>Fehlquote</th><th>Entsch.-Quote</th>
        <th>Entsch. Fehlzeiten</th><th>Unentsch. Fehlzeiten</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`;

  _openPrintWindow(html);
}

// ── PDF-Export: Einzelnes Mitglied ────────────────────────────────────────────
function exportSingleMemberPdf(stat, rows) {
  const settings = window.appSettings || {};
  const orgName  = settings.organisationName || '';
  const now      = new Date();
  const dateStr  = now.toLocaleDateString('de-DE');

  const statusLabel = (s) => ({
    registered:           'Angemeldet',
    present:              'Anwesend',
    absent_excused:       'Entsch. gefehlt',
    absent_unexcused:     'Unentsch. gefehlt',
    late_excused:         'Verspaetet (E)',
    late_unexcused:       'Verspaetet (U)',
    cancelled:            'Abgemeldet',
    confirmation_pending: 'Ausstehend'
  }[s] || s);

  const tableRows = rows.map(({ att, ev }) => {
    const d = ev.startTime?.toDate?.();
    return `<tr>
      <td>${ev.title || '–'}</td>
      <td>${d ? d.toLocaleDateString('de-DE') : '–'}</td>
      <td>${statusLabel(att.status)}</td>
      <td>${att.memberNote || att.trainerNoteMember || '–'}</td>
    </tr>`;
  }).join('');

  const attRate = stat.attendanceRate !== null ? stat.attendanceRate + '%' : '–';
  const absRate = stat.absenceRate    !== null ? stat.absenceRate    + '%' : '–';
  const excRate = stat.excusedRate    !== null ? stat.excusedRate    + '%' : '–';

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
    <title>Bericht – ${stat.member.displayName || stat.member.email}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; margin: 24px; }
      h1   { font-size: 15pt; margin-bottom: 2px; }
      h2   { font-size: 12pt; color: #555; margin: 0 0 16px; font-weight: normal; }
      .kpi-grid { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
      .kpi      { background: #f0f6f6; border-radius: 6px; padding: 10px 16px; min-width: 110px; }
      .kpi .val { font-size: 15pt; font-weight: bold; color: #1a6b6b; }
      .kpi .lbl { font-size: 8pt; color: #555; margin-top: 2px; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      th { background: #1a6b6b; color: #fff; padding: 6px 10px; text-align: left; }
      td { padding: 5px 10px; border-bottom: 1px solid #ddd; }
      tr:nth-child(even) td { background: #f8f8f8; }
      @media print { body { margin: 12px; } }
    </style>
  </head><body>
    <h1>${stat.member.displayName || '(kein Name)'}</h1>
    <h2>${stat.member.email || ''} ${orgName ? '· ' + orgName : ''} · Exportiert am ${dateStr}</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="val">${stat.total}</div><div class="lbl">Termine gesamt</div></div>
      <div class="kpi"><div class="val">${attRate}</div><div class="lbl">Anwesenheit</div></div>
      <div class="kpi"><div class="val">${absRate}</div><div class="lbl">Fehlquote</div></div>
      <div class="kpi"><div class="val">${excRate}</div><div class="lbl">Entsch.-Quote</div></div>
      <div class="kpi"><div class="val">${stat.absentExcused}</div><div class="lbl">Entsch. Fehlzeiten</div></div>
      <div class="kpi"><div class="val">${stat.absentUnexcused}</div><div class="lbl">Unentsch. Fehlzeiten</div></div>
    </div>
    <table>
      <thead><tr><th>Termin</th><th>Datum</th><th>Status</th><th>Notiz</th></tr></thead>
      <tbody>${tableRows || '<tr><td colspan="4">Keine Einträge.</td></tr>'}</tbody>
    </table>
  </body></html>`;

  _openPrintWindow(html);
}

function _openPrintWindow(html) {
  const win = window.open('', '_blank');
  if (!win) { showToast('Popup-Fenster blockiert – bitte Popups erlauben.', 'warning'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}
