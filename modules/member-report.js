// modules/member-report.js
// Dashboard "Meine Mitglieder" – Teilnahme-/Fehlquoten + PDF-Export
// Betreuer: nur eigene Mitglieder | Koordinator/Admin: alle Mitglieder

async function loadMemberReportDashboard() {
  const container = document.getElementById('app-content');
  const myUid     = window.currentUser.firebaseUser.uid;
  const myRoles   = window.currentUser.roles || [];
  const isCoord   = myRoles.includes('coordinator') || myRoles.includes('admin');
  const tLabel    = getRoleLabel('teacher');

  container.innerHTML = `<div class="loading-center">Lade Mitglieder-Berichte...</div>`;

  try {
    const settingsDoc = await firestore.collection('settings').doc('global').get();
    const settings    = settingsDoc.exists ? settingsDoc.data() : {};
    window.appSettings = settings;

    // ── Alle Nutzer laden ───────────────────────────────────────────────────
    const usersSnap = await firestore.collection('users').get();
    const allUsers  = [];
    usersSnap.forEach(doc => {
      const d = doc.data();
      allUsers.push({ uid: doc.id, ...d });
    });

    // ── Eigene Gruppen ermitteln (für Betreuer-Filter) ──────────────────────
    let relevantMembers = [];
    if (isCoord) {
      // Koordinator/Admin: alle Mitglieder
      relevantMembers = allUsers.filter(u => (u.roles || []).includes('member'));
    } else {
      // Betreuer: Mitglieder aus eigenen Gruppen
      const myUserDoc = await firestore.collection('users').doc(myUid).get();
      const myGroups  = myUserDoc.exists ? (myUserDoc.data().groups || []) : [];
      if (!myGroups.length) {
        container.innerHTML = `
          <div class="card" style="max-width:480px;margin:48px auto;text-align:center;">
            <span class="material-icons" style="font-size:40px;color:var(--color-text-faint);margin-bottom:12px;">group_off</span>
            <h3 style="margin:0 0 8px;">Keine Gruppen zugewiesen</h3>
            <p class="text-muted">Du bist noch keiner Gruppe zugewiesen. Bitte wende dich an einen Koordinator.</p>
          </div>`;
        return;
      }
      // Mitglieder aller eigenen Gruppen sammeln
      const memberSet = new Set();
      allUsers.forEach(u => {
        if (!(u.roles || []).includes('member')) return;
        const userGroups = u.groups || [];
        if (userGroups.some(g => myGroups.includes(g))) memberSet.add(u.uid);
      });
      relevantMembers = allUsers.filter(u => memberSet.has(u.uid));
    }

    if (!relevantMembers.length) {
      container.innerHTML = `
        <div class="card" style="max-width:480px;margin:48px auto;text-align:center;">
          <span class="material-icons" style="font-size:40px;color:var(--color-text-faint);margin-bottom:12px;">person_off</span>
          <h3 style="margin:0 0 8px;">Keine Mitglieder gefunden</h3>
          <p class="text-muted">In deinen Gruppen sind noch keine Mitglieder vorhanden.</p>
        </div>`;
      return;
    }

    // ── Zeitraum-Filter ─────────────────────────────────────────────────────
    const now          = new Date();
    const defaultFrom  = new Date(now.getFullYear(), now.getMonth() - 2, 1); // 3 Monate zurück
    const defaultTo    = now;

    // ── UI aufbauen ─────────────────────────────────────────────────────────
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
        <div>
          <h2 style="margin:0 0 4px;">Meine ${isCoord ? 'Mitglieder' : 'Mitglieder'}</h2>
          <p class="text-muted" style="margin:0;font-size:0.85rem;">
            ${relevantMembers.length} Mitglied${relevantMembers.length !== 1 ? 'er' : ''}
            ${isCoord ? '(alle)' : '(deine Gruppen)'}
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button class="btn-secondary" id="export-pdf-btn" style="display:inline-flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:16px;">picture_as_pdf</span> PDF exportieren
          </button>
        </div>
      </div>

      <!-- Zeitraum-Filter -->
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">
          <div style="flex:1;min-width:140px;">
            <label style="font-size:0.85rem;color:var(--color-text-muted);display:block;margin-bottom:4px;">Von</label>
            <input type="date" id="filter-from" value="${_fmtDateInput(defaultFrom)}" />
          </div>
          <div style="flex:1;min-width:140px;">
            <label style="font-size:0.85rem;color:var(--color-text-muted);display:block;margin-bottom:4px;">Bis</label>
            <input type="date" id="filter-to" value="${_fmtDateInput(defaultTo)}" />
          </div>
          <button class="btn-primary" id="apply-filter-btn" style="display:inline-flex;align-items:center;gap:4px;padding:8px 18px;">
            <span class="material-icons" style="font-size:16px;">filter_list</span> Anwenden
          </button>
        </div>
      </div>

      <!-- Suchfeld -->
      <div style="margin-bottom:12px;position:relative;">
        <span class="material-icons" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--color-text-faint);font-size:18px;">search</span>
        <input type="text" id="member-report-search" placeholder="Mitglied suchen..." style="padding-left:36px;" />
      </div>

      <!-- Tabelle -->
      <div id="report-table-wrap">
        <div class="loading-center">Lade Statistiken...</div>
      </div>
    `;

    // Filter anwenden
    const applyAndRender = async () => {
      const fromVal = document.getElementById('filter-from')?.value;
      const toVal   = document.getElementById('filter-to')?.value;
      const from    = fromVal ? new Date(fromVal) : defaultFrom;
      const to      = toVal   ? new Date(toVal + 'T23:59:59') : defaultTo;
      const wrap    = document.getElementById('report-table-wrap');
      if (wrap) wrap.innerHTML = `<div class="loading-center">Lade Statistiken...</div>`;
      const stats = await _computeMemberStats(relevantMembers, from, to);
      if (wrap) renderReportTable(wrap, stats, from, to, isCoord, tLabel);
    };

    document.getElementById('apply-filter-btn')?.addEventListener('click', applyAndRender);
    document.getElementById('member-report-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.member-report-row').forEach(row => {
        row.style.display = row.dataset.name.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
      const fromVal = document.getElementById('filter-from')?.value;
      const toVal   = document.getElementById('filter-to')?.value;
      const from    = fromVal ? new Date(fromVal) : defaultFrom;
      const to      = toVal   ? new Date(toVal + 'T23:59:59') : defaultTo;
      exportReportPDF(from, to, isCoord);
    });

    // Initial rendern
    await applyAndRender();

  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="text-error">Fehler beim Laden: ${err.message}</p>`;
  }
}

// ── Statistiken berechnen ────────────────────────────────────────────────────
async function _computeMemberStats(members, from, to) {
  const stats = [];

  for (const member of members) {
    // Alle Anwesenheits-Einträge dieses Mitglieds laden
    const attSnap = await firestore.collection('eventAttendance')
      .where('userId', '==', member.uid)
      .get();

    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    // Zugehörige Events laden und nach Zeitraum filtern
    const eventIds = [...new Set(attendances.map(a => a.eventId).filter(Boolean))];
    const eventMap = {};
    for (const eid of eventIds) {
      const eDoc = await firestore.collection('events').doc(eid).get();
      if (!eDoc.exists) continue;
      const ev = eDoc.data();
      const t  = ev.startTime?.toDate?.();
      if (t && t >= from && t <= to && ev.status !== 'cancelled' && ev.status !== 'skipped') {
        eventMap[eid] = { id: eid, ...ev, _start: t };
      }
    }

    // Nur Einträge im Zeitraum
    const relevant = attendances.filter(a => eventMap[a.eventId]);

    const total             = relevant.length;
    const present           = relevant.filter(a => a.status === 'present').length;
    const lateExcused       = relevant.filter(a => a.status === 'late_excused').length;
    const lateUnexcused     = relevant.filter(a => a.status === 'late_unexcused').length;
    const absentExcused     = relevant.filter(a => a.status === 'absent_excused').length;
    const absentUnexcused   = relevant.filter(a => a.status === 'absent_unexcused').length;
    const registered        = relevant.filter(a => a.status === 'registered').length;
    const confirmPending    = relevant.filter(a => a.status === 'confirmation_pending').length;
    const cancelled         = relevant.filter(a => a.status === 'cancelled').length;

    const attended          = present + lateExcused + lateUnexcused; // zählt als anwesend
    const absent            = absentExcused + absentUnexcused;
    const excusedTotal      = absentExcused + lateExcused;
    const unexcusedTotal    = absentUnexcused + lateUnexcused;

    const attendanceRate    = total > 0 ? Math.round((attended / total) * 100) : null;
    const absenceRate       = total > 0 ? Math.round((absent   / total) * 100) : null;
    const excusedRate       = absent > 0 ? Math.round((excusedTotal / absent) * 100) : null;

    stats.push({
      uid: member.uid,
      name: member.displayName || member.email || member.uid,
      email: member.email || '',
      groups: member.groups || [],
      total,
      present,
      attended,
      absent,
      absentExcused,
      absentUnexcused,
      lateExcused,
      lateUnexcused,
      registered,
      confirmPending,
      cancelled,
      excusedTotal,
      unexcusedTotal,
      attendanceRate,
      absenceRate,
      excusedRate,
    });
  }

  // Sortierung: alphabetisch nach Name
  stats.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return stats;
}

// ── Tabelle rendern ──────────────────────────────────────────────────────────
function renderReportTable(wrap, stats, from, to, isCoord, tLabel) {
  if (!stats.length) {
    wrap.innerHTML = '<p class="text-muted">Keine Daten für den gewählten Zeitraum.</p>';
    return;
  }

  const pct = (v) => v !== null && v !== undefined ? `${v}%` : '–';
  const num = (v) => v !== null && v !== undefined ? v : 0;

  const rateColor = (rate) => {
    if (rate === null) return 'var(--color-text-muted)';
    if (rate >= 80) return 'var(--color-success)';
    if (rate >= 60) return 'var(--color-warning)';
    return 'var(--color-error)';
  };
  const absColor = (rate) => {
    if (rate === null) return 'var(--color-text-muted)';
    if (rate <= 10) return 'var(--color-success)';
    if (rate <= 25) return 'var(--color-warning)';
    return 'var(--color-error)';
  };

  const dateRange = `${_fmtDate(from)} – ${_fmtDate(to)}`;

  wrap.innerHTML = `
    <div id="report-print-area">
      <div id="report-print-header" style="display:none;margin-bottom:20px;">
        <h2 style="margin:0 0 4px;">Teilnahmebericht</h2>
        <p style="margin:0;font-size:0.9rem;color:#666;">Zeitraum: ${dateRange} · Erstellt: ${_fmtDate(new Date())}</p>
      </div>
      <div style="overflow-x:auto;">
        <table id="report-table" style="font-size:0.88rem;">
          <thead>
            <tr style="background:var(--color-surface-offset);">
              <th style="text-align:left;padding:10px 12px;font-weight:600;">Mitglied</th>
              <th style="padding:10px 8px;text-align:center;" title="Termine gesamt">Termine</th>
              <th style="padding:10px 8px;text-align:center;" title="Anwesenheitsquote">Anw.-Quote</th>
              <th style="padding:10px 8px;text-align:center;" title="Fehlquote">Fehlquote</th>
              <th style="padding:10px 8px;text-align:center;" title="Entschuldigt von Fehlzeiten">Entsch.-Quote</th>
              <th style="padding:10px 8px;text-align:center;">Anwesend</th>
              <th style="padding:10px 8px;text-align:center;">Entsch. gefehlt</th>
              <th style="padding:10px 8px;text-align:center;">Unentsch. gefehlt</th>
              <th style="padding:10px 8px;text-align:center;">Abgemeldet</th>
              <th style="padding:10px 8px;text-align:center;">Offen</th>
            </tr>
          </thead>
          <tbody id="report-tbody">
            ${stats.map(s => `
              <tr class="member-report-row" data-uid="${s.uid}" data-name="${s.name}"
                  style="border-bottom:1px solid var(--color-border);cursor:pointer;"
                  onclick="openMemberReportDetail('${s.uid}')">
                <td style="padding:10px 12px;">
                  <div style="font-weight:500;">${s.name}</div>
                  ${s.email ? `<div style="font-size:0.78rem;color:var(--color-text-muted);">${s.email}</div>` : ''}
                </td>
                <td style="padding:10px 8px;text-align:center;">${num(s.total)}</td>
                <td style="padding:10px 8px;text-align:center;">
                  <span style="font-weight:700;color:${rateColor(s.attendanceRate)};">${pct(s.attendanceRate)}</span>
                </td>
                <td style="padding:10px 8px;text-align:center;">
                  <span style="font-weight:700;color:${absColor(s.absenceRate)};">${pct(s.absenceRate)}</span>
                </td>
                <td style="padding:10px 8px;text-align:center;">
                  <span style="color:${s.excusedRate !== null ? 'var(--color-text)' : 'var(--color-text-faint)'};">${
                    s.excusedRate !== null ? pct(s.excusedRate) + ' entsch.' : '–'
                  }</span>
                </td>
                <td style="padding:10px 8px;text-align:center;color:var(--color-success);font-weight:600;">${num(s.attended)}</td>
                <td style="padding:10px 8px;text-align:center;color:var(--color-warning);">${num(s.absentExcused)}</td>
                <td style="padding:10px 8px;text-align:center;color:var(--color-error);">${num(s.absentUnexcused)}</td>
                <td style="padding:10px 8px;text-align:center;color:var(--color-text-muted);">${num(s.cancelled)}</td>
                <td style="padding:10px 8px;text-align:center;color:var(--color-text-muted);">${num(s.registered + s.confirmPending)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Hover-Effekt für Tabellenzeilen
  document.querySelectorAll('.member-report-row').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.background = 'var(--color-surface-offset)');
    row.addEventListener('mouseleave', () => row.style.background = '');
  });
}

// ── Detailansicht einzelnes Mitglied ─────────────────────────────────────────
async function openMemberReportDetail(uid) {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Detailbericht...</div>`;

  try {
    const userDoc  = await firestore.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const name     = userData.displayName || userData.email || uid;

    const attSnap = await firestore.collection('eventAttendance').where('userId', '==', uid).get();
    const attendances = [];
    attSnap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));

    const eventIds = [...new Set(attendances.map(a => a.eventId).filter(Boolean))];
    const events   = {};
    for (const eid of eventIds) {
      const eDoc = await firestore.collection('events').doc(eid).get();
      if (eDoc.exists) events[eid] = { id: eid, ...eDoc.data() };
    }

    const rows = attendances
      .filter(a => events[a.eventId])
      .sort((a, b) => {
        const ta = events[a.eventId]?.startTime?.toMillis?.() ?? 0;
        const tb = events[b.eventId]?.startTime?.toMillis?.() ?? 0;
        return tb - ta;
      });

    const statusLabel = {
      present:              '✅ Anwesend',
      registered:           '📋 Angemeldet',
      confirmation_pending: '⏳ Ausstehend',
      absent_excused:       '🟡 Entsch. gefehlt',
      absent_unexcused:     '🔴 Unentsch. gefehlt',
      late_excused:         '🟡 Verspätet (E)',
      late_unexcused:       '🟡 Verspätet (U)',
      cancelled:            '↩ Abgemeldet',
      skipped:              '❌ Ausgefallen',
    };

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
        <button class="btn-secondary" id="report-detail-back" style="padding:6px 16px;display:inline-flex;align-items:center;gap:4px;">
          <span class="material-icons" style="font-size:18px;">arrow_back</span> Zurück
        </button>
        <h2 style="margin:0;">Bericht: ${name}</h2>
        <button class="btn-secondary" id="export-detail-pdf" style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">picture_as_pdf</span> PDF
        </button>
      </div>

      <div id="detail-report-content">
        <div style="overflow-x:auto;">
          <table style="font-size:0.88rem;">
            <thead>
              <tr style="background:var(--color-surface-offset);">
                <th style="text-align:left;padding:8px 12px;">Termin</th>
                <th style="padding:8px;text-align:center;">Datum</th>
                <th style="padding:8px;text-align:center;">Status</th>
                <th style="padding:8px;text-align:left;">Notiz</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(a => {
                const ev = events[a.eventId];
                const start = ev?.startTime?.toDate?.();
                return `
                <tr style="border-bottom:1px solid var(--color-border);">
                  <td style="padding:8px 12px;font-weight:500;">${ev?.title || '–'}</td>
                  <td style="padding:8px;text-align:center;white-space:nowrap;">${start ? _fmtDate(start) : '–'}</td>
                  <td style="padding:8px;text-align:center;">${statusLabel[a.status] || a.status}</td>
                  <td style="padding:8px;color:var(--color-text-muted);font-size:0.82rem;">${a.memberNote || a.trainerNoteMember || '–'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('report-detail-back').onclick = () => loadMemberReportDashboard();
    document.getElementById('export-detail-pdf').onclick  = () => _exportDetailPDF(name, rows, events, statusLabel);

  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="text-error">Fehler: ${err.message}</p>`;
  }
}

// ── PDF-Export (Übersicht) ────────────────────────────────────────────────────
function exportReportPDF(from, to, isCoord) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('PDF-Bibliothek nicht geladen.', 'error'); return; }

  const rows   = document.querySelectorAll('.member-report-row');
  const doc    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const title  = (window.appSettings?.brandingTitle || 'Anwesenheit-NEO') + ' – Teilnahmebericht';
  const range  = `Zeitraum: ${_fmtDate(from)} – ${_fmtDate(to)}`;
  const today  = `Erstellt: ${_fmtDate(new Date())}`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${range}   ·   ${today}`, 14, 21);

  const headers = ['Mitglied', 'Termine', 'Anw.-%', 'Fehl-%', 'Entsch.-%', 'Anwesend', 'Entsch.', 'Unentsch.', 'Abgem.', 'Offen'];
  const data    = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 10) return;
    data.push([
      cells[0].querySelector('div')?.textContent || cells[0].textContent,
      cells[1].textContent.trim(),
      cells[2].textContent.trim(),
      cells[3].textContent.trim(),
      cells[4].textContent.trim(),
      cells[5].textContent.trim(),
      cells[6].textContent.trim(),
      cells[7].textContent.trim(),
      cells[8].textContent.trim(),
      cells[9].textContent.trim(),
    ]);
  });

  if (!data.length) { showToast('Keine Daten zum Exportieren.', 'warning'); return; }

  // Einfache manuelle Tabelle
  const colWidths = [50, 16, 18, 18, 22, 18, 18, 22, 18, 14];
  const startX    = 14;
  let   y         = 28;
  const rowH      = 7;
  const headerH   = 8;

  // Header
  doc.setFillColor(240, 240, 240);
  doc.rect(startX, y, colWidths.reduce((a,b) => a+b, 0), headerH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  let x = startX;
  headers.forEach((h, i) => {
    doc.text(h, x + 2, y + 5.5);
    x += colWidths[i];
  });
  y += headerH;

  // Daten
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  data.forEach((row, ri) => {
    if (ri % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(startX, y, colWidths.reduce((a,b)=>a+b,0), rowH, 'F');
    }
    x = startX;
    row.forEach((cell, i) => {
      const txt = String(cell).substring(0, i === 0 ? 30 : 8);
      doc.text(txt, x + 2, y + 4.8);
      x += colWidths[i];
    });
    // Trennlinie
    doc.setDrawColor(220, 220, 220);
    doc.line(startX, y + rowH, startX + colWidths.reduce((a,b)=>a+b,0), y + rowH);
    y += rowH;
    if (y > 185) { doc.addPage(); y = 14; }
  });

  const filename = `Teilnahmebericht_${_fmtDateFile(from)}_${_fmtDateFile(to)}.pdf`;
  doc.save(filename);
  showToast('PDF wurde erstellt.', 'success');
}

// ── PDF-Export (Detail einzelnes Mitglied) ────────────────────────────────────
function _exportDetailPDF(name, rows, events, statusLabel) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('PDF-Bibliothek nicht geladen.', 'error'); return; }

  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = `Einzelbericht: ${name}`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(title, 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Erstellt: ${_fmtDate(new Date())}`, 14, 22);

  const headers  = ['Termin', 'Datum', 'Status', 'Notiz'];
  const colW     = [70, 28, 42, 42];
  const startX   = 14;
  let   y        = 28;

  // Header
  doc.setFillColor(240,240,240);
  doc.rect(startX, y, colW.reduce((a,b)=>a+b,0), 8, 'F');
  doc.setFont('helvetica','bold');
  doc.setFontSize(8.5);
  let x = startX;
  headers.forEach((h,i) => { doc.text(h, x+2, y+5.5); x += colW[i]; });
  y += 8;

  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  rows.forEach((a, ri) => {
    const ev    = events[a.eventId];
    const start = ev?.startTime?.toDate?.();
    const cells = [
      (ev?.title || '–').substring(0, 35),
      start ? _fmtDate(start) : '–',
      (statusLabel[a.status] || a.status).replace(/[✅📋⏳🟡🔴↩❌]/g, '').trim(),
      (a.memberNote || a.trainerNoteMember || '–').substring(0, 30),
    ];
    if (ri % 2 === 0) {
      doc.setFillColor(250,250,250);
      doc.rect(startX, y, colW.reduce((a,b)=>a+b,0), 7, 'F');
    }
    x = startX;
    cells.forEach((c,i) => { doc.text(String(c), x+2, y+4.8); x += colW[i]; });
    doc.setDrawColor(220,220,220);
    doc.line(startX, y+7, startX+colW.reduce((a,b)=>a+b,0), y+7);
    y += 7;
    if (y > 270) { doc.addPage(); y = 14; }
  });

  doc.save(`Bericht_${name.replace(/\s+/g,'_')}_${_fmtDateFile(new Date())}.pdf`);
  showToast('PDF wurde erstellt.', 'success');
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function _fmtDate(d) {
  if (!d) return '–';
  return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function _fmtDateInput(d) {
  if (!d) return '';
  const y  = d.getFullYear();
  const m  = String(d.getMonth()+1).padStart(2,'0');
  const dy = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dy}`;
}
function _fmtDateFile(d) {
  if (!d) return '';
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
