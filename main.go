package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"log"
	"syscall"
	"time"
	"encoding/hex" // Per ImageHash
	"path/filepath" // Per gestire i percorsi dei file media

	"github.com/gin-gonic/gin"
	_ "github.com/go-sql-driver/mysql"
	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3" // Driver SQLite per sqlstore
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore" // Per memorizzare lo stato del dispositivo
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events" // Per l'handler degli eventi
	waLog "go.mau.fi/whatsmeow/util/log" // Per il logger di whatsmeow
	"whatsapp-reader/db"
	"whatsapp-reader/handlers"
	"whatsapp-reader/models"
	"whatsapp-reader/utils"
	"whatsapp-reader/whatsapp"
)

var (
	dbManager *db.MySQLManager
	
	// WebSocket clients
	wsClients    = make(map[*websocket.Conn]bool)
	wsClientsMux sync.Mutex
	
	// Contatore di client connessi
	wsClientCount int32
	
	// Istanza del client WhatsApp wrapper
	whatsAppClientInstance *whatsapp.Client
	
	// Servizio per i reminder
	reminderService *handlers.ReminderService
	
	// Servizio per gli alert automatici
	alertService *handlers.AlertService
	
	// Servizio per la gestione degli account
	accountService *handlers.AccountService
)

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
	sanitizedJID := utils.SanitizePathComponent(jid.String())
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

// Funzione per inviare un messaggio a tutti i client WebSocket
func broadcastToClients(messageType string, payload interface{}) {
	wsClientsMux.Lock()
	defer wsClientsMux.Unlock()
	
	// Se non ci sono client connessi, non fare nulla
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

// Funzione per creare una giocata AI tramite API
func createGiocataAI(message *models.Message, chatJID string, messageID string) {
	fmt.Printf("Creazione giocata AI per messaggio: %s\n", messageID)
	
	// Prepara i dati per l'API
	requestData := models.GiocataAIRequest{
		SaleRivenditoreID: 456, // Valore predefinito
		APIKey:            "betste_secret_key",
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
				fmt.Printf("Nessun percorso alternativo trovato, uso l'immagine hardcoded\n")
				// Usa l'immagine hardcoded
				hardcodedBase64 := "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBg0JCggKDw0QEA8NDw4RExgUERIXEg4PFRwVFxkZGxsbEBQdHx0aHxgaGxr/U6fNIOr5hskiAICfARBIybXv1EJRyk3JYPV7RwHd4aoVQkB2AHx9Gtpbqn5SAcuAEq/yTvxfvV4E1RhckF4VV9gUwXgw6IBNfu7p2wXAU8jriTgFakIFXX729ymitSVCJR6n1Mc/H/epIMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNIYYYYYYYYYYYYZ1C3gGikdP8X2TuCegv0Gl/a37/AKH6cDl9Toz4ZUec9M078PM38eMzeMN1Q5McKm7uOm/hjzJ96H9ghqCVwLgmPpPl/wA6NHOjRoxgAmROLjquAaME+8f2Q/an77//2Q=="
				requestData.ImmagineBase64 = hardcodedBase64
				fmt.Printf("Impostata immagine base64 hardcoded (lunghezza: %d)\n", len(hardcodedBase64))
			} else {
				// Leggi l'immagine dal percorso alternativo trovato
				imgData, err := os.ReadFile(fullPath)
				if err != nil {
					fmt.Printf("Errore nella lettura dell'immagine: %v\n", err)
					// Usa l'immagine hardcoded
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
					
					// Imposta il campo immagine_base64 nella richiesta
					requestData.ImmagineBase64 = imageBase64
					
					fmt.Printf("Immagine convertita in base64 (primi 50 caratteri): %s...\n", imageBase64[:min(50, len(imageBase64))])
				}
			}
		} else {
			// Leggi il file dell'immagine
			imgData, err := os.ReadFile(fullPath)
			if err != nil {
				fmt.Printf("Errore nella lettura dell'immagine: %v\n", err)
				
				// Usa l'immagine hardcoded
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
					
					// Usa l'immagine hardcoded
					hardcodedBase64 := "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBg0JCggKDw0QEA8NDw4RExgUERIXEg4PFRwVFxkZGxsbEBQdHx0aHxgaGxr/U6fNIOr5hskiAICfARBIybXv1EJRyk3JYPV7RwHd4aoVQkB2AHx9Gtpbqn5SAcuAEq/yTvxfvV4E1RhckF4VV9gUwXgw6IBNfu7p2wXAU8jriTgFakIFXX729ymitSVCJR6n1Mc/H/epIMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNIYYYYYYYYYYYYZ1C3gGikdP8X2TuCegv0Gl/a37/AKH6cDl9Toz4ZUec9M078PM38eMzeMN1Q5McKm7uOm/hjzJ96H9ghqCVwLgmPpPl/wA6NHOjRoxgAmROLjquAaME+8f2Q/an77//2Q=="
					requestData.ImmagineBase64 = hardcodedBase64
					fmt.Printf("Impostata immagine base64 hardcoded (lunghezza: %d)\n", len(hardcodedBase64))
				} else {
					fmt.Printf("Immagine convertita in base64 (primi 50 caratteri): %s...\n", imageBase64[:min(50, len(imageBase64))])
					
					// Imposta il campo immagine_base64 nella richiesta
					requestData.ImmagineBase64 = imageBase64
				}
			}
		}
	} else {
		// Se non è un'immagine, usa il contenuto come evento
		evento := message.Content
		requestData.Evento = evento
	}
	
	// Converti la richiesta in JSON
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		fmt.Printf("Errore nella serializzazione JSON: %v\n", err)
		return
	}
	
	// Log dettagliato della richiesta
	fmt.Printf("DEBUG RICHIESTA API GIOCATA AI:\n")
	fmt.Printf("- Evento: %s\n", requestData.Evento)
	fmt.Printf("- SaleRivenditoreID: %d\n", requestData.SaleRivenditoreID)
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
	
	// Crea la richiesta HTTP con timeout più lungo
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	
	// Crea la richiesta HTTP
	req, err := http.NewRequest("POST", "http://127.0.0.1:8000/api/v1/create-giocata-ai/", bytes.NewBuffer(jsonData))
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
	
	// Ricrea un nuovo reader per il corpo della risposta
	resp.Body = io.NopCloser(strings.NewReader(string(respBody)))
	
	// Leggi la risposta
	var response models.GiocataAIResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		fmt.Printf("Errore nella decodifica della risposta JSON: %v\n", err)
		return
	}
	
	// Verifica il risultato
	if response.Success {
		fmt.Printf("Giocata AI creata con successo: %s\n", response.Data.CodiceGiocata)
		
		// Notifica i client WebSocket della giocata creata
		broadcastToClients("giocata_ai_created", map[string]interface{}{
			"messageId": messageID,
			"codice":    response.Data.CodiceGiocata,
			"evento":    response.Data.Evento,
			"quota":     response.Data.Quota,
			"stake":     response.Data.Stake,
		})
		
		// Aggiungi una reazione 🧾 al messaggio originale
		chatJIDObj, err := types.ParseJID(chatJID)
		if err == nil {
			// Estrai l'ID del messaggio dal messageID (formato: chatJID_messageID)
			var msgID string
			parts := strings.Split(messageID, "_")
			if len(parts) >= 2 {
				msgID = parts[len(parts)-1]
			} else {
				msgID = messageID
			}
			
			// Cerca il messaggio originale nel database per ottenere il mittente
			var senderJID types.JID
			dbMessages, err := dbManager.LoadChatMessages(chatJID)
			if err == nil {
				for _, dbMsg := range dbMessages {
					if dbMsg.ID == messageID || dbMsg.ID == msgID {
						// Trovato il messaggio, prova a ottenere il JID del mittente
						senderJID, err = types.ParseJID(dbMsg.Sender)
						if err != nil {
							fmt.Printf("Errore nel parsing del JID del mittente originale: %v, uso JID vuoto\n", err)
							senderJID = types.EmptyJID
						} else {
							fmt.Printf("Trovato mittente originale: %s per messaggio %s\n", dbMsg.Sender, messageID)
						}
						break
					}
				}
			}
			
			// Se non abbiamo trovato il mittente, usiamo un JID vuoto
			if senderJID.IsEmpty() {
				senderJID = types.EmptyJID
				fmt.Printf("Mittente non trovato, uso JID vuoto per la reazione\n")
			}
			
			// Invia la reazione 🧾
			reactionMsg := whatsapp.WhatsmeowClient.BuildReaction(chatJIDObj, senderJID, msgID, "🧾")
			_, err = whatsapp.WhatsmeowClient.SendMessage(context.Background(), chatJIDObj, reactionMsg)
			if err != nil {
				fmt.Printf("Errore nell'invio della reazione 🧾: %v\n", err)
			} else {
				fmt.Printf("Reazione 🧾 inviata con successo al messaggio %s\n", messageID)
			}
		} else {
			fmt.Printf("Errore nel parsing del JID della chat: %v\n", err)
		}
	} else {
		fmt.Printf("Errore nella creazione della giocata AI: %s\n", response.Error)
		
		// Notifica i client WebSocket dell'errore
		broadcastToClients("giocata_ai_error", map[string]interface{}{
			"messageId": messageID,
			"errore":    response.Error,
		})
	}
}

// Funzione per creare un codice giocata tramite API
func createCodiceGiocata(message models.Message, nota string) {
	fmt.Printf("Creazione automatica codice giocata per messaggio: %s\n", message.ID)
	
	// Prepara i dati per l'API
	esito := nota
	if esito == "" {
		esito = "Pending"
	}
	
	// Crea la richiesta base
	requestData := models.CodiceGiocataRequest{
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
		Timeout: 30 * time.Second,
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
		
		// Anche se la richiesta API fallisce, proviamo comunque a inviare la reazione verde
		// per dare un feedback visivo all'utente
		if message.Chat != "" {
			fmt.Printf("Tentativo di inviare comunque la reazione verde nonostante l'errore API\n")
			
			chatJID, parseErr := types.ParseJID(message.Chat)
			if parseErr == nil {
				// Estrai l'ID del messaggio dal message.ID (formato: chatJID_messageID)
				parts := strings.Split(message.ID, "_")
				var msgID string
				if len(parts) >= 2 {
					msgID = parts[len(parts)-1]
				} else {
					msgID = message.ID
				}
				
				// Ottieni il JID del mittente originale (se disponibile)
				var senderJID types.JID
				senderJID = types.EmptyJID
				
				// Non rimuoviamo più le reazioni esistenti, permettiamo a più utenti di reagire allo stesso messaggio
				
				// Invia la reazione verde
				reactionMsg := whatsapp.WhatsmeowClient.BuildReaction(chatJID, senderJID, msgID, "🟢")
				_, reactionErr := whatsapp.WhatsmeowClient.SendMessage(context.Background(), chatJID, reactionMsg)
				if reactionErr != nil {
					fmt.Printf("Errore nell'invio della reazione 🟢: %v\n", reactionErr)
				} else {
					fmt.Printf("Reazione 🟢 inviata con successo al messaggio %s (dopo errore API)\n", msgID)
				}
			}
		}
		
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
	var response models.CodiceGiocataResponse
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
				// Ottieni il JID del mittente originale (se disponibile)
				var senderJID types.JID
				// Se non abbiamo informazioni sul mittente, usiamo un JID vuoto
				senderJID = types.EmptyJID
				
				// Non rimuoviamo più le reazioni esistenti, permettiamo a più utenti di reagire allo stesso messaggio
				
				// Ora invia la nuova reazione (🟢)
				reactionMsg := whatsapp.WhatsmeowClient.BuildReaction(chatJID, senderJID, msgID, "🟢")
				_, err = whatsapp.WhatsmeowClient.SendMessage(context.Background(), chatJID, reactionMsg)
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
	
	// Applica le migration automatiche
	if err := dbManager.ApplyMigrations(); err != nil {
		fmt.Println("Errore nell'applicazione delle migration:", err)
		return
	}
	
	// Inizializza il client WhatsApp
	// 1. Crea il container per lo store (useremo SQLite)
	dbLog := waLog.Stdout("Database", "DEBUG", true)
	
	// Crea la directory per la sessione se non esiste (per compatibilità locale)
	sessionDir := "/app/session"
	if _, err := os.Stat(sessionDir); os.IsNotExist(err) {
		if err := os.MkdirAll(sessionDir, 0755); err != nil {
			log.Printf("Avviso: impossibile creare directory sessione %s: %v (continuo con directory corrente)", sessionDir, err)
			sessionDir = "."
		}
	}
	
	sessionPath := filepath.Join(sessionDir, "whatsmeow_store.db")
	storeContainer, err := sqlstore.New("sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", sessionPath), dbLog)
	if err != nil {
		fmt.Printf("Errore nella creazione del container SQL per Whatsmeow: %v\n", err)
		fmt.Println("Continuo l'avvio del server senza WhatsApp. Le API funzioneranno ma l'invio messaggi fallirà.")
		storeContainer = nil // Assicuriamoci che sia nil per i controlli successivi
	}

	// 2. Definisci l'handler degli eventi qui in main.go
	eventHandler := func(rawEvt interface{}) {
		// Puoi accedere a dbManager, broadcastToClients, ecc. da qui se necessario
		switch evt := rawEvt.(type) {
		case *events.Message:
			senderName := evt.Info.PushName
			if senderName == "" {
				senderName = evt.Info.Sender.User
			}
			logMsg := fmt.Sprintf("[MAIN HANDLER] Messaggio da %s (%s) in chat %s", senderName, evt.Info.Sender.String(), evt.Info.Chat.String())
			if evt.Message.GetConversation() != "" {
				logMsg += fmt.Sprintf(" | Testo: %s", evt.Message.GetConversation())
			} else if img := evt.Message.GetImageMessage(); img != nil {
				logMsg += fmt.Sprintf(" | Immagine: %s", img.GetCaption())
			} else {
				logMsg += " | Tipo messaggio non testuale"
			}
			fmt.Println(logMsg)
			// --- Inizio Logica di Salvataggio Messaggio e Chat ---
			chatJID := evt.Info.Chat
			var chatName string
			var profilePicPath string
			var errProfilePic error

			if evt.Info.IsGroup {
				chatName = whatsapp.GetGroupName(whatsAppClientInstance.Client, chatJID)
				profilePicPath, errProfilePic = downloadProfilePicture(whatsAppClientInstance.Client, chatJID, true)
				if errProfilePic != nil {
					fmt.Printf("[MAIN HANDLER] Errore download immagine profilo gruppo %s: %v\n", chatJID.String(), errProfilePic)
				}
			} else {
				chatName = whatsapp.GetContactName(whatsAppClientInstance.Client, chatJID)
				profilePicPath, errProfilePic = downloadProfilePicture(whatsAppClientInstance.Client, chatJID, false)
				if errProfilePic != nil {
					fmt.Printf("[MAIN HANDLER] Errore download immagine profilo contatto %s: %v\n", chatJID.String(), errProfilePic)
				}
			}

			chatToSave := &models.Chat{
				ID:           chatJID.String(),
				Name:         chatName,
				ProfileImage: profilePicPath,
			}
			if err := dbManager.SaveChat(chatToSave); err != nil {
				fmt.Printf("[MAIN HANDLER] Errore salvataggio chat %s nel DB: %v\n", chatJID.String(), err)
			} else {
				// fmt.Printf("[MAIN HANDLER] Chat %s (%s) salvata/aggiornata nel DB.\n", chatName, chatJID.String())
			}

			messageContent := ""
			isMedia := false
			mediaPath := ""
			imageHash := ""

			if conv := evt.Message.GetConversation(); conv != "" {
				messageContent = conv
			} else if extText := evt.Message.GetExtendedTextMessage(); extText != nil && extText.GetText() != "" {
				messageContent = extText.GetText()
			} else if img := evt.Message.GetImageMessage(); img != nil {
				isMedia = true
				messageContent = img.GetCaption()
				imgData, err := whatsAppClientInstance.Client.Download(img)
				if err != nil {
					fmt.Printf("[MAIN HANDLER] Errore download immagine %s: %v\n", evt.Info.ID, err)
				} else {
					// Assumiamo che utils.GetImageExtension esista e restituisca es. ".jpg"
					ext := utils.GetImageExtension(img.GetMimetype())
					fileName := fmt.Sprintf("%s%s", evt.Info.ID, ext) // ext dovrebbe includere il punto
					basePath := "MediaFiles/Images"
					if err := os.MkdirAll(basePath, 0755); err != nil {
						fmt.Printf("[MAIN HANDLER] Errore creazione directory media %s: %v\n", basePath, err)
					} else {
						fullPath := filepath.Join(basePath, fileName)
						if err := os.WriteFile(fullPath, imgData, 0644); err != nil {
							fmt.Printf("[MAIN HANDLER] Errore salvataggio immagine %s: %v\n", fullPath, err)
						} else {
							mediaPath = "/media/images/" + fileName
							fmt.Printf("[MAIN HANDLER] Immagine salvata in %s\n", fullPath)
							if img.GetFileSHA256() != nil {
								imageHash = hex.EncodeToString(img.GetFileSHA256())
							}
						}
					}
				}
			} else if vid := evt.Message.GetVideoMessage(); vid != nil {
				isMedia = true
				messageContent = vid.GetCaption()
				videoData, err := whatsAppClientInstance.Client.Download(vid)
				if err != nil {
					fmt.Printf("[MAIN HANDLER] Errore download video %s: %v\n", evt.Info.ID, err)
				} else {
					ext := utils.GetVideoExtension(vid.GetMimetype())
					fileName := fmt.Sprintf("%s%s", evt.Info.ID, ext)
					basePath := "MediaFiles/Videos"
					if err := os.MkdirAll(basePath, 0755); err != nil {
						fmt.Printf("[MAIN HANDLER] Errore creazione directory media %s: %v\n", basePath, err)
					} else {
						fullPath := filepath.Join(basePath, fileName)
						if err := os.WriteFile(fullPath, videoData, 0644); err != nil {
							fmt.Printf("[MAIN HANDLER] Errore salvataggio video %s: %v\n", fullPath, err)
						} else {
							mediaPath = "/media/videos/" + fileName
							fmt.Printf("[MAIN HANDLER] Video salvato in %s\n", fullPath)
						}
					}
				}
			} else if aud := evt.Message.GetAudioMessage(); aud != nil {
				isMedia = true
				audioData, err := whatsAppClientInstance.Client.Download(aud)
				if err != nil {
					fmt.Printf("[MAIN HANDLER] Errore download audio %s: %v\n", evt.Info.ID, err)
				} else {
					ext := utils.GetAudioExtension(aud.GetMimetype())
					fileName := fmt.Sprintf("%s%s", evt.Info.ID, ext)
					basePath := "MediaFiles/Audio"
					if err := os.MkdirAll(basePath, 0755); err != nil {
						fmt.Printf("[MAIN HANDLER] Errore creazione directory media %s: %v\n", basePath, err)
					} else {
						fullPath := filepath.Join(basePath, fileName)
						if err := os.WriteFile(fullPath, audioData, 0644); err != nil {
							fmt.Printf("[MAIN HANDLER] Errore salvataggio audio %s: %v\n", fullPath, err)
						} else {
							mediaPath = "/media/audio/" + fileName
							fmt.Printf("[MAIN HANDLER] Audio salvato in %s\n", fullPath)
						}
					}
				}
			} else if doc := evt.Message.GetDocumentMessage(); doc != nil {
				isMedia = true
				messageContent = doc.GetCaption()
				if messageContent == "" {
					messageContent = doc.GetTitle()
				}
				docData, err := whatsAppClientInstance.Client.Download(doc)
				if err != nil {
					fmt.Printf("[MAIN HANDLER] Errore download documento %s: %v\n", evt.Info.ID, err)
				} else {
					ext := utils.GetDocumentExtension(doc.GetMimetype(), doc.GetFileName())
					fileName := fmt.Sprintf("%s%s", evt.Info.ID, ext)
					basePath := "MediaFiles/Documents"
					if err := os.MkdirAll(basePath, 0755); err != nil {
						fmt.Printf("[MAIN HANDLER] Errore creazione directory media %s: %v\n", basePath, err)
					} else {
						fullPath := filepath.Join(basePath, fileName)
						if err := os.WriteFile(fullPath, docData, 0644); err != nil {
							fmt.Printf("[MAIN HANDLER] Errore salvataggio documento %s: %v\n", fullPath, err)
						} else {
							mediaPath = "/media/documents/" + fileName
							fmt.Printf("[MAIN HANDLER] Documento salvato in %s\n", fullPath)
						}
					}
				}
			}

			// Costruisci l'oggetto messaggio per il DB
			dbMessage := &models.Message{
				ID:                  evt.Info.ID,
				Chat:                chatJID.String(),
				ChatName:            chatName,
				Sender:              evt.Info.Sender.String(),
				SenderName:          senderName,
				Content:             messageContent,
				Timestamp:           evt.Info.Timestamp,
				IsMedia:             isMedia,
				MediaPath:           mediaPath,
				ImageHash:           imageHash, // Popolato sopra per le immagini
				ProtocolMessageName: evt.Info.Category, // Salva la categoria del messaggio di protocollo
			}

			// Gestione specifica per ProtocolMessageType e ProtocolMessageName
			if protocolMessage := evt.Message.GetProtocolMessage(); protocolMessage != nil {
				dbMessage.ProtocolMessageType = int(protocolMessage.GetType())
				dbMessage.ProtocolMessageName = utils.GetProtocolMessageTypeName(int(protocolMessage.GetType())) // Aggiorna anche il nome
			} else {
				// Se non è un messaggio di protocollo specifico, ProtocolMessageType rimane 0 (default int value).
				// ProtocolMessageName è già impostato a evt.Info.Category durante l'inizializzazione di dbMessage.
				// Nessuna azione necessaria qui per questi due campi.
			}
			
			// Non salvare messaggi completamente vuoti a meno che non siano media (che potrebbero avere didascalia vuota)
			// o messaggi di protocollo che vogliamo registrare (es. revoca)
			if dbMessage.Content == "" && !dbMessage.IsMedia && dbMessage.ProtocolMessageType == 0 {
				// Potrebbe essere un evento di protocollo che non vogliamo visualizzare come messaggio vuoto.
				// Ad esempio, una notifica di "revoca messaggio" gestita da `events.MessageUpdate`.
				// O un messaggio di tipo `ProtocolMessage` che non ha un contenuto testuale diretto.
				fmt.Printf("[MAIN HANDLER] Messaggio %s (tipo: %s, categoria: %s) scartato (contenuto vuoto e non media).\n", dbMessage.ID, dbMessage.ProtocolMessageType, dbMessage.ProtocolMessageName)
				return // Non salvare e non fare broadcast
			}

			if err := dbManager.SaveMessage(dbMessage); err != nil {
				fmt.Printf("[MAIN HANDLER] Errore salvataggio messaggio %s nel DB: %v\n", dbMessage.ID, err)
			} else {
				fmt.Printf("[MAIN HANDLER] Messaggio %s salvato nel DB.\n", dbMessage.ID)
				broadcastToClients("new_message", dbMessage)
				
				// Gestisci i comandi account se il servizio è disponibile
				if accountService != nil {
					accountService.HandleMessage(chatJID.String(), evt.Info.Sender.String(), messageContent)
				}
			}
			// --- Fine Logica di Salvataggio Messaggio e Chat ---

		case *events.Connected:
			fmt.Println("[MAIN HANDLER] Client WhatsApp connesso")
		case *events.Disconnected:
			fmt.Println("[MAIN HANDLER] Client WhatsApp disconnesso")
		case *events.LoggedOut:
			fmt.Println("[MAIN HANDLER] Client WhatsApp sloggato")
		// Aggiungi altri casi di eventi se necessario
		default:
			// fmt.Printf("[MAIN HANDLER] Evento WhatsApp ricevuto: %T\n", rawEvt)
		}
	}

	// 3. Crea una nuova istanza del client WhatsApp wrapper
	whatsAppClientInstance, err = whatsapp.NewClient(storeContainer, eventHandler)
	if err != nil {
		log.Fatalf("Errore nella creazione del client WhatsApp: %v", err)
	}

	// 4. Assegna il client whatsmeow sottostante alla variabile globale, se usata altrove
	whatsapp.WhatsmeowClient = whatsAppClientInstance.Client // .Client è il *whatsmeow.Client effettivo

	// 5. Gestisci l'autenticazione QR Code e la connessione
	// Controlla se siamo già loggati (Store.ID non è nil)
	if whatsAppClientInstance.Client.Store.ID == nil {
		fmt.Println("Autenticazione richiesta. Scansiona il codice QR con WhatsApp.")
		fmt.Println("ATTENZIONE: WhatsApp non è autenticato. Le API funzioneranno ma l'invio messaggi fallirà.")
		fmt.Println("Per autenticare, connettiti al container e scansiona il QR code.")
		// NON blocchiamo l'avvio del server
		go func() {
			if err := whatsAppClientInstance.WaitForQRCode(); err != nil {
				fmt.Printf("Errore durante l'autenticazione QR code: %v\n", err)
			} else {
				fmt.Println("Autenticazione QR completata e client connesso.")
			}
		}()
	} else {
		fmt.Printf("Client WhatsApp già loggato con ID: %s\n", whatsAppClientInstance.Client.Store.ID.String())
		// Se già loggato, dobbiamo comunque connetterci.
		// Il metodo Connect del wrapper registra l'handler e connette il client whatsmeow.
		if err := whatsAppClientInstance.Connect(); err != nil {
			fmt.Printf("Errore nella connessione del client WhatsApp (già loggato): %v\n", err)
			fmt.Println("Continuo l'avvio del server senza WhatsApp connesso.")
		} else {
			fmt.Println("Client WhatsApp (già loggato) connesso.")
		}
	}
	
	// Configura il server API
	router := gin.Default()
	
	// Configura le rotte API (include anche la route WebSocket)
	handlers.SetupAPIRoutes(router, dbManager)
	
	// Configura le rotte HTTP aggiuntive
	handlers.SetupRoutes(router)
	
	// Inizializza e avvia il servizio dei reminder
	reminderService = handlers.NewReminderService(dbManager)
	reminderService.Start()
	fmt.Println("Servizio reminder avviato - controllo ogni minuto")
	
	// Inizializza e avvia il servizio degli alert automatici
	alertService = handlers.NewAlertService("120363401713435750@g.us")
	alertService.Start()
	fmt.Println("🤖 Servizio alert automatico avviato - polling ogni 30 secondi")
	
	// Inizializza il servizio degli account
	if whatsAppClientInstance != nil && whatsAppClientInstance.Client != nil {
		accountService = handlers.NewAccountService(dbManager, whatsAppClientInstance.Client)
		fmt.Println("🔐 Servizio account inizializzato - comandi /account e /edit disponibili")
	}
	
	// Avvia il server HTTP in una goroutine
	go func() {
		port := ":8080"
		if config != nil {
			port = fmt.Sprintf(":%d", config.Server.Port)
		}
		fmt.Printf("Avvio server HTTP sulla porta %s...\n", port)
		if err := router.Run(port); err != nil {
			fmt.Printf("Errore nell'avvio del server: %v\n", err)
		}
	}()
	
	fmt.Println("Server API avviato su http://localhost:8080")
	fmt.Println("Interfaccia web disponibile su http://localhost:8080/ e http://localhost:8080/web")
	fmt.Println("NOTA: Se WhatsApp non è connesso, l'invio messaggi fallirà con errore 500")
	
	// Gestisci chiusura corretta
	c := make(chan os.Signal)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	
	fmt.Println("Arresto del servizio reminder...")
	if reminderService != nil {
		reminderService.Stop()
	}
	fmt.Println("Servizio reminder fermato.")
	
	fmt.Println("Arresto del servizio alert automatico...")
	if alertService != nil {
		alertService.Stop()
	}
	fmt.Println("Servizio alert automatico fermato.")
	
	fmt.Println("Disconnessione del client WhatsApp...")
	if whatsAppClientInstance != nil {
		whatsAppClientInstance.Disconnect() // Usa il metodo Disconnect del client wrapper (che chiama quello sottostante)
	}
	fmt.Println("Client WhatsApp disconnesso.")
}
