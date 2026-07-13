// Génération automatique du planning — équité + couverture 3 matin + 3 après-midi
//
// Règle métier : chaque jour doit avoir 3 présences le matin ET 3 l'après-midi.
// Combinaisons (nFull, nMatin, nApm) — priorité dans cet ordre :
//   1) (0, 3, 3) → 6 workers  ← priorité équité : tout le monde se partage la journée
//   2) (1, 2, 2) → 5 workers  ← si on peut faire mieux avec un full
//   3) (2, 1, 1) → 4 workers  ← si pas assez de matin/apm
//   4) (3, 0, 0) → 3 workers  ← dernier recours (seulement si 3+ ont mis "full")
//
// Un worker ne peut être assigné "full" que s'il a soumis "full" comme dispo.
// Un worker "full" peut cependant être mis en matin ou apm selon les besoins.

function buildEquityMap(historicalAssignments, resetEquity = false) {
  if (resetEquity) return {};

  const map = {};
  for (const a of historicalAssignments) {
    map[a.worker_id] = (map[a.worker_id] || 0) + (SHIFT_HOURS[a.assigned_shift] || 0);
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

  const equity   = buildEquityMap(historicalAssignments, !!options.resetEquity);
  const weekDays = {};
  workers.forEach(w => { weekDays[w.id] = 0; });

  // Score bas = priorité haute (moins d'heures historiques = travaille en premier)
  function score(wid) {
    return (equity[wid] || 0) + (weekDays[wid] || 0) * 9;
  }

  function sortByScore(arr) {
    return [...arr]
      .sort(() => Math.random() - 0.5)       // tiebreaker aléatoire
      .sort((a, b) => score(a.worker_id) - score(b.worker_id));
  }

  const result = {};

  // Ordre de priorité des combos : (nFull → nMatin = nApm = TARGET - nFull)
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

    let placed = false;

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

      // Combo valide — on l'applique
      assignedFull.forEach(a => {
        result[day].full.push(a.worker_id);
        weekDays[a.worker_id] = (weekDays[a.worker_id] || 0) + 1;
      });
      assignedMatin.forEach(a => {
        result[day].matin.push(a.worker_id);
        weekDays[a.worker_id] = (weekDays[a.worker_id] || 0) + 1;
      });
      assignedApm.forEach(a => {
        result[day].apm.push(a.worker_id);
        weekDays[a.worker_id] = (weekDays[a.worker_id] || 0) + 1;
      });

      placed = true;
      break;
    }

    // Fallback : pas assez de monde pour une combo complète → couverture partielle
    if (!placed) {
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
