package handlers

import (
	"database/sql"
	"whatsapp-reader/models"
)

// DBManager è un'interfaccia che definisce i metodi necessari per interagire con il database
type DBManager interface {
	GetDB() *sql.DB
	SaveChat(chat *models.Chat) error
	LoadChats() ([]*models.Chat, error)
	SaveMessage(message *models.Message) error
	LoadChatMessages(chatID string) ([]models.Message, error)
	SaveChatSynonym(chatID, synonym string) error
	LoadChatSynonyms() (map[string]string, error)
	SaveMessageNote(messageID string, noteData *models.MessageNote) error
	LoadMessageNote(messageID string) (*models.MessageNote, error)
	LoadMessageNotes() (map[string]*models.MessageNote, error)
	SoftDeleteMessageNote(messageID string) error
	SaveRecordedData(data *models.RecordedData) error
	UpdateRecordedData(data *models.RecordedData) error
	LoadRecordedData(messageID string) (*models.RecordedData, error)
	LoadChatRecordedData(chatID string) ([]*models.RecordedData, error)
	LoadAllRecordedData() ([]*models.RecordedData, error)
	DeleteRecordedData(messageID string) error
	Close() error
}
