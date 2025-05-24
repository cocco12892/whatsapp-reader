package models

import (
	"time"
)

// Reaction represents a reaction to a message
type Reaction struct {
	Emoji      string    `json:"emoji"`
	Sender     string    `json:"sender"`
	SenderName string    `json:"senderName"`
	Timestamp  time.Time `json:"timestamp"`
}

// Message represents a WhatsApp message
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
	ProtocolMessageType int        `json:"protocolMessageType,omitempty"`
	ProtocolMessageName string     `json:"protocolMessageName,omitempty"`
	ImageHash           string     `json:"imageHash"`
	Reactions           []Reaction `json:"reactions,omitempty"`
} 