package whatsapp

import (
	"context"
	"fmt"
	"net/http"
	"io"
	"os"
	"os/signal"
	"strings"
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
	
	"whatsapp-reader/db"
)

var (
	// Cache per i nomi
	groupNameCache   sync.Map
	contactNameCache sync.Map
)

// Client rappresenta il client WhatsApp
type Client struct {
	*whatsmeow.Client
	eventHandler func(interface{})
}

// NewClient crea un nuovo client WhatsApp
func NewClient(dbStore *sqlstore.Container, eventHandler func(interface{})) (*Client, error) {
	deviceStore, err := dbStore.GetFirstDevice()
	if err != nil {
		return nil, fmt.Errorf("errore nel recupero del device: %v", err)
	}
	
	client := whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "DEBUG", true))
	return &Client{
		Client:       client,
		eventHandler: eventHandler,
	}, nil
}

// Connect connette il client a WhatsApp
func (c *Client) Connect() error {
	c.AddEventHandler(c.eventHandler)
	
	if err := c.Connect(); err != nil {
		return fmt.Errorf("errore nella connessione: %v", err)
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

// InitClient inizializza il client WhatsApp
func InitClient(dbManager *db.MySQLManager) error {
	// Qui implementiamo la logica per inizializzare il client WhatsApp
	// Per ora, creiamo un client vuoto
	WhatsmeowClient = &whatsmeow.Client{}
	return nil
}

// RegisterEventHandler registra l'handler degli eventi
func RegisterEventHandler(dbManager *db.MySQLManager) {
	// Qui implementiamo la logica per registrare l'handler degli eventi
}

// Connect connette il client WhatsApp e restituisce un QR code se necessario
func Connect() (*string, error) {
	// Qui implementiamo la logica per connettere il client
	// Per ora, restituiamo nil per indicare che non è necessario un QR code
	return nil, nil
}

// Disconnect disconnette il client WhatsApp
func Disconnect() {
	// Qui implementiamo la logica per disconnettere il client
	if WhatsmeowClient != nil {
		WhatsmeowClient.Disconnect()
	}
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
		fmt.Printf("Ricevuto messaggio da %s\n", v.Info.Sender.String())
		
	case *events.Connected:
		// Gestisci la connessione
		fmt.Println("Client connesso")
		
	case *events.Disconnected:
		// Gestisci la disconnessione
		fmt.Println("Client disconnesso")
		
	case *events.LoggedOut:
		// Gestisci il logout
		fmt.Println("Client disconnesso (logout)")
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

// SanitizePathComponent sanitizza una stringa per uso nei percorsi dei file
func SanitizePathComponent(s string) string {
	s = strings.ReplaceAll(s, "/", "_")
	s = strings.ReplaceAll(s, "\\", "_")
	s = strings.ReplaceAll(s, ":", "_")
	s = strings.ReplaceAll(s, "*", "_")
	s = strings.ReplaceAll(s, "?", "_")
	s = strings.ReplaceAll(s, "\"", "_")
	s = strings.ReplaceAll(s, "<", "_")
	s = strings.ReplaceAll(s, ">", "_")
	s = strings.ReplaceAll(s, "|", "_")
	return s
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

