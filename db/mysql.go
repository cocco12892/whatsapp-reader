package db

import (
	"database/sql"
	"fmt"
	"time"
	_ "github.com/go-sql-driver/mysql"
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

	return nil
}

// Salva una chat nel database
func (m *MySQLManager) SaveChat(chat *Chat) error {
	_, err := m.db.Exec(
		"INSERT INTO chats (id, name, profile_image) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, profile_image = ?",
		chat.ID, chat.Name, chat.ProfileImage, chat.Name, chat.ProfileImage,
	)
	return err
}

// Carica tutte le chat dal database
func (m *MySQLManager) LoadChats() ([]*Chat, error) {
	rows, err := m.db.Query("SELECT id, name, profile_image FROM chats")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chats []*Chat
	for rows.Next() {
		var chat Chat
		if err := rows.Scan(&chat.ID, &chat.Name, &chat.ProfileImage); err != nil {
			return nil, err
		}
		chats = append(chats, &chat)
	}

	return chats, nil
}

// Salva un messaggio nel database
func (m *MySQLManager) SaveMessage(message *Message) error {
	_, err := m.db.Exec(`
		INSERT INTO messages (
			id, chat_id, chat_name, sender, sender_name, content, timestamp, 
			is_media, media_path, is_edited, is_deleted, is_reply, 
			reply_to_message_id, reply_to_sender, reply_to_content, 
			protocol_message_type, protocol_message_name, image_hash
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE 
			content = ?, is_edited = ?, is_deleted = ?
	`,
		message.ID, message.Chat, message.ChatName, message.Sender, message.SenderName,
		message.Content, message.Timestamp, message.IsMedia, message.MediaPath,
		message.IsEdited, message.IsDeleted, message.IsReply, message.ReplyToMessageID,
		message.ReplyToSender, message.ReplyToContent, message.ProtocolMessageType,
		message.ProtocolMessageName, message.ImageHash,
		// Valori per l'UPDATE
		message.Content, message.IsEdited, message.IsDeleted,
	)
	return err
}

// Carica i messaggi di una chat dal database
func (m *MySQLManager) LoadChatMessages(chatID string) ([]Message, error) {
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

	var messages []Message
	for rows.Next() {
		var msg Message
		if err := rows.Scan(
			&msg.ID, &msg.Chat, &msg.ChatName, &msg.Sender, &msg.SenderName,
			&msg.Content, &msg.Timestamp, &msg.IsMedia, &msg.MediaPath,
			&msg.IsEdited, &msg.IsDeleted, &msg.IsReply, &msg.ReplyToMessageID,
			&msg.ReplyToSender, &msg.ReplyToContent, &msg.ProtocolMessageType,
			&msg.ProtocolMessageName, &msg.ImageHash,
		); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
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
func (m *MySQLManager) SaveMessageNote(messageID string, noteData *MessageNote) error {
	_, err := m.db.Exec(
		"INSERT INTO message_notes (message_id, note, type, chat_id, chat_name, added_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, FALSE) ON DUPLICATE KEY UPDATE note = ?, type = ?, chat_id = ?, chat_name = ?, added_at = ?, is_deleted = FALSE",
		messageID, noteData.Note, noteData.Type, noteData.ChatID, noteData.ChatName, noteData.AddedAt,
		noteData.Note, noteData.Type, noteData.ChatID, noteData.ChatName, noteData.AddedAt,
	)
	return err
}

// LoadMessageNote carica la nota per un messaggio specifico
func (m *MySQLManager) LoadMessageNote(messageID string) (*MessageNote, error) {
	query := `
		SELECT message_id, note, type, chat_id, chat_name, added_at 
		FROM message_notes 
		WHERE message_id = ? AND is_deleted = FALSE
	`
	
	var note MessageNote
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
func (m *MySQLManager) LoadMessageNotes() (map[string]*MessageNote, error) {
	rows, err := m.db.Query("SELECT message_id, note, type, chat_id, chat_name, added_at, is_deleted FROM message_notes WHERE is_deleted = FALSE")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := make(map[string]*MessageNote)
	for rows.Next() {
		var messageID string
		var note MessageNote
		if err := rows.Scan(&messageID, &note.Note, &note.Type, &note.ChatID, &note.ChatName, &note.AddedAt, &note.IsDeleted); err != nil {
			return nil, err
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
func (m *MySQLManager) SaveRecordedData(data *RecordedData) error {
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
func (m *MySQLManager) UpdateRecordedData(data *RecordedData) error {
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
func (m *MySQLManager) LoadRecordedData(messageID string) (*RecordedData, error) {
	var data RecordedData
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
func (m *MySQLManager) LoadChatRecordedData(chatID string) ([]*RecordedData, error) {
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
	
	var recordedData []*RecordedData
	for rows.Next() {
		var data RecordedData
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
func (m *MySQLManager) LoadAllRecordedData() ([]*RecordedData, error) {
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
	
	var recordedData []*RecordedData
	for rows.Next() {
		var data RecordedData
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

// Chiude la connessione al database
func (m *MySQLManager) Close() error {
	return m.db.Close()
}
