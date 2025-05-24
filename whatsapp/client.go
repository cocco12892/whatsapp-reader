package whatsapp

import (
	"context"
	"fmt"
	"net/http"
	"io"
	"os"
	"os/signal"
	"syscall"
	"sync"
	"time"

	"whatsapp-reader/utils"

	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
	// "whatsapp-reader/db" // Rimosso perché non utilizzato
)

var (
	// Cache per i nomi
	groupNameCache   sync.Map
	contactNameCache sync.Map
	// La variabile globale WhatsmeowClient è definita e impostata in main.go
)

// Client rappresenta il client WhatsApp
type Client struct {
	*whatsmeow.Client // Client whatsmeow effettivo
	eventHandler func(interface{})
}

// NewClient crea un nuovo client WhatsApp
// dbStore è sqlstore.Container, eventHandler è la funzione che gestirà gli eventi
func NewClient(dbStore *sqlstore.Container, eventHandler func(interface{})) (*Client, error) {
	deviceStore, err := dbStore.GetFirstDevice()
	if err != nil { // Errore durante il tentativo di recuperare il device
		return nil, fmt.Errorf("errore nel recupero del device: %v", err)
	}
	if deviceStore == nil { // Nessun device trovato (GetFirstDevice restituisce (nil, nil) in questo caso)
		fmt.Println("Nessun device memorizzato trovato, ne creo uno nuovo.")
		deviceStore = dbStore.NewDevice() // Crea un nuovo device
		if deviceStore == nil { // Ulteriore controllo, anche se NewDevice non dovrebbe restituire nil senza errore
			return nil, fmt.Errorf("impossibile creare un nuovo device store")
		}
	}
	
	// Configura il logger per il client whatsmeow
	clientLog := waLog.Stdout("Client", "DEBUG", true) 
	
	client := whatsmeow.NewClient(deviceStore, clientLog)
	return &Client{
		Client:       client,
		eventHandler: eventHandler,
	}, nil
}

// Connect connette il client a WhatsApp
// Questo è il metodo del nostro tipo Client wrapper.
func (c *Client) Connect() error {
	if c.eventHandler != nil {
		c.AddEventHandler(c.eventHandler) // Registra l'handler fornito
	}
	
	// Chiama il metodo Connect del client whatsmeow embeddato
	if err := c.Client.Connect(); err != nil {
		return fmt.Errorf("errore nella connessione del client whatsmeow: %v", err)
	}
	
	return nil
}

// WaitForQRCode attende il QR code per l'autenticazione
func (c *Client) WaitForQRCode() error {
	if c.Store.ID == nil {
		// Nessun dispositivo registrato, mostra il QR code
		ch, err := c.GetQRChannel(context.Background())
		if err != nil {
			return fmt.Errorf("errore nel recupero del canale QR: %v", err)
		}
		
		qrChan := <-ch
		qrterminal.GenerateHalfBlock(qrChan.Code, qrterminal.L, os.Stdout)
		
		// Attendi che il QR code venga scansionato e la connessione stabilita
		select {
		case evt := <-ch:
			if evt.Event == "code" {
				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
			}
		case <-time.After(5 * time.Minute):
			return fmt.Errorf("timeout nell'attesa della scansione del QR code")
		}
	}
	
	return nil
}

// WaitForInterrupt attende l'interruzione del programma
func (c *Client) WaitForInterrupt() {
	// Attendi il segnale di interruzione
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan
	
	// Disconnetti il client
	c.Disconnect()
}

// SendMessage invia un messaggio
func (c *Client) SendMessage(to types.JID, text string) error {
	msg := &waProto.Message{
		Conversation: proto.String(text),
	}
	
	_, err := c.Client.SendMessage(context.Background(), to, msg)
	return err
}

// AddReaction aggiunge una reazione a un messaggio
func (c *Client) AddReaction(chat types.JID, messageID string, reaction string) error {
	msg := &waProto.Message{
		ReactionMessage: &waProto.ReactionMessage{
			Key: &waProto.MessageKey{
				RemoteJID: proto.String(chat.String()),
				ID:        proto.String(messageID),
			},
			Text:              proto.String(reaction),
			SenderTimestampMS: proto.Int64(0),
		},
	}
	
	_, err := c.Client.SendMessage(context.Background(), chat, msg)
	return err
}

// HandleEvent gestisce gli eventi WhatsApp
func (c *Client) HandleEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		// Gestisci il messaggio
		fmt.Printf("[WHATSAPP CLIENT HANDLER] Ricevuto messaggio da %s (%s)\n", v.Info.Sender.String(), v.Info.PushName)
		if v.Message.GetConversation() != "" {
			fmt.Printf("[WHATSAPP CLIENT HANDLER] Testo: %s\n", v.Message.GetConversation())
		} else if v.Message.GetExtendedTextMessage() != nil && v.Message.GetExtendedTextMessage().GetText() != "" {
			fmt.Printf("[WHATSAPP CLIENT HANDLER] Testo Esteso: %s\n", v.Message.GetExtendedTextMessage().GetText())
		} else if img := v.Message.GetImageMessage(); img != nil {
			caption := img.GetCaption()
			if caption == "" && img.GetContextInfo() != nil && img.GetContextInfo().GetExtendedTextMessage() != nil { // A volte la didascalia è nell'extended text
				caption = img.GetContextInfo().GetExtendedTextMessage().GetText()
			}
			fmt.Printf("[WHATSAPP CLIENT HANDLER] Immagine ricevuta. Caption: %s, URL: %s\n", caption, img.GetURL())
		} else if vid := v.Message.GetVideoMessage(); vid != nil {
			caption := vid.GetCaption()
			if caption == "" && vid.GetContextInfo() != nil && vid.GetContextInfo().GetExtendedTextMessage() != nil {
				caption = vid.GetContextInfo().GetExtendedTextMessage().GetText()
			}
			fmt.Printf("[WHATSAPP CLIENT HANDLER] Video ricevuto. Caption: %s\n", caption)
		} else {
			fmt.Printf("[WHATSAPP CLIENT HANDLER] Ricevuto tipo messaggio non gestito esplicitamente: %+v\n", v.Message)
		}
		fmt.Printf("[WHATSAPP CLIENT HANDLER] Info complete messaggio: %+v\n", v.Info)

	case *events.Connected:
		// Gestisci la connessione
		fmt.Println("[WHATSAPP CLIENT HANDLER] Client connesso")
		
	case *events.Disconnected:
		// Gestisci la disconnessione
		fmt.Println("[WHATSAPP CLIENT HANDLER] Client disconnesso")
		
	case *events.LoggedOut:
		// Gestisci il logout
		fmt.Println("[WHATSAPP CLIENT HANDLER] Client disconnesso (logout)")
	default:
		// fmt.Printf("[WHATSAPP CLIENT HANDLER] Evento ricevuto: %T\n", v)
	}
}

// GetGroupName ottiene il nome di un gruppo
func GetGroupName(client *whatsmeow.Client, jid types.JID) string {
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

// GetContactName ottiene il nome di un contatto
func GetContactName(client *whatsmeow.Client, jid types.JID) string {
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

// DownloadProfilePicture scarica l'immagine del profilo di un contatto o gruppo
func DownloadProfilePicture(client *whatsmeow.Client, jid types.JID, isGroup bool) (string, error) {
	params := &whatsmeow.GetProfilePictureParams{
		Preview: false,
	}
	
	pictureInfo, err := client.GetProfilePictureInfo(jid, params)
	if err != nil {
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
	
	var basePath string
	if isGroup {
		basePath = "ProfileImages/Groups"
	} else {
		basePath = "ProfileImages/Users"
	}
	
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return "", fmt.Errorf("errore nella creazione della directory: %v", err)
	}
	
	sanitizedJID := utils.SanitizePathComponent(jid.String())
	fileName := fmt.Sprintf("%s.jpg", sanitizedJID)
	filePath := fmt.Sprintf("%s/%s", basePath, fileName)
	
	resp, err := http.Get(pictureInfo.URL)
	if err != nil {
		return "", fmt.Errorf("errore nel download dell'immagine: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("errore nella risposta HTTP: %d", resp.StatusCode)
	}
	
	imgData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("errore nella lettura dei dati dell'immagine: %v", err)
	}
	
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

