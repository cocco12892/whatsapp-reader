package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"strings"


	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	// Configura un logger per vedere cosa succede
	logger := waLog.Stdout("Info", "INFO", true) // Cambiato da DEBUG a INFO per ridurre il rumore
	
	// Crea un database SQLite per memorizzare le sessioni
	dbContainer, err := sqlstore.New("sqlite3", "file:whatsmeow.db?_foreign_keys=on", logger)
	if err != nil {
		fmt.Println("Errore durante la creazione del database:", err)
		return
	}
	
	// Ottieni il primo dispositivo dal database o creane uno nuovo
	deviceStore, err := dbContainer.GetFirstDevice()
	if err != nil {
		fmt.Println("Errore durante l'ottenimento del dispositivo:", err)
		return
	}
	
	// Crea un client WhatsApp
	client := whatsmeow.NewClient(deviceStore, logger)
	
	// Cache per i nomi dei contatti
	var contactNameCache sync.Map
	
	// Funzione per ottenere il nome del contatto (con cache)
	getContactName := func(jid types.JID) string {
		// Ottiene solo la parte user del JID (senza il device)
		userJID := types.NewJID(jid.User, jid.Server)
		
		// Controlla se il nome è già in cache
		if cachedName, ok := contactNameCache.Load(userJID.String()); ok {
			return cachedName.(string)
		}
		
		// Altrimenti, recupera il nome dal store locale
		contactInfo, err := deviceStore.Contacts.GetContact(userJID)
		var name string
		if err != nil || contactInfo.PushName == "" {
			name = userJID.User // Se non c'è un nome, usa il numero di telefono
		} else {
			name = contactInfo.PushName
		}
		
		// Salva in cache e restituisci
		contactNameCache.Store(userJID.String(), name)
		return name
	}
	// Cache per i nomi dei gruppi
	var groupNameCache sync.Map
	
	// Funzione per ottenere il nome del gruppo (con cache)
	getGroupName := func(jid types.JID) string {
		// Controlla se il nome è già in cache
		if cachedName, ok := groupNameCache.Load(jid.String()); ok {
			return cachedName.(string)
		}
		
		// Altrimenti, richiedi il nome al server
		groupInfo, err := client.GetGroupInfo(jid)
		if err != nil {
			return jid.String() // Ritorna l'ID se c'è un errore
		}
		
		// Salva in cache e restituisci
		groupNameCache.Store(jid.String(), groupInfo.Name)
		return groupInfo.Name
	}
	
	// Registra la funzione che gestirà gli eventi (come i messaggi ricevuti)
	client.AddEventHandler(func(evt interface{}) {
		// Questo handler verrà chiamato per ogni evento WhatsApp
		switch v := evt.(type) {
		case *events.Message:
			// Abbiamo ricevuto un messaggio
			fmt.Println("------------------------")

			// Aggiungi informazioni sul mittente con il nome
			senderName := getContactName(v.Info.Sender)
			fmt.Printf("Messaggio da: %s (%s)\n", senderName, v.Info.Sender.String())
			
			// Aggiungi informazioni sul gruppo (se presente)
			if v.Info.IsGroup {
				groupName := getGroupName(v.Info.Chat)
				fmt.Printf("Gruppo: %s (%s)\n", groupName, v.Info.Chat.String())
			}
			
			// Estrai il contenuto del messaggio in base al tipo
			if v.Message.GetConversation() != "" {
				// Messaggio di testo semplice
				fmt.Println("Testo:", v.Message.GetConversation())
			} else if v.Message.GetExtendedTextMessage() != nil {
				// Messaggio di testo con formattazione o link
				fmt.Println("Testo esteso:", v.Message.GetExtendedTextMessage().GetText())
			} else if v.Message.GetImageMessage() != nil {
				// Messaggio con immagine
				fmt.Println("Immagine ricevuta")
				fmt.Println("Didascalia:", v.Message.GetImageMessage().GetCaption())
				
				// Scarica l'immagine
				imgData, err := client.Download(v.Message.GetImageMessage())
				if err != nil {
					fmt.Println("Errore durante il download dell'immagine:", err)
				} else {
					// Ottieni i dati per la struttura delle cartelle
					senderName := getContactName(v.Info.Sender)
					var groupName string
					if v.Info.IsGroup {
						groupName = getGroupName(v.Info.Chat)
					} else {
						groupName = "Chat_Private"
					}
					
					// Formatta la data e l'ora
					dataDir := v.Info.Timestamp.Format("2006-01-02")
					oraPrefisso := v.Info.Timestamp.Format("15-04-05")
					
					// Crea la struttura di cartelle
					basePath := "Immagini"
					groupPath := fmt.Sprintf("%s/%s", basePath, groupName)
					dataPath := fmt.Sprintf("%s/%s", groupPath, dataDir)
					
					// Crea le cartelle se non esistono
					err = os.MkdirAll(dataPath, 0755)
					if err != nil {
						fmt.Println("Errore nella creazione delle cartelle:", err)
						return
					}
					
					// Sanitizza il nome del mittente (rimuovi spazi e caratteri speciali)
					sanitizedSenderName := strings.ReplaceAll(senderName, " ", "_")
					sanitizedSenderName = strings.ReplaceAll(sanitizedSenderName, "/", "_")
					sanitizedSenderName = strings.ReplaceAll(sanitizedSenderName, "\\", "_")
					
					// Crea un nome file con l'ora, il nome del mittente e un identificatore unico
					fileName := fmt.Sprintf("%s_%s_ID%s.jpg", oraPrefisso, sanitizedSenderName, v.Info.ID)
					fullPath := fmt.Sprintf("%s/%s", dataPath, fileName)
					
					// Salva l'immagine su file
					err = os.WriteFile(fullPath, imgData, 0644)
					if err != nil {
						fmt.Println("Errore durante il salvataggio dell'immagine:", err)
					} else {
						fmt.Println("Immagine salvata come:", fullPath)
					}
				}
			} else if v.Message.GetDocumentMessage() != nil {
				// Documento
				fmt.Println("Documento ricevuto:", v.Message.GetDocumentMessage().GetFileName())
			} else if v.Message.GetAudioMessage() != nil {
				// Messaggio vocale
				fmt.Println("Messaggio vocale ricevuto")
			} else if v.Message.GetVideoMessage() != nil {
				// Video
				fmt.Println("Video ricevuto")
				fmt.Println("Didascalia:", v.Message.GetVideoMessage().GetCaption())
			} else {
				// Altri tipi di messaggio
				fmt.Println("Ricevuto un altro tipo di messaggio")
			}
			
			fmt.Printf("Timestamp: %s\n", v.Info.Timestamp)
			fmt.Println("------------------------")
		
		case *events.Connected:
			// Quando il client si connette con successo
			fmt.Println("Client connesso!")
			
		case *events.LoggedOut:
			// Se il dispositivo viene disconnesso
			fmt.Println("Dispositivo disconnesso, è necessario effettuare nuovamente l'accesso")
		}
	})
	
	// Controlla se dobbiamo fare il login
	if client.Store.ID == nil {
		fmt.Println("Dispositivo non registrato, scansiona il codice QR con WhatsApp")
		
		// Ottieni un canale per ricevere eventi QR
		qrChan, err := client.GetQRChannel(context.Background())
		if err != nil {
			fmt.Println("Errore nell'ottenere il canale QR:", err)
			return
		}
		
		// Ora connetti il client (dopo aver ottenuto il canale QR)
		err = client.Connect()
		if err != nil {
			fmt.Println("Errore durante la connessione:", err)
			return
		}
		
		// Ascolta gli eventi QR
		for evt := range qrChan {
			if evt.Event == "code" {
				// Stampa il codice QR nel terminale
				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				fmt.Println("Scansiona questo codice QR con WhatsApp sul tuo telefono")
				fmt.Println("Nota: vai su WhatsApp > Menu > Dispositivi collegati > Collega un dispositivo")
			} else {
				fmt.Println("Evento QR:", evt.Event)
			}
		}
	} else {
		// Se siamo già registrati, semplicemente connetti
		fmt.Println("Già registrato con JID:", client.Store.ID)
		err = client.Connect()
		if err != nil {
			fmt.Println("Errore durante la connessione:", err)
			return
		}
		fmt.Println("In attesa di messaggi...")
	}
	
	// Attendi finché l'utente non interrompe il programma (Ctrl+C)
	c := make(chan os.Signal)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	
	// Disconnetti correttamente prima di uscire
	fmt.Println("Disconnessione...")
	client.Disconnect()
}