-- Aggiungi il campo is_deleted alla tabella message_notes se non esiste già
ALTER TABLE message_notes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Aggiorna i record esistenti impostando is_deleted a FALSE
UPDATE message_notes SET is_deleted = FALSE WHERE is_deleted IS NULL;
