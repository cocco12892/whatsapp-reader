package models

import "time"

// Account rappresenta un account utente con credenziali
type Account struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	Password    string    `json:"password"`
	Site        string    `json:"site"`
	Link        string    `json:"link"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	CreatedBy   string    `json:"createdBy"`   // WhatsApp ID di chi ha creato
	IsActive    bool      `json:"isActive"`    // Soft delete
	IsPersonal  bool      `json:"isPersonal"`  // true = nostro, false = altri
} 