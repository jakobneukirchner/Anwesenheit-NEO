// modules/statistics.js

// Sonderzeichen für jsPDF normieren (kein Unicode-Support in Standard-Helvetica)
function pdfSafe(str) {
  return (str || '')
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue')
    .replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue')
    .replace(/ß/g,'ss')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27FF}]/gu, '')
    .replace(/[^\x00-\x7F]/g, '')  // alle restlichen non-ASCII raus
    .trim();
}

function getBrandName() {
  return (window.appSettings?.brandingTitle || '').trim() || 'Anwesenheit-NEO';
}

function _statsBackBtn() {
  const roles = window.currentUser?.roles || [];
  const role  = window.currentDashboardRole;
  const loaders = {
    admin:       () => loadAdminDashboard(),
    coordinator: () => loadCoordinatorDashboard(),
    teacher:     () => loadTrainerDashboard(),
    member:      () => loadMemberDashboard(),
  };
  const fallbackRole = ['admin','coordinator','teacher','member'].find(r => roles.includes(r)) || 'member';
  return loaders[fallbackRole] || loaders.member;
}

async function loadStatisticsDashboard() {
  const container = document.getElementById('app-content');
  container.innerHTML = `<div class="loading-center">Lade Statistiken...</div>`;

  if (!window.appSettings) {
    try {
      const sDoc = await firestore.collection('settings').doc('global').get();
      window.appSettings = sDoc.exists ? sDoc.data() : {};
    } catch(e) { window.appSettings = {}; }
  }

  const now       = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd   = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  const toInputVal = d => d.toISOString().slice(0, 10);

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
      <button class="btn-secondary" id="stat-back-btn" style="padding:6px 16px;display:inline-flex;align-items:center;gap:4px;">
        <span class="material-icons" style="font-size:18px;">arrow_back</span>
        Zurück
      </button>
      <h2 style="margin:0;display:inline-flex;align-items:center;gap:8px;">
        <span class="material-icons" style="color:var(--color-primary);">bar_chart</span>
        Statistiken &amp; Ranglisten
      </h2>
    </div>
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
          <button class="btn-text stat-preset" data-preset="year" style="color:var(--color-primary);">Dieses Jahr</button>
          <button class="btn-text stat-preset" data-preset="lastYear" style="color:var(--color-primary);">Letztes Jahr</button>
          <button class="btn-text stat-preset" data-preset="quarter" style="color:var(--color-primary);">Dieses Quartal</button>
          <button class="btn-text stat-preset" data-preset="month" style="color:var(--color-primary);">Dieser Monat</button>
        </div>
        <button class="btn-primary" id="stat-load-btn" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">refresh</span>
          Laden
        </button>
      </div>
    </div>
    <div id="stat-results"><p class="text-muted">Zeitraum auswählen und auf "Laden" klicken.</p></div>
  `;

  document.getElementById('stat-back-btn').onclick = _statsBackBtn();

  container.querySelectorAll('.stat-preset').forEach(btn => {
    btn.onclick = () => {
      const n = new Date(); let from, to;
      if      (btn.dataset.preset === 'year')     { from=new Date(n.getFullYear(),0,1);       to=new Date(n.getFullYear(),11,31); }
      else if (btn.dataset.preset === 'lastYear') { from=new Date(n.getFullYear()-1,0,1);     to=new Date(n.getFullYear()-1,11,31); }
      else if (btn.dataset.preset === 'quarter')  { const q=Math.floor(n.getMonth()/3); from=new Date(n.getFullYear(),q*3,1); to=new Date(n.getFullYear(),q*3+3,0); }
      else if (btn.dataset.preset === 'month')    { from=new Date(n.getFullYear(),n.getMonth(),1); to=new Date(n.getFullYear(),n.getMonth()+1,0); }
      document.getElementById('stat-from').value = toInputVal(from);
      document.getElementById('stat-to').value   = toInputVal(to);
    };
  });
  document.getElementById('stat-load-btn').onclick = () => runStatistics();
  runStatistics();
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
    const evSnap = await firestore.collection('events')
      .where('startTime', '>=', firebase.firestore.Timestamp.fromDate(fromDate))
      .where('startTime', '<=', firebase.firestore.Timestamp.fromDate(toDate)).get();

    const allEvents = [];
    evSnap.forEach(doc => allEvents.push({ id: doc.id, ...doc.data() }));

    if (!allEvents.length) {
      resultsEl.innerHTML = '<p class="text-muted">Keine Termine im ausgewählten Zeitraum gefunden.</p>';
      return;
    }

    const activeEvents    = allEvents.filter(e => e.status !== 'cancelled' && e.status !== 'skipped');
    const activeEventIds  = activeEvents.map(e => e.id);

    const eventDuration = {};
    activeEvents.forEach(ev => {
      const s = ev.startTime?.toDate?.();
      const e = ev.endTime?.toDate?.();
      eventDuration[ev.id] = (s && e) ? Math.round((e - s) / 60000) : 60;
    });

    const attendances = [];
    if (activeEventIds.length) {
      const chunks = [];
      for (let i = 0; i < activeEventIds.length; i += 30) chunks.push(activeEventIds.slice(i, i + 30));
      for (const chunk of chunks) {
        const snap = await firestore.collection('eventAttendance').where('eventId', 'in', chunk).get();
        snap.forEach(doc => attendances.push({ id: doc.id, ...doc.data() }));
      }
    }

    const userIds = [...new Set([
      ...attendances.map(a => a.userId),
      ...activeEvents.flatMap(e => e.trainers || [])
    ])];
    const userMap = {};
    await Promise.all(userIds.map(async uid => {
      const uDoc = await firestore.collection('users').doc(uid).get();
      userMap[uid] = uDoc.exists
        ? { name: uDoc.data().displayName || uDoc.data().email || uid, email: uDoc.data().email || '', roles: uDoc.data().roles || [] }
        : { name: uid, email: '', roles: [] };
    }));

    // ===== MITGLIEDER-STATISTIKEN =====
    const memberStats = {};
    const initMember = uid => {
      if (!memberStats[uid]) memberStats[uid] = {
        uid, name: userMap[uid]?.name || uid, email: userMap[uid]?.email || '',
        totalEvents: 0, present: 0, absent_excused: 0, absent_unexcused: 0,
        late: 0, cancelled: 0, presentMinutes: 0, registeredMinutes: 0
      };
    };
    attendances.forEach(att => {
      initMember(att.userId);
      const s   = memberStats[att.userId];
      const dur = eventDuration[att.eventId] || 60;
      s.totalEvents++;
      s.registeredMinutes += dur;
      if (att.status === 'present')                                          { s.present++;         s.presentMinutes += dur; }
      else if (att.status === 'absent_excused')                              { s.absent_excused++; }
      else if (att.status === 'absent_unexcused')                            { s.absent_unexcused++; }
      else if (att.status === 'late_excused' || att.status === 'late_unexcused') { s.late++;        s.presentMinutes += Math.round(dur * 0.75); }
      else if (att.status === 'cancelled')                                   { s.cancelled++; }
    });
    Object.values(memberStats).forEach(s => {
      s.attendanceRate  = s.totalEvents > 0 ? Math.round((s.present + s.late) / s.totalEvents * 100) : 0;
      s.punctualityRate = (s.present + s.late) > 0 ? Math.round(s.present / (s.present + s.late) * 100) : 100;
      s.absentRate      = s.totalEvents > 0 ? Math.round((s.absent_excused + s.absent_unexcused) / s.totalEvents * 100) : 0;
      s.presentHours    = (s.presentMinutes / 60).toFixed(1);
    });
    const allMemberStats = Object.values(memberStats);

    // ===== LEITER-STATISTIKEN =====
    const trainerStats = {};
    const initTrainer = uid => {
      if (!trainerStats[uid]) trainerStats[uid] = {
        uid, name: userMap[uid]?.name || uid, email: userMap[uid]?.email || '',
        totalAssigned: 0,
        totalTrained: 0,
        cancelledEvents: 0,
        trainedMinutes: 0
      };
    };
    activeEvents.forEach(ev => {
      const dur        = eventDuration[ev.id] || 60;
      const trainers   = ev.trainers || [];
      const cancelled  = ev.trainerCancellations || [];
      trainers.forEach(uid => {
        initTrainer(uid);
        trainerStats[uid].totalAssigned++;
        trainerStats[uid].totalTrained++;
        trainerStats[uid].trainedMinutes += dur;
      });
      cancelled.forEach(uid => {
        initTrainer(uid);
        trainerStats[uid].totalAssigned++;
        trainerStats[uid].cancelledEvents++;
      });
    });
    Object.values(trainerStats).forEach(s => {
      s.reliabilityRate = s.totalAssigned > 0 ? Math.round((s.totalAssigned - s.cancelledEvents) / s.totalAssigned * 100) : 100;
      s.trainedHours    = (s.trainedMinutes / 60).toFixed(1);
    });
    const allTrainerStats = Object.values(trainerStats);

    // ===== RANGLISTEN-DEFINITIONEN =====
    const memberRankings = [
      { id:'most_present',   title:'Meiste Anwesenheiten',          desc:'Mitglieder mit den meisten anwesenden Terminen',                      sort:(a,b)=>b.present-a.present,              value:s=>`${s.present} Termine`,                           medal:true  },
      { id:'most_hours',     title:'Höchste Anwesenheitszeit',      desc:'Mitglieder mit der meisten tatsächlichen Zeit',                       sort:(a,b)=>b.presentMinutes-a.presentMinutes, value:s=>`${s.presentHours} Std.`,                        medal:true  },
      { id:'best_rate',      title:'Höchste Anwesenheitsquote',     desc:'Anteil anwesend+verspätet an allen Terminen (mind. 3)',               filter:s=>s.totalEvents>=3, sort:(a,b)=>b.attendanceRate-a.attendanceRate,   value:s=>`${s.attendanceRate}% (${s.totalEvents} Termine)`,medal:true  },
      { id:'most_punctual',  title:'Pünktlichste Mitglieder',       desc:'Höchste Pünktlichkeitsrate (mind. 3 Termine)',                       filter:s=>s.totalEvents>=3, sort:(a,b)=>b.punctualityRate-a.punctualityRate, value:s=>`${s.punctualityRate}% pünktlich`,               medal:true  },
      { id:'most_active',    title:'Aktivste Mitglieder',           desc:'Meiste Termine insgesamt eingeschrieben',                            sort:(a,b)=>b.totalEvents-a.totalEvents,       value:s=>`${s.totalEvents} Termine gesamt`,                medal:true  },
      { id:'least_unexcused',title:'Wenigste unentsch. Fehlzeiten', desc:'Mitglieder mit den wenigsten unentschuldigten Fehlzeiten (mind. 3)', filter:s=>s.totalEvents>=3, sort:(a,b)=>a.absent_unexcused-b.absent_unexcused||b.totalEvents-a.totalEvents, value:s=>`${s.absent_unexcused}x unentschuldigt`, medal:false },
      { id:'most_registered',title:'Meiste eingeplante Zeit',       desc:'Meiste Gesamtzeit für die man eingeschrieben war',                   sort:(a,b)=>b.registeredMinutes-a.registeredMinutes, value:s=>`${(s.registeredMinutes/60).toFixed(1)} Std. eingeplant`, medal:false },
    ];

    const trainerRankings = [
      { id:'tr_most_trained',  title:'Meiste geleitete Termine',         desc:'Leiter mit den meisten durchgeführten Terminen',           sort:(a,b)=>b.totalTrained-a.totalTrained,      value:s=>`${s.totalTrained} Termine`,         medal:true  },
      { id:'tr_most_hours',    title:'Meiste Leitungsstunden',           desc:'Leiter mit der meisten Zeit vor Ort',                      sort:(a,b)=>b.trainedMinutes-a.trainedMinutes,  value:s=>`${s.trainedHours} Std.`,              medal:true  },
      { id:'tr_most_reliable', title:'Zuverlässigste Leiter',            desc:'Höchste Zuverlässigkeitsrate (kein Abmelden, mind. 2)',     filter:s=>s.totalAssigned>=2, sort:(a,b)=>b.reliabilityRate-a.reliabilityRate, value:s=>`${s.reliabilityRate}% zuverlässig`, medal:true  },
      { id:'tr_least_cancel',  title:'Wenigste Absagen',                 desc:'Leiter mit den wenigsten eigenen Abmeldungen',             sort:(a,b)=>a.cancelledEvents-b.cancelledEvents||b.totalAssigned-a.totalAssigned, value:s=>`${s.cancelledEvents}x abgemeldet`, medal:false },
    ];

    const podestLabel = (i, medal) => {
      if (!medal || i >= 3) return `${i + 1}.`;
      return ['1.', '2.', '3.'][i];
    };
    const podestStyle = (i, medal) => {
      if (!medal || i >= 3) return '';
      const colors = ['#b8860b', '#888', '#a0522d'];
      return `color:${colors[i]};font-weight:700;`;
    };

    // ===== HTML RENDERN =====
    const renderRankCard = (rank) => {
      const data = (rank.filter ? (s => rank.filter(s)) : (() => true));
      const filtered = (rank === memberRankings[0] || memberRankings.includes(rank) ? allMemberStats : allTrainerStats)
        .filter(data).sort(rank.sort).slice(0, 10);
      if (!filtered.length) return '';
      return `
        <div class="card" style="margin-bottom:16px;" id="rank-${rank.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:4px;">
            <div>
              <h3 style="margin:0 0 2px;">${rank.title}</h3>
              <p class="text-muted" style="margin:0;font-size:0.85rem;">${rank.desc}</p>
            </div>
            <button class="btn-secondary stat-pdf-single" data-rank-id="${rank.id}" style="padding:5px 12px;font-size:0.85rem;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;">
              <span class="material-icons" style="font-size:16px;">picture_as_pdf</span>
              PDF
            </button>
          </div>
          <div style="overflow-x:auto;margin-top:10px;">
            <table>
              <thead><tr><th style="width:40px;">#</th><th>Name</th><th>Wert</th></tr></thead>
              <tbody>
                ${filtered.map((s,i)=>`
                  <tr style="${i<3&&rank.medal?'font-weight:600;':''}">
                    <td style="text-align:center;${podestStyle(i,rank.medal)}">${podestLabel(i,rank.medal)}</td>
                    <td>${s.name}</td>
                    <td>${rank.value(s)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    };

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <p class="text-muted" style="margin:0;font-size:0.88rem;">
          Zeitraum: <strong>${fromDate.toLocaleDateString('de-DE')}</strong> &ndash; <strong>${toDate.toLocaleDateString('de-DE')}</strong>
          &nbsp;&middot;&nbsp; ${activeEvents.length} aktive Termine (${allEvents.length - activeEvents.length} ausgefallen/abgesagt)
          &nbsp;&middot;&nbsp; ${allMemberStats.length} Mitglieder
        </p>
        <button class="btn-primary" id="stat-export-all-pdf" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">picture_as_pdf</span>
          Alle als PDF
        </button>
      </div>

      <h3 style="margin-bottom:8px;display:flex;align-items:center;gap:6px;">
        <span class="material-icons" style="color:var(--color-primary);">group</span>
        Mitglieder-Ranglisten
      </h3>
      ${memberRankings.map(r => renderRankCard(r)).join('')}
    `;

    if (allTrainerStats.length) {
      html += `
        <h3 style="margin-top:24px;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="color:var(--color-primary);">sports</span>
          Leiter-Ranglisten
        </h3>
        ${trainerRankings.map(r => renderRankCard(r)).join('')}
      `;
    }

    resultsEl.innerHTML = html;

    const allRankings     = [...memberRankings, ...trainerRankings];
    const allStatsForRank = (rank) => memberRankings.includes(rank) ? allMemberStats : allTrainerStats;

    document.getElementById('stat-export-all-pdf')?.addEventListener('click', () => {
      exportStatisticsPDF({
        fromDate, toDate,
        eventCount: activeEvents.length,
        memberCount: allMemberStats.length,
        rankings: allRankings,
        statsForRank: allStatsForRank,
        singleRank: null,
        filename: `Statistik_Alle_${fromDate.toISOString().slice(0,10)}_${toDate.toISOString().slice(0,10)}.pdf`
      });
    });

    resultsEl.querySelectorAll('.stat-pdf-single').forEach(btn => {
      btn.addEventListener('click', () => {
        const rankId = btn.dataset.rankId;
        const rank   = allRankings.find(r => r.id === rankId);
        if (!rank) return;
        const statsArr = allStatsForRank(rank);
        exportStatisticsPDF({
          fromDate, toDate,
          eventCount: activeEvents.length,
          memberCount: allMemberStats.length,
          rankings: allRankings,
          statsForRank: allStatsForRank,
          singleRank: rank,
          statsArr,
          filename: `Statistik_${pdfSafe(rank.title).replace(/\s+/g,'_')}_${fromDate.toISOString().slice(0,10)}.pdf`
        });
      });
    });

  } catch(e) {
    resultsEl.innerHTML = `<p class="text-error">Fehler: ${e.message}</p>`;
    console.error(e);
  }
}

function exportStatisticsPDF({ fromDate, toDate, eventCount, memberCount, rankings, statsForRank, singleRank, statsArr, filename }) {
  const jsPDFCtor = (window.jspdf?.jsPDF) || window.jsPDF;
  if (!jsPDFCtor) { showToast('PDF-Bibliothek nicht geladen. Bitte Seite neu laden.', 'error'); return; }
  const doc      = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW    = doc.internal.pageSize.getWidth();
  const pageH    = doc.internal.pageSize.getHeight();
  const margin   = 15;
  const contentW = pageW - margin * 2;
  let y = margin;
  const brand = pdfSafe(getBrandName());

  const addPage = () => { doc.addPage(); y = margin; drawPageHeader(); y += 8; };
  const checkY  = (h=10) => { if (y + h > pageH - margin - 8) addPage(); };

  const drawPageHeader = () => {
    doc.setFillColor(21, 101, 192);
    doc.rect(0, 0, pageW, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(brand, margin, 9.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Statistik-Auswertung', pageW - margin, 9.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  const drawFooter = (pageNum, total) => {
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Seite ${pageNum} von ${total}  |  Exportiert am ${new Date().toLocaleDateString('de-DE')}  |  ${brand}`,
      pageW / 2, pageH - 5, { align: 'center' }
    );
    doc.setTextColor(0, 0, 0);
  };

  drawPageHeader();
  y = 22;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(21, 101, 192);
  doc.text(singleRank ? pdfSafe(singleRank.title) : 'Statistik & Ranglisten', margin, y);
  y += 8;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const dateStr = `${fromDate.toLocaleDateString('de-DE')} - ${toDate.toLocaleDateString('de-DE')}`;
  doc.text(`Zeitraum: ${dateStr}   |   ${eventCount} aktive Termine   |   ${memberCount} Mitglieder`, margin, y);
  y += 10;

  const ranksToExport = singleRank ? [singleRank] : rankings;

  ranksToExport.forEach(rank => {
    const allStatsArr = statsArr || statsForRank(rank);
    const data = allStatsArr
      .filter(rank.filter || (()=>true))
      .sort(rank.sort)
      .slice(0, 10);
    if (!data.length) return;

    checkY(36);

    doc.setFillColor(230, 240, 255);
    doc.rect(margin, y - 5, contentW, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(21, 101, 192);
    doc.text(pdfSafe(rank.title), margin + 3, y + 0.5);
    y += 8;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(pdfSafe(rank.desc), margin, y);
    y += 6;
    doc.setTextColor(0, 0, 0);

    doc.setFillColor(21, 101, 192);
    doc.rect(margin, y, contentW, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('#', margin + 3, y + 4);
    doc.text('Name', margin + 16, y + 4);
    doc.text('Wert', margin + contentW - 3, y + 4, { align: 'right' });
    y += 6;
    doc.setTextColor(0, 0, 0);

    data.forEach((s, i) => {
      checkY(7);
      const top3 = i < 3 && rank.medal;
      if (top3)         doc.setFillColor(255, 248, 210);
      else if (i%2===0) doc.setFillColor(247, 249, 255);
      else              doc.setFillColor(255, 255, 255);
      doc.rect(margin, y, contentW, 6, 'F');
      doc.setFont('helvetica', top3 ? 'bold' : 'normal');
      doc.setFontSize(8.5);
      doc.text((['1.','2.','3.'][i] || `${i+1}.`), margin + 3, y + 4);
      doc.text(pdfSafe(s.name).substring(0, 38), margin + 16, y + 4);
      doc.text(pdfSafe(rank.value(s)), margin + contentW - 3, y + 4, { align: 'right' });
      y += 6;
    });
    y += 10;
  });

  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) { doc.setPage(p); drawFooter(p, total); }

  doc.save(filename);
  showToast('PDF exportiert.', 'success');
}
