package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.mau.fi/whatsmeow"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"whatsapp-reader/models"
	"whatsapp-reader/whatsapp"
)

var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			// Consenti tutte le origini per WebSocket (per sviluppo)
			// In produzione, dovresti limitare questo a origini specifiche.
			return true
		},
	}
	wsClients     = make(map[*websocket.Conn]bool)
	wsClientsMux  sync.Mutex
	wsClientCount int32
)

// DBManager definisce l'interfaccia per le operazioni sul database
type DBManager interface {
	LoadChats() ([]*models.Chat, error)
	LoadChatMessages(chatID string) ([]*models.Message, error)
	SaveChat(chat *models.Chat) error
	SaveMessage(message *models.Message) error
	UpdateMessageStatus(messageID, status string) error
	UpdateMessageContent(messageID, newText string, editedAt time.Time) error
	DeleteMessage(messageID string) error
	GetMessageByID(messageID string) (*models.Message, error)
	LoadRecentChatMessages(chatID string, since time.Time) ([]*models.Message, error)
	
	// Reminder operations
	SaveReminder(reminder *models.Reminder) error
	UpdateReminder(reminder *models.Reminder) error
	DeleteReminder(reminderID string) error
	GetReminderByID(reminderID string) (*models.Reminder, error)
	GetChatReminders(chatID string) ([]*models.Reminder, error)
	GetDueReminders() ([]*models.Reminder, error)
	
	// New reminder state management functions
	MarkReminderAsSent(reminderID string) error
	MarkReminderAsProcessing(reminderID string, attemptCount int) error
	MarkReminderAsFailed(reminderID string, errorMsg string) error
	IncrementReminderAttempt(reminderID string) error
	
	// Backward compatibility
	MarkReminderAsFired(reminderID string) error
	
	// Account operations
	SaveAccount(account *models.Account) error
	UpdateAccount(account *models.Account) error
	DeleteAccount(accountID string) error
	DeactivateAccount(accountID string) error
	GetAccountByID(accountID string) (*models.Account, error)
	GetActiveAccounts() ([]*models.Account, error)
	GetActiveAccountsByCreator(createdBy string) ([]*models.Account, error)
	GetActiveAccountsByOthers(excludeCreatedBy string) ([]*models.Account, error)
	FindAccountForDeactivation(username, site string) (*models.Account, error)
	FindAccountForEdit(username, site string) (*models.Account, error)
	// New is_personal based methods
	GetPersonalAccounts() ([]*models.Account, error)
	GetOthersAccounts() ([]*models.Account, error)
}

// SetupAPIRoutes configura tutte le rotte API
func SetupAPIRoutes(router *gin.Engine, dbManager DBManager) {
	// Abilita CORS per frontend separato
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*") // In produzione: specifica il dominio del frontend
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Servi solo file media e risorse backend
	router.Static("/images", "./Immagini")
	router.Static("/profile-images/users", "./ProfileImages/Users")
	router.Static("/profile-images/groups", "./ProfileImages/Groups")
	router.Static("/audio", "./Messaggi Vocali")
	router.Static("/media/images", "./MediaFiles/Images")
	router.Static("/media/videos", "./MediaFiles/Videos")
	router.Static("/media/audio", "./MediaFiles/Audio")
	router.Static("/media/documents", "./MediaFiles/Documents")

	// API per ottenere le ultime chat
	router.GET("/api/chats", func(c *gin.Context) {
		fmt.Println("Richiesta API /api/chats ricevuta")

		// Carica le chat dal database
		chatList, err := dbManager.LoadChats()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento delle chat: %v", err)})
			return
		}

		// Per ogni chat, carica l'ultimo messaggio delle ultime 2 ore
		twoHoursAgo := time.Now().Add(-2 * time.Hour)
		for _, chat := range chatList {
			dbMessagesSlice, err := dbManager.LoadRecentChatMessages(chat.ID, twoHoursAgo)
			if err != nil {
				// Logga l'errore ma continua, così la chat viene comunque listata
				fmt.Printf("Errore nel caricamento dei messaggi recenti per la chat %s: %v\n", chat.ID, err)
				// Assicurati che chat.Messages sia vuoto se ci sono stati errori o non ci sono messaggi
				chat.Messages = []models.Message{}
				continue
			}

			// Converti []models.Message in []*models.Message per la logica successiva, se necessario,
			// o adatta la logica successiva per usare []models.Message.
			// Per ora, assumiamo che dbMessages debba essere []*models.Message per compatibilità con il codice esistente.
			// Tuttavia, LoadRecentChatMessages ora restituisce []models.Message, quindi dobbiamo adattare.
			// La conversione diretta a []*models.Message non è necessaria se la logica sottostante può gestire []models.Message.
			// Il codice originale usava dbMessages []*models.Message, quindi se LoadRecentChatMessages restituisce
			// []models.Message, dobbiamo assicurarci che il resto del codice sia coerente.
			// Per semplicità, modifichiamo la variabile per riflettere il tipo restituito.
			
			// dbMessagesSlice è di tipo []*models.Message come da interfaccia DBManager
			// dbMessages sarà una copia di dbMessagesSlice per permettere l'ordinamento senza modificare l'originale (se necessario)
			dbMessages := make([]*models.Message, len(dbMessagesSlice))
			for i := range dbMessagesSlice {
				dbMessages[i] = dbMessagesSlice[i] // Corretto: dbMessagesSlice[i] è già *models.Message
			}


			if len(dbMessages) > 0 {
				// Ordina i messaggi per timestamp (più recente prima)
				sort.Slice(dbMessages, func(i, j int) bool {
					return dbMessages[i].Timestamp.After(dbMessages[j].Timestamp)
				})

				chat.LastMessage = *dbMessages[0]
				// Il campo Messages non viene popolato qui per ridurre il payload della risposta /api/chats.
				// I messaggi completi verranno caricati dal frontend on-demand 
				// utilizzando l'endpoint /api/chats/:id/messages.
				chat.Messages = []models.Message{}
			} else {
				// Anche se non ci sono messaggi recenti, assicurati che il campo Messages sia un array vuoto.
				// LastMessage rimarrà il suo valore zero (o quello precedentemente caricato se applicabile).
				chat.Messages = []models.Message{}
			}
		}

		// Ordina le chat per timestamp dell'ultimo messaggio (più recente prima)
		sort.Slice(chatList, func(i, j int) bool {
			// Verifica che entrambe le chat abbiano un ultimo messaggio
			if chatList[i].LastMessage.Timestamp.IsZero() {
				return false // Chat senza ultimi messaggi vanno in fondo
			}
			if chatList[j].LastMessage.Timestamp.IsZero() {
				return true // Se l'altra chat non ha ultimi messaggi, questa viene prima
			}
			return chatList[i].LastMessage.Timestamp.After(chatList[j].LastMessage.Timestamp)
		})

		c.JSON(http.StatusOK, chatList)
	})

	// API per ottenere i messaggi di una chat specifica
	router.GET("/api/chats/:id/messages", func(c *gin.Context) {
		chatID := c.Param("id")

		// Limita i messaggi alle ultime 2 ore
		twoHoursAgo := time.Now().Add(-2 * time.Hour)
		
		// Carica i messaggi dal database (solo ultimi 2 ore)
		dbMessages, err := dbManager.LoadRecentChatMessages(chatID, twoHoursAgo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento dei messaggi: %v", err)})
			return
		}

		if len(dbMessages) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata o nessun messaggio nelle ultime 2 ore"})
			return
		}

		c.JSON(http.StatusOK, dbMessages)
	})

	// API per ottenere l'immagine del profilo di una chat
	router.GET("/api/chats/:id/profile-image", func(c *gin.Context) {
		chatID := c.Param("id")

		// Carica la chat dal database
		chats, err := dbManager.LoadChats() // Potrebbe essere ottimizzato per caricare solo la chat specifica
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento delle chat: %v", err)})
			return
		}

		var chat *models.Chat
		for _, ch := range chats {
			if ch.ID == chatID {
				chat = ch
				break
			}
		}

		if chat == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata"})
			return
		}

		jID, err := types.ParseJID(chatID) // chatID should be a JID string for profile picture
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "JID non valido per la chat"})
			return
		}

		isGroup := jID.Server == types.GroupServer
		profilePath, err := whatsapp.DownloadProfilePicture(whatsapp.WhatsmeowClient, jID, isGroup)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": fmt.Sprintf("Impossibile scaricare l'immagine del profilo: %v", err),
			})
			return
		}

		// Aggiorna l'immagine del profilo nel database
		chat.ProfileImage = profilePath
		if err := dbManager.SaveChat(chat); err != nil {
			fmt.Printf("Errore nell'aggiornamento dell'immagine del profilo: %v\n", err)
		}

		c.JSON(http.StatusOK, gin.H{
			"profileImage": profilePath,
		})
	})

	// API per marcare i messaggi come letti
	router.POST("/api/chats/:id/mark-read", func(c *gin.Context) {
		chatIDStr := c.Param("id")

		var requestData struct {
			MessageIDs []string `json:"messageIds"`
		}

		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}

		if len(requestData.MessageIDs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Nessun ID messaggio fornito"})
			return
		}

		chatJID, err := types.ParseJID(chatIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("JID della chat non valido: %v", err)})
			return
		}

		var mIDs []types.MessageID
		for _, idStr := range requestData.MessageIDs {
			mIDs = append(mIDs, types.MessageID(idStr))
		}

		if whatsapp.WhatsmeowClient == nil || whatsapp.WhatsmeowClient.Store == nil || whatsapp.WhatsmeowClient.Store.ID == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Client WhatsApp non inizializzato o JID del client non disponibile"})
			return
		}
		senderJID := *whatsapp.WhatsmeowClient.Store.ID

		err = whatsapp.WhatsmeowClient.MarkRead(mIDs, time.Now(), chatJID, senderJID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel segnare i messaggi come letti: %v", err)})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": fmt.Sprintf("%d messaggi segnati come letti", len(requestData.MessageIDs)),
		})
	})

	// API per inviare un messaggio
	router.POST("/api/chats/:id/send", func(c *gin.Context) {
		chatIDStr := c.Param("id")
		ctx := context.Background()

		chatJID, err := types.ParseJID(chatIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("JID della chat non valido: %v", err)})
			return
		}

		file, header, err := c.Request.FormFile("image")
		if err == nil {
			defer file.Close()

			imgData, err := io.ReadAll(file)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nella lettura dell'immagine: %v", err)})
				return
			}

			mimeType := header.Header.Get("Content-Type")
			var waMediaType whatsmeow.MediaType
			if mimeType == "image/jpeg" || mimeType == "image/png" || mimeType == "image/gif" {
				waMediaType = whatsmeow.MediaImage
			} else {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Tipo di immagine non supportato"})
				return
			}

			resp, err := whatsapp.WhatsmeowClient.Upload(ctx, imgData, waMediaType)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'upload dell'immagine: %v", err)})
				return
			}

			caption := c.PostForm("text")
			msg := &waE2E.Message{
				ImageMessage: &waE2E.ImageMessage{
					URL:           proto.String(resp.URL),
					DirectPath:    proto.String(resp.DirectPath),
					MediaKey:      resp.MediaKey,
					Mimetype:      proto.String(mimeType),
					Caption:       proto.String(caption),
					FileEncSHA256: resp.FileEncSHA256,
					FileSHA256:    resp.FileSHA256,
					FileLength:    proto.Uint64(resp.FileLength),
				},
			}

			_, err = whatsapp.WhatsmeowClient.SendMessage(ctx, chatJID, msg)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'invio del messaggio con immagine: %v", err)})
				return
			}
		} else {
			text := c.PostForm("text")
			if text == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Il testo del messaggio non può essere vuoto"})
				return
			}
			msg := &waE2E.Message{
				Conversation: proto.String(text),
			}

			_, err = whatsapp.WhatsmeowClient.SendMessage(ctx, chatJID, msg)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'invio del messaggio: %v", err)})
				return
			}
		}

		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Messaggio inviato"})
	})

	// WebSocket endpoint
	router.GET("/ws", func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			fmt.Println("Errore nell'upgrade WebSocket:", err)
			return
		}
		defer conn.Close()

		addWSClient(conn)
		defer removeWSClient(conn)

		var currentStatus string
		if whatsapp.WhatsmeowClient != nil && whatsapp.WhatsmeowClient.IsConnected() {
			currentStatus = "connected"
		} else if whatsapp.WhatsmeowClient != nil && whatsapp.WhatsmeowClient.IsLoggedIn() {
			currentStatus = "logged_in_not_connected"
		} else {
			currentStatus = "disconnected"
		}
		err = conn.WriteJSON(models.WSMessage{Type: "whatsapp_status", Payload: currentStatus})
		if err != nil {
		    fmt.Printf("Errore nell'invio dello stato iniziale al WebSocket: %v\n", err)
		}

		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	})

	// API endpoints per i reminder
	
	// GET /api/chats/:id/reminders - Ottieni tutti i reminder per una chat
	router.GET("/api/chats/:id/reminders", func(c *gin.Context) {
		chatID := c.Param("id")
		
		reminders, err := dbManager.GetChatReminders(chatID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento dei reminder: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, reminders)
	})
	
	// POST /api/chats/:id/reminders - Crea un nuovo reminder per una chat
	router.POST("/api/chats/:id/reminders", func(c *gin.Context) {
		chatID := c.Param("id")
		
		var reminderData struct {
			Message       string    `json:"message" binding:"required"`
			ScheduledTime time.Time `json:"scheduled_time" binding:"required"`
			CreatedBy     string    `json:"created_by"`
		}
		
		if err := c.BindJSON(&reminderData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido o dati mancanti"})
			return
		}
		
		// Carica la chat per ottenere il nome
		chats, err := dbManager.LoadChats()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento delle chat: %v", err)})
			return
		}
		
		var chatName string
		for _, chat := range chats {
			if chat.ID == chatID {
				chatName = chat.Name
				break
			}
		}
		
		if chatName == "" {
			chatName = "Chat sconosciuta" // Fallback se la chat non viene trovata
		}
		
		// Crea il nuovo reminder
		reminder := &models.Reminder{
			ChatID:        chatID,
			ChatName:      chatName,
			Message:       reminderData.Message,
			ScheduledTime: reminderData.ScheduledTime,
			CreatedAt:     time.Now(),
			CreatedBy:     reminderData.CreatedBy,
			IsFired:       false,
		}
		
		if err := dbManager.SaveReminder(reminder); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel salvataggio del reminder: %v", err)})
			return
		}
		
		c.JSON(http.StatusCreated, reminder)
	})
	
	// PUT /api/reminders/:id - Aggiorna un reminder esistente
	router.PUT("/api/reminders/:id", func(c *gin.Context) {
		reminderID := c.Param("id")
		
		// Ottieni il reminder esistente
		existingReminder, err := dbManager.GetReminderByID(reminderID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Reminder non trovato: %v", err)})
			return
		}
		
		var reminderData struct {
			Message       string    `json:"message"`
			ScheduledTime time.Time `json:"scheduled_time"`
		}
		
		if err := c.BindJSON(&reminderData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		// Aggiorna i campi modificabili
		if reminderData.Message != "" {
			existingReminder.Message = reminderData.Message
		}
		
		if !reminderData.ScheduledTime.IsZero() {
			existingReminder.ScheduledTime = reminderData.ScheduledTime
		}
		
		// Salva le modifiche
		if err := dbManager.UpdateReminder(existingReminder); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'aggiornamento del reminder: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, existingReminder)
	})
	
	// DELETE /api/reminders/:id - Elimina un reminder
	router.DELETE("/api/reminders/:id", func(c *gin.Context) {
		reminderID := c.Param("id")
		
		if err := dbManager.DeleteReminder(reminderID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'eliminazione del reminder: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Reminder eliminato con successo"})
	})
}

func addWSClient(conn *websocket.Conn) {
	wsClientsMux.Lock()
	wsClients[conn] = true
	atomic.AddInt32(&wsClientCount, 1)
	wsClientsMux.Unlock()
	fmt.Printf("Client WebSocket connesso. Totale connessi: %d\n", atomic.LoadInt32(&wsClientCount))
}

func removeWSClient(conn *websocket.Conn) {
	wsClientsMux.Lock()
	if _, ok := wsClients[conn]; ok {
		delete(wsClients, conn)
		atomic.AddInt32(&wsClientCount, -1)
		fmt.Printf("Client WebSocket disconnesso. Totale connessi: %d\n", atomic.LoadInt32(&wsClientCount))
	}
	wsClientsMux.Unlock()
}

// BroadcastMessageToClients invia un messaggio a tutti i client WebSocket connessi.
func BroadcastMessageToClients(messageType string, payload interface{}) {
	wsClientsMux.Lock()
	defer wsClientsMux.Unlock()

	if len(wsClients) == 0 {
		return
	}

	wsMessage := models.WSMessage{
		Type:    messageType,
		Payload: payload,
	}

	messageJSON, err := json.Marshal(wsMessage)
	if err != nil {
		fmt.Println("Errore nella serializzazione del messaggio WebSocket:", err)
		return
	}

	var clientsToRemove []*websocket.Conn

	for client := range wsClients {
		err := client.WriteMessage(websocket.TextMessage, messageJSON)
		if err != nil {
			fmt.Println("Errore nell'invio del messaggio WebSocket:", err)
			clientsToRemove = append(clientsToRemove, client)
		}
	}

	for _, client := range clientsToRemove {
		client.Close()
		delete(wsClients, client)
		atomic.AddInt32(&wsClientCount, -1)
		fmt.Printf("Client WebSocket disconnesso (errore). Totale connessi: %d\n", atomic.LoadInt32(&wsClientCount))
	}
}
