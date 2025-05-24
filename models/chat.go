package models

// Chat represents a WhatsApp chat
type Chat struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	LastMessage  Message   `json:"lastMessage"`
	Messages     []Message `json:"messages"`
	ProfileImage string    `json:"profileImage,omitempty"` // Path to profile image
} 