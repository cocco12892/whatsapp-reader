-- Migration per aggiornare la tabella reminders con i nuovi campi
-- Eseguire questa migration per aggiornare lo schema esistente

-- Aggiungi i nuovi campi alla tabella reminders
ALTER TABLE reminders 
ADD COLUMN status VARCHAR(20) DEFAULT 'pending' NOT NULL AFTER is_fired,
ADD COLUMN sent_at TIMESTAMP NULL AFTER status,
ADD COLUMN attempt_count INT DEFAULT 0 NOT NULL AFTER sent_at,
ADD COLUMN last_error TEXT NULL AFTER attempt_count;

-- Aggiorna i reminder esistenti per impostare il nuovo status basato su is_fired
UPDATE reminders 
SET status = CASE 
    WHEN is_fired = true THEN 'sent'
    ELSE 'pending'
END;

-- Per i reminder già inviati, imposta sent_at uguale a created_at (approssimazione)
-- In un sistema reale, potresti avere log più precisi
UPDATE reminders 
SET sent_at = created_at 
WHERE is_fired = true;

-- Aggiungi indici per migliorare le performance delle query
CREATE INDEX idx_reminders_status ON reminders(status);
CREATE INDEX idx_reminders_scheduled_time_status ON reminders(scheduled_time, status);
CREATE INDEX idx_reminders_sent_at ON reminders(sent_at);

-- Commenti per documentare i campi
ALTER TABLE reminders 
MODIFY COLUMN scheduled_time TIMESTAMP NOT NULL COMMENT 'Quando il reminder dovrebbe essere inviato',
MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'Stato: pending, sent, failed, cancelled',
MODIFY COLUMN sent_at TIMESTAMP NULL COMMENT 'Quando il reminder è stato effettivamente inviato',
MODIFY COLUMN attempt_count INT NOT NULL DEFAULT 0 COMMENT 'Numero di tentativi di invio',
MODIFY COLUMN last_error TEXT NULL COMMENT 'Ultimo errore in caso di fallimento'; 