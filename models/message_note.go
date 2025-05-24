package models

import (
	"time"
)

// MessageNote rappresenta una nota associata a un messaggio
type MessageNote struct {
	MessageID string    `json:"messageId"`
	Note      string    `json:"note"`
	Type      string    `json:"type"`
	ChatID    string    `json:"chatId"`
	ChatName  string    `json:"chatName"`
	AddedAt   time.Time `json:"addedAt"`
	IsDeleted bool      `json:"isDeleted"`
}
