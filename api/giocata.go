package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
	"whatsapp-reader/handlers"
	"whatsapp-reader/models"
	"go.mau.fi/whatsmeow/types"
)

// CreateGiocataAI crea una giocata AI tramite API
func CreateGiocataAI(message *models.Message, chatJID string, messageID string, dbManager interface{}) {
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
		
		imageBase64, err := getImageBase64(fullPath)
		if err != nil {
			fmt.Printf("Errore nel recupero dell'immagine: %v\n", err)
			requestData.ImmagineBase64 = getHardcodedImage()
		} else {
			requestData.ImmagineBase64 = imageBase64
		}
	} else {
		// Se non è un'immagine, usa il contenuto come evento
		requestData.Evento = message.Content
	}
	
	// Invia la richiesta all'API
	response, err := sendAPIRequest(requestData)
	if err != nil {
		fmt.Printf("Errore nell'invio della richiesta API: %v\n", err)
		return
	}
	
	// Gestisci la risposta
	handleAPIResponse(response, messageID, chatJID, dbManager)
}

// getImageBase64 ottiene il base64 di un'immagine dato il suo percorso
func getImageBase64(fullPath string) (string, error) {
	// Verifica se il file esiste
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		fmt.Printf("ERRORE: Il file immagine non esiste: %s\n", fullPath)
		
		// Prova percorsi alternativi
		alternativePaths := []string{
			strings.TrimPrefix(fullPath, "./"),           // Prova senza il punto iniziale
			strings.TrimPrefix(fullPath, "/"),            // Rimuovi lo slash iniziale
			"Immagini" + fullPath,                        // Prova con il prefisso Immagini
			"./Immagini" + strings.TrimPrefix(fullPath, "/images"), // Converti il percorso web in percorso file
		}
		
		for _, altPath := range alternativePaths {
			fmt.Printf("Provo percorso alternativo: %s\n", altPath)
			if _, err := os.Stat(altPath); !os.IsNotExist(err) {
				fullPath = altPath
				break
			}
		}
	}
	
	// Leggi il file dell'immagine
	imgData, err := os.ReadFile(fullPath)
	if err != nil {
		return "", err
	}
	
	// Converti in base64
	mimeType := "image/jpeg" // Assumiamo JPEG come default
	if strings.HasSuffix(fullPath, ".png") {
		mimeType = "image/png"
	}
	
	base64Data := base64.StdEncoding.EncodeToString(imgData)
	if len(base64Data) == 0 {
		return "", fmt.Errorf("base64 vuoto dopo la conversione")
	}
	
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
}

// getHardcodedImage restituisce un'immagine hardcoded in base64
func getHardcodedImage() string {
	return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBg0JCggKDw0QEA8NDw4RExgUERIXEg4PFRwVFxkZGxsbEBQdHx0aHxgaGxr/U6fNIOr5hskiAICfARBIybXv1EJRyk3JYPV7RwHd4aoVQkB2AHx9Gtpbqn5SAcuAEq/yTvxfvV4E1RhckF4VV9gUwXgw6IBNfu7p2wXAU8jriTgFakIFXX729ymitSVCJR6n1Mc/H/epIMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNIYYYYYYYYYYYYZ1C3gGikdP8X2TuCegv0Gl/a37/AKH6cDl9Toz4ZUec9M078PM38eMzeMN1Q5McKm7uOm/hjzJ96H9ghqCVwLgmPpPl/wA6NHOjRoxgAmROLjquAaME+8f2Q/an77//2Q=="
}

// sendAPIRequest invia una richiesta all'API
func sendAPIRequest(requestData models.GiocataAIRequest) (*models.GiocataAIResponse, error) {
	// Converti la richiesta in JSON
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		return nil, fmt.Errorf("errore nella serializzazione JSON: %v", err)
	}
	
	// Log dettagliato della richiesta
	logRequestDetails(requestData)
	
	// Crea la richiesta HTTP con timeout più lungo
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	
	// Crea la richiesta HTTP
	req, err := http.NewRequest("POST", "http://127.0.0.1:8000/api/v1/create-giocata-ai/", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("errore nella creazione della richiesta HTTP: %v", err)
	}
	
	// Imposta gli header
	req.Header.Set("Content-Type", "application/json")
	
	// Invia la richiesta
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("errore nell'invio della richiesta HTTP: %v", err)
	}
	defer resp.Body.Close()
	
	// Leggi la risposta
	var response models.GiocataAIResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("errore nella decodifica della risposta JSON: %v", err)
	}
	
	return &response, nil
}

// logRequestDetails logga i dettagli della richiesta
func logRequestDetails(requestData models.GiocataAIRequest) {
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
}

// handleAPIResponse gestisce la risposta dell'API
func handleAPIResponse(response *models.GiocataAIResponse, messageID string, chatJID string, dbManager interface{}) {
	if response.Success {
		fmt.Printf("Giocata AI creata con successo: %s\n", response.Data.CodiceGiocata)
		
		// Notifica i client WebSocket della giocata creata
		handlers.BroadcastToClients("giocata_ai_created", map[string]interface{}{
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
			
			// TODO: Implementare la logica per aggiungere la reazione al messaggio
			fmt.Printf("TODO: Aggiungere reazione 🧾 al messaggio %s nella chat %s\n", msgID, chatJIDObj.String())
		}
	} else {
		fmt.Printf("Errore nella creazione della giocata AI: %v\n", response.Error)
	}
} 