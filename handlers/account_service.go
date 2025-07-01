package handlers

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"whatsapp-reader/models"
)

// AccountService gestisce i comandi per gli account nel gruppo WhatsApp
type AccountService struct {
	dbManager      DBManager
	whatsappChatID string
	client         *whatsmeow.Client
}

const (
	ACCOUNT_CHAT_ID = "120363420671559483@g.us"
)

// NewAccountService crea un nuovo servizio per la gestione degli account
func NewAccountService(dbManager DBManager, client *whatsmeow.Client) *AccountService {
	return &AccountService{
		dbManager:      dbManager,
		whatsappChatID: ACCOUNT_CHAT_ID,
		client:         client,
	}
}

// HandleMessage gestisce i messaggi del gruppo per i comandi account
func (as *AccountService) HandleMessage(chatID string, senderID string, messageContent string) {
	// Verifica che il messaggio provenga dal gruppo corretto
	if chatID != as.whatsappChatID {
		return
	}

	messageContent = strings.TrimSpace(messageContent)
	log.Printf("🔐 AccountService: messaggio ricevuto da %s: %s", senderID, messageContent)

	// Gestisci i comandi
	if messageContent == "/account" {
		as.handleAccountListCommand(senderID)
	} else if messageContent == "/accountaltri" {
		as.handleAccountOthersCommand(senderID)
	} else if strings.HasPrefix(messageContent, "/edit ") {
		as.handleEditCommand(senderID, messageContent)
	} else if strings.HasPrefix(messageContent, "/deactivate ") {
		as.handleDeactivateCommand(senderID, messageContent)
	}
}

// handleAccountListCommand gestisce il comando /account per mostrare i propri account
func (as *AccountService) handleAccountListCommand(senderID string) {
	log.Printf("🔐 Comando /account ricevuto da %s", senderID)

	// Recupera gli account personali dal database (is_personal = true)
	accounts, err := as.dbManager.GetPersonalAccounts()
	if err != nil {
		log.Printf("❌ Errore nel recupero degli account: %v", err)
		as.sendWhatsAppMessage("❌ Errore nel recupero degli account dal database")
		return
	}

	if len(accounts) == 0 {
		as.sendWhatsAppMessage("📝 Nessun tuo account trovato.\n\n💡 *Comandi disponibili:*\n`/edit username password sito link` - Aggiungi/modifica account\n`/accountaltri` - Vedi account degli altri\n`/deactivate username sito` - Disattiva tuo account")
		return
	}

	// Costruisci la lista degli account
	var message strings.Builder
	message.WriteString(fmt.Sprintf("🔐 *I tuoi Account* (%d trovati)\n\n", len(accounts)))

	for i, account := range accounts {
		siteDisplay := account.Site
		if account.Link != "" {
			siteDisplay = fmt.Sprintf("%s - %s", account.Site, account.Link)
		}
		message.WriteString(fmt.Sprintf("*%d.* %s\n", i+1, siteDisplay))
		message.WriteString(fmt.Sprintf("👤 Username: `%s`\n", account.Username))
		message.WriteString(fmt.Sprintf("🔑 Password: `%s`\n", account.Password))
		if !account.UpdatedAt.IsZero() {
			message.WriteString(fmt.Sprintf("✏️ Modificato: %s\n", account.UpdatedAt.Format("02/01/2006 15:04")))
		}
		message.WriteString("\n")
	}

	message.WriteString("💡 *Comandi disponibili:*\n")
	message.WriteString("`/edit username password sito link` - Aggiungi/modifica\n")
	message.WriteString("`/deactivate username sito` - Disattiva account\n")
	message.WriteString("`/accountaltri` - Vedi account degli altri")

	as.sendWhatsAppMessage(message.String())
}

// handleAccountOthersCommand gestisce il comando /accountaltri per mostrare account degli altri
func (as *AccountService) handleAccountOthersCommand(senderID string) {
	log.Printf("🔐 Comando /accountaltri ricevuto da %s", senderID)

	// Recupera gli account degli altri dal database (is_personal = false)
	accounts, err := as.dbManager.GetOthersAccounts()
	if err != nil {
		log.Printf("❌ Errore nel recupero degli account degli altri: %v", err)
		as.sendWhatsAppMessage("❌ Errore nel recupero degli account dal database")
		return
	}

	if len(accounts) == 0 {
		as.sendWhatsAppMessage("📝 Nessun account di altri utenti trovato.\n\n💡 Usa `/account` per vedere i tuoi account.")
		return
	}

	// Costruisci la lista degli account raggruppati per creatore
	var message strings.Builder
	message.WriteString(fmt.Sprintf("👥 *Account degli Altri* (%d trovati)\n\n", len(accounts)))

	currentCreator := ""
	counter := 1
	for _, account := range accounts {
		if account.CreatedBy != currentCreator {
			if currentCreator != "" {
				message.WriteString("\n")
			}
			currentCreator = account.CreatedBy
			message.WriteString(fmt.Sprintf("👤 **Utente:** `%s`\n", account.CreatedBy))
		}
		
		siteDisplay := account.Site
		if account.Link != "" {
			siteDisplay = fmt.Sprintf("%s - %s", account.Site, account.Link)
		}
		message.WriteString(fmt.Sprintf("  *%d.* %s\n", counter, siteDisplay))
		message.WriteString(fmt.Sprintf("  👤 Username: `%s`\n", account.Username))
		message.WriteString(fmt.Sprintf("  🔑 Password: `%s`\n", account.Password))
		message.WriteString("\n")
		counter++
	}

	message.WriteString("💡 Usa `/account` per vedere i tuoi account.")

	as.sendWhatsAppMessage(message.String())
}

// handleEditCommand gestisce il comando /edit per aggiungere/modificare account
func (as *AccountService) handleEditCommand(senderID string, messageContent string) {
	log.Printf("🔐 Comando /edit ricevuto da %s", senderID)

	// Parse dei parametri del comando
	parts := strings.Fields(messageContent)
	if len(parts) < 4 || len(parts) > 5 {
		as.sendWhatsAppMessage("❌ Formato comando non valido.\n\nUso corretto:\n`/edit username password sito [link]`\n\nEsempio:\n`/edit mario123 password123 Gmail https://gmail.com`")
		return
	}

	username := parts[1]
	password := parts[2]
	site := parts[3]
	link := ""
	if len(parts) == 5 {
		link = parts[4]
	}

	// Verifica se esiste già un account con lo stesso username e sito
	existingAccount, err := as.dbManager.FindAccountForEdit(username, site)
	if err != nil && err.Error() != "sql: no rows in result set" {
		log.Printf("❌ Errore nel controllo account esistenti: %v", err)
		as.sendWhatsAppMessage("❌ Errore nel controllo account esistenti")
		return
	}

	now := time.Now()

	if existingAccount != nil {
		// Aggiorna account esistente
		existingAccount.Password = password
		existingAccount.Link = link
		existingAccount.UpdatedAt = now
		// Mantieni is_personal esistente o imposta default se vuoto
		if !existingAccount.IsPersonal {
			existingAccount.IsPersonal = true
		}

		if err := as.dbManager.UpdateAccount(existingAccount); err != nil {
			log.Printf("❌ Errore nell'aggiornamento account: %v", err)
			as.sendWhatsAppMessage("❌ Errore nell'aggiornamento dell'account")
			return
		}

		as.sendWhatsAppMessage(fmt.Sprintf("✅ Account aggiornato con successo!\n\n🏷️ *%s*\n👤 Username: `%s`\n🔑 Password: `%s`\n🔗 Link: %s", 
			site, username, password, link))
	} else {
		// Crea nuovo account
		newAccount := &models.Account{
			ID:         uuid.New().String(),
			Username:   username,
			Password:   password,
			Site:       site,
			Link:       link,
			CreatedAt:  now,
			CreatedBy:  senderID,
			IsActive:   true,
			IsPersonal: true, // Default: tutti gli account creati sono "nostri"
		}

		if err := as.dbManager.SaveAccount(newAccount); err != nil {
			log.Printf("❌ Errore nel salvataggio nuovo account: %v", err)
			as.sendWhatsAppMessage("❌ Errore nel salvataggio del nuovo account")
			return
		}

		as.sendWhatsAppMessage(fmt.Sprintf("✅ Nuovo account creato con successo!\n\n🏷️ *%s*\n👤 Username: `%s`\n🔑 Password: `%s`\n🔗 Link: %s\n📅 Creato: %s", 
			site, username, password, link, now.Format("02/01/2006 15:04")))
	}
}

// handleDeactivateCommand gestisce il comando /deactivate per disattivare un account
func (as *AccountService) handleDeactivateCommand(senderID string, messageContent string) {
	log.Printf("🔐 Comando /deactivate ricevuto da %s", senderID)

	// Parse dei parametri del comando
	parts := strings.Fields(messageContent)
	if len(parts) != 3 {
		as.sendWhatsAppMessage("❌ Formato comando non valido.\n\nUso corretto:\n`/deactivate username sito`\n\nEsempio:\n`/deactivate mario123 Gmail`")
		return
	}

	username := parts[1]
	site := parts[2]

	// Trova l'account da disattivare (qualsiasi utente può disattivare)
	account, err := as.dbManager.FindAccountForDeactivation(username, site)
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			as.sendWhatsAppMessage(fmt.Sprintf("❌ Nessun account trovato con username `%s` e sito `%s`", username, site))
		} else {
			log.Printf("❌ Errore nella ricerca account: %v", err)
			as.sendWhatsAppMessage("❌ Errore nella ricerca dell'account")
		}
		return
	}

	// Disattiva l'account
	if err := as.dbManager.DeactivateAccount(account.ID); err != nil {
		log.Printf("❌ Errore nella disattivazione account: %v", err)
		as.sendWhatsAppMessage("❌ Errore nella disattivazione dell'account")
		return
	}

	linkDisplay := ""
	if account.Link != "" {
		linkDisplay = fmt.Sprintf(" - %s", account.Link)
	}

	as.sendWhatsAppMessage(fmt.Sprintf("✅ Account disattivato con successo!\n\n🏷️ *%s%s*\n👤 Username: `%s`\n🚫 Stato: Disattivato", 
		account.Site, linkDisplay, account.Username))
}

// sendWhatsAppMessage invia un messaggio al gruppo WhatsApp
func (as *AccountService) sendWhatsAppMessage(text string) {
	if as.client == nil {
		log.Printf("❌ Client WhatsApp non disponibile")
		return
	}

	// Verifica che il client sia connesso
	if !as.client.IsConnected() {
		log.Printf("❌ Client WhatsApp non connesso")
		return
	}

	log.Printf("🔐 Tentativo invio messaggio al gruppo: %s", as.whatsappChatID)
	
	chatJID, err := types.ParseJID(as.whatsappChatID)
	if err != nil {
		log.Printf("❌ Errore nel parsing JID chat %s: %v", as.whatsappChatID, err)
		return
	}

	log.Printf("🔐 JID parsato correttamente: %s", chatJID.String())

	msg := &waProto.Message{
		Conversation: proto.String(text),
	}

	_, err = as.client.SendMessage(context.Background(), chatJID, msg)
	if err != nil {
		log.Printf("❌ Errore nell'invio messaggio WhatsApp al gruppo %s: %v", chatJID.String(), err)
		
		// Retry dopo 2 secondi
		log.Printf("🔄 Riprovo invio messaggio tra 2 secondi...")
		time.Sleep(2 * time.Second)
		_, retryErr := as.client.SendMessage(context.Background(), chatJID, msg)
		if retryErr != nil {
			log.Printf("❌ Secondo tentativo fallito: %v", retryErr)
		} else {
			log.Printf("✅ Messaggio inviato al secondo tentativo!")
		}
	} else {
		log.Printf("✅ Messaggio inviato al gruppo account: %s", text[:min(50, len(text))])
	}
}

// min restituisce il minimo tra due interi
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
} 