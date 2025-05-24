package models

import (
	"time"
)

// RecordedData rappresenta dati registrati associati a un messaggio
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
