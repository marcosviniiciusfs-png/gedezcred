-- D1 "gedez-capi": eventos enviados (ou a enviar) para a Meta Conversions API.
-- Dados pessoais ficam só em SHA-256 (normalizados conforme a Meta exige); nunca em texto puro.

CREATE TABLE IF NOT EXISTS capi_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          TEXT    NOT NULL UNIQUE,          -- mesmo eventID do Pixel, para deduplicação
  event_name        TEXT    NOT NULL,                 -- Lead, PageView, ...
  event_time        INTEGER NOT NULL,                 -- unix (segundos)
  event_source_url  TEXT,
  action_source     TEXT    NOT NULL DEFAULT 'website',

  -- user_data (hash SHA-256 hex)
  em_hash           TEXT,
  ph_hash           TEXT,
  fn_hash           TEXT,
  ln_hash           TEXT,
  ct_hash           TEXT,
  st_hash           TEXT,
  zp_hash           TEXT,
  country_hash      TEXT,
  external_id_hash  TEXT,
  fbp               TEXT,                             -- cookie _fbp
  fbc               TEXT,                             -- cookie _fbc / fbclid
  client_ip         TEXT,
  client_user_agent TEXT,

  custom_data       TEXT,                             -- JSON: respostas do quiz, valor, etc.
  utm               TEXT,                             -- JSON: utm_source, utm_campaign, ...

  -- controle de envio
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  meta_response     TEXT,                             -- JSON devolvido pela Graph API
  fbtrace_id        TEXT,
  sent_at           INTEGER,

  -- envio para o CRM (Convex)
  crm_status        TEXT    CHECK (crm_status IN ('sent', 'failed', 'skipped')),
  crm_id            TEXT,
  crm_response      TEXT,
  crm_sent_at       INTEGER,

  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_capi_events_status     ON capi_events (status, created_at);
CREATE INDEX IF NOT EXISTS idx_capi_events_name_time  ON capi_events (event_name, event_time);
