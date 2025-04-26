package main

import (
	"fmt"
	"os"
	"strings"
	"time"
	
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// Funzione per sanitizzare stringhe per uso nei percorsi dei file
func sanitizePathComponent(s string) string {
    // Rimuovi caratteri non sicuri per i percorsi dei file
    s = strings.ReplaceAll(s, "/", "_")
    s = strings.ReplaceAll(s, "\\", "_")
    s = strings.ReplaceAll(s, ":", "_")
    s = strings.ReplaceAll(s, "*", "_")
    s = strings.ReplaceAll(s, "?", "_")
    s = strings.ReplaceAll(s, "\"", "_")
    s = strings.ReplaceAll(s, "<", "_")
    s = strings.ReplaceAll(s, ">", "_")
    s = strings.ReplaceAll(s, "|", "_")
    return s
}

// Funzione per ottenere il nome del gruppo
func getGroupName(client *whatsmeow.Client, jid types.JID) string {
	if cachedName, ok := groupNameCache.Load(jid.String()); ok {
		return cachedName.(string)
	}
	
	groupInfo, err := client.GetGroupInfo(jid)
	if err != nil {
		return jid.String()
	}
	
	groupNameCache.Store(jid.String(), groupInfo.Name)
	return groupInfo.Name
}

// Funzione per ottenere il nome del contatto
func getContactName(client *whatsmeow.Client, jid types.JID) string {
	userJID := types.NewJID(jid.User, jid.Server)
	
	if cachedName, ok := contactNameCache.Load(userJID.String()); ok {
		return cachedName.(string)
	}
	
	contactInfo, err := client.Store.Contacts.GetContact(userJID)
	var name string
	if err != nil || contactInfo.PushName == "" {
		name = userJID.User
	} else {
		name = contactInfo.PushName
	}
	
	contactNameCache.Store(userJID.String(), name)
	return name
}

// Struttura per le reazioni ai messaggi
type Reaction struct {
	Emoji      string    `json:"emoji"`
	Sender     string    `json:"sender"`
	SenderName string    `json:"senderName"`
	Timestamp  time.Time `json:"timestamp"`
}

// Aggiunge una reazione a un messaggio
func addReactionToMessage(messageID string, reaction, sender, senderName string) {
	mutex.Lock()
	defer mutex.Unlock()
	
	// Cerca il messaggio in tutti i messaggi
	for i, msg := range messages {
		if msg.ID == messageID {
			// Verifica se esiste già una reazione dello stesso mittente
			for j, existingReaction := range msg.Reactions {
				if existingReaction.Sender == sender {
					// Aggiorna la reazione esistente
					messages[i].Reactions[j].Emoji = reaction
					messages[i].Reactions[j].Timestamp = time.Now()
					return
				}
			}
			
			// Aggiungi la nuova reazione
			newReaction := Reaction{
				Emoji:      reaction,
				Sender:     sender,
				SenderName: senderName,
				Timestamp:  time.Now(),
			}
			messages[i].Reactions = append(messages[i].Reactions, newReaction)
			
			// Aggiorna anche la reazione nella chat corrispondente
			chatID := msg.Chat
			if chat, exists := chats[chatID]; exists {
				for j, chatMsg := range chat.Messages {
					if chatMsg.ID == messageID {
						for k, existingReaction := range chat.Messages[j].Reactions {
							if existingReaction.Sender == sender {
								chat.Messages[j].Reactions[k].Emoji = reaction
								chat.Messages[j].Reactions[k].Timestamp = time.Now()
								return
							}
						}
						chat.Messages[j].Reactions = append(chat.Messages[j].Reactions, newReaction)
						break
					}
				}
			}
			break
		}
	}
}
