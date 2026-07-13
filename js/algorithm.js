// Génération automatique du planning — équité + couverture 3 matin + 3 après-midi
//
// Règle métier : chaque jour doit avoir 3 présences le matin ET 3 l'après-midi.
// L'algo teste plusieurs répartitions possibles, puis choisit celle qui minimise
// la charge projetée et évite de trop solliciter les mêmes personnes sur plusieurs semaines.
//
// Un worker ne peut être assigné "full" que s'il a soumis "full" comme dispo.
// Un worker "full" peut cependant être mis en matin ou apm selon les besoins.

const MS_PER_DAY  = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function buildEquityMap(historicalAssignments, options = {}) {
  if (options.resetEquity) return {};

  const currentWeekStart = options.currentWeekStart ? parseDate(options.currentWeekStart) : null;

  const map = {};
  for (const a of (historicalAssignments || [])) {
    if (!map[a.worker_id]) {
      map[a.worker_id] = {
        weightedHours: 0,
        full: 0,
        matin: 0,
        apm: 0,
      };
    }

    const rawHours = SHIFT_HOURS[a.assigned_shift] || 0;
    const assignedWeek = a.week_start ? parseDate(a.week_start) : null;
    const weeksAgo = currentWeekStart && assignedWeek
      ? Math.max(0, Math.round((currentWeekStart - assignedWeek) / MS_PER_WEEK))
      : 0;

    // Les semaines anciennes pèsent moins que les récentes.
    const recencyWeight = 1 / (1 + weeksAgo * 0.7);
    map[a.worker_id].weightedHours += rawHours * recencyWeight;
    if (a.assigned_shift === 'full') map[a.worker_id].full += 1;
    if (a.assigned_shift === 'matin') map[a.worker_id].matin += 1;
    if (a.assigned_shift === 'apm') map[a.worker_id].apm += 1;
  }
  return map;
}

// Retourne: { [day]: { full:[workerId,...], matin:[...], apm:[...] } }
function generateSchedule(workers, availabilities, historicalAssignments, options = {}) {
  // Les chefs de zone ne sont jamais dans le planning préparateurs
  workers = workers.filter(w => !w.is_chef_de_zone);

  // Exclure aussi leurs disponibilités pour qu'elles ne passent pas dans le calcul
  const validIds = new Set(workers.map(w => w.id));
  availabilities = availabilities.filter(a => validIds.has(a.worker_id));

  const maxDaysPerWorker = options.maxDaysPerWorker || 5;
  const TARGET = 3; // 3 présences matin + 3 présences après-midi

  const equity   = buildEquityMap(historicalAssignments, options);
  const weekDays = {};
  workers.forEach(w => { weekDays[w.id] = 0; });

  function getStats(wid) {
    return equity[wid] || { weightedHours: 0, full: 0, matin: 0, apm: 0 };
  }

  // Score bas = priorité haute.
  // On pénalise surtout la charge horaire récente, puis les jours déjà posés,
  // puis le volume de full pour mieux répartir les journées complètes.
  function score(wid, extra = {}) {
    const stats = getStats(wid);
    const weightedHours = (stats.weightedHours || 0) + (extra.hours || 0);
    const fullCount     = (stats.full || 0) + (extra.full || 0);
    const matinCount    = (stats.matin || 0) + (extra.matin || 0);
    const apmCount      = (stats.apm || 0) + (extra.apm || 0);
    const plannedDays   = (weekDays[wid] || 0) + (extra.days || 0);

    return weightedHours + fullCount * 2.6 + (matinCount + apmCount) * 1.1 + plannedDays * 9;
  }

  function sortByScore(arr) {
    return [...arr]
      .sort(() => Math.random() - 0.5)       // tiebreaker aléatoire
      .sort((a, b) => score(a.worker_id) - score(b.worker_id));
  }

  function buildAssignmentExtras(assignments) {
    const extras = {};
    for (const { worker_id, shift } of assignments) {
      if (!extras[worker_id]) {
        extras[worker_id] = { hours: 0, full: 0, matin: 0, apm: 0, days: 1 };
      }
      extras[worker_id].hours += SHIFT_HOURS[shift] || 0;
      extras[worker_id][shift] += 1;
    }
    return extras;
  }

  function evaluateCandidate(assignments) {
    const extras = buildAssignmentExtras(assignments);
    const scores = workers.map(w => score(w.id, extras[w.id] || {})).sort((a, b) => a - b);
    const spread = scores.length ? scores[scores.length - 1] - scores[0] : 0;
    const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
    const variance = scores.reduce((acc, value) => acc + Math.pow(value - average, 2), 0);

    return {
      spread,
      variance,
      distinctWorkers: Object.keys(extras).length,
      extras,
    };
  }

  const result = {};

  // Les combos les plus équilibrés sont évalués en premier, mais le score final décide.
  const COMBO_ORDER = [0, 1, 2, 3];

  for (let day = 0; day < 6; day++) {
    result[day] = { full: [], matin: [], apm: [] };

    // Workers disponibles ce jour-là (hors indispo + hors quota semaine)
    const dayAvails = availabilities
      .filter(a => a.day_of_week === day && a.shift !== 'indispo')
      .filter(a => (weekDays[a.worker_id] || 0) < maxDaysPerWorker);

    const fullSorted  = sortByScore(dayAvails.filter(a => a.shift === 'full'));
    const matinSorted = sortByScore(dayAvails.filter(a => a.shift === 'matin'));
    const apmSorted   = sortByScore(dayAvails.filter(a => a.shift === 'apm'));

    const candidates = [];

    for (const nFull of COMBO_ORDER) {
      const nEach = TARGET - nFull; // nb matin ET nb apm nécessaires
      if (nEach < 0) continue;
      if (fullSorted.length < nFull) continue;

      // Workers full assignés comme "full"
      const assignedFull    = fullSorted.slice(0, nFull);
      const remainingFull   = fullSorted.slice(nFull);

      // Pool matin = workers "matin" + full non encore utilisés
      const matinPool = sortByScore([...matinSorted, ...remainingFull]);
      if (matinPool.length < nEach) continue;
      const assignedMatin   = matinPool.slice(0, nEach);

      // Pool apm = workers "apm" + full non utilisés en matin
      const usedInMatin = new Set(assignedMatin.map(a => a.worker_id));
      const apmPool = sortByScore([
        ...apmSorted,
        ...remainingFull.filter(a => !usedInMatin.has(a.worker_id))
      ]);
      if (apmPool.length < nEach) continue;
      const assignedApm = apmPool.slice(0, nEach);

      const candidateAssignments = [
        ...assignedFull.map(a => ({ worker_id: a.worker_id, shift: 'full' })),
        ...assignedMatin.map(a => ({ worker_id: a.worker_id, shift: 'matin' })),
        ...assignedApm.map(a => ({ worker_id: a.worker_id, shift: 'apm' })),
      ];

      candidates.push({
        nFull,
        assignedFull,
        assignedMatin,
        assignedApm,
        ...evaluateCandidate(candidateAssignments),
      });
    }

    if (candidates.length) {
      candidates.sort((a, b) => {
        if (a.spread !== b.spread) return a.spread - b.spread;
        if (a.variance !== b.variance) return a.variance - b.variance;
        if (a.distinctWorkers !== b.distinctWorkers) return b.distinctWorkers - a.distinctWorkers;
        return a.nFull - b.nFull;
      });

      const best = candidates[0];
      best.assignedFull.forEach(a => {
        result[day].full.push(a.worker_id);
        weekDays[a.worker_id] = (weekDays[a.worker_id] || 0) + 1;
      });
      best.assignedMatin.forEach(a => {
        result[day].matin.push(a.worker_id);
        weekDays[a.worker_id] = (weekDays[a.worker_id] || 0) + 1;
      });
      best.assignedApm.forEach(a => {
        result[day].apm.push(a.worker_id);
        weekDays[a.worker_id] = (weekDays[a.worker_id] || 0) + 1;
      });
    } else {
      // Fallback : pas assez de monde pour une combo complète → couverture partielle
      let morningLeft = TARGET, afternoonLeft = TARGET;
      const all = sortByScore(dayAvails);
      for (const a of all) {
        if (morningLeft <= 0 && afternoonLeft <= 0) break;
        const wid = a.worker_id;
        if (a.shift === 'full' && morningLeft > 0 && afternoonLeft > 0) {
          result[day].full.push(wid);
          morningLeft--; afternoonLeft--;
          weekDays[wid] = (weekDays[wid] || 0) + 1;
        } else if ((a.shift === 'full' || a.shift === 'matin') && morningLeft > 0) {
          result[day].matin.push(wid);
          morningLeft--;
          weekDays[wid] = (weekDays[wid] || 0) + 1;
        } else if ((a.shift === 'full' || a.shift === 'apm') && afternoonLeft > 0) {
          result[day].apm.push(wid);
          afternoonLeft--;
          weekDays[wid] = (weekDays[wid] || 0) + 1;
        }
      }
    }
  }

  return result;
}
