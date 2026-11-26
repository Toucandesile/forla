-- Forla — relais de synchronisation : uniquement des données chiffrées et des identifiants opaques.
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  h TEXT NOT NULL,
  k TEXT NOT NULL,
  u INTEGER NOT NULL,
  p TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (h, k)
);

CREATE INDEX IF NOT EXISTS idx_changes_h_seq ON changes (h, seq);
CREATE INDEX IF NOT EXISTS idx_changes_seq ON changes (seq);
