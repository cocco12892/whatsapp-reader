package db

import (
	"database/sql"
	"fmt"
	"time"
	_ "github.com/go-sql-driver/mysql"
	"whatsapp-reader/models"
	"github.com/google/uuid"
)

type MySQLManager struct {
	db *sql.DB
}

// Crea una nuova istanza del gestore MySQL
func NewMySQLManager(dsn string) (*MySQLManager, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}

	// Verifica la connessione
	if err := db.Ping(); err != nil {
		return nil, err
	}

	// Imposta i parametri di connessione
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	return &MySQLManager{db: db}, nil
}

// Inizializza le tabelle necessarie
func (m *MySQLManager) InitTables() error {
	// Tabella per le chat
	_, err := m.db.Exec(`
		CREATE TABLE IF NOT EXISTS chats (
			id VARCHAR(255) PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			profile_image VARCHAR(255),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("errore nella creazione della tabella chats: %v", err)
	}
	
	// Tabella per i dati registrati (importo e quota)
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS recorded_data (
			message_id VARCHAR(255) PRIMARY KEY,
			data VARCHAR(255) NOT NULL,
			chat_id VARCHAR(255) NOT NULL,
			chat_name VARCHAR(255) NOT NULL,
			sender_name VARCHAR(255) NOT NULL,
			content TEXT NOT NULL,
			timestamp TIMESTAMP NOT NULL,
			recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NULL,
			note_id VARCHAR(255),
			note TEXT,
			INDEX (chat_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("errore nella creazione della tabella recorded_data: %v", err)
	}

	// Tabella per i messaggi
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id VARCHAR(255) PRIMARY KEY,
			chat_id VARCHAR(255) NOT NULL,
			chat_name VARCHAR(255) NOT NULL,
			sender VARCHAR(255) NOT NULL,
			sender_name VARCHAR(255) NOT NULL,
			content TEXT NOT NULL,
			timestamp TIMESTAMP NOT NULL,
			is_media BOOLEAN DEFAULT FALSE,
			media_path VARCHAR(255),
			is_edited BOOLEAN DEFAULT FALSE,
			is_deleted BOOLEAN DEFAULT FALSE,
			is_reply BOOLEAN DEFAULT FALSE,
			reply_to_message_id VARCHAR(255),
			reply_to_sender VARCHAR(255),
			reply_to_content TEXT,
			protocol_message_type INT,
			protocol_message_name VARCHAR(255),
			image_hash VARCHAR(255),
			FOREIGN KEY (chat_id) REFERENCES chats(id)
		)
	`)
	if err != nil {
		return fmt.Errorf("errore nella creazione della tabella messages: %v", err)
	}

	// Tabella per i sinonimi delle chat
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS chat_synonyms (
			chat_id VARCHAR(255) PRIMARY KEY,
			synonym VARCHAR(255) NOT NULL,
			FOREIGN KEY (chat_id) REFERENCES chats(id)
		)
	`)
	if err != nil {
		return fmt.Errorf("errore nella creazione della tabella chat_synonyms: %v", err)
	}

	// Tabella per le note dei messaggi
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS message_notes (
			message_id VARCHAR(255) PRIMARY KEY,
			note TEXT NOT NULL,
			type VARCHAR(50) DEFAULT 'nota',
			chat_id VARCHAR(255),
			chat_name VARCHAR(255),
			added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			is_deleted BOOLEAN DEFAULT FALSE,
			FOREIGN KEY (message_id) REFERENCES messages(id)
		)
	`)
	if err != nil {
		return fmt.Errorf("errore nella creazione della tabella message_notes: %v", err)
	}

	// Tabella per i reminder
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS reminders (
			id VARCHAR(255) PRIMARY KEY,
			chat_id VARCHAR(255) NOT NULL,
			chat_name VARCHAR(255) NOT NULL,
			message TEXT NOT NULL,
			scheduled_time TIMESTAMP NOT NULL COMMENT 'Quando il reminder dovrebbe essere inviato',
			created_at TIMESTAMP NOT NULL,
			created_by VARCHAR(255) NOT NULL,
			is_fired BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Manteniamo per backward compatibility',
			status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'Stato: pending, sent, failed, cancelled',
			sent_at TIMESTAMP NULL COMMENT 'Quando il reminder è stato effettivamente inviato',
			attempt_count INT NOT NULL DEFAULT 0 COMMENT 'Numero di tentativi di invio',
			last_error TEXT NULL COMMENT 'Ultimo errore in caso di fallimento',
			INDEX idx_reminders_status (status),
			INDEX idx_reminders_scheduled_time_status (scheduled_time, status),
			INDEX idx_reminders_sent_at (sent_at)
		)
	`)
	if err != nil {
		return fmt.Errorf("errore nella creazione della tabella reminders: %v", err)
	}

	return nil
}

// Salva una chat nel database
func (m *MySQLManager) SaveChat(chat *models.Chat) error {
	_, err := m.db.Exec(
		"INSERT INTO chats (id, name, profile_image) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, profile_image = ?",
		chat.ID, chat.Name, chat.ProfileImage, chat.Name, chat.ProfileImage,
	)
	return err
}

// Carica tutte le chat dal database
func (m *MySQLManager) LoadChats() ([]*models.Chat, error) {
	rows, err := m.db.Query("SELECT id, name, profile_image FROM chats")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chats []*models.Chat
	for rows.Next() {
		var chat models.Chat
		if err := rows.Scan(&chat.ID, &chat.Name, &chat.ProfileImage); err != nil {
			return nil, err
		}
		chats = append(chats, &chat)
	}

	return chats, nil
}

// Salva un messaggio nel database
func (m *MySQLManager) SaveMessage(message *models.Message) error {
	// Prima verifica se la chat esiste, se non esiste la crea
	_, err := m.db.Exec(
		"INSERT IGNORE INTO chats (id, name) VALUES (?, ?)",
		message.Chat, message.ChatName,
	)
	if err != nil {
		fmt.Printf("Errore nel verificare/creare la chat: %v\n", err)
		// Continua comunque, potrebbe essere un errore di chiave duplicata
	}

	// Ora salva il messaggio
	_, err = m.db.Exec(`
		INSERT INTO messages (
			id, chat_id, chat_name, sender, sender_name, content, timestamp, 
			is_media, media_path, is_edited, is_deleted, is_reply, 
			reply_to_message_id, reply_to_sender, reply_to_content, 
			protocol_message_type, protocol_message_name, image_hash
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE 
			chat_id = ?, chat_name = ?, sender = ?, sender_name = ?,
			content = ?, timestamp = ?, is_media = ?, media_path = ?,
			is_edited = ?, is_deleted = ?, is_reply = ?, 
			reply_to_message_id = ?, reply_to_sender = ?, reply_to_content = ?,
			protocol_message_type = ?, protocol_message_name = ?, image_hash = ?
	`,
		message.ID, message.Chat, message.ChatName, message.Sender, message.SenderName,
		message.Content, message.Timestamp, message.IsMedia, message.MediaPath,
		message.IsEdited, message.IsDeleted, message.IsReply, message.ReplyToMessageID,
		message.ReplyToSender, message.ReplyToContent, message.ProtocolMessageType,
		message.ProtocolMessageName, message.ImageHash,
		// Valori per l'UPDATE (tutti i campi)
		message.Chat, message.ChatName, message.Sender, message.SenderName,
		message.Content, message.Timestamp, message.IsMedia, message.MediaPath,
		message.IsEdited, message.IsDeleted, message.IsReply, message.ReplyToMessageID,
		message.ReplyToSender, message.ReplyToContent, message.ProtocolMessageType,
		message.ProtocolMessageName, message.ImageHash,
	)
	
	if err != nil {
		fmt.Printf("Errore SQL nel salvataggio del messaggio: %v\n", err)
	}
	return err
}

// Carica i messaggi di una chat dal database
func (m *MySQLManager) LoadChatMessages(chatID string) ([]*models.Message, error) {
	rows, err := m.db.Query(`
		SELECT id, chat_id, chat_name, sender, sender_name, content, timestamp, 
			is_media, media_path, is_edited, is_deleted, is_reply, 
			reply_to_message_id, reply_to_sender, reply_to_content, 
			protocol_message_type, protocol_message_name, image_hash
		FROM messages
		WHERE chat_id = ?
		ORDER BY timestamp ASC
	`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []*models.Message
	for rows.Next() {
		var msg models.Message
		if err := rows.Scan(
			&msg.ID, &msg.Chat, &msg.ChatName, &msg.Sender, &msg.SenderName,
			&msg.Content, &msg.Timestamp, &msg.IsMedia, &msg.MediaPath,
			&msg.IsEdited, &msg.IsDeleted, &msg.IsReply, &msg.ReplyToMessageID,
			&msg.ReplyToSender, &msg.ReplyToContent, &msg.ProtocolMessageType,
			&msg.ProtocolMessageName, &msg.ImageHash,
		); err != nil {
			return nil, err
		}
		messages = append(messages, &msg)
	}

	return messages, nil
}

// Salva un sinonimo per una chat
func (m *MySQLManager) SaveChatSynonym(chatID, synonym string) error {
	_, err := m.db.Exec(
		"INSERT INTO chat_synonyms (chat_id, synonym) VALUES (?, ?) ON DUPLICATE KEY UPDATE synonym = ?",
		chatID, synonym, synonym,
	)
	return err
}

// Carica tutti i sinonimi delle chat
func (m *MySQLManager) LoadChatSynonyms() (map[string]string, error) {
	rows, err := m.db.Query("SELECT chat_id, synonym FROM chat_synonyms")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	synonyms := make(map[string]string)
	for rows.Next() {
		var chatID, synonym string
		if err := rows.Scan(&chatID, &synonym); err != nil {
			return nil, err
		}
		synonyms[chatID] = synonym
	}

	return synonyms, nil
}

// Salva una nota per un messaggio
func (m *MySQLManager) SaveMessageNote(messageID string, noteData *models.MessageNote) error {
	_, err := m.db.Exec(
		"INSERT INTO message_notes (message_id, note, type, chat_id, chat_name, added_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, FALSE) ON DUPLICATE KEY UPDATE note = ?, type = ?, chat_id = ?, chat_name = ?, added_at = ?, is_deleted = FALSE",
		messageID, noteData.Note, noteData.Type, noteData.ChatID, noteData.ChatName, noteData.AddedAt,
		noteData.Note, noteData.Type, noteData.ChatID, noteData.ChatName, noteData.AddedAt,
	)
	return err
}

// LoadMessageNote carica la nota per un messaggio specifico
func (m *MySQLManager) LoadMessageNote(messageID string) (*models.MessageNote, error) {
	query := `
		SELECT message_id, note, type, chat_id, chat_name, added_at 
		FROM message_notes 
		WHERE message_id = ? AND is_deleted = FALSE
	`
	
	var note models.MessageNote
	var addedAtStr string
	
	err := m.db.QueryRow(query, messageID).Scan(
		&note.MessageID,
		&note.Note,
		&note.Type,
		&note.ChatID,
		&note.ChatName,
		&addedAtStr,
	)
	
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("nessuna nota trovata per il messaggio %s", messageID)
		}
		return nil, err
	}
	
	// Converti la stringa della data in time.Time
	addedAt, err := time.Parse("2006-01-02 15:04:05", addedAtStr)
	if err != nil {
		// Se c'è un errore nella conversione, usa il timestamp corrente
		note.AddedAt = time.Now()
	} else {
		note.AddedAt = addedAt
	}
	
	return &note, nil
}

// Carica tutte le note dei messaggi
func (m *MySQLManager) LoadMessageNotes() (map[string]*models.MessageNote, error) {
	rows, err := m.db.Query("SELECT message_id, note, type, chat_id, chat_name, added_at, is_deleted FROM message_notes WHERE is_deleted = FALSE")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := make(map[string]*models.MessageNote)
	for rows.Next() {
		var messageID string
		var note models.MessageNote
		var addedAtStr string
		if err := rows.Scan(&messageID, &note.Note, &note.Type, &note.ChatID, &note.ChatName, &addedAtStr, &note.IsDeleted); err != nil {
			return nil, err
		}
		
		// Converti la stringa della data in time.Time
		addedAt, err := time.Parse("2006-01-02 15:04:05", addedAtStr)
		if err != nil {
			// Se c'è un errore nella conversione, usa il timestamp corrente
			note.AddedAt = time.Now()
		} else {
			note.AddedAt = addedAt
		}
		
		note.MessageID = messageID
		notes[messageID] = &note
	}

	return notes, nil
}

// Elimina una nota di un messaggio (hard delete)
func (m *MySQLManager) DeleteMessageNote(messageID string) error {
	_, err := m.db.Exec("DELETE FROM message_notes WHERE message_id = ?", messageID)
	return err
}

// Soft delete di una nota di un messaggio
func (m *MySQLManager) SoftDeleteMessageNote(messageID string) error {
	_, err := m.db.Exec("UPDATE message_notes SET is_deleted = TRUE WHERE message_id = ?", messageID)
	return err
}

// SaveRecordedData salva un dato registrato nel database
func (m *MySQLManager) SaveRecordedData(data *models.RecordedData) error {
	// Imposta il timestamp di registrazione se non è già impostato
	if data.RecordedAt.IsZero() {
		data.RecordedAt = time.Now()
	}
	
	_, err := m.db.Exec(`
		INSERT INTO recorded_data (
			message_id, data, chat_id, chat_name, sender_name, 
			content, timestamp, recorded_at, note_id, note
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		data.MessageID, data.Data, data.ChatID, data.ChatName, data.SenderName,
		data.Content, data.Timestamp, data.RecordedAt, data.NoteID, data.Note,
	)
	return err
}

// UpdateRecordedData aggiorna un dato registrato esistente
func (m *MySQLManager) UpdateRecordedData(data *models.RecordedData) error {
	// Imposta il timestamp di aggiornamento
	data.UpdatedAt = time.Now()
	
	_, err := m.db.Exec(`
		UPDATE recorded_data SET
			data = ?,
			chat_id = ?,
			chat_name = ?,
			sender_name = ?,
			content = ?,
			timestamp = ?,
			updated_at = ?,
			note_id = ?,
			note = ?
		WHERE message_id = ?
	`,
		data.Data, data.ChatID, data.ChatName, data.SenderName,
		data.Content, data.Timestamp, data.UpdatedAt, data.NoteID, data.Note,
		data.MessageID,
	)
	return err
}

// LoadRecordedData carica un dato registrato specifico
func (m *MySQLManager) LoadRecordedData(messageID string) (*models.RecordedData, error) {
	var data models.RecordedData
	var updatedAt sql.NullTime
	var noteID sql.NullString
	var note sql.NullString
	
	err := m.db.QueryRow(`
		SELECT 
			message_id, data, chat_id, chat_name, sender_name, 
			content, timestamp, recorded_at, updated_at, note_id, note
		FROM recorded_data
		WHERE message_id = ?
	`, messageID).Scan(
		&data.MessageID, &data.Data, &data.ChatID, &data.ChatName, &data.SenderName,
		&data.Content, &data.Timestamp, &data.RecordedAt, &updatedAt, &noteID, &note,
	)
	
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("dato registrato non trovato")
		}
		return nil, err
	}
	
	if updatedAt.Valid {
		data.UpdatedAt = updatedAt.Time
	}
	
	if noteID.Valid {
		data.NoteID = noteID.String
	}
	
	if note.Valid {
		data.Note = note.String
	}
	
	return &data, nil
}

// LoadChatRecordedData carica tutti i dati registrati per una chat specifica
func (m *MySQLManager) LoadChatRecordedData(chatID string) ([]*models.RecordedData, error) {
	rows, err := m.db.Query(`
		SELECT 
			message_id, data, chat_id, chat_name, sender_name, 
			content, timestamp, recorded_at, updated_at, note_id, note
		FROM recorded_data
		WHERE chat_id = ?
		ORDER BY timestamp ASC
	`, chatID)
	
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var recordedData []*models.RecordedData
	for rows.Next() {
		var data models.RecordedData
		var updatedAt sql.NullTime
		var noteID sql.NullString
		var note sql.NullString
		
		if err := rows.Scan(
			&data.MessageID, &data.Data, &data.ChatID, &data.ChatName, &data.SenderName,
			&data.Content, &data.Timestamp, &data.RecordedAt, &updatedAt, &noteID, &note,
		); err != nil {
			return nil, err
		}
		
		if updatedAt.Valid {
			data.UpdatedAt = updatedAt.Time
		}
		
		if noteID.Valid {
			data.NoteID = noteID.String
		}
		
		if note.Valid {
			data.Note = note.String
		}
		
		recordedData = append(recordedData, &data)
	}
	
	return recordedData, nil
}

// LoadAllRecordedData carica tutti i dati registrati
func (m *MySQLManager) LoadAllRecordedData() ([]*models.RecordedData, error) {
	rows, err := m.db.Query(`
		SELECT 
			message_id, data, chat_id, chat_name, sender_name, 
			content, timestamp, recorded_at, updated_at, note_id, note
		FROM recorded_data
		ORDER BY timestamp DESC
	`)
	
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var recordedData []*models.RecordedData
	for rows.Next() {
		var data models.RecordedData
		var updatedAt sql.NullTime
		var noteID sql.NullString
		var note sql.NullString
		
		if err := rows.Scan(
			&data.MessageID, &data.Data, &data.ChatID, &data.ChatName, &data.SenderName,
			&data.Content, &data.Timestamp, &data.RecordedAt, &updatedAt, &noteID, &note,
		); err != nil {
			return nil, err
		}
		
		if updatedAt.Valid {
			data.UpdatedAt = updatedAt.Time
		}
		
		if noteID.Valid {
			data.NoteID = noteID.String
		}
		
		if note.Valid {
			data.Note = note.String
		}
		
		recordedData = append(recordedData, &data)
	}
	
	return recordedData, nil
}

// DeleteRecordedData elimina un dato registrato
func (m *MySQLManager) DeleteRecordedData(messageID string) error {
	_, err := m.db.Exec("DELETE FROM recorded_data WHERE message_id = ?", messageID)
	return err
}

// GetDB restituisce l'oggetto database per operazioni di emergenza
func (m *MySQLManager) GetDB() *sql.DB {
	return m.db
}

// Chiude la connessione al database
func (m *MySQLManager) Close() error {
	return m.db.Close()
}

// DeleteMessage elimina un messaggio dal database
func (m *MySQLManager) DeleteMessage(messageID string) error {
	_, err := m.db.Exec("UPDATE messages SET is_deleted = TRUE WHERE id = ?", messageID)
	return err
}

// UpdateMessageStatus aggiorna lo stato di un messaggio
func (m *MySQLManager) UpdateMessageStatus(messageID, status string) error {
	_, err := m.db.Exec("UPDATE messages SET status = ? WHERE id = ?", status, messageID)
	return err
}

// UpdateMessageContent aggiorna il contenuto di un messaggio
func (m *MySQLManager) UpdateMessageContent(messageID, newText string, editedAt time.Time) error {
	_, err := m.db.Exec("UPDATE messages SET content = ?, is_edited = TRUE, edited_at = ? WHERE id = ?", 
		newText, editedAt, messageID)
	return err
}

// GetMessageByID ottiene un messaggio specifico dal database
func (m *MySQLManager) GetMessageByID(messageID string) (*models.Message, error) {
	var msg models.Message
	err := m.db.QueryRow(`
		SELECT id, chat_id, chat_name, sender, sender_name, content, timestamp, 
			is_media, media_path, is_edited, is_deleted, is_reply, 
			reply_to_message_id, reply_to_sender, reply_to_content, 
			protocol_message_type, protocol_message_name, image_hash
		FROM messages
		WHERE id = ?
	`, messageID).Scan(
		&msg.ID, &msg.Chat, &msg.ChatName, &msg.Sender, &msg.SenderName,
		&msg.Content, &msg.Timestamp, &msg.IsMedia, &msg.MediaPath,
		&msg.IsEdited, &msg.IsDeleted, &msg.IsReply, &msg.ReplyToMessageID,
		&msg.ReplyToSender, &msg.ReplyToContent, &msg.ProtocolMessageType,
		&msg.ProtocolMessageName, &msg.ImageHash,
	)
	
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("messaggio non trovato")
		}
		return nil, err
	}
	
	return &msg, nil
}

// LoadRecentChatMessages carica i messaggi recenti di una chat dal database a partire da un certo timestamp
func (m *MySQLManager) LoadRecentChatMessages(chatID string, since time.Time) ([]*models.Message, error) {
	rows, err := m.db.Query(`
		SELECT id, chat_id, chat_name, sender, sender_name, content, timestamp, 
			is_media, media_path, is_edited, is_deleted, is_reply, 
			reply_to_message_id, reply_to_sender, reply_to_content, 
			protocol_message_type, protocol_message_name, image_hash
		FROM messages
		WHERE chat_id = ? AND timestamp >= ?
		ORDER BY timestamp ASC
	`, chatID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []*models.Message
	for rows.Next() {
		var msg models.Message
		if err := rows.Scan(
			&msg.ID, &msg.Chat, &msg.ChatName, &msg.Sender, &msg.SenderName,
			&msg.Content, &msg.Timestamp, &msg.IsMedia, &msg.MediaPath,
			&msg.IsEdited, &msg.IsDeleted, &msg.IsReply, &msg.ReplyToMessageID,
			&msg.ReplyToSender, &msg.ReplyToContent, &msg.ProtocolMessageType,
			&msg.ProtocolMessageName, &msg.ImageHash,
		); err != nil {
			return nil, err
		}
		messages = append(messages, &msg)
	}

	return messages, nil
}

// SaveReminder salva un reminder nel database
func (m *MySQLManager) SaveReminder(reminder *models.Reminder) error {
	// Se il reminder non ha un ID, generane uno
	if reminder.ID == "" {
		reminder.ID = uuid.New().String()
	}
	
	// Se non è impostato CreatedAt, impostalo a now
	if reminder.CreatedAt.IsZero() {
		reminder.CreatedAt = time.Now()
	}
	
	// Imposta valori di default se non specificati
	if reminder.Status == "" {
		reminder.Status = models.ReminderStatusPending
	}
	
	_, err := m.db.Exec(`
		INSERT INTO reminders (
			id, chat_id, chat_name, message, scheduled_time, 
			created_at, created_by, is_fired, status, sent_at, 
			attempt_count, last_error
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		reminder.ID, reminder.ChatID, reminder.ChatName, reminder.Message,
		reminder.ScheduledTime, reminder.CreatedAt, reminder.CreatedBy, 
		reminder.IsFired, reminder.Status, reminder.SentAt, 
		reminder.AttemptCount, reminder.LastError,
	)
	
	return err
}

// UpdateReminder aggiorna un reminder esistente
func (m *MySQLManager) UpdateReminder(reminder *models.Reminder) error {
	_, err := m.db.Exec(`
		UPDATE reminders SET 
			chat_id = ?, 
			chat_name = ?, 
			message = ?, 
			scheduled_time = ?, 
			created_by = ?, 
			is_fired = ?,
			status = ?,
			sent_at = ?,
			attempt_count = ?,
			last_error = ?
		WHERE id = ?
	`,
		reminder.ChatID, reminder.ChatName, reminder.Message,
		reminder.ScheduledTime, reminder.CreatedBy, reminder.IsFired,
		reminder.Status, reminder.SentAt, reminder.AttemptCount, 
		reminder.LastError, reminder.ID,
	)
	
	return err
}

// DeleteReminder elimina un reminder dal database
func (m *MySQLManager) DeleteReminder(reminderID string) error {
	_, err := m.db.Exec("DELETE FROM reminders WHERE id = ?", reminderID)
	return err
}

// GetReminderByID ottiene un reminder specifico dal database
func (m *MySQLManager) GetReminderByID(reminderID string) (*models.Reminder, error) {
	var reminder models.Reminder
	var sentAt sql.NullTime
	var lastError sql.NullString
	
	err := m.db.QueryRow(`
		SELECT id, chat_id, chat_name, message, scheduled_time, 
			created_at, created_by, is_fired, status, sent_at, 
			attempt_count, last_error
		FROM reminders
		WHERE id = ?
	`, reminderID).Scan(
		&reminder.ID, &reminder.ChatID, &reminder.ChatName, &reminder.Message,
		&reminder.ScheduledTime, &reminder.CreatedAt, &reminder.CreatedBy, 
		&reminder.IsFired, &reminder.Status, &sentAt, 
		&reminder.AttemptCount, &lastError,
	)
	
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("reminder non trovato")
		}
		return nil, err
	}
	
	// Gestione dei campi nullable
	if sentAt.Valid {
		reminder.SentAt = &sentAt.Time
	}
	if lastError.Valid {
		reminder.LastError = lastError.String
	}
	
	return &reminder, nil
}

// GetChatReminders ottiene tutti i reminder per una chat specifica
func (m *MySQLManager) GetChatReminders(chatID string) ([]*models.Reminder, error) {
	rows, err := m.db.Query(`
		SELECT id, chat_id, chat_name, message, scheduled_time, 
			created_at, created_by, is_fired, status, sent_at, 
			attempt_count, last_error
		FROM reminders
		WHERE chat_id = ?
		ORDER BY scheduled_time ASC
	`, chatID)
	
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var reminders []*models.Reminder
	for rows.Next() {
		var reminder models.Reminder
		var sentAt sql.NullTime
		var lastError sql.NullString
		
		if err := rows.Scan(
			&reminder.ID, &reminder.ChatID, &reminder.ChatName, &reminder.Message,
			&reminder.ScheduledTime, &reminder.CreatedAt, &reminder.CreatedBy, 
			&reminder.IsFired, &reminder.Status, &sentAt, 
			&reminder.AttemptCount, &lastError,
		); err != nil {
			return nil, err
		}
		
		// Gestione dei campi nullable
		if sentAt.Valid {
			reminder.SentAt = &sentAt.Time
		}
		if lastError.Valid {
			reminder.LastError = lastError.String
		}
		
		reminders = append(reminders, &reminder)
	}
	
	return reminders, nil
}

// GetDueReminders ottiene tutti i reminder scaduti e non ancora inviati
func (m *MySQLManager) GetDueReminders() ([]*models.Reminder, error) {
	now := time.Now()
	
	// Log del momento del controllo
	fmt.Printf("MySQL GetDueReminders: controllo alle %s (timezone: %s)\n", 
		now.Format("2006-01-02 15:04:05"), now.Location().String())
	
	rows, err := m.db.Query(`
		SELECT id, chat_id, chat_name, message, scheduled_time, 
			created_at, created_by, is_fired, status, sent_at, 
			attempt_count, last_error
		FROM reminders
		WHERE scheduled_time <= ? AND status = 'pending'
		ORDER BY scheduled_time ASC
	`, now)
	
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var reminders []*models.Reminder
	for rows.Next() {
		var reminder models.Reminder
		var sentAt sql.NullTime
		var lastError sql.NullString
		
		if err := rows.Scan(
			&reminder.ID, &reminder.ChatID, &reminder.ChatName, &reminder.Message,
			&reminder.ScheduledTime, &reminder.CreatedAt, &reminder.CreatedBy, 
			&reminder.IsFired, &reminder.Status, &sentAt, 
			&reminder.AttemptCount, &lastError,
		); err != nil {
			return nil, err
		}
		
		// Gestione dei campi nullable
		if sentAt.Valid {
			reminder.SentAt = &sentAt.Time
		}
		if lastError.Valid {
			reminder.LastError = lastError.String
		}
		
		// Log dettagliato di ogni reminder trovato
		fmt.Printf("MySQL GetDueReminders: trovato reminder %s per chat %s, scheduled=%s, status=%s, attempts=%d\n",
			reminder.ID, reminder.ChatID, 
			reminder.ScheduledTime.Format("2006-01-02 15:04:05"), 
			reminder.Status, reminder.AttemptCount)
		
		reminders = append(reminders, &reminder)
	}
	
	fmt.Printf("MySQL GetDueReminders: totale %d reminder da processare\n", len(reminders))
	
	return reminders, nil
}

// MarkReminderAsProcessing marca un reminder come in elaborazione
func (m *MySQLManager) MarkReminderAsProcessing(reminderID string, attemptCount int) error {
	fmt.Printf("MySQL MarkReminderAsProcessing: marcando reminder %s come in elaborazione (tentativo %d)\n", 
		reminderID, attemptCount)
	
	result, err := m.db.Exec(`
		UPDATE reminders 
		SET status = 'processing', attempt_count = ? 
		WHERE id = ? AND status = 'pending'
	`, attemptCount, reminderID)
	
	if err != nil {
		fmt.Printf("MySQL MarkReminderAsProcessing: errore nell'aggiornamento del reminder %s: %v\n", reminderID, err)
		return err
	}
	
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		fmt.Printf("MySQL MarkReminderAsProcessing: errore nel contare le righe aggiornate per reminder %s: %v\n", reminderID, err)
		return err
	}
	
	if rowsAffected == 0 {
		return fmt.Errorf("reminder %s non è più pending o non esiste", reminderID)
	}
	
	fmt.Printf("MySQL MarkReminderAsProcessing: reminder %s marcato come in elaborazione, righe aggiornate: %d\n", reminderID, rowsAffected)
	return nil
}

// MarkReminderAsSent marca un reminder come inviato con successo
func (m *MySQLManager) MarkReminderAsSent(reminderID string) error {
	now := time.Now()
	fmt.Printf("MySQL MarkReminderAsSent: marcando reminder %s come inviato alle %s\n", 
		reminderID, now.Format("2006-01-02 15:04:05"))
	
	result, err := m.db.Exec(`
		UPDATE reminders 
		SET status = 'sent', is_fired = true, sent_at = ? 
		WHERE id = ?
	`, now, reminderID)
	
	if err != nil {
		fmt.Printf("MySQL MarkReminderAsSent: errore nell'aggiornamento del reminder %s: %v\n", reminderID, err)
		return err
	}
	
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		fmt.Printf("MySQL MarkReminderAsSent: errore nel contare le righe aggiornate per reminder %s: %v\n", reminderID, err)
		return err
	}
	
	fmt.Printf("MySQL MarkReminderAsSent: reminder %s marcato come inviato, righe aggiornate: %d\n", reminderID, rowsAffected)
	
	return nil
}

// MarkReminderAsFailed marca un reminder come fallito
func (m *MySQLManager) MarkReminderAsFailed(reminderID string, errorMsg string) error {
	fmt.Printf("MySQL MarkReminderAsFailed: marcando reminder %s come fallito: %s\n", reminderID, errorMsg)
	
	result, err := m.db.Exec(`
		UPDATE reminders 
		SET status = 'failed', last_error = ?, attempt_count = attempt_count + 1 
		WHERE id = ?
	`, errorMsg, reminderID)
	
	if err != nil {
		fmt.Printf("MySQL MarkReminderAsFailed: errore nell'aggiornamento del reminder %s: %v\n", reminderID, err)
		return err
	}
	
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		fmt.Printf("MySQL MarkReminderAsFailed: errore nel contare le righe aggiornate per reminder %s: %v\n", reminderID, err)
		return err
	}
	
	fmt.Printf("MySQL MarkReminderAsFailed: reminder %s marcato come fallito, righe aggiornate: %d\n", reminderID, rowsAffected)
	
	return nil
}

// IncrementReminderAttempt incrementa il contatore dei tentativi
func (m *MySQLManager) IncrementReminderAttempt(reminderID string) error {
	fmt.Printf("MySQL IncrementReminderAttempt: incrementando tentativi per reminder %s\n", reminderID)
	
	result, err := m.db.Exec(`
		UPDATE reminders 
		SET attempt_count = attempt_count + 1 
		WHERE id = ?
	`, reminderID)
	
	if err != nil {
		fmt.Printf("MySQL IncrementReminderAttempt: errore nell'aggiornamento del reminder %s: %v\n", reminderID, err)
		return err
	}
	
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		fmt.Printf("MySQL IncrementReminderAttempt: errore nel contare le righe aggiornate per reminder %s: %v\n", reminderID, err)
		return err
	}
	
	fmt.Printf("MySQL IncrementReminderAttempt: tentativo incrementato per reminder %s, righe aggiornate: %d\n", reminderID, rowsAffected)
	
	return nil
}

// MarkReminderAsFired marca un reminder come inviato (backward compatibility)
// DEPRECATED: utilizzare MarkReminderAsSent al posto di questa funzione
func (m *MySQLManager) MarkReminderAsFired(reminderID string) error {
	fmt.Printf("MySQL MarkReminderAsFired: (DEPRECATED) usando MarkReminderAsSent per reminder %s\n", reminderID)
	return m.MarkReminderAsSent(reminderID)
}

// Account operations

// SaveAccount salva un nuovo account nel database
func (m *MySQLManager) SaveAccount(account *models.Account) error {
	_, err := m.db.Exec(`
		INSERT INTO accounts (id, username, password, site, link, created_at, created_by, is_active, is_personal)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, account.ID, account.Username, account.Password, account.Site, account.Link, account.CreatedAt, account.CreatedBy, account.IsActive, account.IsPersonal)
	return err
}

// UpdateAccount aggiorna un account esistente
func (m *MySQLManager) UpdateAccount(account *models.Account) error {
	_, err := m.db.Exec(`
		UPDATE accounts 
		SET username = ?, password = ?, site = ?, link = ?, updated_at = ?, is_active = ?, is_personal = ?
		WHERE id = ?
	`, account.Username, account.Password, account.Site, account.Link, account.UpdatedAt, account.IsActive, account.IsPersonal, account.ID)
	return err
}

// DeleteAccount elimina un account dal database
func (m *MySQLManager) DeleteAccount(accountID string) error {
	_, err := m.db.Exec("DELETE FROM accounts WHERE id = ?", accountID)
	return err
}

// GetAccountByID recupera un account tramite ID
func (m *MySQLManager) GetAccountByID(accountID string) (*models.Account, error) {
	var account models.Account
	var updatedAt sql.NullTime
	err := m.db.QueryRow(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE id = ?
	`, accountID).Scan(
		&account.ID, &account.Username, &account.Password, &account.Site, 
		&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
	
	if err != nil {
		return nil, err
	}
	
	if updatedAt.Valid {
		account.UpdatedAt = updatedAt.Time
	}
	
	return &account, nil
}

// DeactivateAccount esegue soft delete di un account
func (m *MySQLManager) DeactivateAccount(accountID string) error {
	_, err := m.db.Exec("UPDATE accounts SET is_active = FALSE WHERE id = ?", accountID)
	return err
}

// GetActiveAccounts recupera tutti gli account attivi
func (m *MySQLManager) GetActiveAccounts() ([]*models.Account, error) {
	rows, err := m.db.Query(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE is_active = TRUE ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []*models.Account
	for rows.Next() {
		var account models.Account
		var updatedAt sql.NullTime
		err := rows.Scan(
			&account.ID, &account.Username, &account.Password, &account.Site,
			&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
		if err != nil {
			return nil, err
		}
		
		if updatedAt.Valid {
			account.UpdatedAt = updatedAt.Time
		}
		
		accounts = append(accounts, &account)
	}
	return accounts, nil
}

// GetActiveAccountsByCreator recupera gli account attivi di un utente specifico
func (m *MySQLManager) GetActiveAccountsByCreator(createdBy string) ([]*models.Account, error) {
	rows, err := m.db.Query(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE created_by = ? AND is_active = TRUE ORDER BY created_at DESC
	`, createdBy)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []*models.Account
	for rows.Next() {
		var account models.Account
		var updatedAt sql.NullTime
		err := rows.Scan(
			&account.ID, &account.Username, &account.Password, &account.Site,
			&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
		if err != nil {
			return nil, err
		}
		
		if updatedAt.Valid {
			account.UpdatedAt = updatedAt.Time
		}
		
		accounts = append(accounts, &account)
	}
	return accounts, nil
}

// GetActiveAccountsByOthers recupera gli account attivi di tutti gli altri utenti
func (m *MySQLManager) GetActiveAccountsByOthers(excludeCreatedBy string) ([]*models.Account, error) {
	rows, err := m.db.Query(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE created_by != ? AND is_active = TRUE ORDER BY created_by, created_at DESC
	`, excludeCreatedBy)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []*models.Account
	for rows.Next() {
		var account models.Account
		var updatedAt sql.NullTime
		err := rows.Scan(
			&account.ID, &account.Username, &account.Password, &account.Site,
			&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
		if err != nil {
			return nil, err
		}
		
		if updatedAt.Valid {
			account.UpdatedAt = updatedAt.Time
		}
		
		accounts = append(accounts, &account)
	}
	return accounts, nil
}

// FindAccountForDeactivation trova un account per la deattivazione (qualsiasi utente può deattivare)
func (m *MySQLManager) FindAccountForDeactivation(username, site string) (*models.Account, error) {
	var account models.Account
	var updatedAt sql.NullTime
	err := m.db.QueryRow(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE username = ? AND site = ? AND is_active = TRUE
	`, username, site).Scan(
		&account.ID, &account.Username, &account.Password, &account.Site, 
		&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
	
	if err != nil {
		return nil, err
	}
	
	if updatedAt.Valid {
		account.UpdatedAt = updatedAt.Time
	}
	
	return &account, nil
}

// FindAccountForEdit trova un account per la modifica (qualsiasi utente può modificare)
func (m *MySQLManager) FindAccountForEdit(username, site string) (*models.Account, error) {
	var account models.Account
	var updatedAt sql.NullTime
	err := m.db.QueryRow(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE username = ? AND site = ? AND is_active = TRUE
	`, username, site).Scan(
		&account.ID, &account.Username, &account.Password, &account.Site, 
		&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
	
	if err != nil {
		return nil, err
	}
	
	if updatedAt.Valid {
		account.UpdatedAt = updatedAt.Time
	}
	
	return &account, nil
}

// GetPersonalAccounts recupera tutti gli account personali (is_personal = true)
func (m *MySQLManager) GetPersonalAccounts() ([]*models.Account, error) {
	rows, err := m.db.Query(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE is_personal = TRUE AND is_active = TRUE ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []*models.Account
	for rows.Next() {
		var account models.Account
		var updatedAt sql.NullTime
		err := rows.Scan(
			&account.ID, &account.Username, &account.Password, &account.Site,
			&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
		if err != nil {
			return nil, err
		}
		
		if updatedAt.Valid {
			account.UpdatedAt = updatedAt.Time
		}
		
		accounts = append(accounts, &account)
	}
	return accounts, nil
}

// GetOthersAccounts recupera tutti gli account degli altri (is_personal = false)
func (m *MySQLManager) GetOthersAccounts() ([]*models.Account, error) {
	rows, err := m.db.Query(`
		SELECT id, username, password, site, link, created_at, updated_at, created_by, is_active, is_personal
		FROM accounts WHERE is_personal = FALSE AND is_active = TRUE ORDER BY created_by, created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []*models.Account
	for rows.Next() {
		var account models.Account
		var updatedAt sql.NullTime
		err := rows.Scan(
			&account.ID, &account.Username, &account.Password, &account.Site,
			&account.Link, &account.CreatedAt, &updatedAt, &account.CreatedBy, &account.IsActive, &account.IsPersonal)
		if err != nil {
			return nil, err
		}
		
		if updatedAt.Valid {
			account.UpdatedAt = updatedAt.Time
		}
		
		accounts = append(accounts, &account)
	}
	return accounts, nil
}
