// modules/statistics.js
// Statistik-Modul: Ranglisten mit Zeitraumauswahl & PDF-Export

async function loadStatisticsDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Statistiken...</div>`;

  try {
    // Zeitraum: Standard = aktuelles Jahr
    const now   = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd   = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const toInputVal = d => d.toISOString().slice(0, 10);

    container.innerHTML = `
      <h2 style="margin-top:0;">&#128202; Statistiken & Ranglisten</h2>

      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:16px;">
          <div>
            <label style="font-size:0.85rem;">Von</label>
            <input type="date" id="stat-from" value="${toInputVal(yearStart)}" />
          </div>
          <div>
            <label style="font-size:0.85rem;">Bis</label>
            <input type="date" id="stat-to" value="${toInputVal(yearEnd)}" />
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-text stat-preset" data-preset="year">Dieses Jahr</button>
            <button class="btn-text stat-preset" data-preset="lastYear">Letztes Jahr</button>
            <button class="btn-text stat-preset" data-preset="quarter">Dieses Quartal</button>
            <button class="btn-text stat-preset" data-preset="month">Dieser Monat</button>
          </div>
          <button class="btn-primary" id="stat-load-btn">Laden</button>
        </div>
      </div>

      <div id="stat-results"><p class="text-muted">Zeitraum auswählen und auf "Laden" klicken.</p></div>
    `;

    // Preset-Buttons
    container.querySelectorAll('.stat-preset').forEach(btn => {
      btn.onclick = () => {
        const n = new Date();
        let from, to;
        if (btn.dataset.preset === 'year') {
          from = new Date(n.getFullYear(), 0, 1);
          to   = new Date(n.getFullYear(), 11, 31);
        } else if (btn.dataset.preset === 'lastYear') {
          from = new Date(n.getFullYear() - 1, 0, 1);
          to   = new Date(n.getFullYear() - 1, 11, 31);
        } else if (btn.dataset.preset === 'quarter') {
          const q = Math.floor(n.getMonth() / 3);
          from = new Date(n.getFullYear(), q * 3, 1);
          to   = new Date(n.getFullYear(), q * 3 + 3, 0);
        } else if (btn.dataset.preset === 'month') {
          from = new Date(n.getFullYear(), n.getMonth(), 1);
          to   = new Date(n.getFullYear(), n.getMonth() + 1, 0);
        }
        document.getElementById('stat-from').value = toInputVal(from);
        document.getElementById('stat-to').value   = toInputVal(to);
      };
    });

    document.getElementById('stat-load-btn').onclick = () => runStatistics();

    // Erstes Laden direkt
    runStatistics();

  } catch (e) {
    container.innerHTML = `<p class="text-error">Fehler: ${e.message}</p>`;
  }
}

async function runStatistics() {
  const resultsEl = document.getElementById('stat-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = `<div class="loading-center">Berechne Statistiken...</div>`;

  const fromVal = document.getElementById('stat-from')?.value;
  const toVal   = document.getElementById('stat-to')?.value;
  if (!fromVal || !toVal) { resultsEl.innerHTML = '<p class="text-error">Bitte Zeitraum auswählen.</p>'; return; }

  const fromDate = new Date(fromVal + 'T00:00:00');
  const toDate   = new Date(toVal   + 'T23:59:59');

  try {
    // Events im Zeitraum laden
    const evSnap = await firestore.collection('events')
      .where('startTime', '>=', firebase.firestore.Timestamp.fromDate(fromDate))
      .where('startTime', '<=', firebase.firestore.Timestamp.fromDate(toDate))
      .get();

    const events = [];
    evSnap.forEach(doc => events.push({ id: doc.id, ...doc.data() }));

    if (!events.length) {
      resultsEl.innerHTML = '<p class="text-muted">Keine Termine im ausgewählten Zeitraum gefunden.</p>';
      return;
    }

    const eventIds = events.map(e => e.id);

    // Event-Dauer berechnen (in Minuten)
    const eventDuration = {};
    events.forEach(ev => {
      const s = ev.startTime?.toDate?.();
      const e = ev.endTime?.toDate?.();
      eventDuration[ev.id] = (s && e) ? Math.round((e - s) / 60000) : 60; // Default 60 Min
    });

    // Alle Anwesenheits-Einträge für diese Events laden (in Batches von 30)
    const attendances = [];
    const chunks = [];
    for (let i = 0; i < eventIds.length; i += 30) chunks.push(eventIds.slice(i, i + 30));
    for (const chunk of chunks) {
      const snap = await firestore.collection('eventAttendance')
        .where('eventId', 'in', chunk).get();
      snap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));
    }

    // Alle betroffenen User laden
    const userIds = [...new Set(attendances.map(a => a.userId))];
    const userMap = {};
    await Promise.all(userIds.map(async uid => {
      const uDoc = await firestore.collection('users').doc(uid).get();
      userMap[uid] = uDoc.exists
        ? { name: uDoc.data().displayName || uDoc.data().email || uid, email: uDoc.data().email || '' }
        : { name: uid, email: '' };
    }));

    // Statistiken pro Mitglied berechnen
    const stats = {};
    const initUser = (uid) => {
      if (!stats[uid]) stats[uid] = {
        uid,
        name:              userMap[uid]?.name || uid,
        email:             userMap[uid]?.email || '',
        totalEvents:       0,   // Termine für die registriert
        present:           0,   // Tatsächlich anwesend
        absent_excused:    0,
        absent_unexcused:  0,
        late:              0,   // verspätet (beide Arten)
        cancelled:         0,   // selbst abgemeldet
        presentMinutes:    0,   // Gesamtzeit anwesend in Minuten
        registeredMinutes: 0,   // Gesamtzeit registriert (unabh. von Status)
        attendanceRate:    0,   // wird später berechnet
        punctualityRate:   0,
      };
    };

    attendances.forEach(att => {
      initUser(att.userId);
      const s = stats[att.userId];
      const dur = eventDuration[att.eventId] || 60;
      s.totalEvents++;
      s.registeredMinutes += dur;
      if (att.status === 'present') {
        s.present++;
        s.presentMinutes += dur;
      } else if (att.status === 'absent_excused')   { s.absent_excused++; }
      else if (att.status === 'absent_unexcused')   { s.absent_unexcused++; }
      else if (att.status === 'late_excused' || att.status === 'late_unexcused') {
        s.late++;
        s.presentMinutes += Math.round(dur * 0.75); // Verspätete zählen mit 75%
      } else if (att.status === 'cancelled') { s.cancelled++; }
    });

    // Abgeleitete Metriken
    Object.values(stats).forEach(s => {
      s.attendanceRate  = s.totalEvents > 0 ? Math.round((s.present + s.late) / s.totalEvents * 100) : 0;
      s.punctualityRate = (s.present + s.late) > 0 ? Math.round(s.present / (s.present + s.late) * 100) : 100;
      s.absentRate      = s.totalEvents > 0 ? Math.round((s.absent_excused + s.absent_unexcused) / s.totalEvents * 100) : 0;
      s.presentHours    = (s.presentMinutes / 60).toFixed(1);
    });

    const allStats = Object.values(stats);
    if (!allStats.length) {
      resultsEl.innerHTML = '<p class="text-muted">Keine Mitgliederdaten im Zeitraum.</p>';
      return;
    }

    // Ranglisten-Definitionen
    const rankings = [
      {
        id: 'most_present',
        title: '🏆 Meiste Anwesenheiten',
        desc: 'Mitglieder mit den meisten tatsächlich anwesenden Terminen',
        sort: (a, b) => b.present - a.present,
        value: s => `${s.present} Termine`,
        medal: true,
      },
      {
        id: 'most_hours',
        title: '⏱️ Höchste Anwesenheitszeit',
        desc: 'Mitglieder mit der meisten tatsächlichen Zeit im Training',
        sort: (a, b) => b.presentMinutes - a.presentMinutes,
        value: s => `${s.presentHours} Std.`,
        medal: true,
      },
      {
        id: 'best_rate',
        title: '📊 Höchste Anwesenheitsquote',
        desc: 'Anteil anwesend+verspätet an allen Terminen (mind. 3 Termine)',
        filter: s => s.totalEvents >= 3,
        sort: (a, b) => b.attendanceRate - a.attendanceRate,
        value: s => `${s.attendanceRate}% (${s.totalEvents} Termine)`,
        medal: true,
      },
      {
        id: 'most_punctual',
        title: '⏰ Pünktlichste Mitglieder',
        desc: 'Höchste Pünktlichkeitsrate (anwesend ohne Verspätung, mind. 3 Termine)',
        filter: s => s.totalEvents >= 3,
        sort: (a, b) => b.punctualityRate - a.punctualityRate,
        value: s => `${s.punctualityRate}% pünktlich`,
        medal: true,
      },
      {
        id: 'most_active',
        title: '🔥 Aktivste Mitglieder',
        desc: 'Meiste Termine insgesamt (registriert für)',
        sort: (a, b) => b.totalEvents - a.totalEvents,
        value: s => `${s.totalEvents} Termine gesamt`,
        medal: true,
      },
      {
        id: 'least_unexcused',
        title: '✅ Wenigste unentschuldigte Fehlzeiten',
        desc: 'Mitglieder mit den wenigsten unentschuldigten Fehlzeiten',
        filter: s => s.totalEvents >= 3,
        sort: (a, b) => a.absent_unexcused - b.absent_unexcused || b.totalEvents - a.totalEvents,
        value: s => `${s.absent_unexcused}x unentschuldigt`,
        medal: false,
      },
      {
        id: 'most_improved',
        title: '📈 Höchste gesamte Trainingszeit (registriert)',
        desc: 'Meiste Zeit für die man eingeschrieben war',
        sort: (a, b) => b.registeredMinutes - a.registeredMinutes,
        value: s => `${(s.registeredMinutes/60).toFixed(1)} Std. eingeplant`,
        medal: false,
      },
    ];

    // Ranglisten rendern
    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        <p class="text-muted" style="margin:0;font-size:0.88rem;">
          Zeitraum: <strong>${fromDate.toLocaleDateString('de-DE')}</strong> – <strong>${toDate.toLocaleDateString('de-DE')}</strong>
          &nbsp;·&nbsp; ${events.length} Termine &nbsp;·&nbsp; ${allStats.length} Mitglieder
        </p>
        <button class="btn-primary" id="stat-export-pdf">&#128196; Als PDF exportieren</button>
      </div>
    `;

    rankings.forEach(rank => {
      let data = allStats.filter(rank.filter || (() => true)).sort(rank.sort).slice(0, 10);
      if (!data.length) return;
      const medals = ['🥇', '🥈', '🥉'];
      html += `
        <div class="card" style="margin-bottom:16px;" id="rank-${rank.id}">
          <h3 style="margin:0 0 4px;">${rank.title}</h3>
          <p class="text-muted" style="margin:0 0 12px;font-size:0.85rem;">${rank.desc}</p>
          <div style="overflow-x:auto;">
            <table>
              <thead><tr><th style="width:40px;">#</th><th>Name</th><th>Wert</th></tr></thead>
              <tbody>
                ${data.map((s, i) => `
                  <tr style="${i < 3 && rank.medal ? 'font-weight:600;' : ''}">
                    <td style="font-size:1.1rem;text-align:center;">${rank.medal && i < 3 ? medals[i] : (i + 1) + '.'}</td>
                    <td>${s.name}</td>
                    <td>${rank.value(s)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    });

    resultsEl.innerHTML = html;

    // PDF Export
    document.getElementById('stat-export-pdf')?.addEventListener('click', () => {
      exportStatisticsPDF(fromDate, toDate, events.length, allStats, rankings);
    });

  } catch (e) {
    resultsEl.innerHTML = `<p class="text-error">Fehler beim Laden: ${e.message}</p>`;
    console.error(e);
  }
}

function exportStatisticsPDF(fromDate, toDate, eventCount, allStats, rankings) {
  if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
    showToast('PDF-Bibliothek nicht geladen. Bitte Seite neu laden.', 'error');
    return;
  }
  const { jsPDF } = window.jspdf || window;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  const addPage = () => {
    doc.addPage();
    y = margin;
    drawHeader();
    y += 8;
  };

  const checkY = (needed = 10) => {
    if (y + needed > pageH - margin) addPage();
  };

  const drawHeader = () => {
    // Brand-Balken
    doc.setFillColor(21, 101, 192);
    doc.rect(0, 0, pageW, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Anwesenheit-NEO', margin, 9.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Statistik-Auswertung', pageW - margin, 9.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  const drawFooter = (pageNum) => {
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Seite ${pageNum} · Exportiert am ${new Date().toLocaleDateString('de-DE')} · Anwesenheit-NEO`, pageW / 2, pageH - 6, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  };

  // Erste Seite
  drawHeader();
  y = 22;

  // Titel
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(21, 101, 192);
  doc.text('Statistik & Ranglisten', margin, y);
  y += 8;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Zeitraum: ${fromDate.toLocaleDateString('de-DE')} – ${toDate.toLocaleDateString('de-DE')}   ·   ${eventCount} Termine   ·   ${allStats.length} Mitglieder`, margin, y);
  y += 10;

  let pageNum = 1;

  rankings.forEach(rank => {
    let data = allStats.filter(rank.filter || (() => true)).sort(rank.sort).slice(0, 10);
    if (!data.length) return;

    checkY(30);

    // Abschnitts-Titel
    doc.setFillColor(240, 245, 255);
    doc.rect(margin, y - 4, contentW, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(21, 101, 192);
    doc.text(rank.title.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]/gu, '').trim(), margin + 2, y + 0.5);
    y += 8;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    doc.text(rank.desc, margin, y);
    y += 6;
    doc.setTextColor(0, 0, 0);

    // Tabellen-Header
    doc.setFillColor(21, 101, 192);
    doc.rect(margin, y, contentW, 6, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('#', margin + 2, y + 4);
    doc.text('Name', margin + 14, y + 4);
    doc.text('Wert', margin + contentW - 2, y + 4, { align: 'right' });
    y += 6;
    doc.setTextColor(0, 0, 0);

    // Zeilen
    data.forEach((s, i) => {
      checkY(7);
      const isTop3 = i < 3 && rank.medal;
      doc.setFillColor(i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 255 : 255);
      if (isTop3) doc.setFillColor(255, 248, 220);
      doc.rect(margin, y, contentW, 6, 'F');
      doc.setFont('helvetica', isTop3 ? 'bold' : 'normal');
      doc.setFontSize(8.5);
      const rankLabel = ['1.', '2.', '3.'][i] || `${i + 1}.`;
      doc.text(rankLabel, margin + 2, y + 4);
      doc.text(s.name.substring(0, 35), margin + 14, y + 4);
      doc.text(rank.value(s), margin + contentW - 2, y + 4, { align: 'right' });
      y += 6;
    });

    y += 8;
  });

  // Footers auf allen Seiten
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p);
  }

  const filename = `Statistik_${fromDate.toISOString().slice(0,10)}_${toDate.toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
  showToast('PDF erfolgreich exportiert.', 'success');
}
