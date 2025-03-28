package db

import (
	"time"
)

// Struttura per memorizzare i messaggi
type Message struct {
	ID                  string    `json:"id"`
	Chat                string    `json:"chat"`
	ChatName            string    `json:"chatName"`
	Sender              string    `json:"sender"`
	SenderName          string    `json:"senderName"`
	Content             string    `json:"content"`
	Timestamp           time.Time `json:"timestamp"`
	IsMedia             bool      `json:"isMedia"`
	MediaPath           string    `json:"mediaPath,omitempty"`
	IsEdited            bool      `json:"isEdited"`
	IsDeleted           bool      `json:"isDeleted"`
	IsReply             bool      `json:"isReply"`
	ReplyToMessageID    string    `json:"replyToMessageId,omitempty"`
	ReplyToSender       string    `json:"replyToSender,omitempty"`
	ReplyToContent      string    `json:"replyToContent,omitempty"`
	ProtocolMessageType int       `json:"protocolMessageType,omitempty"`
	ProtocolMessageName string    `json:"protocolMessageName,omitempty"`
	ImageHash           string    `json:"imageHash"`
}

// Struttura per la chat
type Chat struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	LastMessage  Message   `json:"lastMessage"`
	Messages     []Message `json:"messages"`
	ProfileImage string    `json:"profileImage,omitempty"`
}

// Struttura per le note dei messaggi
type MessageNote struct {
	MessageID string    `json:"messageId"`
	Note      string    `json:"note"`
	Type      string    `json:"type"`
	ChatID    string    `json:"chatId"`
	ChatName  string    `json:"chatName"`
	AddedAt   time.Time `json:"addedAt"`
}
