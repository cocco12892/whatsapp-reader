package handlers

import (
	"net/http"
	"github.com/gorilla/websocket"
	"whatsapp-reader/models"
)

var (
	// WebSocket upgrader
	wsUpgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Consenti tutte le origini in sviluppo
		},
	}
)

// BroadcastToClients invia un messaggio a tutti i client WebSocket connessi
func BroadcastToClients(messageType string, payload interface{}) {
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
	
	for client := range wsClients {
		err := client.WriteJSON(wsMessage)
		if err != nil {
			client.Close()
			delete(wsClients, client)
		}
	}
}

// HandleWebSocket gestisce le connessioni WebSocket
func HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, "Could not upgrade connection", http.StatusInternalServerError)
		return
	}
	
	wsClientsMux.Lock()
	wsClients[conn] = true
	wsClientsMux.Unlock()
	
	// Cleanup quando la connessione viene chiusa
	defer func() {
		wsClientsMux.Lock()
		delete(wsClients, conn)
		wsClientsMux.Unlock()
		conn.Close()
	}()
	
	// Loop di lettura messaggi
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
} 
