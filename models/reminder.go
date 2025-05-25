package models

import (
	"time"
)

// Reminder represents a chat reminder
type Reminder struct {
	ID            string    `json:"id"`
	ChatID        string    `json:"chat_id"`
	ChatName      string    `json:"chat_name"`
	Message       string    `json:"message"`
	ScheduledTime time.Time `json:"scheduled_time"`
	CreatedAt     time.Time `json:"created_at"`
	CreatedBy     string    `json:"created_by"`
	IsFired       bool      `json:"is_fired"`
} 