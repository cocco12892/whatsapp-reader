package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/go-sql-driver/mysql"
	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3"
	"github.com/mdp/qrterminal/v3"
	"github.com/rs/zerolog"
	"go.mau.fi/libsignal/logger"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/waproto"
	"google.golang.org/protobuf/proto as protoV2"
	"whatsapp-reader/db"
	"whatsapp-reader/handlers"
	"whatsapp-reader/models"
	"whatsapp-reader/utils"
	"whatsapp-reader/whatsapp"
)

var (
	dbManager      *db.MySQLManager
	wsClients      = make(map[*websocket.Conn]bool)
	wsClientsMux   sync.Mutex
	wsClientCount  int32
	groupNameCache sync.Map // Cache per i nomi dei gruppi
	contactNameCache sync.Map // Cache per i nomi dei contatti
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

// Funzione per inviare un messaggio a tutti i client WebSocket
func broadcastToClients(messageType string, payload interface{}) {
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

// Funzione per creare una giocata AI tramite API
func createGiocataAI(message *models.Message, chatJID string, messageID string) {
	fmt.Printf("Creazione giocata AI per messaggio: %s\n", messageID)
	
	requestData := models.GiocataAIRequest{
		SaleRivenditoreID: 456, // Valore predefinito
		APIKey:            "betste_secret_key",
	}
	
	if message.IsMedia && message.MediaPath != "" {
		fullPath := "." + message.MediaPath
		fmt.Printf("Tentativo di leggere l'immagine da: %s\n", fullPath)
		
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			fmt.Printf("ERRORE: Il file immagine non esiste: %s\n", fullPath)
			
			alternativePaths := []string{
				message.MediaPath,
				strings.TrimPrefix(message.MediaPath, "/"),
				"Immagini" + message.MediaPath,
				"./Immagini" + strings.TrimPrefix(message.MediaPath, "/images"),
			}
			
			var found bool
			for _, altPath := range alternativePaths {
				fmt.Printf("Provo percorso alternativo: %s\n", altPath)
				if _, err := os.Stat(altPath); !os.IsNotExist(err) {
					fullPath = altPath
					found = true
					fmt.Printf("Trovato file immagine in percorso alternativo: %s\n", fullPath)
					break
				}
			}
			
			if !found {
				fmt.Printf("ERRORE DEFINITIVO: Impossibile trovare il file immagine dopo aver provato percorsi alternativi.\n")
				return
			}
		}
		
		imgBytes, err := os.ReadFile(fullPath)
		if err != nil {
			fmt.Printf("Errore nella lettura del file immagine: %v\n", err)
			return
		}
		requestData.Media = base64.StdEncoding.EncodeToString(imgBytes)
		requestData.MediaType = http.DetectContentType(imgBytes)
	}
	
	requestData.Timestamp = message.Timestamp.Format(time.RFC3339)
	requestData.MessageID = messageID
	requestData.PushName = message.SenderName
	requestData.ChatJID = chatJID
	requestData.Testo = message.Text
	
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		fmt.Printf("Errore nella serializzazione JSON: %v\n", err)
		return
	}
	
	resp, err := http.Post("https://betscore.it/api/giocata_ai", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Errore nell'invio della richiesta API: %v\n", err)
		return
	}
	defer resp.Body.Close()
	
	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Risposta API Giocata AI: %s\n", string(body))
	
	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Errore nella risposta API: %d %s\n", resp.StatusCode, string(body))
	}
}

func createCodiceGiocata(message models.Message, nota string) {
	fmt.Printf("Creazione codice giocata per messaggio: %s\n", message.ID)
	
	requestData := models.CreateCodiceGiocataRequest{
		SaleRivenditoreID: 456, // Valore predefinito
		APIKey:            "betste_secret_key",
		Codice:            message.Text, // Il testo del messaggio è il codice
		Nota:              nota,
		PushName:          message.SenderName,
		ChatJID:           message.ChatJID,
		MessageID:         message.ID,
		Timestamp:         message.Timestamp.Format(time.RFC3339),
	}
	
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		fmt.Printf("Errore nella serializzazione JSON per codice giocata: %v\n", err)
		return
	}
	
	apiURL := "https://betscore.it/api/create_codice_giocata"
	resp, err := http.Post(apiURL, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Errore nell'invio della richiesta API per codice giocata: %v\n", err)
		return
	}
	defer resp.Body.Close()
	
	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Risposta API Create Codice Giocata: %s\n", string(body))
	
	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Errore nella risposta API per codice giocata: %d %s\n", resp.StatusCode, string(body))
	} else {
		// Invia conferma di successo a WhatsApp
		go func() {
			time.Sleep(2 * time.Second) // Attendi un paio di secondi per dare tempo al server di elaborare
			confirmMsg := fmt.Sprintf("Automazione creata con successo per il codice: %s", message.Text)
			targetJID, _ := types.ParseJID(message.ChatJID)
			msg := &waproto.Message{
				Conversation: proto.String(confirmMsg),
			}
			_, err := whatsapp.WhatsmeowClient.SendMessage(context.Background(), targetJID, msg)
			if err != nil {
				fmt.Printf("Errore nell'invio del messaggio di conferma a WhatsApp: %v\n", err)
			}
		}()
	}
}

func processMessageForAutomation(msgText string, message models.Message) {
	fmt.Printf("Processing message for automation: ID=%s, Text='%s'\n", message.ID, msgText)
	
	r := regexp.MustCompile(`(?i)nota\s*:\s*(.+)`)
	matches := r.FindStringSubmatch(msgText)
	
	var nota string
	textToProcess := msgText
	if len(matches) > 1 {
		nota = strings.TrimSpace(matches[1])
		textToProcess = strings.TrimSpace(r.ReplaceAllString(msgText, ""))
		fmt.Printf("Nota estratta: '%s', Testo rimanente: '%s'\n", nota, textToProcess)
	}
	
	message.Text = textToProcess // Aggiorna il testo del messaggio senza la nota
	
	if utils.IsCodiceGiocata(textToProcess) {
		fmt.Printf("Il messaggio '%s' è un codice giocata.\n", textToProcess)
		// Verifica se il messaggio è stato inviato da un operatore (controlla il numero di telefono)
		if utils.IsOperatorNumber(message.SenderJID) {
			fmt.Printf("Messaggio da operatore, creo codice giocata con nota: '%s'\n", nota)
			createCodiceGiocata(message, nota)
		} else {
			fmt.Println("Messaggio non da operatore, non creo codice giocata.")
		}
	} else if strings.HasPrefix(strings.ToLower(textToProcess), "screenshot") || message.IsMedia {
		fmt.Printf("Il messaggio '%s' è uno screenshot o media.\n", textToProcess)
		// Verifica se il messaggio è stato inviato da un operatore
		if utils.IsOperatorNumber(message.SenderJID) {
			fmt.Println("Messaggio da operatore, creo giocata AI.")
			createGiocataAI(&message, message.ChatJID, message.ID)
		} else {
			fmt.Println("Messaggio non da operatore, non creo giocata AI.")
		}
	} else {
		fmt.Printf("Il messaggio '%s' non corrisponde a nessun pattern di automazione.\n", textToProcess)
	}
}

func eventHandler(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		handleNewMessage(v)
	case *events.Receipt:
		handleReceipt(v)
	case *events.HistorySync:
		handleHistorySync(v)
	case *events.Connected:
		fmt.Println("Connesso a WhatsApp")
		broadcastToClients("whatsapp_status", "connected")
	case *events.Disconnected:
		fmt.Println("Disconnesso da WhatsApp")
		broadcastToClients("whatsapp_status", "disconnected")
	case *events.LoggedOut:
		fmt.Println("Sloggato, per favore scansiona nuovamente il QR code")
		// Potrebbe essere necessario gestire la pulizia dei dati del client qui
		// e richiedere una nuova scansione del QR.
		broadcastToClients("whatsapp_status", "logged_out")
		//TODO: Aggiungere un modo per far sì che il frontend mostri di nuovo il QR
		// Potrebbe essere necessario terminare l'applicazione o gestire un flag
	case *events.PairSuccess:
		fmt.Printf("Accoppiato con successo con %s (%s)\n", v.ID, v.BusinessName)
	case *events.StreamReplaced:
		fmt.Println("Stream rimpiazzato. Il client precedente è stato disconnesso.")
	case *events.OfflineSyncCompleted:
		fmt.Printf("Sincronizzazione offline completata: %d messaggi, %d chat\n", v.Messages, v.Chats)
	case *events.ChatPresence:
		fmt.Printf("Presenza nella chat %s: Stato=%s, Media=%v\n", v.JID, v.State, v.Media)
	case *events.UserPresence:
		fmt.Printf("Presenza utente %s: Disponibile=%v, UltimaAttività=%v\n", v.JID, v.Available, v.LastSeen)
	case *events.CallOffer, *events.CallAccept, *events.CallTerminate, *events.CallOfferNotice, *events.CallRelayLatency:
		// Non gestiamo le chiamate attivamente, ma potremmo loggarle se necessario
		fmt.Printf("Evento chiamata ricevuto: %T\n", v)
	case *events.PrivacySettings:
		fmt.Printf("Impostazioni privacy aggiornate: %+v\n", v)
	default:
		// fmt.Printf("Evento non gestito: %T\n", v) // Loggare solo se necessario per il debug
	}
}

func handleNewMessage(m *events.Message) {
	fmt.Printf("Nuovo messaggio ricevuto: %+v\n", m.Message)
	
	var chatJID string
	var senderJID string
	var senderName string
	var chatName string
	var isGroup bool
	
	// Determina se il messaggio è da un gruppo o da un utente singolo
	if m.Info.IsGroup {
		chatJID = m.Info.Chat.String() // JID del gruppo
		senderJID = m.Info.Sender.String() // JID del mittente effettivo nel gruppo
		groupInfo, err := whatsapp.WhatsmeowClient.GetGroupInfo(m.Info.Chat)
		if err != nil {
			chatName = m.Info.Chat.User // Usa l'ID del gruppo se il nome non è disponibile
		} else {
			chatName = groupInfo.Name
		}
		senderName = getContactName(whatsapp.WhatsmeowClient, m.Info.Sender) // Nome del mittente nel gruppo
		isGroup = true
	} else {
		chatJID = m.Info.Chat.String()     // JID della chat (uguale al mittente per chat singole)
		senderJID = m.Info.Sender.String() // JID del mittente
		chatName = getContactName(whatsapp.WhatsmeowClient, m.Info.Chat) // Nome del contatto della chat
		senderName = chatName // Nelle chat singole, il nome del mittente è il nome della chat
		isGroup = false
	}
	
	// Se il client non è inizializzato o non è connesso, non fare nulla
	if whatsapp.WhatsmeowClient == nil || !whatsapp.WhatsmeowClient.IsConnected() {
		fmt.Println("Cliente non connesso, messaggio ignorato.")
		return
	}
	
	// Prepara il messaggio per il salvataggio nel DB e l'invio via WebSocket
	dbMessage := models.Message{
		ID:         m.Info.ID,
		ChatJID:    chatJID,
		SenderJID:  senderJID,
		SenderName: senderName,
		Timestamp:  m.Info.Timestamp,
		IsFromMe:   m.Info.IsFromMe,
		IsGroup:    isGroup,
		ChatName:   chatName,
	}
	
	// Gestione diversi tipi di messaggio
	if m.Message.GetConversation() != "" {
		dbMessage.Text = m.Message.GetConversation()
	} else if extended := m.Message.GetExtendedTextMessage(); extended != nil {
		dbMessage.Text = extended.GetText()
		// Gestione del messaggio citato (quoted message)
		if extended.ContextInfo != nil && extended.ContextInfo.QuotedMessage != nil {
			dbMessage.QuotedMessage = &models.QuotedMessageInfo{
				ID: extended.ContextInfo.GetStanzaID(),
				// TODO: Potremmo voler recuperare il testo del messaggio citato dal DB se disponibile
				Text: "Messaggio citato (contenuto non mostrato)", // Placeholder
			}
			if extended.ContextInfo.GetParticipant() != "" {
				dbMessage.QuotedMessage.SenderJID = extended.ContextInfo.GetParticipant()
				dbMessage.QuotedMessage.SenderName = getContactName(whatsapp.WhatsmeowClient, types.NewJID(extended.ContextInfo.GetParticipant(), types.DefaultUserServer))
			}
		}
	} else if imageMsg := m.Message.GetImageMessage(); imageMsg != nil {
		dbMessage.Text = imageMsg.GetCaption()
		dbMessage.IsMedia = true
		dbMessage.MediaType = "image"
		go func() {
			imgData, err := whatsapp.WhatsmeowClient.Download(imageMsg)
			if err != nil {
				fmt.Printf("Errore nel download dell'immagine: %v\n", err)
				return
			}
			fileName := fmt.Sprintf("%s.jpg", m.Info.ID)
			filePath := filepath.Join("Immagini", fileName)
			if err := os.WriteFile(filePath, imgData, 0644); err != nil {
				fmt.Printf("Errore nel salvataggio dell'immagine: %v\n", err)
				return
			}
			dbMessage.MediaPath = "/images/" + fileName // Percorso web
			dbManager.SaveMessage(&dbMessage)            // Salva dopo aver ottenuto il MediaPath
			broadcastToClients("new_message", dbMessage) // Notifica i client
			processMessageForAutomation(dbMessage.Text, dbMessage) // Processa per automazione dopo aver salvato
		}()
		return // Il salvataggio e broadcast avvengono nella goroutine
	} else if audioMsg := m.Message.GetAudioMessage(); audioMsg != nil {
		dbMessage.IsMedia = true
		dbMessage.MediaType = "audio"
		dbMessage.Text = "Messaggio audio"
		go func() {
			audioData, err := whatsapp.WhatsmeowClient.Download(audioMsg)
			if err != nil {
				fmt.Printf("Errore nel download dell'audio: %v\n", err)
				return
			}
			ext := getAudioExtension(audioMsg.GetMimetype())
			fileName := fmt.Sprintf("%s.%s", m.Info.ID, ext)
			filePath := filepath.Join("Messaggi Vocali", fileName)
			if err := os.WriteFile(filePath, audioData, 0644); err != nil {
				fmt.Printf("Errore nel salvataggio dell'audio: %v\n", err)
				return
			}
			dbMessage.MediaPath = "/audio/" + fileName // Percorso web
			dbManager.SaveMessage(&dbMessage)
			broadcastToClients("new_message", dbMessage)
		}()
		return
	} else if videoMsg := m.Message.GetVideoMessage(); videoMsg != nil {
		dbMessage.Text = videoMsg.GetCaption()
		dbMessage.IsMedia = true
		dbMessage.MediaType = "video"
		// Simile gestione per i video, se necessario (download, salvataggio, etc.)
		// Per ora, logghiamo e salviamo solo le informazioni base
		fmt.Println("Messaggio video ricevuto, non gestito completamente.")
	} else if stickerMsg := m.Message.GetStickerMessage(); stickerMsg != nil {
		dbMessage.Text = "Sticker"
		dbMessage.IsMedia = true
		dbMessage.MediaType = "sticker"
		// Potremmo scaricare lo sticker se necessario
	} else if contactMsg := m.Message.GetContactMessage(); contactMsg != nil {
		dbMessage.Text = fmt.Sprintf("Contatto: %s", contactMsg.GetDisplayName())
	} else if locationMsg := m.Message.GetLocationMessage(); locationMsg != nil {
		dbMessage.Text = fmt.Sprintf("Posizione: Lat %f, Lon %f", locationMsg.GetDegreesLatitude(), locationMsg.GetDegreesLongitude())
	} else if liveLocationMsg := m.Message.GetLiveLocationMessage(); liveLocationMsg != nil {
		dbMessage.Text = "Posizione live (non supportata)"
	} else if documentMsg := m.Message.GetDocumentMessage(); documentMsg != nil {
		dbMessage.Text = fmt.Sprintf("Documento: %s", documentMsg.GetTitle())
		dbMessage.IsMedia = true
		dbMessage.MediaType = "document"
		// Simile gestione per i documenti (download, salvataggio, etc.)
		// Per ora, logghiamo e salviamo solo le informazioni base
		fmt.Println("Messaggio documento ricevuto, non gestito completamente.")
	} else if protocolMsg := m.Message.GetProtocolMessage(); protocolMsg != nil {
		typeName := getProtocolMessageTypeName(int(protocolMsg.GetType()))
		dbMessage.Text = fmt.Sprintf("Messaggio di protocollo: %s", typeName)
		dbMessage.IsSystem = true
		fmt.Printf("Protocol message type: %s, ID: %s\n", typeName, m.Info.ID)
		if protocolMsg.GetType() == proto.ProtocolMessage_REVOKE {
			fmt.Printf("Messaggio revocato con ID: %s nel chat %s\n", protocolMsg.GetKey().GetId(), chatJID)
			dbManager.DeleteMessage(protocolMsg.GetKey().GetId())
			broadcastToClients("message_deleted", map[string]string{"id": protocolMsg.GetKey().GetId(), "chatId": chatJID})
			return // Non salvare i messaggi di revoca come messaggi normali
		}
	} else if m.Message.GetEditedMessage() != nil {
		editedMsgProto := m.Message.GetEditedMessage()
		originalMsgID := editedMsgProto.GetMessage().GetProtocolMessage().GetKey().GetId()
		newText := editedMsgProto.GetMessage().GetConversation()
		fmt.Printf("Messaggio Modificato: OriginalID=%s, NuovoTesto='%s'\n", originalMsgID, newText)
		dbManager.UpdateMessageContent(originalMsgID, newText, time.Now())
		broadcastToClients("message_edited", map[string]string{
			"id":       originalMsgID,
			"chatId":   chatJID,
			"newText":  newText,
			"editedAt": time.Now().Format(time.RFC3339),
		})
		return // Messaggio editato gestito
	}
	
	// Salva il messaggio nel DB
	err := dbManager.SaveMessage(&dbMessage)
	if err != nil {
		fmt.Printf("Errore nel salvataggio del messaggio: %v\n", err)
		return
	}
	
	// Invia il messaggio ai client WebSocket connessi
	broadcastToClients("new_message", dbMessage)
	
	// Controlla se il messaggio è un codice giocata o uno screenshot e se è da un operatore
	// Questo viene fatto dopo aver salvato e trasmesso il messaggio base
	if !dbMessage.IsMedia { // Processa solo se non è media già gestito in goroutine
		processMessageForAutomation(dbMessage.Text, dbMessage)
	}
	
	// Se il messaggio non è da me e il client è connesso, segna come letto
	if !m.Info.IsFromMe && whatsapp.WhatsmeowClient.IsConnected() {
		// Crea il JID corretto per il mittente
		var participantJID types.JID
		if m.Info.IsGroup {
			participantJID = m.Info.Sender // JID del mittente effettivo nel gruppo
		} else {
			participantJID = m.Info.Chat // JID della chat (mittente)
		}
		
		// MarkRead richiede un array di MessageID e il JID del mittente del messaggio (non il JID della chat)
		// e il JID della chat.
		// Per i gruppi, il `sender` è il partecipante che ha inviato il messaggio.
		// Per le chat 1-a-1, il `sender` è lo stesso della chat JID.
		// Il client deve essere il destinatario del messaggio per segnarlo come letto.
		// L'API MarkRead sembra essere per i *propri* messaggi letti da altri, non per marcare i messaggi altrui come letti da te.
		// Per segnare un messaggio come letto *dal client corrente*, si usa SendReceipt con il tipo "read".
		
		// Invio ricevuta di lettura
		receipt := &types.Receipt{
			Type:      types.ReceiptTypeRead,
			MessageIDs: []string{m.Info.ID},
			Timestamp: time.Now(),
			ChatJID:   m.Info.Chat, // JID della chat in cui il messaggio è stato ricevuto
			// ParticipantJID non è necessario per le ricevute di lettura inviate dal client
			// ma è cruciale per le ricevute di consegna/lettura *ricevute* dal client
			// per sapere chi nel gruppo ha letto/ricevuto.
		}
		if m.Info.IsGroup {
			receipt.ParticipantJID = m.Info.Sender // JID del mittente del messaggio nel gruppo
		}
		
		err = whatsapp.WhatsmeowClient.SendReceipt(receipt)
		if err != nil {
			fmt.Printf("Errore nell'invio della ricevuta di lettura: %v\n", err)
		} else {
			fmt.Printf("Ricevuta di lettura inviata per messaggio %s\n", m.Info.ID)
			// Aggiorna lo stato del messaggio nel DB a 'read_by_me'
			dbManager.UpdateMessageStatus(m.Info.ID, "read_by_me")
			// Invia aggiornamento dello stato ai client WebSocket
			broadcastToClients("message_status_update", map[string]string{
				"id":     m.Info.ID,
				"status": "read_by_me",
			})
		}
	}
}

func handleReceipt(r *events.Receipt) {
	fmt.Printf("Ricevuta: %+v\n", r)
	status := "unknown"
	switch r.Type {
	case types.ReceiptTypeDelivered:
		status = "delivered"
	case types.ReceiptTypeRead:
		status = "read"
	case types.ReceiptTypePlayed:
		status = "played"
	default:
		fmt.Printf("Tipo di ricevuta non gestito: %s\n", r.Type)
		return
	}
	
	for _, id := range r.MessageIDs {
		dbManager.UpdateMessageStatus(id, status)
		// Invia aggiornamento dello stato ai client WebSocket
		broadcastToClients("message_status_update", map[string]string{
			"id":     id,
			"status": status,
			"chatId": r.ChatJID.String(), // Aggiungi chatId per identificare la chat nel frontend
		})
	}
}

func handleHistorySync(hs *events.HistorySync) {
	fmt.Printf("Sincronizzazione cronologia: %+v\n", hs)
	// Qui potresti voler salvare i messaggi sincronizzati nel tuo database
	// Iterare su hs.Messages e hs.Conversations
	for _, msg := range hs.Messages {
		handleNewMessage(&events.Message{Message: msg, Info: events.MessageInfo{ /* ... popola Info se necessario ... */ }})
	}
	// Potresti dover gestire le conversazioni (chat) anche qui
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	// Carica la configurazione
	cfg, err := utils.LoadConfig("config.json")
	if err != nil {
		log.Fatalf("Errore nel caricamento della configurazione: %v", err)
	}
	
	// Inizializza il logger di Whatsmeow
	logger.SetLogLevel("DEBUG") // Imposta il livello di log desiderato
	zerolog.SetGlobalLevel(zerolog.DebugLevel) // Imposta il livello di log globale per zerolog
	
	// Inizializza il database manager
	dbManager, err = db.NewMySQLManager(cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)
	if err != nil {
		log.Fatalf("Impossibile connettersi al database: %v", err)
	}
	fmt.Println("Connesso al database MySQL.")
	
	// Esegui le migrazioni del database
	if err := dbManager.RunMigrations("migration.sql"); err != nil {
		log.Fatalf("Errore durante l'esecuzione delle migrazioni del database: %v", err)
	}
	fmt.Println("Migrazioni del database eseguite con successo.")
	
	// Inizializza il contenitore del database SQL per Whatsmeow
	store.DeviceProps.Os = proto.String("Whatsapp Reader CLI") // Imposta un nome OS personalizzato
	store.DeviceProps.PlatformType = proto.Platforms_PLATFORM_DESKTOP.Enum() // Imposta il tipo di piattaforma
	
	container, err := sqlstore.New("sqlite3", "file:whatsmeow.db?_foreign_keys=on", nil)
	if err != nil {
		panic(err)
	}
	
	// Se hai un device store, usalo. Altrimenti, ne crea uno nuovo.
	deviceStore, err := container.GetFirstDevice()
	if err != nil {
		panic(err)
	}
	if deviceStore == nil {
		deviceStore = container.NewDevice()
	}
	
	// Inizializza il client Whatsmeow
	whatsapp.WhatsmeowClient = whatsmeow.NewClient(deviceStore, nil)
	whatsapp.WhatsmeowClient.AddEventHandler(eventHandler)
	
	// Connessione a WhatsApp
	if whatsapp.WhatsmeowClient.Store.ID == nil {
		// Nessun ID salvato, quindi è necessario effettuare il login
		qrChan, _ := whatsapp.WhatsmeowClient.GetQRChannel(context.Background())
		err = whatsapp.WhatsmeowClient.Connect()
		if err != nil {
			panic(err)
		}
		for evt := range qrChan {
			if evt.Event == "code" {
				fmt.Println("QR code:")
				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				fmt.Println("Scansiona il QR code con WhatsApp sul tuo telefono.")
				// Invia il QR code ai client WebSocket
				broadcastToClients("qr_code", evt.Code)
			} else {
				fmt.Printf("Evento login: %s\n", evt.Event)
				if evt.Event == "success" {
					broadcastToClients("whatsapp_status", "connected_qr")
				} else if evt.Event == "timeout" || evt.Event == "error" {
					broadcastToClients("whatsapp_status", "qr_error")
				}
			}
		}
	} else {
		// Già loggato, prova a connetterti
		err = whatsapp.WhatsmeowClient.Connect()
		if err != nil {
			panic(err)
		}
	}
	
	// Inizializza Gin router
	r := gin.Default()
	
	// Setup delle rotte API
	handlers.SetupAPIRoutes(r, dbManager) // Passa dbManager a SetupAPIRoutes
	
	// Avvia il server HTTP in una goroutine
	go func() {
		if err := r.Run(":8080"); err != nil {
			log.Fatalf("Impossibile avviare il server: %v", err)
		}
	}()
	fmt.Println("Server avviato su http://localhost:8080")
	
	// Ascolta i segnali di interruzione
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	
	// Disconnetti il client WhatsApp quando l'applicazione termina
	fmt.Println("Disconnessione da WhatsApp...")
	whatsapp.WhatsmeowClient.Disconnect()
	fmt.Println("Client WhatsApp disconnesso.")
	dbManager.Close()
	fmt.Println("Connessione al database chiusa.")
}
