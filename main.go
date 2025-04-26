package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
	_ "github.com/go-sql-driver/mysql"
	_ "github.com/mattn/go-sqlite3"
	"whatsapp-reader/db"
	"whatsapp-reader/utils"
)

// Variabile globale per il client WhatsApp
var whatsmeowClient *whatsmeow.Client

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
	dbManager *db.MySQLManager
	mutex     sync.RWMutex
	
	// Manteniamo queste variabili per compatibilità con il codice esistente
	messages []Message
	chats    map[string]*Chat
	
	// Cache per i nomi
	groupNameCache   sync.Map
	contactNameCache sync.Map
	
	// WebSocket clients
	wsClients    = make(map[*websocket.Conn]bool)
	wsClientsMux sync.Mutex
	
	// Contatore di client connessi
	wsClientCount int32
	
	// WebSocket upgrader
	wsUpgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Consenti tutte le origini in sviluppo
		},
	}
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

// Struttura per i messaggi WebSocket
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// Tipi di messaggi WebSocket
const (
	WSTypeNewMessage     = "new_message"
	WSTypeChatUpdated    = "chat_updated"
	WSTypeMessageEdited  = "message_edited"
	WSTypeMessageDeleted = "message_deleted"
)

// Funzione per inviare un messaggio a tutti i client WebSocket
func broadcastToClients(messageType string, payload interface{}) {
	wsClientsMux.Lock()
	defer wsClientsMux.Unlock()
	
	// Se non ci sono client connessi, non fare nulla
	if len(wsClients) == 0 {
		return
	}
	
	message := WSMessage{
		Type:    messageType,
		Payload: payload,
	}
	
	messageJSON, err := json.Marshal(message)
	if err != nil {
		fmt.Println("Errore nella serializzazione del messaggio WebSocket:", err)
		return
	}
	
	// Crea una lista di client da rimuovere
	var clientsToRemove []*websocket.Conn
	
	for client := range wsClients {
		err := client.WriteMessage(websocket.TextMessage, messageJSON)
		if err != nil {
			fmt.Println("Errore nell'invio del messaggio WebSocket:", err)
			clientsToRemove = append(clientsToRemove, client)
		}
	}
	
	// Rimuovi i client disconnessi
	for _, client := range clientsToRemove {
		client.Close()
		delete(wsClients, client)
		atomic.AddInt32(&wsClientCount, -1)
		fmt.Printf("Client WebSocket disconnesso (errore). Totale connessi: %d\n", atomic.LoadInt32(&wsClientCount))
	}
}

// Struttura per la richiesta di creazione del codice giocata
type CodiceGiocataRequest struct {
	Evento         string  `json:"evento,omitempty"`
	Esito          string  `json:"esito"`
	TipsterID      int     `json:"tipster_id"`
	Percentuale    float64 `json:"percentuale"`
	ImmagineURL    string  `json:"immagine_url,omitempty"`
	ImmagineBase64 string  `json:"immagine_base64,omitempty"`
	APIKey         string  `json:"api_key"`
}

// Struttura per la risposta dell'API
type CodiceGiocataResponse struct {
	Success bool   `json:"success"`
	Codice  string `json:"codice,omitempty"`
	Errore  string `json:"errore,omitempty"`
}

// Funzione per inviare una richiesta di codice giocata direttamente
func sendCodiceGiocataRequest(messageID string, requestData CodiceGiocataRequest) {
	fmt.Printf("Invio richiesta diretta per codice giocata (messageID: %s)\n", messageID)
	
	// Converti la richiesta in JSON
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		fmt.Printf("Errore nella serializzazione JSON: %v\n", err)
		return
	}
	
	// Log dettagliato della richiesta
	fmt.Printf("DEBUG RICHIESTA API DIRETTA:\n")
	fmt.Printf("- Evento: %s\n", requestData.Evento)
	fmt.Printf("- Esito: %s\n", requestData.Esito)
	fmt.Printf("- TipsterID: %d\n", requestData.TipsterID)
	fmt.Printf("- Percentuale: %f\n", requestData.Percentuale)
	fmt.Printf("- ImmagineURL: %s\n", requestData.ImmagineURL)
	fmt.Printf("- ImmagineBase64 presente: %t (lunghezza: %d)\n", len(requestData.ImmagineBase64) > 0, len(requestData.ImmagineBase64))
	fmt.Printf("- APIKey: %s\n", requestData.APIKey)
	
	// Stampa la richiesta JSON per debug (senza la parte base64 completa per leggibilità)
	debugJSON := requestData
	if len(debugJSON.ImmagineBase64) > 100 {
		truncatedBase64 := debugJSON.ImmagineBase64[:100] + "..."
		debugJSON.ImmagineBase64 = truncatedBase64
	}
	debugJSONBytes, _ := json.MarshalIndent(debugJSON, "", "  ")
	fmt.Printf("Richiesta JSON diretta (troncata): %s\n", string(debugJSONBytes))
	
	// Crea la richiesta HTTP
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	
	// Modifica l'URL per usare 127.0.0.1 invece di localhost
	req, err := http.NewRequest("POST", "http://127.0.0.1:8000/api/v1/create-codice-giocata/", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Errore nella creazione della richiesta HTTP: %v\n", err)
		return
	}
	
	// Imposta gli header
	req.Header.Set("Content-Type", "application/json")
	
	// Invia la richiesta
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Errore nell'invio della richiesta HTTP: %v\n", err)
		return
	}
	defer resp.Body.Close()
	
	// Leggi il corpo della risposta per il debug
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Errore nella lettura della risposta: %v\n", err)
		return
	}
	
	fmt.Printf("Risposta API diretta ricevuta (status: %d): %s\n", resp.StatusCode, string(respBody))
	
	// Log dettagliato in caso di errore
	if resp.StatusCode >= 400 {
		fmt.Printf("ERRORE API DIRETTA (status %d):\n", resp.StatusCode)
		fmt.Printf("- URL: http://127.0.0.1:8000/api/v1/create-codice-giocata/\n")
		fmt.Printf("- Metodo: POST\n")
		fmt.Printf("- Headers: Content-Type: application/json\n")
		fmt.Printf("- Payload JSON (lunghezza totale: %d bytes)\n", len(jsonData))
		
		// Stampa i primi e gli ultimi caratteri del payload completo
		if len(jsonData) > 200 {
			fmt.Printf("  Primi 100 caratteri: %s\n", string(jsonData[:100]))
			fmt.Printf("  Ultimi 100 caratteri: %s\n", string(jsonData[len(jsonData)-100:]))
		} else {
			fmt.Printf("  Payload completo: %s\n", string(jsonData))
		}
		
		// Stampa la risposta di errore
		fmt.Printf("- Risposta di errore: %s\n", string(respBody))
	}
	
	// Ricrea un nuovo reader per il corpo della risposta
	resp.Body = io.NopCloser(strings.NewReader(string(respBody)))
	
	// Leggi la risposta
	var response CodiceGiocataResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		fmt.Printf("Errore nella decodifica della risposta JSON: %v\n", err)
		return
	}
	
	// Verifica il risultato
	if response.Success {
		fmt.Printf("Codice giocata creato con successo: %s\n", response.Codice)
		
		// Notifica i client WebSocket del codice creato
		broadcastToClients("codice_giocata_created", map[string]interface{}{
			"messageId": messageID,
			"codice":    response.Codice,
			"esito":     requestData.Esito,
		})
		
		// Aggiungi una reazione 🟢 al messaggio originale
		// Estrai il JID della chat dal messageID (formato: chatJID_messageID)
		parts := strings.Split(messageID, "_")
		if len(parts) >= 2 {
			chatJIDStr := parts[0]
			msgID := parts[len(parts)-1]
			
			chatJID, err := types.ParseJID(chatJIDStr)
			if err == nil {
				// Crea il messaggio di reazione
				reactionMsg := &waProto.Message{
					ReactionMessage: &waProto.ReactionMessage{
						Key: &waProto.MessageKey{
							RemoteJID: proto.String(chatJID.String()),
							FromMe:    proto.Bool(false),
							ID:        proto.String(msgID),
						},
						Text:              proto.String("🟢"),
						SenderTimestampMS: proto.Int64(time.Now().UnixNano() / int64(time.Millisecond)),
					},
				}
						
				// Invia la reazione
				_, err := whatsmeowClient.SendMessage(context.Background(), chatJID, reactionMsg)
				if err != nil {
					fmt.Printf("Errore nell'invio della reazione 🟢: %v\n", err)
				} else {
					fmt.Printf("Reazione 🟢 inviata con successo al messaggio %s\n", messageID)
				}
			} else {
				fmt.Printf("Errore nel parsing del JID della chat: %v\n", err)
			}
		} else {
			fmt.Printf("Formato ID messaggio non valido per l'invio della reazione: %s\n", messageID)
		}
	} else {
		fmt.Printf("Errore nella creazione del codice giocata: %s\n", response.Errore)
		
		// Notifica i client WebSocket dell'errore
		broadcastToClients("codice_giocata_error", map[string]interface{}{
			"messageId": messageID,
			"errore":    response.Errore,
		})
	}
}

// Funzione per creare un codice giocata tramite API
func createCodiceGiocata(message Message, nota string) {
	fmt.Printf("Creazione automatica codice giocata per messaggio: %s\n", message.ID)
	
	// Prepara i dati per l'API
	esito := nota
	if esito == "" {
		esito = "Pending"
	}
	
	// Crea la richiesta base
	requestData := CodiceGiocataRequest{
		Esito:       esito,
		TipsterID:   1, // Valore predefinito
		Percentuale: 0.3, // Valore predefinito
		APIKey:      "betste_secret_key",
	}
	
	// Se il messaggio contiene un'immagine, ottieni il base64
	if message.IsMedia && message.MediaPath != "" {
		// Ottieni il percorso completo dell'immagine
		fullPath := "." + message.MediaPath
		fmt.Printf("Tentativo di leggere l'immagine da: %s\n", fullPath)
		
		// Verifica se il file esiste
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			fmt.Printf("ERRORE: Il file immagine non esiste: %s\n", fullPath)
			
			// Prova percorsi alternativi
			alternativePaths := []string{
				message.MediaPath,                  // Prova senza il punto iniziale
				strings.TrimPrefix(message.MediaPath, "/"), // Rimuovi lo slash iniziale
				"Immagini" + message.MediaPath,     // Prova con il prefisso Immagini
				"./Immagini" + strings.TrimPrefix(message.MediaPath, "/images"), // Converti il percorso web in percorso file
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
				fmt.Printf("Dettagli messaggio:\n")
				fmt.Printf("- ID: %s\n", message.ID)
				fmt.Printf("- Chat: %s\n", message.Chat)
				fmt.Printf("- Sender: %s\n", message.Sender)
				fmt.Printf("- IsMedia: %t\n", message.IsMedia)
				fmt.Printf("- MediaPath: %s\n", message.MediaPath)
				fmt.Printf("- ImageHash: %s\n", message.ImageHash)
				
				// Usa l'immagine di esempio fornita dall'utente
				fmt.Printf("Utilizzo immagine di esempio hardcoded\n")
				hardcodedBase64 := "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBg0JCggKDw0QEA8NDw4RExgUERIXEg4PFRwVFxkZGxsbEBQdHx0aHxgaGxr/U6fNIOr5hskiAICfARBIybXv1EJRyk3JYPV7RwHd4aoVQkB2AHx9Gtpbqn5SAcuAEq/yTvxfvV4E1RhckF4VV9gUwXgw6IBNfu7p2wXAU8jriTgFakIFXX729ymitSVCJR6n1Mc/H/epIMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNIYYYYYYYYYYYYZ1C3gGikdP8X2TuCegv0Gl/a37/AKH6cDl9Toz4ZUec9M078PM38eMzeMN1Q5McKm7uOm/hjzJ96H9ghqCVwLgmPpPl/wA6NHOjRoxgAmROLjquAaME+8f2Q/an77//2Q=="
				requestData.ImmagineBase64 = hardcodedBase64
				fmt.Printf("Impostata immagine base64 hardcoded (lunghezza: %d)\n", len(hardcodedBase64))
				return
			}
		}
		
		// Leggi il file dell'immagine
		imgData, err := os.ReadFile(fullPath)
		if err != nil {
			fmt.Printf("Errore nella lettura dell'immagine: %v\n", err)
			
			// Usa l'immagine di esempio fornita dall'utente
			fmt.Printf("Utilizzo immagine di esempio hardcoded dopo errore di lettura\n")
			hardcodedBase64 := "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBg0JCggKDw0QEA8NDw4RExgUERIXEg4PFRwVFxkZGxsbEBQdHx0aHxgaGxr/U6fNIOr5hskiAICfARBIybXv1EJRyk3JYPV7RwHd4aoVQkB2AHx9Gtpbqn5SAcuAEq/yTvxfvV4E1RhckF4VV9gUwXgw6IBNfu7p2wXAU8jriTgFakIFXX729ymitSVCJR6n1Mc/H/epIMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNIYYYYYYYYYYYYZ1C3gGikdP8X2TuCegv0Gl/a37/AKH6cDl9Toz4ZUec9M078PM38eMzeMN1Q5McKm7uOm/hjzJ96H9ghqCVwLgmPpPl/wA6NHOjRoxgAmROLjquAaME+8f2Q/an77//2Q=="
			requestData.ImmagineBase64 = hardcodedBase64
			fmt.Printf("Impostata immagine base64 hardcoded (lunghezza: %d)\n", len(hardcodedBase64))
		} else {
			// Converti in base64
			mimeType := "image/jpeg" // Assumiamo JPEG come default
			if strings.HasSuffix(fullPath, ".png") {
				mimeType = "image/png"
			}
			
			base64Data := base64.StdEncoding.EncodeToString(imgData)
			imageBase64 := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
			
			// Verifica che il base64 non sia vuoto
			if len(base64Data) == 0 {
				fmt.Printf("ERRORE: Base64 vuoto dopo la conversione\n")
				
				// Usa l'immagine di esempio fornita dall'utente
				fmt.Printf("Utilizzo immagine di esempio hardcoded dopo base64 vuoto\n")
				hardcodedBase64 := "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBg0JCggKDw0QEA8NDw4RExgUERIXEg4PFRwVFxkZGxsbEBQdHx0aHxgaGxr/U6fNIOr5hskiAICfARBIybXv1EJRyk3JYPV7RwHd4aoVQkB2AHx9Gtpbqn5SAcuAEq/yTvxfvV4E1RhckF4VV9gUwXgw6IBNfu7p2wXAU8jriTgFakIFXX729ymitSVCJR6n1Mc/H/epIMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNIYYYYYYYYYYYYZ1C3gGikdP8X2TuCegv0Gl/a37/AKH6cDl9Toz4ZUec9M078PM38eMzeMN1Q5McKm7uOm/hjzJ96H9ghqCVwLgmPpPl/wA6NHOjRoxgAmROLjquAaME+8f2Q/an77//2Q=="
				requestData.ImmagineBase64 = hardcodedBase64
				fmt.Printf("Impostata immagine base64 hardcoded (lunghezza: %d)\n", len(hardcodedBase64))
			} else {
				fmt.Printf("Immagine convertita in base64 (primi 50 caratteri): %s...\n", imageBase64[:min(50, len(imageBase64))])
				
				// Imposta il campo immagine_base64 nella richiesta
				requestData.ImmagineBase64 = imageBase64
				
				// Stampa la richiesta completa per debug
				fmt.Printf("Invio richiesta con immagine base64 (lunghezza: %d)\n", len(imageBase64))
				
				// Verifica che il formato sia corretto
				if !strings.HasPrefix(imageBase64, "data:image/") {
					fmt.Printf("AVVISO: Il formato del base64 potrebbe non essere corretto\n")
				}
			}
		}
	} else {
		// Se non è un'immagine, usa il contenuto come evento
		evento := message.Content
		requestData.Evento = evento
		requestData.ImmagineURL = "https://example.com/image.jpg" // URL hardcoded come richiesto
	}
	
	// Converti la richiesta in JSON
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		fmt.Printf("Errore nella serializzazione JSON: %v\n", err)
		return
	}
	
	// Log dettagliato della richiesta
	fmt.Printf("DEBUG RICHIESTA API:\n")
	fmt.Printf("- Evento: %s\n", requestData.Evento)
	fmt.Printf("- Esito: %s\n", requestData.Esito)
	fmt.Printf("- TipsterID: %d\n", requestData.TipsterID)
	fmt.Printf("- Percentuale: %f\n", requestData.Percentuale)
	fmt.Printf("- ImmagineURL: %s\n", requestData.ImmagineURL)
	fmt.Printf("- ImmagineBase64 presente: %t (lunghezza: %d)\n", len(requestData.ImmagineBase64) > 0, len(requestData.ImmagineBase64))
	fmt.Printf("- APIKey: %s\n", requestData.APIKey)
	
	// Stampa la richiesta JSON per debug (senza la parte base64 completa per leggibilità)
	debugJSON := requestData
	if len(debugJSON.ImmagineBase64) > 100 {
		truncatedBase64 := debugJSON.ImmagineBase64[:100] + "..."
		debugJSON.ImmagineBase64 = truncatedBase64
	}
	debugJSONBytes, _ := json.MarshalIndent(debugJSON, "", "  ")
	fmt.Printf("Richiesta JSON (troncata): %s\n", string(debugJSONBytes))
	
	// Crea la richiesta HTTP
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	
	// Modifica l'URL per usare 127.0.0.1 invece di localhost
	req, err := http.NewRequest("POST", "http://127.0.0.1:8000/api/v1/create-codice-giocata/", bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Errore nella creazione della richiesta HTTP: %v\n", err)
		return
	}
	
	// Imposta gli header
	req.Header.Set("Content-Type", "application/json")
	
	// Invia la richiesta
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Errore nell'invio della richiesta HTTP: %v\n", err)
		return
	}
	defer resp.Body.Close()
	
	// Leggi il corpo della risposta per il debug
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Errore nella lettura della risposta: %v\n", err)
		return
	}
	
	fmt.Printf("Risposta API ricevuta (status: %d): %s\n", resp.StatusCode, string(respBody))
	
	// Log dettagliato in caso di errore
	if resp.StatusCode >= 400 {
		fmt.Printf("ERRORE API (status %d):\n", resp.StatusCode)
		fmt.Printf("- URL: http://127.0.0.1:8000/api/v1/create-codice-giocata/\n")
		fmt.Printf("- Metodo: POST\n")
		fmt.Printf("- Headers: Content-Type: application/json\n")
		fmt.Printf("- Payload JSON (lunghezza totale: %d bytes)\n", len(jsonData))
		
		// Stampa i primi e gli ultimi caratteri del payload completo
		if len(jsonData) > 200 {
			fmt.Printf("  Primi 100 caratteri: %s\n", string(jsonData[:100]))
			fmt.Printf("  Ultimi 100 caratteri: %s\n", string(jsonData[len(jsonData)-100:]))
		} else {
			fmt.Printf("  Payload completo: %s\n", string(jsonData))
		}
		
		// Stampa la risposta di errore
		fmt.Printf("- Risposta di errore: %s\n", string(respBody))
	}
	
	// Ricrea un nuovo reader per il corpo della risposta
	resp.Body = io.NopCloser(strings.NewReader(string(respBody)))
	
	// Leggi la risposta
	var response CodiceGiocataResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		fmt.Printf("Errore nella decodifica della risposta JSON: %v\n", err)
		return
	}
	
	// Verifica il risultato
	if response.Success {
		fmt.Printf("Codice giocata creato con successo: %s\n", response.Codice)
		
		// Notifica i client WebSocket del codice creato
		broadcastToClients("codice_giocata_created", map[string]interface{}{
			"messageId": message.ID,
			"codice":    response.Codice,
			"esito":     esito,
		})
		
		// Aggiungi una reazione 🟢 al messaggio originale
		// Estrai il JID della chat dal message.ID (formato: chatJID_messageID)
		parts := strings.Split(message.ID, "_")
		if len(parts) >= 2 {
			chatJIDStr := message.Chat
			msgID := parts[len(parts)-1]
			
			chatJID, err := types.ParseJID(chatJIDStr)
			if err == nil {
				// Crea il messaggio di reazione
				reactionMsg := &waProto.Message{
					ReactionMessage: &waProto.ReactionMessage{
						Key: &waProto.MessageKey{
							RemoteJID: proto.String(chatJID.String()),
							FromMe:    proto.Bool(false),
							ID:        proto.String(msgID),
						},
						Text:              proto.String("🟢"),
						SenderTimestampMS: proto.Int64(time.Now().UnixNano() / int64(time.Millisecond)),
					},
				}
				
				// Invia la reazione
				_, err := whatsmeowClient.SendMessage(context.Background(), chatJID, reactionMsg)
				if err != nil {
					fmt.Printf("Errore nell'invio della reazione 🟢: %v\n", err)
				} else {
					fmt.Printf("Reazione 🟢 inviata con successo al messaggio %s\n", message.ID)
				}
			} else {
				fmt.Printf("Errore nel parsing del JID della chat: %v\n", err)
			}
		} else {
			fmt.Printf("Formato ID messaggio non valido per l'invio della reazione: %s\n", message.ID)
		}
	} else {
		fmt.Printf("Errore nella creazione del codice giocata: %s\n", response.Errore)
		
		// Notifica i client WebSocket dell'errore
		broadcastToClients("codice_giocata_error", map[string]interface{}{
			"messageId": message.ID,
			"errore":    response.Errore,
		})
	}
}

// Funzione di utilità per trovare il minimo tra due interi
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	// Inizializza la mappa delle chat
	chats = make(map[string]*Chat)
	
	// Carica la configurazione
	config, err := utils.LoadConfig("config.json")
	if err != nil {
		fmt.Println("Errore nel caricamento della configurazione:", err)
		// Usa valori predefiniti se la configurazione non è disponibile
		config = &utils.Config{
			Database: utils.DatabaseConfig{
				Host:     "localhost",
				Port:     3306,
				User:     "root",
				Password: "password",
				DBName:   "whatsapp_viewer",
			},
			Server: utils.ServerConfig{
				Port: 8080,
			},
		}
	}
	
	// Inizializza il database MySQL
	dbManager, err = db.NewMySQLManager(config.Database.GetDSN())
	if err != nil {
		fmt.Println("Errore nella connessione al database MySQL:", err)
		return
	}
	defer dbManager.Close()
	
	// Inizializza le tabelle
	if err := dbManager.InitTables(); err != nil {
		fmt.Println("Errore nell'inizializzazione delle tabelle:", err)
		return
	}
	
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
	
	// Crea un client WhatsApp e lo assegna alla variabile globale
	whatsmeowClient = whatsmeow.NewClient(deviceStore, logger)
	
	// Registra l'event handler principale
	whatsmeowClient.AddEventHandler(func(evt interface{}) {
		switch v := evt.(type) {
		case *events.Message:
    		// Controlla se è un messaggio di tipo elimina
			if v.Message.GetProtocolMessage() != nil && v.Message.GetProtocolMessage().GetType() == 0 {

				revokedMessageID := v.Message.GetProtocolMessage().GetKey().GetId()
				
				fmt.Printf("Ricevuta richiesta di eliminazione per messaggio: %s\n", revokedMessageID)
				
				mutex.Lock()
				var chatID string
				var messageFound bool
				
				for i, msg := range messages {
					if msg.ID == revokedMessageID {
						// Contrassegna il messaggio come eliminato
						messages[i].IsDeleted = true
						messages[i].Content = "(Questo messaggio è stato eliminato)"
						chatID = msg.Chat
						messageFound = true
						
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
						
						fmt.Printf("Messaggio %s contrassegnato come eliminato in memoria\n", revokedMessageID)
						break
					}
				}
				mutex.Unlock()
				
				if messageFound {
					// Aggiorna il messaggio nel database
					dbMessage := db.Message{
						ID:        revokedMessageID,
						IsDeleted: true,
						Content:   "(Questo messaggio è stato eliminato)",
						Chat:      chatID,
					}
					if err := dbManager.SaveMessage(&dbMessage); err != nil {
						fmt.Printf("Errore nell'aggiornamento del messaggio eliminato nel database: %v\n", err)
					} else {
						fmt.Printf("Messaggio %s contrassegnato come eliminato nel database\n", revokedMessageID)
					}
					
					// Notifica i client WebSocket del messaggio eliminato
					broadcastToClients("message_deleted", map[string]interface{}{
						"messageId": revokedMessageID,
						"chatId":    chatID,
					})
					
					fmt.Printf("Notifica WebSocket inviata per messaggio eliminato: %s\n", revokedMessageID)
				} else {
					fmt.Printf("Messaggio da eliminare %s non trovato\n", revokedMessageID)
				}
			}

    		// Controlla se è un messaggio di tipo modifica
			if v.Message.GetProtocolMessage() != nil && v.Message.GetProtocolMessage().GetType() == 14 {
				// Ottieni l'ID del messaggio originale
				editedMessageID := v.Message.GetProtocolMessage().GetKey().GetId()
				
				// Trova il messaggio originale nella lista dei messaggi
				mutex.Lock()
				var chatID, chatName, sender, senderName string
				var messageFound bool
				var content string
				
				for i, msg := range messages {
					if msg.ID == editedMessageID {
						// Estrai il contenuto aggiornato dal messaggio modificato
						
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
							messages[i].IsEdited = true
							
							// Salva i dati per l'aggiornamento del database
							chatID = msg.Chat
							chatName = msg.ChatName
							sender = msg.Sender
							senderName = msg.SenderName
							messageFound = true
							
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
				
				if messageFound && content != "" {
					// Aggiorna il messaggio nel database
					dbMessage := db.Message{
						ID:         editedMessageID,
						Content:    content,
						IsEdited:   true,
						Chat:       chatID,
						ChatName:   chatName,
						Sender:     sender,
						SenderName: senderName,
					}
					if err := dbManager.SaveMessage(&dbMessage); err != nil {
						fmt.Printf("Errore nell'aggiornamento del messaggio modificato nel database: %v\n", err)
					}
					
					// Notifica i client WebSocket del messaggio modificato
					broadcastToClients("message_edited", map[string]interface{}{
						"messageId": editedMessageID,
						"chatId":    chatID,
						"content":   content,
					});
					
					fmt.Printf("Notifica WebSocket inviata per messaggio modificato: %s\n", editedMessageID)
				} else {
					fmt.Printf("Messaggio da modificare %s non trovato o contenuto vuoto\n", editedMessageID)
				}
			}
			// Ottieni i dati del messaggio
			var chatJID string
			var chatName string
			
			if v.Info.IsGroup {
				chatJID = v.Info.Chat.String()
				chatName = getGroupName(whatsmeowClient, v.Info.Chat)
				
				fmt.Printf("DEBUG GROUP MESSAGE:\n")
				fmt.Printf("  Chat JID: %s\n", chatJID)
				fmt.Printf("  Chat Name: %s\n", chatName)
			} else {
				chatJID = v.Info.Chat.String()
				
				// Usa sempre v.Info.Chat per ottenere il nome del contatto
				chatName = getContactName(whatsmeowClient, v.Info.Chat)
				
				
				fmt.Printf("DEBUG PRIVATE MESSAGE:\n")
				fmt.Printf("  Sender: %s\n", v.Info.Sender.String())
				fmt.Printf("  Chat Name: %s\n", chatName)
				fmt.Printf("  Message Content: %s\n\n", v.Message.GetConversation())
			}
			
			senderName := getContactName(whatsmeowClient, v.Info.Sender)
			
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
				imgData, err := whatsmeowClient.Download(v.Message.GetImageMessage())
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
				audioData, err := whatsmeowClient.Download(audioMsg)
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
					reactionText := v.Message.GetReactionMessage().GetText()
					targetMessageID := v.Message.GetReactionMessage().GetKey().GetId()
					
					content = fmt.Sprintf("👍 Reazione: %s (al messaggio: %s)", 
							reactionText,
							targetMessageID)
					
					// Verifica se è una reazione con fiamma 🔥
					if reactionText == "🔥" {
						fmt.Printf("Rilevata reazione 🔥 al messaggio %s da %s\n", targetMessageID, senderName)
						
						// Cerca il messaggio originale
						var originalMessage *Message
						mutex.RLock()
						for _, msg := range messages {
							if msg.ID == targetMessageID {
								originalMessage = &msg
								break
							}
						}
						mutex.RUnlock()
						
						// Se il messaggio non è stato trovato in memoria, prova a cercarlo nel database
						if originalMessage == nil {
							fmt.Printf("Messaggio %s non trovato in memoria, cerco nel database\n", targetMessageID)
							dbMessages, err := dbManager.LoadChatMessages(chatJID)
							if err == nil {
								for _, dbMsg := range dbMessages {
									if dbMsg.ID == targetMessageID {
										// Converti il messaggio dal formato DB al formato Message
										convertedMsg := Message{
											ID:        dbMsg.ID,
											Chat:      dbMsg.Chat,
											ChatName:  dbMsg.ChatName,
											Sender:    dbMsg.Sender,
											SenderName: dbMsg.SenderName,
											Content:   dbMsg.Content,
											Timestamp: dbMsg.Timestamp,
											IsMedia:   dbMsg.IsMedia,
											MediaPath: dbMsg.MediaPath,
											ImageHash: dbMsg.ImageHash,
										}
										originalMessage = &convertedMsg
										fmt.Printf("Messaggio %s trovato nel database\n", targetMessageID)
										break
									}
								}
							} else {
								fmt.Printf("Errore nel caricamento dei messaggi dal database: %v\n", err)
							}
						}
						
						// Cerca la nota associata al messaggio
						var noteContent string
						if note, err := dbManager.LoadMessageNote(targetMessageID); err == nil {
							noteContent = note.Note
							fmt.Printf("Nota trovata per il messaggio %s: %s\n", targetMessageID, noteContent)
						} else {
							fmt.Printf("Nessuna nota trovata per il messaggio %s: %v\n", targetMessageID, err)
						}
						
						// Se il messaggio è stato trovato, crea il codice giocata
						if originalMessage != nil {
							fmt.Printf("Avvio creazione codice giocata per messaggio %s (IsMedia: %v, MediaPath: %s)\n", 
								targetMessageID, originalMessage.IsMedia, originalMessage.MediaPath)
							
							// Se è un'immagine, crea una copia del messaggio con ImmagineBase64 preimpostato
							if originalMessage.IsMedia && originalMessage.MediaPath != "" {
								// Crea una copia del messaggio originale
								messageCopy := *originalMessage
								
								// Ottieni il percorso completo dell'immagine
								fullPath := "." + messageCopy.MediaPath
								fmt.Printf("Tentativo di leggere l'immagine da: %s\n", fullPath)
								
								// Verifica se il file esiste
								if _, err := os.Stat(fullPath); os.IsNotExist(err) {
									fmt.Printf("ERRORE: Il file immagine non esiste: %s\n", fullPath)
									
									// Prova percorsi alternativi
									alternativePaths := []string{
										messageCopy.MediaPath,                  // Prova senza il punto iniziale
										strings.TrimPrefix(messageCopy.MediaPath, "/"), // Rimuovi lo slash iniziale
										"Immagini" + messageCopy.MediaPath,     // Prova con il prefisso Immagini
										"./Immagini" + strings.TrimPrefix(messageCopy.MediaPath, "/images"), // Converti il percorso web in percorso file
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
										fmt.Printf("Nessun percorso alternativo trovato, uso l'immagine hardcoded\n")
										// Usa l'immagine hardcoded
										createCodiceGiocata(messageCopy, noteContent)
									} else {
										// Leggi l'immagine dal percorso alternativo trovato
										imgData, err := os.ReadFile(fullPath)
										if err != nil {
											fmt.Printf("Errore nella lettura dell'immagine: %v\n", err)
											createCodiceGiocata(messageCopy, noteContent)
										} else {
											// Converti in base64
											mimeType := "image/jpeg" // Assumiamo JPEG come default
											if strings.HasSuffix(fullPath, ".png") {
												mimeType = "image/png"
											}
											
											base64Data := base64.StdEncoding.EncodeToString(imgData)
											imageBase64 := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
											
											// Crea una richiesta speciale solo con l'immagine base64
											specialRequest := CodiceGiocataRequest{
												Esito:          noteContent,
												TipsterID:      1,
												Percentuale:    0.3,
												ImmagineBase64: imageBase64,
												APIKey:         "betste_secret_key",
											}
											
											// Invia direttamente la richiesta speciale
											sendCodiceGiocataRequest(messageCopy.ID, specialRequest)
										}
									}
								} else {
									// Leggi l'immagine
									imgData, err := os.ReadFile(fullPath)
									if err != nil {
										fmt.Printf("Errore nella lettura dell'immagine: %v\n", err)
										createCodiceGiocata(messageCopy, noteContent)
									} else {
										// Converti in base64
										mimeType := "image/jpeg" // Assumiamo JPEG come default
										if strings.HasSuffix(fullPath, ".png") {
											mimeType = "image/png"
										}
										
										base64Data := base64.StdEncoding.EncodeToString(imgData)
										imageBase64 := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
										
										// Crea una richiesta speciale solo con l'immagine base64
										specialRequest := CodiceGiocataRequest{
											Esito:          noteContent,
											TipsterID:      1,
											Percentuale:    0.3,
											ImmagineBase64: imageBase64,
											APIKey:         "betste_secret_key",
										}
										
										// Invia direttamente la richiesta speciale
										sendCodiceGiocataRequest(messageCopy.ID, specialRequest)
									}
								}
							} else {
								// Se non è un'immagine, usa il metodo standard
								createCodiceGiocata(*originalMessage, noteContent)
							}
						} else {
							fmt.Printf("ERRORE: Impossibile creare codice giocata, messaggio %s non trovato\n", targetMessageID)
						}
						
						// Notifica i client WebSocket della reazione con fiamma
						broadcastToClients("fire_reaction", map[string]interface{}{
							"targetMessageId": targetMessageID,
							"senderJid": v.Info.Sender.String(),
							"senderName": senderName,
							"chatId": chatJID,
							"chatName": chatName,
						})
					}
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
			
			// Converti il messaggio nel tipo db.Message
			dbMessage := db.Message{
				ID:                  message.ID,
				Chat:                message.Chat,
				ChatName:            message.ChatName,
				Sender:              message.Sender,
				SenderName:          message.SenderName,
				Content:             message.Content,
				Timestamp:           message.Timestamp,
				IsMedia:             message.IsMedia,
				MediaPath:           message.MediaPath,
				IsEdited:            message.IsEdited,
				IsDeleted:           message.IsDeleted,
				IsReply:             message.IsReply,
				ReplyToMessageID:    message.ReplyToMessageID,
				ReplyToSender:       message.ReplyToSender,
				ReplyToContent:      message.ReplyToContent,
				ProtocolMessageType: message.ProtocolMessageType,
				ProtocolMessageName: message.ProtocolMessageName,
				ImageHash:           message.ImageHash,
			}

			// Salva la chat nel database prima del messaggio per rispettare il vincolo di chiave esterna
			chat := &db.Chat{
				ID:           chatJID,
				Name:         chatName,
				LastMessage:  dbMessage,
				ProfileImage: "",
			}
			
			// Salva la chat nel database
			if err := dbManager.SaveChat(chat); err != nil {
				fmt.Printf("Errore nel salvataggio della chat: %v\n", err)
				// Anche in caso di errore, notifica i client WebSocket della nuova chat
				broadcastToClients("chat_updated", chat)
			}
			
			// Salva il messaggio nel database dopo aver salvato la chat
			if err := dbManager.SaveMessage(&dbMessage); err != nil {
				fmt.Printf("Errore nel salvataggio del messaggio: %v\n", err)
				// Anche in caso di errore, notifica i client WebSocket del nuovo messaggio
			}
			
			// Notifica i client WebSocket del nuovo messaggio
			// Invia sempre la notifica, anche se ci sono stati errori nel salvataggio
			broadcastToClients("new_message", map[string]interface{}{
				"chatId":   chatJID,
				"message":  dbMessage,
			})
			
			// Prova a scaricare l'immagine del profilo
			isGroup := v.Info.IsGroup
			profilePath, err := downloadProfilePicture(client, v.Info.Chat, isGroup)
			if err == nil {
				chat.ProfileImage = profilePath
				
				// Aggiorna la chat nel database con l'immagine del profilo
				if err := dbManager.SaveChat(chat); err != nil {
					fmt.Printf("Errore nell'aggiornamento della chat con l'immagine del profilo: %v\n", err)
				}
			}
			
			// Notifica i client WebSocket dell'aggiornamento della chat
			// Invia sempre la notifica, anche se ci sono stati errori nel salvataggio
			broadcastToClients("chat_updated", chat)
			
			fmt.Printf("Nuovo messaggio da %s in %s: %s\n", senderName, chatName, content)
		
		case *events.Connected:
			fmt.Println("Client connesso!")
			
		case *events.LoggedOut:
			fmt.Println("Dispositivo disconnesso")
		}
	})

	// Connetti il client WhatsApp
	if whatsmeowClient.Store.ID == nil {
		qrChan, err := whatsmeowClient.GetQRChannel(context.Background())
		if err != nil {
			fmt.Println("Errore nell'ottenere il canale QR:", err)
			return
		}
		
		err = whatsmeowClient.Connect()
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
		fmt.Println("Già registrato con JID:", whatsmeowClient.Store.ID)
		err = whatsmeowClient.Connect()
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
	
	// Endpoint WebSocket per le notifiche in tempo reale
	router.GET("/ws", func(c *gin.Context) {
		conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			fmt.Printf("Errore nell'upgrade della connessione WebSocket: %v\n", err)
			return
		}
		
		// Aggiungi il client alla mappa dei client WebSocket
		wsClientsMux.Lock()
		wsClients[conn] = true
		clientCount := atomic.AddInt32(&wsClientCount, 1)
		wsClientsMux.Unlock()
		
		// Invia un messaggio di benvenuto al client
		welcomeMsg := WSMessage{
			Type: "connection_established",
			Payload: map[string]interface{}{
				"message": "Connessione WebSocket stabilita",
				"timestamp": time.Now(),
				"clientCount": clientCount,
			},
		}
		
		welcomeMsgJSON, _ := json.Marshal(welcomeMsg)
		conn.WriteMessage(websocket.TextMessage, welcomeMsgJSON)
		
		fmt.Printf("Nuovo client WebSocket connesso. Totale connessi: %d\n", clientCount)
		
		// Imposta un ping periodico per mantenere attiva la connessione
		conn.SetPingHandler(func(appData string) error {
			// Rispondi con un pong
			err := conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(time.Second))
			if err != nil {
				fmt.Printf("Errore nell'invio del pong: %v\n", err)
			}
			return nil
		})
		
		// Gestisci la disconnessione
		go func() {
			defer func() {
				wsClientsMux.Lock()
				delete(wsClients, conn)
				currentCount := atomic.AddInt32(&wsClientCount, -1)
				wsClientsMux.Unlock()
				conn.Close()
				fmt.Printf("Client WebSocket disconnesso. Totale connessi: %d\n", currentCount)
			}()
			
			// Imposta un timeout di lettura per rilevare connessioni inattive
			conn.SetReadDeadline(time.Now().Add(time.Minute * 5))
			conn.SetPongHandler(func(string) error {
				// Resetta il timeout quando riceviamo un pong
				conn.SetReadDeadline(time.Now().Add(time.Minute * 5))
				return nil
			})
			
			for {
				// Leggi i messaggi dal client
				messageType, message, err := conn.ReadMessage()
				if err != nil {
					if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
						fmt.Printf("Errore nella lettura del messaggio WebSocket: %v\n", err)
					}
					break
				}
				
				// Se riceviamo un messaggio di ping, rispondiamo con un pong
				if messageType == websocket.PingMessage {
					if err := conn.WriteMessage(websocket.PongMessage, nil); err != nil {
						fmt.Printf("Errore nell'invio del pong: %v\n", err)
						break
					}
					continue
				}
				
				// Se riceviamo un messaggio di testo, lo processiamo
				if messageType == websocket.TextMessage && len(message) > 0 {
					// Per ora non facciamo nulla con i messaggi ricevuti
					// Ma potremmo implementare comandi client-server in futuro
					fmt.Printf("Messaggio ricevuto dal client: %s\n", string(message))
				}
			}
		}()
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

	router.GET("/api/chats/:id/profile-image", func(c *gin.Context) {
		chatID := c.Param("id")
		
		// Carica la chat dal database
		chats, err := dbManager.LoadChats()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel caricamento delle chat: %v", err)})
			return
		}
		
		var chat *db.Chat
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
		
		// Converti gli ID da stringhe a types.MessageID
		var messageIDs []types.MessageID
		for _, id := range requestData.MessageIDs {
			messageIDs = append(messageIDs, types.MessageID(id))
		}
		
		// Ottieni informazioni sulla chat
		chatJID, err := types.ParseJID(chatID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "JID chat non valido"})
			return
		}
		
		// Ottieni l'ultimo messaggio dalla lista per determinare il mittente
		// (Necessario nei gruppi)
		mutex.RLock()
		chat, exists := chats[chatID]
		mutex.RUnlock()
		
		if !exists {
			// Prova a caricare la chat dal database
			dbChats, err := dbManager.LoadChats()
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata"})
				return
			}
			
			found := false
			for _, dbChat := range dbChats {
				if dbChat.ID == chatID {
					found = true
					break
				}
			}
			
			if !found {
				c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata"})
				return
			}
			
			// Carica i messaggi della chat
			dbMessages, err := dbManager.LoadChatMessages(chatID)
			if err != nil || len(dbMessages) == 0 {
				c.JSON(http.StatusOK, gin.H{
					"status": "success",
					"message": "Nessun messaggio da segnare come letto",
				})
				return
			}
			
			// Crea una chat temporanea con i messaggi caricati
			tempChat := &Chat{
				ID:      chatID,
				Name:    dbMessages[0].ChatName,
				Messages: []Message{},
			}
			
			// Converti i messaggi dal formato DB al formato Message
			for _, dbMsg := range dbMessages {
				tempChat.Messages = append(tempChat.Messages, Message{
					ID:        dbMsg.ID,
					Chat:      dbMsg.Chat,
					ChatName:  dbMsg.ChatName,
					Sender:    dbMsg.Sender,
					SenderName: dbMsg.SenderName,
					Content:   dbMsg.Content,
					Timestamp: dbMsg.Timestamp,
				})
			}
			
			chat = tempChat
		}
		
		// In un gruppo, abbiamo bisogno del mittente specifico
		var senderJID types.JID
		isGroup := chatJID.Server == "g.us"
		
		if isGroup && len(chat.Messages) > 0 {
			// Trova il messaggio corrispondente per ottenere il mittente
			found := false
			for _, msg := range chat.Messages {
				if len(requestData.MessageIDs) > 0 && msg.ID == requestData.MessageIDs[0] {
					senderJID, err = types.ParseJID(msg.Sender)
					if err != nil {
						// Se non riusciamo a parsare il JID, continuiamo comunque
						// Potrebbe funzionare anche senza specificare il mittente
						fmt.Printf("Avviso: impossibile analizzare il JID del mittente: %v\n", err)
					} else {
						found = true
					}
					break
				}
			}
			
			if !found {
				// Se non troviamo il messaggio specifico, proviamo a usare il primo messaggio disponibile
				if len(chat.Messages) > 0 {
					senderJID, err = types.ParseJID(chat.Messages[0].Sender)
					if err != nil {
						fmt.Printf("Avviso: impossibile analizzare il JID del mittente: %v\n", err)
					}
				}
			}
		}
		
		// Imposta la presenza come disponibile (opzionale, ma consigliato per le ricevute di lettura)
		err = whatsmeowClient.SendPresence(types.PresenceAvailable)
		if err != nil {
			fmt.Printf("Avviso: errore nell'impostare la presenza: %v\n", err)
			// Continuiamo comunque, non è un errore critico
		}
		
		// Marca i messaggi come letti
		err = whatsmeowClient.MarkRead(
			messageIDs,
			time.Now(),
			chatJID,
			senderJID, // In chat private può essere una JID vuota
		)
		
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nel segnare i messaggi come letti: %v", err)})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"message": fmt.Sprintf("%d messaggi segnati come letti", len(messageIDs)),
		})
	})

	// API per inviare un messaggio
	router.POST("/api/chats/:id/send", func(c *gin.Context) {
		chatID := c.Param("id")
		
		// Ottieni JID della chat
		chatJID, err := types.ParseJID(chatID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "JID chat non valido"})
			return
		}

		// Trova il nome della chat
		var chatName string
		if chat, exists := chats[chatID]; exists {
			chatName = chat.Name
		} else {
			if chatJID.Server == "g.us" {
				chatName = getGroupName(whatsmeowClient, chatJID)
			} else {
				chatName = getContactName(whatsmeowClient, chatJID)
			}
		}
		
		// ID del mittente (te stesso)
		selfJID := client.Store.ID
		
		// Verifica se la richiesta contiene un'immagine
		file, header, err := c.Request.FormFile("image")
		if err == nil {
			// Caricamento immagine
			defer file.Close()
			
			// Leggi l'immagine
			imageData, err := io.ReadAll(file)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Errore nella lettura dell'immagine: %v", err)})
				return
			}
			
			// Ottieni il tipo MIME dell'immagine
			contentType := header.Header.Get("Content-Type")
			if !strings.HasPrefix(contentType, "image/") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Il file caricato non è un'immagine valida"})
				return
			}
			
			// Ottieni la didascalia se presente
			caption := c.PostForm("caption")
			
			// Crea il messaggio immagine
			uploadedImage, err := whatsmeowClient.Upload(context.Background(), imageData, whatsmeow.MediaImage)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'upload dell'immagine: %v", err)})
				return
			}
			
			// Crea il messaggio con l'immagine
			imageMsg := &waProto.ImageMessage{
				URL:           proto.String(uploadedImage.URL),
				DirectPath:    proto.String(uploadedImage.DirectPath),
				MediaKey:      uploadedImage.MediaKey,
				Mimetype:      proto.String(contentType),
				FileEncSHA256: uploadedImage.FileEncSHA256,
				FileSHA256:    uploadedImage.FileSHA256,
				FileLength:    proto.Uint64(uploadedImage.FileLength),
				Caption:       proto.String(caption),
			}
			
			msg := &waProto.Message{
				ImageMessage: imageMsg,
			}
			
			// Genera un ID per il messaggio
			msgID := whatsmeowClient.GenerateMessageID()
			
			// Invia il messaggio
			resp, err := whatsmeowClient.SendMessage(context.Background(), chatJID, msg)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'invio dell'immagine: %v", err)})
				return
			}
			
			// Salva l'immagine localmente
			var mediaPath string
			
			// Calcola l'hash SHA-256 dell'immagine
			imageHash := sha256.Sum256(imageData)
			imageHashString := hex.EncodeToString(imageHash[:])
			
			// Genera i path per il salvataggio
			timestamp := resp.Timestamp
			dataDir := timestamp.Format("2006-01-02")
			oraPrefisso := timestamp.Format("15-04-05")
			
			// Sanitizza i nomi
			sanitizedChatName := sanitizePathComponent(chatName)
			sanitizedSenderName := sanitizePathComponent("Tu")
			
			// Crea le directory
			basePath := "Immagini"
			groupPath := fmt.Sprintf("%s/%s", basePath, sanitizedChatName)
			dataPath := fmt.Sprintf("%s/%s", groupPath, dataDir)
			
			err = os.MkdirAll(dataPath, 0755)
			if err != nil {
				fmt.Printf("Errore creazione directory: %v\n", err)
			} else {
				// Crea il nome file
				fileName := fmt.Sprintf("%s_%s_ID%s.jpg", oraPrefisso, sanitizedSenderName, msgID)
				fullPath := fmt.Sprintf("%s/%s", dataPath, fileName)
				
				// Salva il file
				err = os.WriteFile(fullPath, imageData, 0644)
				if err != nil {
					fmt.Printf("Errore salvataggio file: %v\n", err)
				} else {
					// Crea URL per il browser
					mediaPath = fmt.Sprintf("/images/%s/%s/%s", sanitizedChatName, dataDir, fileName)
					fmt.Printf("Immagine salvata: %s, Hash: %s\n", mediaPath, imageHashString)
				}
			}
			
			// Crea un messaggio locale che rappresenta quello appena inviato
			newMessage := Message{
				ID:        msgID,
				Chat:      chatID,
				ChatName:  chatName,
				Sender:    selfJID.String(),
				SenderName: "Tu", 
				Content:   fmt.Sprintf("📷 Immagine: %s", caption),
				Timestamp: timestamp,
				IsMedia:   true,
				MediaPath: mediaPath,
				ImageHash: imageHashString,
				ProtocolMessageType: 0,
				ProtocolMessageName: "",
			}
			
			// Converti il messaggio nel tipo db.Message per salvarlo nel database
			dbMessage := db.Message{
				ID:                  newMessage.ID,
				Chat:                newMessage.Chat,
				ChatName:            newMessage.ChatName,
				Sender:              newMessage.Sender,
				SenderName:          newMessage.SenderName,
				Content:             newMessage.Content,
				Timestamp:           newMessage.Timestamp,
				IsMedia:             newMessage.IsMedia,
				MediaPath:           newMessage.MediaPath,
				ImageHash:           newMessage.ImageHash,
			}
			
			// Salva il messaggio nel database
			if err := dbManager.SaveMessage(&dbMessage); err != nil {
				fmt.Printf("Errore nel salvataggio dell'immagine inviata nel database: %v\n", err)
			} else {
				fmt.Printf("Immagine inviata salvata nel database: %s\n", msgID)
			}
			
			mutex.Lock()
			// Aggiungi alla lista generale di messaggi
			messages = append(messages, newMessage)
			
			// Aggiungi alla chat corrispondente
			if chat, exists := chats[chatID]; exists {
				chat.LastMessage = newMessage
				chat.Messages = append(chat.Messages, newMessage)
			} else {
				chats[chatID] = &Chat{
					ID:          chatID,
					Name:        chatName,
					LastMessage: newMessage,
					Messages:    []Message{newMessage},
				}
			}
			mutex.Unlock()
			
			// Notifica i client WebSocket del nuovo messaggio
			broadcastToClients("new_message", map[string]interface{}{
				"chatId":   chatID,
				"message":  dbMessage,
			})
			
			c.JSON(http.StatusOK, gin.H{
				"status": "success",
				"message": "Immagine inviata con successo",
				"timestamp": timestamp,
				"messageData": newMessage,
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
		
		// Crea un nuovo messaggio
		var msg *waProto.Message
		
		if requestData.IsReply && requestData.ReplyToMessageID != "" {
			mutex.RLock()
			// Cerca il messaggio originale a cui rispondere
			var originalMessage *Message
			for _, message := range messages {
				if message.ID == requestData.ReplyToMessageID && message.Chat == chatID {
					originalMessage = &message
					break
				}
			}
			mutex.RUnlock()
			
			if originalMessage != nil {
				// Crea un messaggio di tipo ExtendedTextMessage per le risposte
				msg = &waProto.Message{
					ExtendedTextMessage: &waProto.ExtendedTextMessage{
						Text: proto.String(requestData.Content),
						ContextInfo: &waProto.ContextInfo{
							StanzaID: proto.String(requestData.ReplyToMessageID),
							Participant: proto.String(originalMessage.Sender),
							QuotedMessage: &waProto.Message{
								Conversation: proto.String(originalMessage.Content),
							},
						},
					},
				}
			} else {
				// Messaggio originale non trovato, invia un messaggio normale
				msg = &waProto.Message{
					Conversation: proto.String(requestData.Content),
				}
			}
		} else {
			// Messaggio normale (non di risposta)
			msg = &waProto.Message{
				Conversation: proto.String(requestData.Content),
			}
		}
    
		// Invia il messaggio
		resp, err := whatsmeowClient.SendMessage(context.Background(), chatJID, msg)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Errore nell'invio del messaggio: %v", err)})
			return
		}
		
		// Crea un messaggio locale che rappresenta quello appena inviato
		msgID := resp.ID
		timestamp := resp.Timestamp
		
		// Crea l'oggetto messaggio con le informazioni di risposta
		newMessage := Message{
			ID:        msgID,
			Chat:      chatID,
			ChatName:  chatName,
			Sender:    selfJID.String(),
			SenderName: "Tu",
			Content:   requestData.Content,
			Timestamp: timestamp,
			IsMedia:   false,
			
			// Aggiungi informazioni sulla risposta se applicabile
			IsReply:         requestData.IsReply,
			ReplyToMessageID: requestData.ReplyToMessageID,
			
			// Inizializza i campi che causano problemi
			ProtocolMessageType: 0,
			ProtocolMessageName: "",
			ImageHash:           "",
		}
		
		// Se è una risposta, aggiungi i dati del messaggio originale
		if requestData.IsReply && requestData.ReplyToMessageID != "" {
			mutex.RLock()
			for _, message := range messages {
				if message.ID == requestData.ReplyToMessageID && message.Chat == chatID {
					newMessage.ReplyToSender = message.SenderName
					newMessage.ReplyToContent = message.Content
					break
				}
			}
			mutex.RUnlock()
		}
		
		fmt.Printf("DEBUG: Salvataggio messaggio inviato nel database. ID: %s, Chat: %s, Contenuto: %s\n", 
			msgID, chatID, requestData.Content)
		
		// Converti il messaggio nel tipo db.Message per salvarlo nel database
		dbMessage := db.Message{
			ID:                  newMessage.ID,
			Chat:                newMessage.Chat,
			ChatName:            newMessage.ChatName,
			Sender:              newMessage.Sender,
			SenderName:          newMessage.SenderName,
			Content:             newMessage.Content,
			Timestamp:           newMessage.Timestamp,
			IsMedia:             newMessage.IsMedia,
			IsReply:             newMessage.IsReply,
			ReplyToMessageID:    newMessage.ReplyToMessageID,
			ReplyToSender:       newMessage.ReplyToSender,
			ReplyToContent:      newMessage.ReplyToContent,
			ProtocolMessageType: newMessage.ProtocolMessageType,
			ProtocolMessageName: newMessage.ProtocolMessageName,
			ImageHash:           newMessage.ImageHash,
		}
		
		// Salva la chat nel database prima del messaggio per rispettare il vincolo di chiave esterna
		dbChat := &db.Chat{
			ID:           chatID,
			Name:         chatName,
			LastMessage:  dbMessage,
			ProfileImage: "",
		}
		
		// Salva la chat nel database
		if err := dbManager.SaveChat(dbChat); err != nil {
			fmt.Printf("Errore nel salvataggio della chat prima del messaggio: %v\n", err)
			// Prova a forzare l'inserimento della chat
			_, err = dbManager.GetDB().Exec(
				"INSERT IGNORE INTO chats (id, name) VALUES (?, ?)",
				chatID, chatName,
			)
			if err != nil {
				fmt.Printf("Errore anche nel tentativo di forzare l'inserimento della chat: %v\n", err)
			} else {
				fmt.Printf("Chat inserita con metodo alternativo: %s\n", chatID)
			}
		} else {
			fmt.Printf("Chat salvata nel database con successo prima del messaggio: %s\n", chatID)
		}
		
		// Salva il messaggio nel database con più dettagli di debug
		fmt.Printf("DEBUG: Tentativo di salvare il messaggio nel DB. ID: %s, Chat: %s\n", dbMessage.ID, dbMessage.Chat)
		
		// Assicurati che tutti i campi necessari siano impostati
		if dbMessage.ID == "" || dbMessage.Chat == "" {
			fmt.Printf("ERRORE: ID messaggio o Chat ID vuoti! ID: '%s', Chat: '%s'\n", dbMessage.ID, dbMessage.Chat)
		}
		
		// Prova a salvare direttamente con SQL
		_, err = dbManager.GetDB().Exec(`
			INSERT INTO messages (
				id, chat_id, chat_name, sender, sender_name, content, timestamp, 
				is_media, media_path, is_edited, is_deleted, is_reply, 
				reply_to_message_id, reply_to_sender, reply_to_content,
				protocol_message_type, protocol_message_name, image_hash
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE 
				content = ?, sender_name = ?, chat_name = ?
		`,
			dbMessage.ID, dbMessage.Chat, dbMessage.ChatName, dbMessage.Sender, dbMessage.SenderName,
			dbMessage.Content, dbMessage.Timestamp, dbMessage.IsMedia, dbMessage.MediaPath,
			dbMessage.IsEdited, dbMessage.IsDeleted, dbMessage.IsReply, dbMessage.ReplyToMessageID,
			dbMessage.ReplyToSender, dbMessage.ReplyToContent, dbMessage.ProtocolMessageType,
			dbMessage.ProtocolMessageName, dbMessage.ImageHash,
			// Valori per l'UPDATE
			dbMessage.Content, dbMessage.SenderName, dbMessage.ChatName,
		)
		
		if err != nil {
			fmt.Printf("ERRORE CRITICO nell'inserimento diretto SQL: %v\n", err)
			
			// Prova con il metodo standard come fallback
			if err := dbManager.SaveMessage(&dbMessage); err != nil {
				fmt.Printf("ERRORE CRITICO anche nel salvataggio standard: %v\n", err)
			} else {
				fmt.Printf("Messaggio salvato con metodo standard: %s\n", msgID)
			}
		} else {
			fmt.Printf("Messaggio salvato con SQL diretto: %s\n", msgID)
		}
		
		// Verifica che il messaggio sia stato salvato
		dbMessages, err := dbManager.LoadChatMessages(chatID)
		if err != nil {
			fmt.Printf("Errore nel verificare il salvataggio del messaggio: %v\n", err)
		} else {
			messageFound := false
			for _, msg := range dbMessages {
				if msg.ID == msgID {
					messageFound = true
					fmt.Printf("SUCCESSO: messaggio %s trovato nel database\n", msgID)
					break
				}
			}
			if !messageFound {
				fmt.Printf("ERRORE CRITICO: messaggio %s NON trovato nel database dopo il salvataggio!\n", msgID)
			}
		}
		
		mutex.Lock()
		// Aggiungi alla lista generale di messaggi
		messages = append(messages, newMessage)
		
		// Aggiungi alla chat corrispondente o crea una nuova chat
		if chat, exists := chats[chatID]; exists {
			chat.LastMessage = newMessage
			chat.Messages = append(chat.Messages, newMessage)
		} else {
			// Questo caso dovrebbe essere raro, poiché stai inviando un messaggio a una chat esistente
			chats[chatID] = &Chat{
				ID:          chatID,
				Name:        chatName,
				LastMessage: newMessage,
				Messages:    []Message{newMessage},
			}
		}
		mutex.Unlock()
		
		// Aggiorna nuovamente la chat nel database per assicurarsi che l'ultimo messaggio sia aggiornato
		dbChat.LastMessage = dbMessage
		
		// Prova a salvare direttamente con SQL
		_, err = dbManager.GetDB().Exec(
			"INSERT INTO chats (id, name, profile_image) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, profile_image = ?",
			dbChat.ID, dbChat.Name, dbChat.ProfileImage, dbChat.Name, dbChat.ProfileImage,
		)
		
		if err != nil {
			fmt.Printf("ERRORE nell'aggiornamento diretto SQL della chat: %v\n", err)
			
			// Prova con il metodo standard come fallback
			if err := dbManager.SaveChat(dbChat); err != nil {
				fmt.Printf("ERRORE CRITICO anche nell'aggiornamento standard della chat: %v\n", err)
			} else {
				fmt.Printf("Chat aggiornata con metodo standard: %s\n", chatID)
			}
		} else {
			fmt.Printf("Chat aggiornata con SQL diretto: %s\n", chatID)
		}
		
		// Notifica i client WebSocket del nuovo messaggio
		broadcastToClients("new_message", map[string]interface{}{
			"chatId":   chatID,
			"message":  dbMessage,
		})
		
		// Notifica anche dell'aggiornamento della chat
		broadcastToClients("chat_updated", dbChat)
		
		fmt.Printf("Notifiche WebSocket inviate per nuovo messaggio e aggiornamento chat\n")
		
		// Verifica che il messaggio sia stato salvato correttamente
		_, err = dbManager.LoadChatMessages(chatID)
		if err != nil {
			fmt.Printf("Avviso: impossibile verificare il salvataggio del messaggio: %v\n", err)
		} else {
			fmt.Printf("Verifica completata: i messaggi della chat %s sono stati caricati con successo\n", chatID)
		}
		
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"message": "Messaggio inviato con successo",
			"timestamp": timestamp,
			"messageData": newMessage, // Restituisci il messaggio creato
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
	
	// API per gestire le note dei messaggi
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
		noteData := &db.MessageNote{
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
		noteData := &db.MessageNote{
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
		
		var requestData db.RecordedData
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
		
		var requestData db.RecordedData
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

	// Avvia il server HTTP in una goroutine
	go func() {
		port := ":8080"
		if config != nil {
			port = fmt.Sprintf(":%d", config.Server.Port)
		}
		if err := router.Run(port); err != nil {
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
	whatsmeowClient.Disconnect()
}
