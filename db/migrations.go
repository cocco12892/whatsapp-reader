package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

// Migration rappresenta una singola migration del database
type Migration struct {
	Version     int
	Description string
	SQL         string
}

// Tutte le migration disponibili in ordine di versione
var migrations = []Migration{
	{
		Version:     1,
		Description: "Initial schema",
		SQL: `-- Questa migration è già applicata durante InitTables()
		-- Inserita qui solo per tracking delle versioni`,
	},
	{
		Version:     2,
		Description: "Add reminder enhanced fields",
		SQL: `
		-- Aggiungi i nuovi campi alla tabella reminders se non esistono già
		ALTER TABLE reminders 
		ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' NOT NULL,
		ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP NULL,
		ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 0 NOT NULL,
		ADD COLUMN IF NOT EXISTS last_error TEXT NULL;

		-- Aggiorna i reminder esistenti per impostare il nuovo status basato su is_fired
		UPDATE reminders 
		SET status = CASE 
			WHEN is_fired = true THEN 'sent'
			ELSE 'pending'
		END
		WHERE status = 'pending' AND (is_fired = true OR is_fired = false);

		-- Per i reminder già inviati, imposta sent_at uguale a created_at se sent_at è NULL
		UPDATE reminders 
		SET sent_at = created_at
		WHERE is_fired = true AND sent_at IS NULL;

		-- Crea indici per migliorare le performance se non esistono
		CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
		CREATE INDEX IF NOT EXISTS idx_reminders_scheduled_time_status ON reminders(scheduled_time, status);
		CREATE INDEX IF NOT EXISTS idx_reminders_sent_at ON reminders(sent_at);
		`,
	},
}

// ApplyMigrations applica tutte le migration necessarie
func (m *MySQLManager) ApplyMigrations() error {
	log.Println("🔄 Controllo migration del database...")
	
	// Crea la tabella delle migration se non esiste
	if err := m.createMigrationsTable(); err != nil {
		return fmt.Errorf("errore nella creazione della tabella migrations: %v", err)
	}
	
	// Ottieni la versione attuale del database
	currentVersion, err := m.getCurrentVersion()
	if err != nil {
		return fmt.Errorf("errore nel recupero della versione attuale: %v", err)
	}
	
	log.Printf("📊 Versione database attuale: %d", currentVersion)
	
	// Applica tutte le migration necessarie
	applied := 0
	for _, migration := range migrations {
		if migration.Version > currentVersion {
			log.Printf("🔄 Applicando migration %d: %s", migration.Version, migration.Description)
			
			if err := m.applyMigration(migration); err != nil {
				return fmt.Errorf("errore nell'applicazione della migration %d: %v", migration.Version, err)
			}
			
			applied++
			log.Printf("✅ Migration %d applicata con successo", migration.Version)
		}
	}
	
	if applied == 0 {
		log.Println("✅ Database aggiornato, nessuna migration necessaria")
	} else {
		log.Printf("🎉 Applicate %d migration con successo", applied)
	}
	
	return nil
}

// createMigrationsTable crea la tabella per tracciare le migration
func (m *MySQLManager) createMigrationsTable() error {
	_, err := m.db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INT PRIMARY KEY,
			description VARCHAR(255) NOT NULL,
			applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_version (version)
		)
	`)
	return err
}

// getCurrentVersion ottiene la versione corrente del database
func (m *MySQLManager) getCurrentVersion() (int, error) {
	var version int
	err := m.db.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version)
	if err != nil {
		return 0, err
	}
	return version, nil
}

// applyMigration applica una singola migration
func (m *MySQLManager) applyMigration(migration Migration) error {
	// Inizia una transazione
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() // Rollback automatico se non viene fatto commit
	
	// Applica la migration SQL (se non è vuota)
	if migration.SQL != "" && migration.SQL != `-- Questa migration è già applicata durante InitTables()
		-- Inserita qui solo per tracking delle versioni` {
		if _, err := tx.Exec(migration.SQL); err != nil {
			return fmt.Errorf("errore nell'esecuzione SQL: %v", err)
		}
	}
	
	// Registra la migration come applicata
	_, err = tx.Exec(`
		INSERT INTO schema_migrations (version, description, applied_at) 
		VALUES (?, ?, ?)
	`, migration.Version, migration.Description, time.Now())
	
	if err != nil {
		return fmt.Errorf("errore nel registrare la migration: %v", err)
	}
	
	// Commit della transazione
	return tx.Commit()
}

// GetAppliedMigrations restituisce tutte le migration applicate
func (m *MySQLManager) GetAppliedMigrations() ([]Migration, error) {
	rows, err := m.db.Query(`
		SELECT version, description 
		FROM schema_migrations 
		ORDER BY version ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var appliedMigrations []Migration
	for rows.Next() {
		var migration Migration
		if err := rows.Scan(&migration.Version, &migration.Description); err != nil {
			return nil, err
		}
		appliedMigrations = append(appliedMigrations, migration)
	}
	
	return appliedMigrations, nil
} 