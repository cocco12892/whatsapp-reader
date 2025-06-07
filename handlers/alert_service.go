package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"whatsapp-reader/whatsapp"
)

// AlertService gestisce il monitoraggio automatico degli alert
type AlertService struct {
	isRunning          bool
	stopChan           chan struct{}
	lastCursor         int64
	processedAlerts    map[string]bool
	eventDataCache     map[string]interface{}
	eventDataTimestamp map[string]int64
	whatsappChatID     string
}

// Alert rappresenta un alert da pod-dolphin
type Alert struct {
	ID          string  `json:"id"`
	EventID     string  `json:"eventId"`
	Home        string  `json:"home"`
	Away        string  `json:"away"`
	LeagueName  string  `json:"leagueName"`
	LineType    string  `json:"lineType"`
	Outcome     string  `json:"outcome"`
	Points      string  `json:"points"`
	ChangeFrom  string  `json:"changeFrom"`
	ChangeTo    string  `json:"changeTo"`
	Starts      int64   `json:"starts"`
}

// EventData rappresenta i dati dell'evento da swordfish
type EventData struct {
	Starts  int64                  `json:"starts"`
	Periods map[string]interface{} `json:"periods"`
}

// NewAlertService crea un nuovo servizio per gli alert automatici
func NewAlertService(whatsappChatID string) *AlertService {
	return &AlertService{
		isRunning:          false,
		stopChan:           make(chan struct{}),
		lastCursor:         1743067773853, // Valore di default
		processedAlerts:    make(map[string]bool),
		eventDataCache:     make(map[string]interface{}),
		eventDataTimestamp: make(map[string]int64),
		whatsappChatID:     whatsappChatID,
	}
}

// Start avvia il servizio di monitoraggio
func (as *AlertService) Start() {
	if as.isRunning {
		log.Println("Alert service già in esecuzione")
		return
	}

	as.isRunning = true
	log.Println("🤖 Alert service avviato - polling ogni 30 secondi")

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		// Esegui subito il primo controllo
		as.checkAlerts()

		for {
			select {
			case <-ticker.C:
				as.checkAlerts()
			case <-as.stopChan:
				log.Println("Alert service fermato")
				return
			}
		}
	}()
}

// Stop ferma il servizio
func (as *AlertService) Stop() {
	if !as.isRunning {
		return
	}

	as.stopChan <- struct{}{}
	as.isRunning = false
}

// checkAlerts controlla nuovi alert da pod-dolphin
func (as *AlertService) checkAlerts() {
	log.Println("🔍 Checking for new alerts...")

	// Chiamata a pod-dolphin
	url := fmt.Sprintf("https://pod-dolphin.fly.dev/alerts/user_2ip8HMVMMWrz0jJyFxT86OB5ZnU?dropNotificationsCursor=%d", as.lastCursor)
	
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("❌ Errore nel fetch degli alert: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ Errore HTTP: %d", resp.StatusCode)
		return
	}

	var result struct {
		Data []Alert `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("❌ Errore nel parsing JSON: %v", err)
		return
	}

	if len(result.Data) == 0 {
		log.Println("✅ Nessun nuovo alert")
		return
	}

	log.Printf("📊 Trovati %d nuovi alert", len(result.Data))

	// Aggiorna il cursor
	for _, alert := range result.Data {
		timestamp, err := strconv.ParseInt(strings.Split(alert.ID, "-")[0], 10, 64)
		if err == nil && timestamp > as.lastCursor {
			as.lastCursor = timestamp
		}
	}

	// Processa ogni alert
	for _, alert := range result.Data {
		// Evita duplicati
		if as.processedAlerts[alert.ID] {
			continue
		}

		// Processa l'alert
		if as.processAlert(alert) {
			as.processedAlerts[alert.ID] = true
		}
	}
}

// processAlert processa un singolo alert
func (as *AlertService) processAlert(alert Alert) bool {
	log.Printf("🔍 Processing alert: %s - %s vs %s", alert.ID, alert.Home, alert.Away)

	// Ottieni dati dell'evento
	eventData, err := as.getEventData(alert.EventID)
	if err != nil {
		log.Printf("❌ Errore nel recupero dati evento %s: %v", alert.EventID, err)
		return false
	}

	// Calcola NVP
	nvp, err := as.calculateNVP(alert, eventData)
	if err != nil {
		log.Printf("❌ Errore nel calcolo NVP per %s: %v", alert.ID, err)
		return false
	}

	// Verifica se vale la pena scommettere (NVP positivo)
	currentOdds, err := strconv.ParseFloat(alert.ChangeTo, 64)
	if err != nil {
		log.Printf("❌ Errore nel parsing delle quote: %v", err)
		return false
	}

	if nvp > currentOdds {
		log.Printf("✅ Alert positivo! NVP: %.2f > Quote: %.2f", nvp, currentOdds)
		as.sendWhatsAppNotification(alert, nvp)
		return true
	} else {
		log.Printf("⚠️ Alert negativo. NVP: %.2f <= Quote: %.2f", nvp, currentOdds)
		return true // Marca come processato comunque
	}
}

// getEventData ottieni dati dell'evento con cache
func (as *AlertService) getEventData(eventID string) (map[string]interface{}, error) {
	now := time.Now().Unix()

	// Controlla cache (5 minuti)
	if cached, exists := as.eventDataCache[eventID]; exists {
		if timestamp, ok := as.eventDataTimestamp[eventID]; ok && now-timestamp < 300 {
			return cached.(map[string]interface{}), nil
		}
	}

	// Fetch da swordfish
	url := fmt.Sprintf("https://swordfish-production.up.railway.app/events/%s", eventID)
	client := &http.Client{Timeout: 10 * time.Second}
	
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP error: %d", resp.StatusCode)
	}

	var result struct {
		Data map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	// Salva in cache
	as.eventDataCache[eventID] = result.Data
	as.eventDataTimestamp[eventID] = now

	return result.Data, nil
}

// calculateNVP calcola il No Vig Price usando JavaScript
func (as *AlertService) calculateNVP(alert Alert, eventData map[string]interface{}) (float64, error) {
	vm := goja.New()

	// Definisci le funzioni di calcolo NVP in JavaScript
	jsCode := `
	function calculateTwoWayNVP(homeOdds, awayOdds) {
		const homeProb = 1 / homeOdds;
		const awayProb = 1 / awayOdds;
		const totalProb = homeProb + awayProb;
		
		const trueHomeProb = homeProb / totalProb;
		const trueAwayProb = awayProb / totalProb;
		
		return {
			homeNVP: 1 / trueHomeProb,
			awayNVP: 1 / trueAwayProb
		};
	}

	function calculateThreeWayNVP(homeOdds, drawOdds, awayOdds) {
		const homeProb = 1 / homeOdds;
		const drawProb = 1 / drawOdds;
		const awayProb = 1 / awayOdds;
		const totalProb = homeProb + drawProb + awayProb;
		
		const trueHomeProb = homeProb / totalProb;
		const trueDrawProb = drawProb / totalProb;
		const trueAwayProb = awayProb / totalProb;
		
		return {
			homeNVP: 1 / trueHomeProb,
			drawNVP: 1 / trueDrawProb,
			awayNVP: 1 / trueAwayProb
		};
	}
	`

	_, err := vm.RunString(jsCode)
	if err != nil {
		return 0, fmt.Errorf("errore nell'esecuzione del JavaScript: %v", err)
	}

	// Converti eventData in JSON per JavaScript
	eventDataJSON, _ := json.Marshal(eventData)
	vm.Set("eventData", string(eventDataJSON))
	vm.Set("lineType", alert.LineType)
	vm.Set("outcome", alert.Outcome)
	vm.Set("points", alert.Points)

	// Logica di calcolo NVP specifica per tipo di scommessa
	calcCode := `
	const data = JSON.parse(eventData);
	const period0 = data.periods && data.periods.num_0;
	let nvpValue = null;

	if (!period0) {
		nvpValue = null;
	} else if (lineType === 'MONEYLINE' || lineType === 'money_line') {
		const moneyline = period0.money_line || {};
		
		if (moneyline.home && moneyline.away && !moneyline.draw) {
			// 2-way market
			const nvp = calculateTwoWayNVP(moneyline.home, moneyline.away);
			nvpValue = outcome.toLowerCase().includes('home') ? nvp.homeNVP : nvp.awayNVP;
		} else if (moneyline.home && moneyline.draw && moneyline.away) {
			// 3-way market
			const nvp = calculateThreeWayNVP(moneyline.home, moneyline.draw, moneyline.away);
			if (outcome.toLowerCase().includes('home')) {
				nvpValue = nvp.homeNVP;
			} else if (outcome.toLowerCase().includes('draw')) {
				nvpValue = nvp.drawNVP;
			} else {
				nvpValue = nvp.awayNVP;
			}
		}
	} else if (lineType === 'SPREAD') {
		const spreads = period0.spreads || {};
		const pointsKey = points || Object.keys(spreads)[0];
		
		if (spreads[pointsKey] && spreads[pointsKey].home && spreads[pointsKey].away) {
			const nvp = calculateTwoWayNVP(spreads[pointsKey].home, spreads[pointsKey].away);
			nvpValue = outcome.toLowerCase().includes('home') ? nvp.homeNVP : nvp.awayNVP;
		}
	} else if (lineType === 'TOTAL') {
		const totals = period0.totals || {};
		const pointsKey = points || Object.keys(totals)[0];
		
		if (totals[pointsKey] && totals[pointsKey].over && totals[pointsKey].under) {
			const nvp = calculateTwoWayNVP(totals[pointsKey].over, totals[pointsKey].under);
			nvpValue = outcome.toLowerCase().includes('over') ? nvp.homeNVP : nvp.awayNVP;
		}
	}

	nvpValue;
	`

	result, err := vm.RunString(calcCode)
	if err != nil {
		return 0, fmt.Errorf("errore nel calcolo NVP: %v", err)
	}

	if result.ToFloat() == 0 {
		return 0, fmt.Errorf("NVP non calcolabile per questo tipo di scommessa")
	}

	return result.ToFloat(), nil
}

// sendWhatsAppNotification invia notifica WhatsApp
func (as *AlertService) sendWhatsAppNotification(alert Alert, nvp float64) {
	log.Printf("📱 Sending WhatsApp notification for alert: %s", alert.ID)

	// Prepara il messaggio
	message := fmt.Sprintf("🚨 *ALERT POSITIVO!*\n\n"+
		"📊 *MATCH*: %s vs %s\n"+
		"🏆 *LEAGUE*: %s\n"+
		"📈 *FROM*: %s\n"+
		"📉 *TO*: %s\n"+
		"🔢 *NVP*: %.2f\n"+
		"💰 *EDGE*: %.2f%%\n"+
		"🎯 *BET*: %s %s %s",
		alert.Home, alert.Away,
		alert.LeagueName,
		alert.ChangeFrom,
		alert.ChangeTo,
		nvp,
		((nvp/parseFloat(alert.ChangeTo))-1)*100,
		alert.LineType, alert.Outcome, alert.Points)

	// Invia messaggio via API interna
	chatJID, err := types.ParseJID(as.whatsappChatID)
	if err != nil {
		log.Printf("❌ Errore nel parsing del JID: %v", err)
		return
	}

	// Crea il messaggio usando il protobuf corretto
	msg := &waE2E.Message{
		Conversation: proto.String(message),
	}
	
	_, err = whatsapp.WhatsmeowClient.SendMessage(context.Background(), chatJID, msg)
	if err != nil {
		log.Printf("❌ Errore nell'invio del messaggio WhatsApp: %v", err)
		return
	}

	log.Printf("✅ Messaggio WhatsApp inviato con successo!")

	// TODO: Generare e inviare il grafico
	// as.sendChart(alert)
}

// parseFloat helper per convertire stringhe in float
func parseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
} 