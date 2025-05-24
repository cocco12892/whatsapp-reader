package db

import (
	"time"
)

// Struttura per le note dei messaggi
type MessageNote struct {
	MessageID string    `json:"messageId"`
	Note      string    `json:"note"`
	Type      string    `json:"type"`
	ChatID    string    `json:"chatId"`
	ChatName  string    `json:"chatName"`
	AddedAt   time.Time `json:"addedAt"`
	IsDeleted bool      `json:"isDeleted"`
}

// RecordedData rappresenta un dato registrato (importo e quota)
type RecordedData struct {
	MessageID  string    `json:"messageId"`
	Data       string    `json:"data"`       // Formato: "importo@quota"
	ChatID     string    `json:"chatId"`
	ChatName   string    `json:"chatName"`
	SenderName string    `json:"senderName"`
	Content    string    `json:"content"`
	Timestamp  time.Time `json:"timestamp"`
	RecordedAt time.Time `json:"recordedAt"`
	UpdatedAt  time.Time `json:"updatedAt,omitempty"`
	NoteID     string    `json:"noteId,omitempty"`
	Note       string    `json:"note,omitempty"`
}
