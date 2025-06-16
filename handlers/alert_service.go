package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/fogleman/gg"
	"go.mau.fi/whatsmeow"
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
	recentAlerts       map[string]int64 // Traccia alert recenti per evitare duplicati
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
	Starts      string  `json:"starts"`
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
		lastCursor:         1750064426000, // 9:00 UTC (16 June 2025)
		processedAlerts:    make(map[string]bool),
		eventDataCache:     make(map[string]interface{}),
		eventDataTimestamp: make(map[string]int64),
		recentAlerts:       make(map[string]int64),
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

	// Aggiorna il cursor PRIMA di processare per evitare di riprocessare gli stessi alert
	maxTimestamp := as.lastCursor
	for _, alert := range result.Data {
		timestamp, err := strconv.ParseInt(strings.Split(alert.ID, "-")[0], 10, 64)
		if err == nil && timestamp > maxTimestamp {
			maxTimestamp = timestamp
		}
	}
	as.lastCursor = maxTimestamp

	// Processa ogni alert
	for _, alert := range result.Data {
		// Evita duplicati basati sull'ID
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
		
		// Controlla se abbiamo già inviato un alert simile negli ultimi 5 minuti
		if as.isDuplicateAlert(alert) {
			log.Printf("🔄 Alert duplicato ignorato per %s vs %s (%s %s)", alert.Home, alert.Away, alert.LineType, alert.Outcome)
			return true
		}
		
		as.sendWhatsAppNotification(alert, nvp)
		as.markAlertAsSent(alert)
		return true
	} else {
		log.Printf("⚠️ Alert negativo. NVP: %.2f <= Quote: %.2f", nvp, currentOdds)
		return true // Marca come processato comunque
	}
}

// isDuplicateAlert controlla se un alert simile è stato inviato negli ultimi 5 minuti
func (as *AlertService) isDuplicateAlert(alert Alert) bool {
	// Crea una chiave unica basata su partita + tipo di scommessa + punti
	key := fmt.Sprintf("%s-%s-%s-%s-%s", alert.Home, alert.Away, alert.LineType, alert.Outcome, alert.Points)
	
	now := time.Now().Unix()
	
	// Controlla se esiste un alert recente (5 minuti = 300 secondi)
	if lastSent, exists := as.recentAlerts[key]; exists {
		if now-lastSent < 300 {
			return true
		}
	}
	
	// Pulisci alert vecchi (oltre 5 minuti)
	for k, timestamp := range as.recentAlerts {
		if now-timestamp >= 300 {
			delete(as.recentAlerts, k)
		}
	}
	
	return false
}

// markAlertAsSent marca un alert come inviato
func (as *AlertService) markAlertAsSent(alert Alert) {
	key := fmt.Sprintf("%s-%s-%s-%s-%s", alert.Home, alert.Away, alert.LineType, alert.Outcome, alert.Points)
	as.recentAlerts[key] = time.Now().Unix()
}

// getEventData ottieni dati dell'evento con cache
func (as *AlertService) getEventData(eventID string) (map[string]interface{}, error) {
	now := time.Now().Unix()

	// Controlla cache (10 secondi)
	if cached, exists := as.eventDataCache[eventID]; exists {
		if timestamp, ok := as.eventDataTimestamp[eventID]; ok && now-timestamp < 10 {
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

// calculateNVP calcola il No Vig Price usando l'algoritmo Power Method (same as frontend)
func (as *AlertService) calculateNVP(alert Alert, eventData map[string]interface{}) (float64, error) {
	vm := goja.New()

	// ALGORITMO POWER METHOD (identico al frontend per consistenza)
	jsCode := `
	// Power Method NVP Calculation (same as frontend)
	function calculateNVPValues(odds, tolerance = 0.0001, maxIterations = 100) {
		// Extract odds and convert to probabilities
		const probabilities = {};
		let totalProbability = 0;
		
		for (const [key, value] of Object.entries(odds)) {
			if (value !== undefined && value > 0) {
				probabilities[key] = 1 / value;
				totalProbability += probabilities[key];
			}
		}
		
		// Calculate bookmaker's margin
		const margin = totalProbability - 1;
		
		// Convert to array for processing
		const probabilityValues = Object.values(probabilities);
		
		// Apply power method to remove vigorish
		const fairProbabilities = powerMethod(probabilityValues, tolerance, maxIterations);
		
		// Convert fair probabilities back to odds (NVP)
		const nvpValues = {};
		const keys = Object.keys(probabilities);
		
		fairProbabilities.forEach((fairProb, index) => {
			nvpValues[keys[index]] = 1 / fairProb;
		});
		
		return {
			nvp: nvpValues,
			fairProbabilities: fairProbabilities.reduce((obj, prob, i) => {
				obj[keys[i]] = prob;
				return obj;
			}, {}),
			rawProbabilities: probabilities,
			margin: margin * 100
		};
	}

	function powerMethod(probabilities, tolerance, maxIterations) {
		let r = 1; // Initial exponent
		let adjustedProbs = probabilities.map(p => Math.pow(p, r));
		
		for (let i = 0; i < maxIterations; i++) {
			// Calculate difference from 1
			const sumProbs = adjustedProbs.reduce((sum, p) => sum + p, 0);
			const diff = sumProbs - 1;
			
			// If close enough to 1, we're done
			if (Math.abs(diff) < tolerance) {
				break;
			}
			
			// Calculate gradient for Newton-Raphson method
			const gradient = probabilities.reduce(
				(sum, p) => sum + Math.log(p) * Math.pow(p, r), 
				0
			);
			
			// Adjust r using Newton-Raphson step
			r -= diff / gradient;
			
			// Recalculate probabilities with new r
			adjustedProbs = probabilities.map(p => Math.pow(p, r));
		}
		
		return adjustedProbs;
	}

	// Calculate NVP for a 2-way market (spreads, totals)
	function calculateTwoWayNVP(home, away) {
		const odds = {
			home: parseFloat(home),
			away: parseFloat(away)
		};
		
		const result = calculateNVPValues(odds);
		return {
			homeNVP: result.nvp.home,
			awayNVP: result.nvp.away,
			margin: result.margin
		};
	}

	// Calculate NVP for a 3-way market (moneyline with draw)
	function calculateThreeWayNVP(home, draw, away) {
		const odds = {
			home: parseFloat(home),
			draw: parseFloat(draw),
			away: parseFloat(away)
		};
		
		const result = calculateNVPValues(odds);
		return {
			homeNVP: result.nvp.home,
			drawNVP: result.nvp.draw,
			awayNVP: result.nvp.away,
			margin: result.margin
		};
	}
	`;

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
	} else if (lineType === 'TOTAL' || lineType === 'total') {
		const totals = period0.totals || {};
		
		// Migliora il parsing dei punti (same logic as frontend)
		let pointsKey = points;
		
		// Se points è undefined o vuoto, prova a estrarre dal lineType
		if (!pointsKey && lineType) {
			const match = lineType.match(/total\s+(over|under)\s+([\d.]+)/i);
			if (match) {
				pointsKey = match[2];
			}
		}
		
		// Se non abbiamo punti, prendi il primo disponibile
		if (!pointsKey) {
			pointsKey = Object.keys(totals)[0];
		}
		
		// Assicurati che pointsKey sia una stringa per il matching
		const pointsStr = String(pointsKey);
		
		if (totals[pointsStr] && totals[pointsStr].over && totals[pointsStr].under) {
			const overOdds = parseFloat(totals[pointsStr].over);
			const underOdds = parseFloat(totals[pointsStr].under);
			
			const nvp = calculateTwoWayNVP(overOdds, underOdds);
			nvpValue = outcome.toLowerCase().includes('over') ? nvp.homeNVP : nvp.awayNVP;
		} else {
			// Prova a cercare con conversione numerica (fallback come frontend)
			const numericPoints = parseFloat(pointsStr);
			const alternativeKey = Object.keys(totals).find(key => parseFloat(key) === numericPoints);
			
			if (alternativeKey && totals[alternativeKey] && totals[alternativeKey].over && totals[alternativeKey].under) {
				const overOdds = parseFloat(totals[alternativeKey].over);
				const underOdds = parseFloat(totals[alternativeKey].under);
				
				const nvp = calculateTwoWayNVP(overOdds, underOdds);
				nvpValue = outcome.toLowerCase().includes('over') ? nvp.homeNVP : nvp.awayNVP;
			}
		}
	}

	nvpValue;
	`

	result, err := vm.RunString(calcCode)
	if err != nil {
		return 0, fmt.Errorf("errore nel calcolo NVP: %v", err)
	}

	// Controlla se il risultato è null/undefined piuttosto che solo 0
	if result.ToFloat() == 0 && result.String() != "0" {
		return 0, fmt.Errorf("NVP non calcolabile per questo tipo di scommessa")
	}

	return result.ToFloat(), nil
}

// sendWhatsAppNotification invia notifica WhatsApp
func (as *AlertService) sendWhatsAppNotification(alert Alert, nvp float64) {
	log.Printf("📱 Sending WhatsApp notification for alert: %s", alert.ID)

	// Estrai timestamp dall'ID dell'alert (formato: 1750058615638-0)
	var alertTime time.Time
	if parts := strings.Split(alert.ID, "-"); len(parts) > 0 {
		if timestamp, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
			alertTime = time.Unix(timestamp/1000, 0)
		}
	}
	if alertTime.IsZero() {
		alertTime = time.Now() // Fallback se non riesce a parsare
	}

	// Estrai timestamp della partita dal campo "starts"
	var matchTime time.Time
	if alert.Starts != "" {
		if timestamp, err := strconv.ParseInt(alert.Starts, 10, 64); err == nil {
			matchTime = time.Unix(timestamp/1000, 0)
		}
	}

	// Calcola il drop percentuale dalla quota iniziale a quella attuale
	fromOdds := parseFloat(alert.ChangeFrom)
	toOdds := parseFloat(alert.ChangeTo)
	dropPercentage := ((fromOdds - toOdds) / fromOdds) * 100

	// Prepara il messaggio con le date
	message := fmt.Sprintf("🚨 *ALERT POSITIVO!*\n\n"+
		"📊 *MATCH*: %s vs %s\n"+
		"🏆 *LEAGUE*: %s\n"+
		"⏰ *ALERT TIME*: %s\n"+
		"🕐 *MATCH START*: %s\n"+
		"📈 *FROM*: %s\n"+
		"📉 *TO*: %s\n"+
		"🔢 *NVP*: %.2f\n"+
		"📉 *DROP*: %.2f%%\n"+
		"🎯 *BET*: %s %s %s",
		alert.Home, alert.Away,
		alert.LeagueName,
		alertTime.Format("15:04:05 02/01/2006"),
		func() string {
			if matchTime.IsZero() {
				return "N/A"
			}
			return matchTime.Format("15:04:05 02/01/2006")
		}(),
		alert.ChangeFrom,
		alert.ChangeTo,
		nvp,
		dropPercentage,
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

	// Genera e invia il grafico
	as.sendChart(alert, nvp)
}

// sendChart genera e invia il grafico dell'evento
func (as *AlertService) sendChart(alert Alert, nvp float64) {
	log.Printf("📈 Generating chart for alert: %s", alert.ID)

	// Ottieni dati dell'evento per il grafico
	eventData, err := as.getEventData(alert.EventID)
	if err != nil {
		log.Printf("❌ Errore nel recupero dati per grafico: %v", err)
		return
	}

	// Genera l'immagine del grafico
	chartPath, err := as.generateChartImage(alert, eventData, nvp)
	if err != nil {
		log.Printf("❌ Errore nella generazione del grafico: %v", err)
		return
	}

	// Invia l'immagine via WhatsApp
	err = as.sendImageToWhatsApp(chartPath, alert)
	if err != nil {
		log.Printf("❌ Errore nell'invio dell'immagine: %v", err)
		return
	}

	// Rimuovi il file temporaneo
	os.Remove(chartPath)
	log.Printf("✅ Grafico inviato con successo!")
}

// generateChartImage genera un grafico sparkline dell'andamento delle quote
func (as *AlertService) generateChartImage(alert Alert, eventData map[string]interface{}, nvp float64) (string, error) {
	const width, height = 800, 800 // Immagine quadrata
	dc := gg.NewContext(width, height)

	// Sfondo gradient
	for i := 0; i < height; i++ {
		alpha := float64(i) / float64(height)
		dc.SetRGB(0.05+alpha*0.05, 0.08+alpha*0.08, 0.12+alpha*0.08)
		dc.DrawLine(0, float64(i), float64(width), float64(i))
		dc.Stroke()
	}

	// Estrai i dati storici
	periods, ok := eventData["periods"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("dati dei periodi non trovati")
	}
	
	period0, ok := periods["num_0"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("dati del periodo 0 non trovati")
	}

	history, ok := period0["history"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("dati storici non trovati")
	}

	// Header
	dc.SetRGB(1, 1, 1)
	title := fmt.Sprintf("%s vs %s", alert.Home, alert.Away)
	dc.DrawStringAnchored(title, float64(width)/2, 30, 0.5, 0.5)
	
	dc.SetRGB(0.8, 0.8, 0.8)
	league := fmt.Sprintf("🏆 %s", alert.LeagueName)
	dc.DrawStringAnchored(league, float64(width)/2, 55, 0.5, 0.5)

	// Info alert
	dc.SetRGB(0.2, 0.4, 0.6)
	dc.DrawRoundedRectangle(50, 80, float64(width-100), 40, 8)
	dc.Fill()
	
	dc.SetRGB(1, 1, 1)
	alertInfo := fmt.Sprintf("🚨 %s %s %s | FROM: %s → TO: %s | NVP: %.2f", 
		alert.LineType, alert.Outcome, alert.Points, alert.ChangeFrom, alert.ChangeTo, nvp)
	dc.DrawStringAnchored(alertInfo, float64(width)/2, 100, 0.5, 0.5)

	// Estrai i dati storici per l'alert specifico
	chartData, err := as.extractHistoricalData(history, alert)
	if err != nil {
		return "", fmt.Errorf("errore nell'estrazione dati storici: %v", err)
	}

	if len(chartData) == 0 {
		// Nessun dato storico, mostra solo info alert
		dc.SetRGB(0.8, 0.8, 0.8)
		dc.DrawStringAnchored("Nessun dato storico disponibile", float64(width)/2, float64(height)/2, 0.5, 0.5)
	} else {
		// Disegna il grafico sparkline - usa più spazio verticale per formato quadrato
		as.drawSparklineChart(dc, chartData, alert, nvp, 140, float64(width-100), float64(height-180))
	}

	// Timestamp
	dc.SetRGB(0.6, 0.6, 0.6)
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	dc.DrawStringAnchored("Generated: "+timestamp, float64(width)/2, float64(height)-20, 0.5, 0.5)

	// Salva l'immagine
	chartDir := "./charts"
	if err := os.MkdirAll(chartDir, 0755); err != nil {
		return "", fmt.Errorf("errore nella creazione directory charts: %v", err)
	}

	filename := fmt.Sprintf("alert_%s_%d.png", alert.EventID, time.Now().Unix())
	chartPath := filepath.Join(chartDir, filename)
	
	if err := dc.SavePNG(chartPath); err != nil {
		return "", fmt.Errorf("errore nel salvataggio del grafico: %v", err)
	}

	return chartPath, nil
}

// ChartDataPoint rappresenta un punto nel grafico
type ChartDataPoint struct {
	Timestamp int64
	Odds      float64
	Limit     float64
}

// extractHistoricalData estrae i dati storici per l'alert specifico
func (as *AlertService) extractHistoricalData(history map[string]interface{}, alert Alert) ([]ChartDataPoint, error) {
	var rawData []interface{}
	
	// Estrai i dati in base al tipo di alert
	switch strings.ToUpper(alert.LineType) {
	case "MONEYLINE", "MONEY_LINE":
		moneyline, ok := history["moneyline"].(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("dati moneyline non trovati")
		}
		
		outcome := strings.ToLower(alert.Outcome)
		if outcome == "home" || strings.Contains(outcome, "home") {
			if data, ok := moneyline["home"].([]interface{}); ok {
				rawData = data
			}
		} else if outcome == "away" || strings.Contains(outcome, "away") {
			if data, ok := moneyline["away"].([]interface{}); ok {
				rawData = data
			}
		} else if outcome == "draw" || strings.Contains(outcome, "draw") {
			if data, ok := moneyline["draw"].([]interface{}); ok {
				rawData = data
			}
		}
		
	case "SPREAD", "SPREADS":
		spreads, ok := history["spreads"].(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("dati spreads non trovati")
		}
		
		points := alert.Points
		if points == "" {
			// Prendi il primo spread disponibile
			for k := range spreads {
				points = k
				break
			}
		}
		
		if spreadData, ok := spreads[points].(map[string]interface{}); ok {
			outcome := strings.ToLower(alert.Outcome)
			if outcome == "home" || strings.Contains(outcome, "home") {
				if data, ok := spreadData["home"].([]interface{}); ok {
					rawData = data
				}
			} else if outcome == "away" || strings.Contains(outcome, "away") {
				if data, ok := spreadData["away"].([]interface{}); ok {
					rawData = data
				}
			}
		}
		
	case "TOTAL", "TOTALS":
		totals, ok := history["totals"].(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("dati totals non trovati")
		}
		
		points := alert.Points
		var totalData map[string]interface{}
		var found bool
		
		// Prova prima con la chiave esatta
		if totalData, found = totals[points].(map[string]interface{}); !found {
			// Prova solo con varianti logiche dello stesso numero
			if _, err := strconv.ParseFloat(points, 64); err == nil {
				// Prova con formato alternativo (3.5 -> "3.5", 3 -> "3.0")
				variants := []string{}
				if strings.Contains(points, ".") {
					// Se ha decimali, prova senza decimali se è .0
					if strings.HasSuffix(points, ".0") {
						variants = append(variants, strings.TrimSuffix(points, ".0"))
					}
				} else {
					// Se non ha decimali, prova con .0
					variants = append(variants, points+".0")
				}
				
				for _, variant := range variants {
					if totalData, found = totals[variant].(map[string]interface{}); found {
						break
					}
				}
			}
			
			// Se ancora non trovato e points è vuoto, prendi il primo disponibile
			if !found && points == "" {
				for _, v := range totals {
					if totalData, found = v.(map[string]interface{}); found {
						break
					}
				}
			}
		}
		
		if found {
			outcome := strings.ToLower(alert.Outcome)
			if outcome == "over" || strings.Contains(outcome, "over") {
				if data, ok := totalData["over"].([]interface{}); ok {
					rawData = data
				}
			} else if outcome == "under" || strings.Contains(outcome, "under") {
				if data, ok := totalData["under"].([]interface{}); ok {
					rawData = data
				}
			}
		}
	}
	
	if len(rawData) == 0 {
		return nil, fmt.Errorf("nessun dato storico trovato per %s %s %s", alert.LineType, alert.Outcome, alert.Points)
	}
	
	// Converti i dati grezzi in ChartDataPoint
	var chartData []ChartDataPoint
	for _, item := range rawData {
		if dataArray, ok := item.([]interface{}); ok && len(dataArray) >= 3 {
			timestamp, _ := dataArray[0].(float64)
			odds, _ := dataArray[1].(float64)
			limit, _ := dataArray[2].(float64)
			
			if odds > 0 { // Filtra quote valide
				chartData = append(chartData, ChartDataPoint{
					Timestamp: int64(timestamp),
					Odds:      odds,
					Limit:     limit,
				})
			}
		}
	}
	
	// Ordina per timestamp
	sort.Slice(chartData, func(i, j int) bool {
		return chartData[i].Timestamp < chartData[j].Timestamp
	})
	
	return chartData, nil
}

// drawSparklineChart disegna il grafico sparkline
func (as *AlertService) drawSparklineChart(dc *gg.Context, data []ChartDataPoint, alert Alert, nvp float64, startY float64, chartWidth float64, chartHeight float64) {
	if len(data) == 0 {
		return
	}
	
	// Margini
	margin := 50.0
	plotX := margin
	plotY := startY + 20
	plotWidth := chartWidth - 2*margin
	plotHeight := chartHeight - 60
	
	// Trova min/max per scaling delle quote
	minOdds := data[0].Odds
	maxOdds := data[0].Odds
	
	for _, point := range data {
		if point.Odds < minOdds {
			minOdds = point.Odds
		}
		if point.Odds > maxOdds {
			maxOdds = point.Odds
		}
	}
	
	// Aggiungi padding ai valori
	oddsRange := maxOdds - minOdds
	if oddsRange < 0.1 {
		oddsRange = 0.1
	}
	minOdds -= oddsRange * 0.1
	maxOdds += oddsRange * 0.1
	
	// Disegna sfondo del grafico
	dc.SetRGB(0.15, 0.15, 0.2)
	dc.DrawRectangle(plotX, plotY, plotWidth, plotHeight)
	dc.Fill()
	
	// Disegna bordo
	dc.SetRGB(0.4, 0.4, 0.4)
	dc.SetLineWidth(1)
	dc.DrawRectangle(plotX, plotY, plotWidth, plotHeight)
	dc.Stroke()
	
	// Disegna griglia
	dc.SetRGB(0.3, 0.3, 0.3)
	dc.SetLineWidth(0.5)
	for i := 1; i < 5; i++ {
		y := plotY + float64(i)*plotHeight/5
		dc.DrawLine(plotX, y, plotX+plotWidth, y)
		dc.Stroke()
	}
	
	// Disegna la linea delle quote
	dc.SetRGB(0.2, 0.8, 0.2) // Verde
	dc.SetLineWidth(2)
	
	// Usa l'indice dei dati invece del timestamp per l'asse X
	for i := 0; i < len(data)-1; i++ {
		x1 := plotX + float64(i)/float64(len(data)-1)*plotWidth
		y1 := plotY + plotHeight - (data[i].Odds-minOdds)/(maxOdds-minOdds)*plotHeight
		
		x2 := plotX + float64(i+1)/float64(len(data)-1)*plotWidth
		y2 := plotY + plotHeight - (data[i+1].Odds-minOdds)/(maxOdds-minOdds)*plotHeight
		
		dc.DrawLine(x1, y1, x2, y2)
		dc.Stroke()
	}
	
	// Aggiungi punti sui dati per evidenziare i valori
	dc.SetRGB(0.1, 0.6, 0.1)
	for i, point := range data {
		x := plotX + float64(i)/float64(len(data)-1)*plotWidth
		y := plotY + plotHeight - (point.Odds-minOdds)/(maxOdds-minOdds)*plotHeight
		dc.DrawCircle(x, y, 2)
		dc.Fill()
	}
	

	
	// Linea NVP (giallo)
	if nvp > 0 {
		y := plotY + plotHeight - (nvp-minOdds)/(maxOdds-minOdds)*plotHeight
		dc.SetRGB(1, 1, 0.2)
		dc.SetLineWidth(2)
		dc.SetDash(5, 5)
		dc.DrawLine(plotX, y, plotX+plotWidth, y)
		dc.Stroke()
		dc.SetDash() // Reset dash
	}
	
	// Labels degli assi
	dc.SetRGB(0.8, 0.8, 0.8)
	
	// Y-axis labels (odds)
	for i := 0; i <= 4; i++ {
		y := plotY + plotHeight - float64(i)*plotHeight/4
		odds := minOdds + float64(i)*(maxOdds-minOdds)/4
		dc.DrawStringAnchored(fmt.Sprintf("%.2f", odds), plotX-10, y, 1, 0.5)
	}
	
	// Legenda
	legendY := plotY + plotHeight + 30
	dc.SetRGB(0.2, 0.8, 0.2)
	dc.DrawLine(plotX, legendY, plotX+20, legendY)
	dc.Stroke()
	dc.SetRGB(0.8, 0.8, 0.8)
	dc.DrawStringAnchored("Quote", plotX+25, legendY, 0, 0.5)
	
	dc.SetRGB(1, 1, 0.2)
	dc.SetDash(5, 5)
	dc.DrawLine(plotX+80, legendY, plotX+100, legendY)
	dc.Stroke()
	dc.SetDash()
	dc.DrawStringAnchored("NVP", plotX+105, legendY, 0, 0.5)
}

// sendImageToWhatsApp invia un'immagine via WhatsApp
func (as *AlertService) sendImageToWhatsApp(imagePath string, alert Alert) error {
	// Leggi il file immagine
	imageData, err := os.ReadFile(imagePath)
	if err != nil {
		return fmt.Errorf("errore nella lettura dell'immagine: %v", err)
	}

	// Parse del JID
	chatJID, err := types.ParseJID(as.whatsappChatID)
	if err != nil {
		return fmt.Errorf("errore nel parsing del JID: %v", err)
	}

	// Upload dell'immagine
	uploaded, err := whatsapp.WhatsmeowClient.Upload(context.Background(), imageData, whatsmeow.MediaImage)
	if err != nil {
		return fmt.Errorf("errore nell'upload dell'immagine: %v", err)
	}

	// Crea il messaggio immagine
	imageMsg := &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			Mimetype:      proto.String("image/png"),
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(imageData))),
			Caption:       proto.String(fmt.Sprintf("📊 Chart for %s vs %s\n🎯 %s %s", alert.Home, alert.Away, alert.LineType, alert.Outcome)),
		},
	}

	// Invia il messaggio
	_, err = whatsapp.WhatsmeowClient.SendMessage(context.Background(), chatJID, imageMsg)
	if err != nil {
		return fmt.Errorf("errore nell'invio del messaggio immagine: %v", err)
	}

	return nil
}

// parseFloat helper per convertire stringhe in float
func parseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
} 