package db

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// Migration rappresenta una singola migration del database
type Migration struct {
	Version     int
	Description string
	SQL         string
	SQLStatements []string // Per supportare multiple statements
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
		SQLStatements: []string{
			// Aggiungi status column
			`ALTER TABLE reminders ADD COLUMN status VARCHAR(20) DEFAULT 'pending' NOT NULL`,
			
			// Aggiungi sent_at column
			`ALTER TABLE reminders ADD COLUMN sent_at TIMESTAMP NULL`,
			
			// Aggiungi attempt_count column  
			`ALTER TABLE reminders ADD COLUMN attempt_count INT DEFAULT 0 NOT NULL`,
			
			// Aggiungi last_error column
			`ALTER TABLE reminders ADD COLUMN last_error TEXT NULL`,
			
			// Aggiorna i reminder esistenti per impostare il nuovo status
			`UPDATE reminders 
			SET status = CASE 
				WHEN is_fired = 1 THEN 'sent'
				ELSE 'pending'
			END`,
			
			// Per i reminder già inviati, imposta sent_at uguale a created_at
			`UPDATE reminders 
			SET sent_at = created_at
			WHERE is_fired = 1 AND sent_at IS NULL`,
			
			// Crea indice status
			`CREATE INDEX idx_reminders_status ON reminders(status)`,
			
			// Crea indice composto
			`CREATE INDEX idx_reminders_scheduled_time_status ON reminders(scheduled_time, status)`,
			
			// Crea indice sent_at
			`CREATE INDEX idx_reminders_sent_at ON reminders(sent_at)`,
		},
	},
	{
		Version:     3,
		Description: "Add accounts table",
		SQLStatements: []string{
			`CREATE TABLE IF NOT EXISTS accounts (
				id VARCHAR(255) PRIMARY KEY,
				username VARCHAR(255) NOT NULL,
				password VARCHAR(255) NOT NULL,
				site VARCHAR(255) NOT NULL,
				link TEXT,
				created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP NULL,
				created_by VARCHAR(255) NOT NULL,
				INDEX idx_accounts_username (username),
				INDEX idx_accounts_site (site),
				INDEX idx_accounts_created_by (created_by)
			)`,
		},
	},
	{
		Version:     4,
		Description: "Add is_active field to accounts table",
		SQLStatements: []string{
			`ALTER TABLE accounts ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`,
			`CREATE INDEX idx_accounts_active ON accounts(is_active)`,
		},
	},
	{
		Version:     5,
		Description: "Add is_personal field to accounts table",
		SQLStatements: []string{
			`ALTER TABLE accounts ADD COLUMN is_personal BOOLEAN NOT NULL DEFAULT TRUE`,
			`CREATE INDEX idx_accounts_personal ON accounts(is_personal)`,
		},
	},
	{
		Version:     6,
		Description: "Update existing accounts to set correct is_personal values",
		SQLStatements: []string{
			`UPDATE accounts SET is_personal = FALSE WHERE created_by = '393472195905@s.whatsapp.net'`,
		},
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
	
	// Determina quali SQL statements eseguire
	var sqlStatements []string
	
	if len(migration.SQLStatements) > 0 {
		// Usa l'array di statements se disponibile
		sqlStatements = migration.SQLStatements
	} else if migration.SQL != "" && migration.SQL != `-- Questa migration è già applicata durante InitTables()
		-- Inserita qui solo per tracking delle versioni` {
		// Fallback al campo SQL singolo, diviso per ';'
		sqlStatements = strings.Split(migration.SQL, ";")
	}
	
	// Esegui ogni statement SQL separatamente
	for i, sqlStatement := range sqlStatements {
		sqlStatement = strings.TrimSpace(sqlStatement)
		if sqlStatement == "" || strings.HasPrefix(sqlStatement, "--") {
			continue // Salta statement vuoti o commenti
		}
		
		log.Printf("   Eseguendo statement %d di %d...", i+1, len(sqlStatements))
		if _, err := tx.Exec(sqlStatement); err != nil {
			return fmt.Errorf("errore nell'esecuzione dello statement %d: %v\nSQL: %s", i+1, err, sqlStatement)
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