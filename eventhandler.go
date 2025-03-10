package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/store/appstate"
)

// Registra tutti gli handler di eventi
func registerEventHandlers(client *whatsmeow.Client) {
	client.AddEventHandler(func(evt interface{}) {
		switch v := evt.(type) {
		case *events.Message:
			handleMessageEvent(client, v)
			
		case *events.Reaction:
			handleReactionEvent(client, v)
			
		case *events.Receipt:
			handleReceiptEvent(client, v)
			
		case *events.Presence:
			fmt.Printf("Cambio stato di %s: %s\n", v.From.String(), v.Presence)
			
		case *events.GroupInfo:
			handleGroupInfoEvent(client, v)
			
		case *events.JoinedGroup:
			fmt.Printf("Entrati nel gruppo %s (%s)\n", v.GroupName, v.JID.String())
			groupNameCache.Store(v.JID.String(), v.GroupName)
			
		case *events.Picture:
			handlePictureEvent(v)
			
		case *events.CallOffer:
			fmt.Printf("Chiamata in arrivo da %s (ID: %s)\n", v.CallCreator.String(), v.CallID)
			
		case *events.CallTerminate:
			fmt.Printf("Chiamata terminata: %s\n", v.CallID)
			
		case *events.CallAccept:
			fmt.Printf("Chiamata accettata: %s\n", v.CallID)
			
		case *events.MediaRetry:
			fmt.Printf("Richiesta di ricaricare media per il messaggio: %s\n", v.MessageID)
			
		case *events.HistorySync:
			handleHistorySyncEvent(client, v)
			
		case *events.AppState:
			handleAppStateEvent(v)
			
		case *events.PushName:
			fmt.Printf("Nome utente aggiornato: %s -> %s\n", v.JID, v.PushName)
			contactNameCache.Store(v.JID.String(), v.PushName)
			
		case *events.PairSuccess:
			fmt.Printf("Dispositivo accoppiato con successo! ID: %s\n", v.ID)
			
		case *events.LoggedOut:
			fmt.Println("Dispositivo disconnesso!")
			
		case *events.QR:
			fmt.Println("Nuovo QR code generato")
			qrterminal.GenerateHalfBlock(v.Codes[0], qrterminal.L, os.Stdout)
			
		case *events.Connected:
			fmt.Println("Connesso al server di WhatsApp!")
			
		case *events.Disconnected:
			fmt.Println("Disconnesso dal server di WhatsApp!")
			if v.Reason != nil {
				fmt.Printf("Motivo: %v\n", v.Reason)
			}
			
		case *events.PrivacySettings:
			fmt.Printf("Impostazioni privacy aggiornate: %+v\n", v.Settings)
			
		case *events.IdentityChange:
			fmt.Printf("Identità cambiata per %s\n", v.JID)
			
		case *events.ClientOutdated:
			fmt.Println("Il client è obsoleto! È necessario aggiornare la versione di whatsmeow")
			
		case *events.MarkChatAsRead:
			fmt.Printf("Chat %s contrassegnata come letta\n", v.JID)
			
		case *events.Blocklist:
			fmt.Printf("Lista blocchi aggiornata: %d contatti bloccati\n", len(v.PreviouslyBlocked))
			
		default:
			// Gestione di qualsiasi altro tipo di evento non espressamente gestito
			fmt.Printf("Evento non gestito di tipo %T: %+v\n", v, v)
		}
	})
}

// Gestisce gli eventi di tipo Message
func handleMessageEvent(client *whatsmeow.Client, v *events.Message) {
	// Ottieni i dati del messaggio
	var chatJID string
	var chatName string
	
	if v.Info.IsGroup {
		chatJID = v.Info.Chat.String()
		chatName = getGroupName(client, v.Info.Chat)
	} else {
		chatJID = v.Info.Sender.String()
		chatName = getContactName(client, v.Info.Sender)
	}
	
	senderName := getContactName(client, v.Info.Sender)
	
	// Gestione speciale per messaggi di protocollo
	if v.Message.GetProtocolMessage() != nil {
		protoMsg := v.Message.GetProtocolMessage()
		
		switch protoMsg.GetType() {
		case proto.ProtocolMessage_REVOKE:
			// Gestione messaggio cancellato
			if key := protoMsg.GetKey(); key != nil {
				// Cerca il messaggio originale
				originalMsgID := key.GetId()
				fmt.Printf("Messaggio %s cancellato da %s\n", originalMsgID, v.Info.Sender.String())
				
				// Aggiorna il messaggio nel database
				mutex.Lock()
				for i, msg := range messages {
					if msg.ID == originalMsgID {
						messages[i].Content = "🗑️ Messaggio cancellato"
						messages[i].IsDeleted = true
						
						// Aggiorna anche nelle chat
						if chat, exists := chats[chatJID]; exists {
							for j, chatMsg := range chat.Messages {
								if chatMsg.ID == originalMsgID {
									chat.Messages[j].Content = "🗑️ Messaggio cancellato"
									chat.Messages[j].IsDeleted = true
									break
								}
							}
						}
						break
					}
				}
				mutex.Unlock()
			}
			return
			
		case proto.ProtocolMessage_EDIT:
			// Gestione messaggio modificato
			if key := protoMsg.GetKey(); key != nil && protoMsg.GetEditedMessage() != nil {
				originalMsgID := key.GetId()
				
				// Ottieni il nuovo contenuto
				var newContent string
				
				if protoMsg.GetEditedMessage().GetConversation() != "" {
					newContent = protoMsg.GetEditedMessage().GetConversation()
				} else if extMsg := protoMsg.GetEditedMessage().GetExtendedTextMessage(); extMsg != nil {
					newContent = extMsg.GetText()
				} else {
					newContent = "Contenuto modificato (tipo complesso)"
				}
				
				fmt.Printf("Messaggio %s modificato da %s: %s\n", 
					originalMsgID, v.Info.Sender.String(), newContent)
				
				// Aggiorna il messaggio nel database
				mutex.Lock()
				for i, msg := range messages {
					if msg.ID == originalMsgID {
						messages[i].Content = "✏️ " + newContent + " (modificato)"
						messages[i].IsEdited = true
						
						// Aggiorna anche nelle chat
						if chat, exists := chats[chatJID]; exists {
							for j, chatMsg := range chat.Messages {
								if chatMsg.ID == originalMsgID {
									chat.Messages[j].Content = "✏️ " + newContent + " (modificato)"
									chat.Messages[j].IsEdited = true
									break
								}
							}
						}
						break
					}
				}
				mutex.Unlock()
			}
			return
		}
	}
	
	// Per tutti gli altri messaggi normali
	content, isMedia, mediaPath, err := handleMessageTypes(client, v)
	if err != nil {
		fmt.Printf("Errore durante la gestione del messaggio: %v\n", err)
	}
	
	// Verifica se è una risposta a un altro messaggio
	var quotedMsg *QuotedMsg
	if extendedMsg := v.Message.GetExtendedTextMessage(); extendedMsg != nil && 
	   extendedMsg.GetContextInfo() != nil && extendedMsg.GetContextInfo().GetStanzaId() != "" {
		quotedMsg = &QuotedMsg{
			ID:      extendedMsg.GetContextInfo().GetStanzaId(),
			Sender:  extendedMsg.GetContextInfo().GetParticipant(),
			Content: "(messaggio citato)",
		}
	}
	
	// Crea il messaggio
	message := Message{
		ID:         v.Info.ID,
		Chat:       chatJID,
		ChatName:   chatName,
		Sender:     v.Info.Sender.String(),
		SenderName: senderName,
		Content:    content,
		Timestamp:  v.Info.Timestamp,
		IsMedia:    isMedia,
		MediaPath:  mediaPath,
		QuotedMsg:  quotedMsg,
		Reactions:  []Reaction{},
	}
	
	// Determina il tipo di messaggio
	if v.Message.GetImageMessage() != nil {
		message.MessageType = "image"
	} else if v.Message.GetVideoMessage() != nil {
		message.MessageType = "video"
	} else if v.Message.GetAudioMessage() != nil {
		message.MessageType = "audio"
	} else if v.Message.GetDocumentMessage() != nil {
		message.MessageType = "document"
	} else if v.Message.GetStickerMessage() != nil {
		message.MessageType = "sticker"
	} else if v.Message.GetContactMessage() != nil {
		message.MessageType = "contact"
	} else if v.Message.GetLocationMessage() != nil {
		message.MessageType = "location"
	} else if v.Message.GetPollCreationMessage() != nil {
		message.MessageType = "poll"
	} else {
		message.MessageType = "text"
	}
	
	// Aggiorna la lista dei messaggi e delle chat
	mutex.Lock()
	messages = append(messages, message)
	
	// Aggiorna o crea la chat
	if chat, exists := chats[chatJID]; exists {
		chat.LastMessage = message
		chat.Messages = append(chat.Messages, message)
	} else {
		chats[chatJID] = &Chat{
			ID:          chatJID,
			Name:        chatName,
			LastMessage: message,
			Messages:    []Message{message},
			IsGroup:     v.Info.IsGroup,
		}
	}
	mutex.Unlock()
	
	fmt.Printf("Nuovo messaggio da %s in %s: %s\n", senderName, chatName, content)
}