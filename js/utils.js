const DAYS_FR   = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const SHIFT_LABELS = { full:'09H-18H', matin:'09H-14H', apm:'14H-18H' };
const SHIFT_HOURS  = { full:9, matin:5, apm:4 };

// Parse une date "YYYY-MM-DD" sans décalage UTC (évite le bug dimanche en UTC+2)
function parseDate(str) {
  if (typeof str === 'string' && str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d); // minuit local, pas UTC
  }
  return new Date(str);
}

function getMondayOf(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toDateStr(date) {
  const d = new Date(date);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function formatDate(date, opts = { day:'numeric', month:'long' }) {
  return new Date(date).toLocaleDateString('fr-FR', opts);
}

function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
}

function formatWeekLabel(mondayStr) {
  const mon = new Date(mondayStr);
  const sat = addDays(mon, 5);
  return `Semaine du ${formatDate(mon)} au ${formatDate(sat)}`;
}

function formatDeadline(ts) {
  return new Date(ts).toLocaleString('fr-FR', {
    weekday:'long', day:'numeric', month:'long',
    hour:'2-digit', minute:'2-digit'
  });
}

// Date locale pour input datetime-local (évite le décalage UTC)
function toLocalDatetimeStr(date) {
  const d = new Date(date);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Calcule les valeurs par défaut intelligentes pour une collecte
function getSmartSlotDefaults() {
  const today    = new Date();
  const monday   = getMondayOf(today);

  // Semaine planifiée = semaine prochaine
  const nextMon  = addDays(monday, 7);

  // Deadline = jeudi de la semaine en cours à 10h
  const thursday = addDays(monday, 3);
  thursday.setHours(10, 0, 0, 0);

  return { weekStart: toDateStr(nextMon), deadline: thursday };
}

function showToast(msg, type = 'success') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Build the planning HTML table (matches the photo format)
function buildPlanningTable(weekStart, assignments, scheduleDays, workerMap) {
  const mon = getMondayOf(parseDate(weekStart));
  const wn  = getWeekNumber(mon);
  const totalRows = 6 * 5; // 5 rows per day × 6 days

  // Group by day
  const days = Array.from({length:6}, (_,d) => {
    const meta = scheduleDays.find(s => s.day_of_week === d) || {};
    const da   = assignments.filter(a => a.day_of_week === d);
    return {
      date:        addDays(mon, d),
      chefDeZone:  meta.chef_de_zone || '',
      full:  da.filter(a => a.assigned_shift === 'full').map(a => workerMap[a.worker_id] || '?'),
      matin: da.filter(a => a.assigned_shift === 'matin').map(a => workerMap[a.worker_id] || '?'),
      apm:   da.filter(a => a.assigned_shift === 'apm').map(a => workerMap[a.worker_id] || '?'),
    };
  });

  function nameCell(arr, idx) {
    return `<td>${arr[idx] || ''}</td>`;
  }

  let rows = '';
  days.forEach((day, d) => {
    const dayLabel = `${DAYS_FR[d]} ${formatDate(day.date, {day:'numeric', month:'long'})}`;
    const maxW = Math.max(day.full.length, day.matin.length, day.apm.length, 1);
    const wCols = Math.max(maxW, 3);

    if (d === 0) {
      rows += `<tr>
        <td class="store-col" rowspan="${totalRows}">${STORE_NAME}<br><b>S${wn}</b></td>
        <td class="day-header" colspan="${wCols + 1}">${dayLabel}</td>
      </tr>`;
    } else {
      rows += `<tr><td class="day-header" colspan="${wCols + 1}">${dayLabel}</td></tr>`;
    }

    rows += `<tr>
      <td class="shift-label chef-label">Chef de zone</td>
      <td class="chef-value" colspan="${wCols}">${day.chefDeZone}</td>
    </tr>`;

    [['full',day.full],['matin',day.matin],['apm',day.apm]].forEach(([key,arr]) => {
      let cells = '';
      for (let i = 0; i < wCols; i++) cells += nameCell(arr, i);
      rows += `<tr><td class="shift-label">${SHIFT_LABELS[key]}</td>${cells}</tr>`;
    });
  });

  return `<table class="planning-table"><tbody>${rows}</tbody></table>`;
}
