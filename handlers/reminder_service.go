package handlers

import (
	"context"
	"fmt"
	"log"
	"time"
	
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"whatsapp-reader/models"
	"whatsapp-reader/whatsapp"
)

// ReminderService gestisce il controllo periodico dei reminder
type ReminderService struct {
	dbManager DBManager
	isRunning bool
	stopChan  chan struct{}
}

// NewReminderService crea un nuovo servizio per i reminder
func NewReminderService(dbManager DBManager) *ReminderService {
	return &ReminderService{
		dbManager: dbManager,
		isRunning: false,
		stopChan:  make(chan struct{}),
	}
}

// Start avvia il servizio di controllo dei reminder
func (rs *ReminderService) Start() {
	if rs.isRunning {
		log.Println("Il servizio reminder è già in esecuzione")
		return
	}

	rs.isRunning = true
	log.Println("Servizio reminder avviato")

	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		// Esegui subito il primo controllo
		rs.checkReminders()

		for {
			select {
			case <-ticker.C:
				rs.checkReminders()
			case <-rs.stopChan:
				log.Println("Servizio reminder fermato")
				return
			}
		}
	}()
}

// Stop ferma il servizio di controllo dei reminder
func (rs *ReminderService) Stop() {
	if !rs.isRunning {
		return
	}

	rs.stopChan <- struct{}{}
	rs.isRunning = false
}

// checkReminders controlla i reminder scaduti e li invia
func (rs *ReminderService) checkReminders() {
	now := time.Now()
	log.Printf("Controllo reminder alle %s (timezone: %s)", 
		now.Format("2006-01-02 15:04:05"), now.Location().String())
	
	// Ottieni i reminder scaduti
	dueReminders, err := rs.dbManager.GetDueReminders()
	if err != nil {
		log.Printf("Errore nel recupero dei reminder scaduti: %v\n", err)
		return
	}

	if len(dueReminders) == 0 {
		return
	}

	log.Printf("Trovati %d reminder da inviare\n", len(dueReminders))

	// Raggruppa i reminder per chat per evitare invii multipli contemporanei
	remindersByChat := make(map[string][]*models.Reminder)
	for _, reminder := range dueReminders {
		remindersByChat[reminder.ChatID] = append(remindersByChat[reminder.ChatID], reminder)
	}

	// Invia i reminder chat per chat con un piccolo delay tra le chat
	for chatID, chatReminders := range remindersByChat {
		log.Printf("Invio %d reminder per la chat %s", len(chatReminders), chatID)
		
		for i, reminder := range chatReminders {
			// Log dettagliato del reminder
			log.Printf("Invio reminder %s: scheduled_time=%s, now=%s, status=%s", 
				reminder.ID, 
				reminder.ScheduledTime.Format("2006-01-02 15:04:05"), 
				now.Format("2006-01-02 15:04:05"),
				reminder.Status)
			
			// Doppio controllo: verifica che il reminder non sia già stato inviato
			// durante questa esecuzione (race condition protection)
			currentReminder, err := rs.dbManager.GetReminderByID(reminder.ID)
			if err != nil {
				log.Printf("Errore nel verificare lo stato del reminder %s: %v", reminder.ID, err)
				continue
			}
			
			if currentReminder.Status != models.ReminderStatusPending {
				log.Printf("Reminder %s non è più pending (status=%s), salto", reminder.ID, currentReminder.Status)
				continue
			}
			
			// Incrementa il contatore dei tentativi
			attemptCount := currentReminder.AttemptCount + 1
			
			// Prova a marcare il reminder come in elaborazione
			err = rs.dbManager.MarkReminderAsProcessing(reminder.ID, attemptCount)
			if err != nil {
				log.Printf("Errore nel marcare il reminder %s come in elaborazione: %v\n", reminder.ID, err)
				continue
			}
			
			// Invia il reminder via WhatsApp (messaggio reale)
			sent := rs.sendWhatsAppMessage(reminder)
			
			// Aggiorna lo stato finale in base al risultato
			if sent {
				// Marca come inviato con successo
				if err := rs.dbManager.MarkReminderAsSent(reminder.ID); err != nil {
					log.Printf("Errore nel marcare il reminder %s come inviato: %v\n", reminder.ID, err)
				}
				
				// Invia anche la notifica via WebSocket per aggiornare l'interfaccia
				payload := map[string]interface{}{
					"chatId":      reminder.ChatID,
					"reminderMessage": map[string]interface{}{
						"id":        fmt.Sprintf("reminder_%s", reminder.ID),
						"message":   reminder.Message,
						"timestamp": time.Now(),
						"senderName": "Sistema",
						"isSystemMessage": true,
						"isReminder": true,
						"scheduledTime": reminder.ScheduledTime,
						"createdBy": reminder.CreatedBy,
					},
				}

				// Invia il reminder via WebSocket
				BroadcastMessageToClients("reminder", payload)
				
				log.Printf("Reminder %s inviato con successo", reminder.ID)
			} else {
				// Marca come fallito
				if err := rs.dbManager.MarkReminderAsFailed(reminder.ID, "Errore nell'invio WhatsApp"); err != nil {
					log.Printf("Errore nel marcare il reminder %s come fallito: %v", reminder.ID, err)
				}
				log.Printf("Fallimento nell'invio del reminder %s", reminder.ID)
			}
			
			// Piccolo delay tra i reminder della stessa chat per evitare spam
			if i < len(chatReminders)-1 {
				time.Sleep(500 * time.Millisecond)
			}
		}
		
		// Delay più lungo tra chat diverse
		time.Sleep(1 * time.Second)
	}
}

// sendWhatsAppMessage invia un messaggio WhatsApp per un reminder
func (rs *ReminderService) sendWhatsAppMessage(reminder *models.Reminder) bool {
	// Verifica che il client WhatsApp sia inizializzato
	if whatsapp.WhatsmeowClient == nil {
		log.Println("Client WhatsApp non inizializzato, impossibile inviare il reminder")
		return false
	}
	
	// Verifica che il client sia connesso
	if !whatsapp.WhatsmeowClient.IsConnected() {
		log.Println("Client WhatsApp non connesso, impossibile inviare il reminder")
		return false
	}
	
	// Converti l'ID della chat in JID
	chatJID, err := types.ParseJID(reminder.ChatID)
	if err != nil {
		log.Printf("Errore nel parsing del JID della chat per il reminder: %v\n", err)
		return false
	}
	
	// Formatta il messaggio del reminder
	messageText := fmt.Sprintf("⏰ *REMINDER*\n\n%s\n\n_(Programmato da %s)_", 
		reminder.Message, 
		reminder.CreatedBy)
	
	// Crea il messaggio WhatsApp
	msg := &waE2E.Message{
		Conversation: proto.String(messageText),
	}
	
	// Invia il messaggio
	ctx := context.Background()
	_, err = whatsapp.WhatsmeowClient.SendMessage(ctx, chatJID, msg)
	
	if err != nil {
		log.Printf("Errore nell'invio del messaggio WhatsApp per il reminder: %v\n", err)
		return false
	}
	
	log.Printf("Reminder inviato con successo alla chat %s: %s\n", reminder.ChatName, reminder.Message)
	return true
} 