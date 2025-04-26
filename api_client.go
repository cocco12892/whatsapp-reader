package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Struttura per la richiesta di creazione del codice giocata
type CodiceGiocataRequest struct {
	Evento      string  `json:"evento"`
	Esito       string  `json:"esito"`
	TipsterID   int     `json:"tipster_id"`
	Percentuale float64 `json:"percentuale"`
	ImmagineURL string  `json:"immagine_url"`
	APIKey      string  `json:"api_key"`
}

// Struttura per la risposta dell'API
type CodiceGiocataResponse struct {
	Success bool   `json:"success"`
	Codice  string `json:"codice,omitempty"`
	Errore  string `json:"errore,omitempty"`
}

// Funzione per creare un codice giocata tramite API
func createCodiceGiocata(message Message, nota string) {
	fmt.Printf("Creazione automatica codice giocata per messaggio: %s\n", message.ID)
	
	// Prepara i dati per l'API
	evento := message.Content
	esito := nota
	if esito == "" {
		esito = "Esito non specificato"
	}
	
	// Crea la richiesta
	requestData := CodiceGiocataRequest{
		Evento:      evento,
		Esito:       esito,
		TipsterID:   1, // Valore predefinito
		Percentuale: 0.3, // Valore predefinito
		ImmagineURL: "https://example.com/image.jpg", // URL hardcoded come richiesto
		APIKey:      "betste_secret_key",
	}
	
	// Converti la richiesta in JSON
	jsonData, err := json.Marshal(requestData)
	if err != nil {
		fmt.Printf("Errore nella serializzazione JSON: %v\n", err)
		return
	}
	
	// Crea la richiesta HTTP
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	
	req, err := http.NewRequest("POST", "http://localhost:8000/api/v1/create-codice-giocata/", bytes.NewBuffer(jsonData))
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
	
	// Leggi la risposta
	var response CodiceGiocataResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		fmt.Printf("Errore nella decodifica della risposta: %v\n", err)
		return
	}
	
	// Verifica il risultato
	if response.Success {
		fmt.Printf("Codice giocata creato con successo: %s\n", response.Codice)
		
		// Notifica i client WebSocket del codice creato
		broadcastToClients("codice_giocata_created", map[string]interface{}{
			"messageId": message.ID,
			"codice":    response.Codice,
			"evento":    evento,
			"esito":     esito,
		})
	} else {
		fmt.Printf("Errore nella creazione del codice giocata: %s\n", response.Errore)
		
		// Notifica i client WebSocket dell'errore
		broadcastToClients("codice_giocata_error", map[string]interface{}{
			"messageId": message.ID,
			"errore":    response.Errore,
		})
	}
}
