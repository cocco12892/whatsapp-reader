package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"crypto/sha256"
    "encoding/hex"

	"github.com/gin-gonic/gin"
	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	_ "github.com/mattn/go-sqlite3"
)

// Struttura per memorizzare i messaggi
type Message struct {
    ID              string    `json:"id"`
    Chat            string    `json:"chat"`
    ChatName        string    `json:"chatName"`
    Sender          string    `json:"sender"`
    SenderName      string    `json:"senderName"`
    Content         string    `json:"content"`
    Timestamp       time.Time `json:"timestamp"`
    IsMedia         bool      `json:"isMedia"`
    MediaPath       string    `json:"mediaPath,omitempty"`
	IsEdited        bool      `json:"isEdited"`
	IsDeleted       bool      `json:"isDeleted"` 

    // Nuovi campi per i messaggi di risposta
    IsReply         bool      `json:"isReply"`
    ReplyToMessageID string   `json:"replyToMessageId,omitempty"`
    ReplyToSender   string    `json:"replyToSender,omitempty"`
    ReplyToContent  string    `json:"replyToContent,omitempty"`

	ProtocolMessageType int    `json:"protocolMessageType,omitempty"`
    ProtocolMessageName string `json:"protocolMessageName,omitempty"`

	ImageHash       string    `json:"imageHash"`
}


// Struttura per la chat
type Chat struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	LastMessage  Message   `json:"lastMessage"`
	Messages     []Message `json:"messages"`
	ProfileImage string    `json:"profileImage,omitempty"` // Percorso all'immagine del profilo
}

var (
	messages []Message
	chats    map[string]*Chat
	mutex    sync.RWMutex
	
	// Cache per i nomi
	groupNameCache   sync.Map
	contactNameCache sync.Map
)

func getProtocolMessageTypeName(typeNum int) string {
    switch typeNum {
    case 0:
        return "revoke"
    case 2:
        return "app_state_sync_key_share"
    case 4:
        return "history_sync_notification"
    case 5:
        return "initial_security_notification"
    case 7:
        return "app_state_fatal_exception_notification"
    case 10:
        return "sync_message"
    case 11:
        return "peer_data_operation_request"
    case 12:
        return "peer_data_operation_response"
    case 13:
        return "placeholder_cleanup"
    case 14:
        return "edit"
    default:
        return "unknown"
    }
}

func getAudioExtension(mimetype string) string {
    switch mimetype {
    case "audio/ogg":
        return "ogg"
    case "audio/mp4":
        return "m4a"
    case "audio/wav":
        return "wav"
    case "audio/mpeg":
        return "mp3"
    default:
        return "audio"
    }
}

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

func downloadProfilePicture(client *whatsmeow.Client, jid types.JID, isGroup bool) (string, error) {
	// Crea i parametri per il download dell'immagine del profilo
	params := &whatsmeow.GetProfilePictureParams{
		Preview: false,
	}
	
	// Ottieni le informazioni sull'immagine del profilo
	pictureInfo, err := client.GetProfilePictureInfo(jid, params)
	if err != nil {
		// Gestisci casi specifici di errore
		if err == whatsmeow.ErrProfilePictureUnauthorized {
			return "", fmt.Errorf("non autorizzato a vedere l'immagine del profilo")
		}
		if err == whatsmeow.ErrProfilePictureNotSet {
			return "", fmt.Errorf("nessuna immagine del profilo impostata")
		}
		return "", err
	}
	
	if pictureInfo == nil || pictureInfo.URL == "" {
		return "", fmt.Errorf("nessuna immagine del profilo disponibile")
	}
	
	// Crea il nome della directory
	var basePath string
	if isGroup {
		basePath = "ProfileImages/Groups"
	} else {
		basePath = "ProfileImages/Users"
	}
	
	// Crea la directory se non esiste
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return "", fmt.Errorf("errore nella creazione della directory: %v", err)
	}
	
	// Sanitizza l'ID per il nome del file
	sanitizedJID := sanitizePathComponent(jid.String())
	fileName := fmt.Sprintf("%s.jpg", sanitizedJID)
	filePath := fmt.Sprintf("%s/%s", basePath, fileName)
	
	// Effettua la richiesta HTTP per scaricare l'immagine
	resp, err := http.Get(pictureInfo.URL)
	if err != nil {
		return "", fmt.Errorf("errore nel download dell'immagine: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("errore nella risposta HTTP: %d", resp.StatusCode)
	}
	
	// Leggi i dati dell'immagine
	imgData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("errore nella lettura dei dati dell'immagine: %v", err)
	}
	
	// Salva l'immagine
	if err := os.WriteFile(filePath, imgData, 0644); err != nil {
		return "", fmt.Errorf("errore nel salvataggio dell'immagine: %v", err)
	}
	
	var folderType string
	if isGroup {
		folderType = "groups"
	} else {
		folderType = "users"
	}
	webPath := fmt.Sprintf("/profile-images/%s/%s", folderType, fileName)
	return webPath, nil
}

func main() {
	// Inizializza lo storage
	chats = make(map[string]*Chat)
	
	// Configura un logger
	logger := waLog.Stdout("Info", "INFO", true)
	
	// Crea un database SQLite per memorizzare le sessioni
	dbContainer, err := sqlstore.New("sqlite3", "file:whatsmeow.db?_foreign_keys=on", logger)
	if err != nil {
		fmt.Println("Errore durante la creazione del database:", err)
		return
	}
	
	// Ottieni il primo dispositivo dal database
	deviceStore, err := dbContainer.GetFirstDevice()
	if err != nil {
		fmt.Println("Errore durante l'ottenimento del dispositivo:", err)
		return
	}
	
	// Crea un client WhatsApp
	client := whatsmeow.NewClient(deviceStore, logger)
	
	// Registra l'event handler principale
	client.AddEventHandler(func(evt interface{}) {
		switch v := evt.(type) {
		case *events.Message:
    		// Controlla se è un messaggio di tipo elimina
			if v.Message.GetProtocolMessage() != nil && v.Message.GetProtocolMessage().GetType() == 0 {

				revokedMessageID := v.Message.GetProtocolMessage().GetKey().GetId()
				
				mutex.Lock()
				for i, msg := range messages {
					if msg.ID == revokedMessageID {
						// Contrassegna il messaggio come eliminato
						messages[i].IsDeleted = true
						messages[i].Content = "(Questo messaggio è stato eliminato)"
						
						// Aggiorna anche nella chat corrispondente
						if chat, exists := chats[msg.Chat]; exists {
							for j, chatMsg := range chat.Messages {
								if chatMsg.ID == revokedMessageID {
									chat.Messages[j].IsDeleted = true
									chat.Messages[j].Content = "(Questo messaggio è stato eliminato)"
									break
								}
							}
							
							// Se è l'ultimo messaggio nella chat, aggiorna anche quello
							if chat.LastMessage.ID == revokedMessageID {
								chat.LastMessage.IsDeleted = true
								chat.LastMessage.Content = "(Questo messaggio è stato eliminato)"
							}
						}
						
						fmt.Printf("Messaggio %s eliminato\n", revokedMessageID)
						break
					}
				}
				mutex.Unlock()
			}

    		// Controlla se è un messaggio di tipo modifica
			if v.Message.GetProtocolMessage() != nil && v.Message.GetProtocolMessage().GetType() == 14 {
				// Ottieni l'ID del messaggio originale
				editedMessageID := v.Message.GetProtocolMessage().GetKey().GetId()
				
				// Trova il messaggio originale nella lista dei messaggi
				mutex.Lock()
				for i, msg := range messages {
					if msg.ID == editedMessageID {
						// Estrai il contenuto aggiornato dal messaggio modificato
						var content string
						
						// Estrai il contenuto aggiornato
						if v.Message.GetProtocolMessage().GetEditedMessage().GetConversation() != "" {
							content = v.Message.GetProtocolMessage().GetEditedMessage().GetConversation()
						} else if v.Message.GetProtocolMessage().GetEditedMessage().GetExtendedTextMessage() != nil {
							content = v.Message.GetProtocolMessage().GetEditedMessage().GetExtendedTextMessage().GetText()
						}
						
						// Aggiorna il messaggio
						if content != "" {
							messages[i].Content = content
							// Aggiungi un flag per indicare che è stato modificato
							messages[i].IsEdited = true  // Dovrai aggiungere questo campo alla struct Message
							
							// Aggiorna anche nella chat corrispondente
							if chat, exists := chats[msg.Chat]; exists {
								for j, chatMsg := range chat.Messages {
									if chatMsg.ID == editedMessageID {
										chat.Messages[j].Content = content
										chat.Messages[j].IsEdited = true
										break
									}
								}
								
								// Se è l'ultimo messaggio nella chat, aggiorna anche quello
								if chat.LastMessage.ID == editedMessageID {
									chat.LastMessage.Content = content
									chat.LastMessage.IsEdited = true
								}
							}
							
							fmt.Printf("Messaggio %s modificato: %s\n", editedMessageID, content)
						}
						break
					}
				}
				mutex.Unlock()
			}
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
			
			// Determina il contenuto del messaggio in base al tipo
			var (
				content string
				isMedia bool
				mediaPath string
			
				isReply bool
				replyToMessageID string
				replyToSender string    // Add this line
				replyToContent string

				isEdited bool
				isDeleted bool
				protocolMessageType int
        		protocolMessageName string

				imageHashString string 
			)
			
			// Sostituisci la parte di gestione dei tipi di messaggio nel tuo event handler case *events.Message:
			// Modificando questa parte:

			if v.Message.GetConversation() != "" {
				content = v.Message.GetConversation()
			} else if v.Message.GetExtendedTextMessage() != nil {
				extendedMsg := v.Message.GetExtendedTextMessage()
				content = extendedMsg.GetText()
				
				// Gestione del messaggio di risposta
				if contextInfo := extendedMsg.GetContextInfo(); contextInfo != nil {
					isReply = true
					replyToMessageID = contextInfo.GetStanzaId()
					
					// Modify the reply sender extraction
					if participant := contextInfo.GetParticipant(); participant != "" {
						// Parse the participant string (typically in format "user@server")
						parts := strings.Split(participant, "@")
						if len(parts) == 2 {
							userJID := types.NewJID(parts[0], parts[1])
							replyToSender = getContactName(client, userJID)
						} else {
							// Fallback to using the entire participant string
							replyToSender = participant
						}
					}
					
					// Ottieni il contenuto del messaggio originale
					if quotedMsg := contextInfo.GetQuotedMessage(); quotedMsg != nil {
						// Estrai il contenuto del messaggio originale
						switch {
						case quotedMsg.GetConversation() != "":
							replyToContent = quotedMsg.GetConversation()
						case quotedMsg.GetExtendedTextMessage() != nil:
							replyToContent = quotedMsg.GetExtendedTextMessage().GetText()
						case quotedMsg.GetImageMessage() != nil:
							replyToContent = "📷 Immagine"
							if caption := quotedMsg.GetImageMessage().GetCaption(); caption != "" {
								replyToContent += ": " + caption
							}
						case quotedMsg.GetDocumentMessage() != nil:
							replyToContent = "📄 Documento: " + quotedMsg.GetDocumentMessage().GetFileName()
						case quotedMsg.GetAudioMessage() != nil:
							replyToContent = "🔊 Messaggio vocale"
						case quotedMsg.GetVideoMessage() != nil:
							replyToContent = "🎥 Video"
							if caption := quotedMsg.GetVideoMessage().GetCaption(); caption != "" {
								replyToContent += ": " + caption
							}
						}
					}
				}
			} else if v.Message.GetImageMessage() != nil {
				isMedia = true
				content = "📷 Immagine"
				if caption := v.Message.GetImageMessage().GetCaption(); caption != "" {
					content += ": " + caption
				}
				
				// Salva l'immagine - mantenendo il codice originale che funzionava
				imgData, err := client.Download(v.Message.GetImageMessage())
				if err == nil {
					// Calcola l'hash SHA-256 dell'immagine
					imageHash := sha256.Sum256(imgData)
					imageHashString = hex.EncodeToString(imageHash[:])
					
					// Il resto del codice esistente per salvare l'immagine...
					dataDir := v.Info.Timestamp.Format("2006-01-02")
					oraPrefisso := v.Info.Timestamp.Format("15-04-05")
					
					// Sanitizza i nomi
					sanitizedChatName := sanitizePathComponent(chatName)
					sanitizedSenderName := sanitizePathComponent(senderName)
					
					basePath := "Immagini"
					groupPath := fmt.Sprintf("%s/%s", basePath, sanitizedChatName)
					dataPath := fmt.Sprintf("%s/%s", groupPath, dataDir)
					
					// Crea le directory
					err = os.MkdirAll(dataPath, 0755)
					if err != nil {
						fmt.Printf("Errore creazione directory: %v\n", err)
					}
					
					// Crea il nome file
					fileName := fmt.Sprintf("%s_%s_ID%s.jpg", oraPrefisso, sanitizedSenderName, v.Info.ID)
					fullPath := fmt.Sprintf("%s/%s", dataPath, fileName)
					
					// Salva il file
					err = os.WriteFile(fullPath, imgData, 0644)
					if err != nil {
						fmt.Printf("Errore salvataggio file: %v\n", err)
					} else {
						// Crea URL per il browser
						mediaPath = fmt.Sprintf("/images/%s/%s/%s", sanitizedChatName, dataDir, fileName)
						
						fmt.Printf("Immagine salvata: %s, Hash: %s\n", mediaPath, imageHashString)
					}
				} else {
					fmt.Printf("Errore download immagine: %v\n", err)
				}
			} else if v.Message.GetDocumentMessage() != nil {
				isMedia = true
				content = "📄 Documento: " + v.Message.GetDocumentMessage().GetFileName()
			} else if v.Message.GetAudioMessage() != nil {
				audioMsg := v.Message.GetAudioMessage()
				isMedia = true
				content = "🔊 Messaggio vocale"

				// Scarica il file audio
				audioData, err := client.Download(audioMsg)
				if err == nil {
					// Genera path per salvare il file
					dataDir := v.Info.Timestamp.Format("2006-01-02")
					oraPrefisso := v.Info.Timestamp.Format("15-04-05")
					
					// Sanitizza i nomi
					sanitizedChatName := sanitizePathComponent(chatName)
					sanitizedSenderName := sanitizePathComponent(senderName)
					
					basePath := "Messaggi Vocali"
					groupPath := fmt.Sprintf("%s/%s", basePath, sanitizedChatName)
					dataPath := fmt.Sprintf("%s/%s", groupPath, dataDir)
					
					// Crea le directory
					err = os.MkdirAll(dataPath, 0755)
					if err != nil {
						fmt.Printf("Errore creazione directory: %v\n", err)
					}
					
					// Informazioni aggiuntive dall'AudioMessage
					duration := audioMsg.GetSeconds() // Durata in secondi
					mimetype := audioMsg.GetMimetype() // Tipo di file audio
					
					// Crea il nome file
					fileName := fmt.Sprintf("%s_%s_ID%s.%s", 
						oraPrefisso, 
						sanitizedSenderName, 
						v.Info.ID, 
						getAudioExtension(mimetype),
					)
					fullPath := fmt.Sprintf("%s/%s", dataPath, fileName)
					
					// Salva il file
					err = os.WriteFile(fullPath, audioData, 0644)
					if err != nil {
						fmt.Printf("Errore salvataggio file audio: %v\n", err)
					} else {
						// Crea URL per il browser
						mediaPath = fmt.Sprintf("/audio/%s/%s/%s", 
							sanitizedChatName, 
							dataDir, 
							fileName,
						)
						
						// Aggiorna il contenuto con dettagli aggiuntivi
						content = fmt.Sprintf("🔊 Messaggio vocale (Durata: %d sec, Tipo: %s)", 
							duration, 
							mimetype,
						)
						
						fmt.Printf("Messaggio vocale salvato: %s\n", mediaPath)
					}
				} else {
					fmt.Printf("Errore download messaggio vocale: %v\n", err)
				}
			} else if v.Message.GetVideoMessage() != nil {
				isMedia = true
				content = "🎥 Video"
				if caption := v.Message.GetVideoMessage().GetCaption(); caption != "" {
					content += ": " + caption
				}
			} else {
				// Aggiungi debug per "messaggio di altro tipo"
				messageType := "sconosciuto"
				
				// Controllo tutti i tipi possibili
				if v.Message.GetStickerMessage() != nil {
					messageType = "sticker"
					content = "🏷️ Sticker"
				} else if v.Message.GetContactMessage() != nil {
					messageType = "contatto"
					content = "👤 Contatto: " + v.Message.GetContactMessage().GetDisplayName()
				} else if v.Message.GetLocationMessage() != nil {
					messageType = "posizione"
					content = fmt.Sprintf("📍 Posizione: lat %f, long %f", 
							v.Message.GetLocationMessage().GetDegreesLatitude(),
							v.Message.GetLocationMessage().GetDegreesLongitude())
				} else if v.Message.GetLiveLocationMessage() != nil {
					messageType = "posizione live"
					content = "📍 Posizione in tempo reale"
				} else if v.Message.GetReactionMessage() != nil {
					messageType = "reazione"
					content = fmt.Sprintf("👍 Reazione: %s (al messaggio: %s)", 
							v.Message.GetReactionMessage().GetText(),
							v.Message.GetReactionMessage().GetKey().GetId())
				} else if v.Message.GetPollCreationMessage() != nil {
					messageType = "sondaggio"
					content = "📊 Sondaggio: " + v.Message.GetPollCreationMessage().GetName()
				} else if v.Message.GetPollUpdateMessage() != nil {
					messageType = "voto sondaggio"
					content = "📊 Voto a un sondaggio"
				} else if v.Message.GetProtocolMessage() != nil {
				
					protocolType := int(v.Message.GetProtocolMessage().GetType())
					protocolMessageType = protocolType
					
					// Imposta il nome in base al tipo
					protocolMessageName = getProtocolMessageTypeName(protocolType)
					
					// Imposta il contenuto per messaggi di protocollo
					content = fmt.Sprintf("Messaggio di protocollo (tipo: %s)", protocolMessageName)
					
					// Verifica se è un messaggio di revoca (eliminazione)
					if protocolType == 0 { // REVOKE
						protocolMessageType = 99
						isDeleted = true
					}

					// Verifica se è un edit
					if protocolType == 14 { // EDIT
						isEdited = true
					}
				} else if v.Message.GetButtonsMessage() != nil {
					messageType = "messaggio con pulsanti"
					content = "🔘 Messaggio con pulsanti"
				} else if v.Message.GetTemplateMessage() != nil {
					messageType = "messaggio template"
					content = "📝 Messaggio template"
				} else if v.Message.GetViewOnceMessage() != nil {
					messageType = "visualizza una volta"
					content = "👁️ Messaggio visualizzabile una volta"
				} else if v.Message.GetOrderMessage() != nil {
					messageType = "ordine"
					content = "🛒 Ordine"
				} else if v.Message.GetProductMessage() != nil {
					messageType = "prodotto"
					content = "🛍️ Prodotto"
				} else if v.Message.GetListMessage() != nil {
					messageType = "lista"
					content = "📋 Messaggio lista"
				} else if v.Message.GetEphemeralMessage() != nil {
					messageType = "effimero"
					content = "⏱️ Messaggio a tempo"
				} else {
					// Stampa il protobuf per debug
					fmt.Printf("DEBUG - Messaggio non riconosciuto: %+v\n", v.Message)
				}
				
				content = fmt.Sprintf("%s (tipo: %s)", content, messageType)
			}
			
			// Crea il messaggio
			message := Message{
				ID:        v.Info.ID,
				Chat:      chatJID,
				ChatName:  chatName,
				Sender:    v.Info.Sender.String(),
				SenderName: senderName,
				Content:   content,
				Timestamp: v.Info.Timestamp,
				IsMedia:   isMedia,
				MediaPath: mediaPath,

				// Aggiungi le informazioni di risposta
				IsReply:         isReply,
				ReplyToMessageID: replyToMessageID,
				ReplyToSender:   replyToSender,
				ReplyToContent:  replyToContent,

				ProtocolMessageType: protocolMessageType,
				ProtocolMessageName: protocolMessageName,
				IsEdited:            isEdited,
				IsDeleted:            isDeleted,

				ImageHash:           imageHashString,
			}
			
			// Aggiorna la lista dei messaggi e delle chat
			mutex.Lock()
			messages = append(messages, message)
			
			// Aggiorna o crea la chat
			if chat, exists := chats[chatJID]; exists {
				chat.LastMessage = message
				chat.Messages = append(chat.Messages, message)
				
				// Aggiungi l'immagine del profilo se non è già presente
				if chat.ProfileImage == "" {
					isGroup := v.Info.IsGroup
					profilePath, err := downloadProfilePicture(client, v.Info.Chat, isGroup)
					if err == nil {
						chat.ProfileImage = profilePath
					}
				}
			} else {
				// Prova a scaricare l'immagine del profilo
				isGroup := v.Info.IsGroup
				profilePath, err := downloadProfilePicture(client, v.Info.Chat, isGroup)
				if err != nil {
					fmt.Printf("Errore nel download dell'immagine del profilo: %v\n", err)
					profilePath = "" // Imposta a stringa vuota se il download fallisce
				}
				
				// Crea la nuova chat
				chats[chatJID] = &Chat{
					ID:           chatJID,
					Name:         chatName,
					LastMessage:  message,
					Messages:     []Message{message},
					ProfileImage: profilePath, // Potrebbe essere vuoto se il download fallisce
				}
			}
			mutex.Unlock()
			
			fmt.Printf("Nuovo messaggio da %s in %s: %s\n", senderName, chatName, content)
		
		case *events.Connected:
			fmt.Println("Client connesso!")
			
		case *events.LoggedOut:
			fmt.Println("Dispositivo disconnesso")
		}
	})

	// Connetti il client WhatsApp
	if client.Store.ID == nil {
		qrChan, err := client.GetQRChannel(context.Background())
		if err != nil {
			fmt.Println("Errore nell'ottenere il canale QR:", err)
			return
		}
		
		err = client.Connect()
		if err != nil {
			fmt.Println("Errore durante la connessione:", err)
			return
		}
		
		for evt := range qrChan {
			if evt.Event == "code" {
				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				fmt.Println("Scansiona questo codice QR con WhatsApp")
			} else {
				fmt.Println("Evento QR:", evt.Event)
			}
		}
	} else {
		fmt.Println("Già registrato con JID:", client.Store.ID)
		err = client.Connect()
		if err != nil {
			fmt.Println("Errore durante la connessione:", err)
			return
		}
	}
	
	// Configura il server API
	router := gin.Default()
	
	// Abilita CORS
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})
	
	// Servi file statici (per l'interfaccia web)
	router.Static("/web", "./web")
	router.Static("/images", "./Immagini")
	router.Static("/profile-images/users", "./ProfileImages/Users")
	router.Static("/profile-images/groups", "./ProfileImages/Groups")
	router.Static("/audio", "./Messaggi Vocali")

	// API per ottenere le ultime chat
	router.GET("/api/chats", func(c *gin.Context) {
		fmt.Println("Richiesta API /api/chats ricevuta")
		fmt.Println("Headers:", c.Request.Header)
		
		mutex.RLock()
		defer mutex.RUnlock()
		
		fmt.Println("Numero di chat trovate:", len(chats))
		
		// Converti la mappa in slice per ordinarla
		var chatList []*Chat
		for _, chat := range chats {
			chatList = append(chatList, chat)
		}
		
		// Ordina le chat per timestamp dell'ultimo messaggio (più recente prima)
		sort.Slice(chatList, func(i, j int) bool {
			return chatList[i].LastMessage.Timestamp.After(chatList[j].LastMessage.Timestamp)
		})
		
		// Prendi solo le ultime 10 (o meno se ce ne sono meno di 10)
		limit := 10
		if len(chatList) < limit {
			limit = len(chatList)
		}
		
		c.JSON(http.StatusOK, chatList[:limit])
	})
	
	// API per ottenere i messaggi di una chat specifica
	// Endpoint di test
	router.GET("/api/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"message": "Il backend funziona correttamente",
		})
	})

	router.GET("/api/chats/:id/messages", func(c *gin.Context) {
		chatID := c.Param("id")
		
		mutex.RLock()
		defer mutex.RUnlock()
		
		chat, exists := chats[chatID]
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata"})
			return
		}
		
		c.JSON(http.StatusOK, chat.Messages)
	})

	router.GET("/api/chats/:id/profile-image", func(c *gin.Context) {
		chatID := c.Param("id")
		
		mutex.RLock()
		chat, exists := chats[chatID]
		mutex.RUnlock()
		
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata"})
			return
		}
		
		jid, err := types.ParseJID(chatID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "JID non valido"})
			return
		}
		
		isGroup := jid.Server == "g.us"
		profilePath, err := downloadProfilePicture(client, jid, isGroup)
		
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": fmt.Sprintf("Impossibile scaricare l'immagine del profilo: %v", err),
			})
			return
		}
		
		mutex.Lock()
		chat.ProfileImage = profilePath
		mutex.Unlock()
		
		c.JSON(http.StatusOK, gin.H{
			"profileImage": profilePath,
		})
	})
	
	// Avvia il server HTTP in una goroutine
	go func() {
		if err := router.Run(":8080"); err != nil {
			fmt.Printf("Errore nell'avvio del server: %v\n", err)
		}
	}()
	
	fmt.Println("Server API avviato su http://localhost:8080")
	fmt.Println("Interfaccia web disponibile su http://localhost:8080/web")
	
	// Gestisci chiusura corretta
	c := make(chan os.Signal)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	
	fmt.Println("Disconnessione...")
	client.Disconnect()
}