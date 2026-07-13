-- ============================================================
-- Planning Préparateurs - Schéma Supabase
-- Exécuter dans : Supabase > SQL Editor > New query
-- ============================================================

CREATE TABLE IF NOT EXISTS workers (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fenêtres de collecte des dispos (l'admin ouvre une par semaine)
CREATE TABLE IF NOT EXISTS availability_slots (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start          DATE NOT NULL UNIQUE,
  deadline            TIMESTAMPTZ NOT NULL,
  is_open             BOOLEAN DEFAULT TRUE,
  max_per_day         INTEGER DEFAULT 6,
  max_days_per_worker INTEGER DEFAULT 5,
  auto_send_pdf       BOOLEAN DEFAULT FALSE,
  pdf_sent_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Disponibilités soumises par les préparateurs
CREATE TABLE IF NOT EXISTS availabilities (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id    UUID REFERENCES workers(id) ON DELETE CASCADE NOT NULL,
  week_start   DATE NOT NULL,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 5),
  shift        TEXT NOT NULL CHECK (shift IN ('full', 'matin', 'apm', 'indispo')),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(worker_id, week_start, day_of_week)
);

-- Métadonnées par jour (chef de zone, publication)
CREATE TABLE IF NOT EXISTS schedule_days (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start   DATE NOT NULL,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 5),
  chef_de_zone TEXT DEFAULT '',
  is_published BOOLEAN DEFAULT FALSE,
  generated_at TIMESTAMPTZ,
  UNIQUE(week_start, day_of_week)
);

-- Affectations préparateurs → jours + créneaux
CREATE TABLE IF NOT EXISTS schedule_assignments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start     DATE NOT NULL,
  day_of_week    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 5),
  worker_id      UUID REFERENCES workers(id) ON DELETE CASCADE NOT NULL,
  assigned_shift TEXT NOT NULL CHECK (assigned_shift IN ('full', 'matin', 'apm')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_start, day_of_week, worker_id)
);

ALTER TABLE workers               DISABLE ROW LEVEL SECURITY;
ALTER TABLE availability_slots    DISABLE ROW LEVEL SECURITY;
ALTER TABLE availabilities        DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_days         DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_assignments  DISABLE ROW LEVEL SECURITY;
