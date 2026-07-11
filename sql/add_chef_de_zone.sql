-- Ajouter le statut "Chef de zone" sur les workers
-- Supabase > SQL Editor > New query > Run

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS is_chef_de_zone BOOLEAN DEFAULT FALSE;
