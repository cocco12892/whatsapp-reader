package db

import (
	"time"
)

// Chat rappresenta una chat di WhatsApp
type Chat struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	LastMessage  Message   `json:"lastMessage"`
	Messages     []Message `json:"messages"`
	ProfileImage string    `json:"profileImage,omitempty"` // Path to profile image
}

// Message rappresenta un messaggio di WhatsApp
type Message struct {
	ID                  string     `json:"id"`
	Chat                string     `json:"chat"`
	ChatName            string     `json:"chatName"`
	Sender              string     `json:"sender"`
	SenderName          string     `json:"senderName"`
	Content             string     `json:"content"`
	Timestamp           time.Time  `json:"timestamp"`
	IsMedia             bool       `json:"isMedia"`
	MediaPath           string     `json:"mediaPath,omitempty"`
	IsEdited            bool       `json:"isEdited"`
	IsDeleted           bool       `json:"isDeleted"`
	IsReply             bool       `json:"isReply"`
	ReplyToMessageID    string     `json:"replyToMessageId,omitempty"`
	ReplyToSender       string     `json:"replyToSender,omitempty"`
	ReplyToContent      string     `json:"replyToContent,omitempty"`
	Reactions           []Reaction `json:"reactions,omitempty"`
	ProtocolMessageType int        `json:"protocolMessageType,omitempty"`
	ProtocolMessageName string     `json:"protocolMessageName,omitempty"`
	ImageHash           string     `json:"imageHash,omitempty"`
}

// Reaction rappresenta una reazione a un messaggio
type Reaction struct {
	Emoji      string    `json:"emoji"`
	Sender     string    `json:"sender"`
	SenderName string    `json:"senderName"`
	Timestamp  time.Time `json:"timestamp"`
}

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
