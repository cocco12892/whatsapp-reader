package handlers

import (
	"fmt"
	"log"
	"time"
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

	// Invia ciascun reminder via WebSocket
	for _, reminder := range dueReminders {
		// Crea un payload per il reminder
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
		
		// Marca il reminder come inviato
		if err := rs.dbManager.MarkReminderAsFired(reminder.ID); err != nil {
			log.Printf("Errore nel marcare il reminder %s come inviato: %v\n", reminder.ID, err)
		}
	}
} 