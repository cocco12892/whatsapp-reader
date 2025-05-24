package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"whatsapp-reader/models"
	"whatsapp-reader/whatsapp"
)

// SetupAPIRoutes configura tutte le rotte API
func SetupAPIRoutes(router *gin.Engine, dbManager DBManager) {
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
		
		// Carica le chat dal database
		chatList, err := dbManager.LoadChats()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento delle chat: %v", err)})
			return
		}
		
		// Per ogni chat, carica l'ultimo messaggio
		for _, chat := range chatList {
			dbMessages, err := dbManager.LoadChatMessages(chat.ID)
			if err != nil {
				continue
			}
			
			if len(dbMessages) > 0 {
				// Ordina i messaggi per timestamp (più recente prima)
				sort.Slice(dbMessages, func(i, j int) bool {
					return dbMessages[i].Timestamp.After(dbMessages[j].Timestamp)
				})
				
				chat.LastMessage = dbMessages[0]
				chat.Messages = dbMessages
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
		
		// Carica i messaggi dal database
		dbMessages, err := dbManager.LoadChatMessages(chatID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento dei messaggi: %v", err)})
			return
		}
		
		if len(dbMessages) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata o nessun messaggio"})
			return
		}
		
		c.JSON(http.StatusOK, dbMessages)
	})

	// API per ottenere l'immagine del profilo di una chat
	router.GET("/api/chats/:id/profile-image", func(c *gin.Context) {
		chatID := c.Param("id")
		
		// Carica la chat dal database
		chats, err := dbManager.LoadChats()
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
		
		jid, err := whatsapp.ParseJID(chatID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "JID non valido"})
			return
		}
		
		isGroup := jid.Server == "g.us"
		profilePath, err := whatsapp.DownloadProfilePicture(jid, isGroup)
		
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
		chatID := c.Param("id")
		
		var requestData struct {
			MessageIDs []string `json:"messageIds"` // Array di ID dei messaggi da segnare come letti
		}
		
		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		if len(requestData.MessageIDs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Nessun ID messaggio fornito"})
			return
		}
		
		err := whatsapp.MarkMessagesAsRead(chatID, requestData.MessageIDs, dbManager)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel segnare i messaggi come letti: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"message": fmt.Sprintf("%d messaggi segnati come letti", len(requestData.MessageIDs)),
		})
	})

	// API per inviare un messaggio
	router.POST("/api/chats/:id/send", func(c *gin.Context) {
		chatID := c.Param("id")
		
		// Verifica se la richiesta contiene un'immagine
		file, header, err := c.Request.FormFile("image")
		if err == nil {
			// Caricamento immagine
			defer file.Close()
			
			// Ottieni la didascalia se presente
			caption := c.PostForm("caption")
			
			message, err := whatsapp.SendImageMessage(chatID, file, header, caption, dbManager)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'invio dell'immagine: %v", err)})
				return
			}
			
			c.JSON(http.StatusOK, gin.H{
				"status": "success",
				"message": "Immagine inviata con successo",
				"timestamp": message.Timestamp,
				"messageData": message,
			})
			return
		}
		
		// Se non è un'immagine, procedi con il normale invio di messaggio di testo
		var requestData struct {
			Content string `json:"content"` 
			IsReply bool   `json:"isReply"`
			ReplyToMessageID string `json:"replyToMessageId"`
		}
		
		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		if requestData.Content == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Contenuto del messaggio vuoto"})
			return
		}
		
		message, err := whatsapp.SendTextMessage(chatID, requestData.Content, requestData.IsReply, requestData.ReplyToMessageID, dbManager)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'invio del messaggio: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"message": "Messaggio inviato con successo",
			"timestamp": message.Timestamp,
			"messageData": message,
		})
	})
	
	// API per gestire i sinonimi delle chat
	router.GET("/api/chats/:id/synonym", func(c *gin.Context) {
		chatID := c.Param("id")
		
		// Carica tutti i sinonimi
		synonyms, err := dbManager.LoadChatSynonyms()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento dei sinonimi: %v", err)})
			return
		}
		
		synonym, exists := synonyms[chatID]
		if !exists {
			c.JSON(http.StatusOK, gin.H{"synonym": ""})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"synonym": synonym})
	})
	
	router.POST("/api/chats/:id/synonym", func(c *gin.Context) {
		chatID := c.Param("id")
		
		var requestData struct {
			Synonym string `json:"synonym"`
		}
		
		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		// Salva il sinonimo nel database
		if err := dbManager.SaveChatSynonym(chatID, requestData.Synonym); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel salvataggio del sinonimo: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})
	
	router.DELETE("/api/chats/:id/synonym", func(c *gin.Context) {
		chatID := c.Param("id")
		
		// Rimuovi il sinonimo dal database (imposta a stringa vuota)
		if err := dbManager.SaveChatSynonym(chatID, ""); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nella rimozione del sinonimo: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})

	// API per le note dei messaggi
	router.GET("/api/messages/:id/note", func(c *gin.Context) {
		messageID := c.Param("id")
		
		// Carica la nota dal database
		note, err := dbManager.LoadMessageNote(messageID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Nota non trovata: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, note)
	})
	
	router.GET("/api/message-notes", func(c *gin.Context) {
		// Carica tutte le note dei messaggi
		notes, err := dbManager.LoadMessageNotes()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento delle note: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, notes)
	})
	
	// API per ottenere tutte le note (alias di message-notes per compatibilità)
	router.GET("/api/notes", func(c *gin.Context) {
		// Carica tutte le note dei messaggi
		notes, err := dbManager.LoadMessageNotes()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento delle note: %v", err)})
			return
		}
		
		// Converti in array per compatibilità con il frontend
		notesArray := make([]interface{}, 0, len(notes))
		for _, note := range notes {
			notesArray = append(notesArray, note)
		}
		
		c.JSON(http.StatusOK, notesArray)
	})
	
	router.POST("/api/messages/:id/note", func(c *gin.Context) {
		messageID := c.Param("id")
		
		var requestData struct {
			Note      string `json:"note"`
			Type      string `json:"type"`
			ChatID    string `json:"chatId"`
			ChatName  string `json:"chatName"`
			AddedAt   string `json:"addedAt"`
			FromDuplicateGroup bool `json:"fromDuplicateGroup"`
			GroupId   string `json:"groupId"`
			ImageHash string `json:"imageHash"`
		}
		
		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		// Converti la data in time.Time
		addedAt, err := time.Parse(time.RFC3339, requestData.AddedAt)
		if err != nil {
			addedAt = time.Now()
		}
		
		// Crea l'oggetto nota
		noteData := &models.MessageNote{
			MessageID: messageID,
			Note:      requestData.Note,
			Type:      requestData.Type,
			ChatID:    requestData.ChatID,
			ChatName:  requestData.ChatName,
			AddedAt:   addedAt,
		}
		
		// Salva la nota nel database
		if err := dbManager.SaveMessageNote(messageID, noteData); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel salvataggio della nota: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success", "note": noteData})
	})
	
	// Endpoint PUT per aggiornare una nota esistente (per compatibilità)
	router.PUT("/api/messages/:id/note", func(c *gin.Context) {
		messageID := c.Param("id")
		
		var requestData struct {
			Note      string `json:"note"`
			Type      string `json:"type"`
			ChatID    string `json:"chatId"`
			ChatName  string `json:"chatName"`
			AddedAt   string `json:"addedAt"`
			FromDuplicateGroup bool `json:"fromDuplicateGroup"`
			GroupId   string `json:"groupId"`
			ImageHash string `json:"imageHash"`
		}
		
		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		// Converti la data in time.Time
		addedAt, err := time.Parse(time.RFC3339, requestData.AddedAt)
		if err != nil {
			addedAt = time.Now()
		}
		
		// Crea l'oggetto nota
		noteData := &models.MessageNote{
			MessageID: messageID,
			Note:      requestData.Note,
			Type:      requestData.Type,
			ChatID:    requestData.ChatID,
			ChatName:  requestData.ChatName,
			AddedAt:   addedAt,
		}
		
		// Salva la nota nel database (stessa funzione di POST)
		if err := dbManager.SaveMessageNote(messageID, noteData); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'aggiornamento della nota: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success", "note": noteData})
	})
	
	router.DELETE("/api/messages/:id/note", func(c *gin.Context) {
		messageID := c.Param("id")
		
		// Soft delete della nota dal database
		if err := dbManager.SoftDeleteMessageNote(messageID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nella rimozione della nota: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})
	
	// API per eliminare una nota (alias per compatibilità)
	router.DELETE("/api/notes/:id", func(c *gin.Context) {
		messageID := c.Param("id")
		
		// Soft delete della nota dal database
		if err := dbManager.SoftDeleteMessageNote(messageID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nella rimozione della nota: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})
	
	// API per i dati registrati
	router.GET("/api/recorded-data", func(c *gin.Context) {
		// Carica tutti i dati registrati dal database
		recordedData, err := dbManager.LoadAllRecordedData()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento dei dati registrati: %v", err)})
			return
		}
		c.JSON(http.StatusOK, recordedData)
	})
	
	// API per ottenere un dato registrato specifico
	router.GET("/api/recorded-data/:id", func(c *gin.Context) {
		messageID := c.Param("id")
		
		// Carica il dato registrato dal database
		recordedData, err := dbManager.LoadRecordedData(messageID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Dato registrato non trovato: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, recordedData)
	})
	
	// API per ottenere tutti i dati registrati di una chat
	router.GET("/api/recorded-data/chat/:id", func(c *gin.Context) {
		chatID := c.Param("id")
		
		// Carica i dati registrati per la chat dal database
		recordedData, err := dbManager.LoadChatRecordedData(chatID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento dei dati registrati: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, recordedData)
	})
	
	// API per salvare un dato registrato
	router.POST("/api/recorded-data/:id", func(c *gin.Context) {
		messageID := c.Param("id")
		
		var requestData models.RecordedData
		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		// Assicurati che l'ID del messaggio sia corretto
		requestData.MessageID = messageID
		
		// Salva il dato registrato nel database
		if err := dbManager.SaveRecordedData(&requestData); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel salvataggio del dato registrato: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": requestData})
	})
	
	// API per aggiornare un dato registrato
	router.PUT("/api/recorded-data/:id", func(c *gin.Context) {
		messageID := c.Param("id")
		
		var requestData models.RecordedData
		if err := c.BindJSON(&requestData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Formato JSON non valido"})
			return
		}
		
		// Assicurati che l'ID del messaggio sia corretto
		requestData.MessageID = messageID
		
		// Aggiorna il dato registrato nel database
		if err := dbManager.UpdateRecordedData(&requestData); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'aggiornamento del dato registrato: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": requestData})
	})
	
	// API per eliminare un dato registrato
	router.DELETE("/api/recorded-data/:id", func(c *gin.Context) {
		messageID := c.Param("id")
		
		// Elimina il dato registrato dal database
		if err := dbManager.DeleteRecordedData(messageID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'eliminazione del dato registrato: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})

	// Endpoint di test
	router.GET("/api/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"message": "Il backend funziona correttamente",
		})
	})
}
