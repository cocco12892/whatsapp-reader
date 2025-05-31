package models

import (
	"time"
)

// ReminderStatus rappresenta lo stato di un reminder
type ReminderStatus string

const (
	ReminderStatusPending    ReminderStatus = "pending"    // In attesa di invio
	ReminderStatusProcessing ReminderStatus = "processing" // In elaborazione
	ReminderStatusSent       ReminderStatus = "sent"       // Inviato con successo
	ReminderStatusFailed     ReminderStatus = "failed"     // Invio fallito
	ReminderStatusCancelled  ReminderStatus = "cancelled"  // Cancellato dall'utente
)

// Reminder represents a chat reminder
type Reminder struct {
	ID            string         `json:"id"`
	ChatID        string         `json:"chat_id"`
	ChatName      string         `json:"chat_name"`
	Message       string         `json:"message"`
	ScheduledTime time.Time      `json:"scheduled_time"` // Quando DOVREBBE essere inviato
	CreatedAt     time.Time      `json:"created_at"`     // Quando è stato creato
	CreatedBy     string         `json:"created_by"`
	Status        ReminderStatus `json:"status"`         // Stato del reminder
	SentAt        *time.Time     `json:"sent_at"`        // Quando è stato EFFETTIVAMENTE inviato (null se non ancora inviato)
	AttemptCount  int            `json:"attempt_count"`  // Numero di tentativi di invio
	LastError     string         `json:"last_error"`     // Ultimo errore se fallito
	// Manteniamo IsFired per backward compatibility, ma ora ridondante con Status
	IsFired       bool           `json:"is_fired"`
} 