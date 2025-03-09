package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

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
	ID        string    `json:"id"`
	Chat      string    `json:"chat"`
	ChatName  string    `json:"chatName"`
	Sender    string    `json:"sender"`
	SenderName string   `json:"senderName"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	IsMedia   bool      `json:"isMedia"`
	MediaPath string    `json:"mediaPath,omitempty"`
}

// Struttura per la chat
type Chat struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	LastMessage Message `json:"lastMessage"`
	Messages  []Message `json:"messages"`
}

var (
	messages []Message
	chats    map[string]*Chat
	mutex    sync.RWMutex
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
	
	// Cache per i nomi dei gruppi
	var groupNameCache sync.Map
	
	// Funzione per ottenere il nome del gruppo
	getGroupName := func(jid types.JID) string {
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
	
	// Cache per i nomi dei contatti
	var contactNameCache sync.Map
	
	// Funzione per ottenere il nome del contatto
	getContactName := func(jid types.JID) string {
		userJID := types.NewJID(jid.User, jid.Server)
		
		if cachedName, ok := contactNameCache.Load(userJID.String()); ok {
			return cachedName.(string)
		}
		
		contactInfo, err := deviceStore.Contacts.GetContact(userJID)
		var name string
		if err != nil || contactInfo.PushName == "" {
			name = userJID.User
		} else {
			name = contactInfo.PushName
		}
		
		contactNameCache.Store(userJID.String(), name)
		return name
	}
	
	// Registra la funzione handler per gli eventi
	client.AddEventHandler(func(evt interface{}) {
		switch v := evt.(type) {
		case *events.Message:
			// Ottieni i dati del messaggio
			var chatJID string
			var chatName string
			
			if v.Info.IsGroup {
				chatJID = v.Info.Chat.String()
				chatName = getGroupName(v.Info.Chat)
			} else {
				chatJID = v.Info.Sender.String()
				chatName = getContactName(v.Info.Sender)
			}
			
			senderName := getContactName(v.Info.Sender)
			
			// Determina il contenuto del messaggio
			var content string
			var isMedia bool
			var mediaPath string
			
			if v.Message.GetConversation() != "" {
				content = v.Message.GetConversation()
			} else if v.Message.GetExtendedTextMessage() != nil {
				content = v.Message.GetExtendedTextMessage().GetText()
			} else if v.Message.GetImageMessage() != nil {
				isMedia = true
				content = "📷 Immagine"
				if caption := v.Message.GetImageMessage().GetCaption(); caption != "" {
					content += ": " + caption
				}
				
				// Salva l'immagine
				imgData, err := client.Download(v.Message.GetImageMessage())
				if err == nil {
					dataDir := v.Info.Timestamp.Format("2006-01-02")
					oraPrefisso := v.Info.Timestamp.Format("15-04-05")
					
					// Sanitizza i nomi
					sanitizedChatName := sanitizePathComponent(chatName)
					sanitizedSenderName := sanitizePathComponent(senderName)
					
					basePath := "Immagini"
					groupPath := fmt.Sprintf("%s/%s", basePath, sanitizedChatName)
					dataPath := fmt.Sprintf("%s/%s", groupPath, dataDir)
					
					// Crea le directory
					os.MkdirAll(dataPath, 0755)
					
					// Crea il nome file
					fileName := fmt.Sprintf("%s_%s_ID%s.jpg", oraPrefisso, sanitizedSenderName, v.Info.ID)
					fullPath := fmt.Sprintf("%s/%s", dataPath, fileName)
					
					// Salva il file
					err = os.WriteFile(fullPath, imgData, 0644)
					if err == nil {
						// Crea URL per il browser
						mediaPath = fmt.Sprintf("/images/%s/%s/%s", sanitizedChatName, dataDir, fileName)
					}
				}
			} else if v.Message.GetDocumentMessage() != nil {
				isMedia = true
				content = "📄 Documento: " + v.Message.GetDocumentMessage().GetFileName()
			} else if v.Message.GetAudioMessage() != nil {
				isMedia = true
				content = "🔊 Messaggio vocale"
			} else if v.Message.GetVideoMessage() != nil {
				isMedia = true
				content = "🎥 Video"
				if caption := v.Message.GetVideoMessage().GetCaption(); caption != "" {
					content += ": " + caption
				}
			} else {
				content = "Messaggio di altro tipo"
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
					ID:        chatJID,
					Name:      chatName,
					LastMessage: message,
					Messages:  []Message{message},
				}
			}
			mutex.Unlock()
			
			fmt.Printf("Nuovo messaggio da %s in %s: %s\n", senderName, chatName, content)
			fmt.Printf("Dettagli messaggio: %+v\n", message)
		
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
