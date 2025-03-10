package main

import (
	"fmt"
	"os"
	"strings"
	
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Funzione per gestire tutti i tipi di messaggi
func handleMessageTypes(client *whatsmeow.Client, v *events.Message) (content string, isMedia bool, mediaPath string, err error) {
	// Determina il contenuto del messaggio in base al tipo
	if v.Message == nil {
		return "Messaggio vuoto", false, "", nil
	}

	// Testo semplice
	if v.Message.GetConversation() != "" {
		return v.Message.GetConversation(), false, "", nil
	}

	// Testo esteso (con formattazione, menzioni, ecc.)
	if extText := v.Message.GetExtendedTextMessage(); extText != nil {
		content := extText.GetText()
		if extText.GetContextInfo() != nil && extText.GetContextInfo().GetMentionedJid() != nil {
			content += " (con menzioni)"
		}
		return content, false, "", nil
	}

	// Immagine
	if imgMsg := v.Message.GetImageMessage(); imgMsg != nil {
		caption := imgMsg.GetCaption()
		contentText := "📷 Immagine"
		if caption != "" {
			contentText += ": " + caption
		}
		
		// Gestione download immagine
		imgData, err := client.Download(imgMsg)
		if err == nil {
			dataDir := v.Info.Timestamp.Format("2006-01-02")
			oraPrefisso := v.Info.Timestamp.Format("15-04-05")
			
			// Ottieni nomi
			senderName := getContactName(client, v.Info.Sender)
			var chatName string
			if v.Info.IsGroup {
				chatName = getGroupName(client, v.Info.Chat)
			} else {
				chatName = getContactName(client, v.Info.Sender)
			}
			
			sanitizedChatName := sanitizePathComponent(chatName)
			sanitizedSenderName := sanitizePathComponent(senderName)
			
			basePath := "Immagini"
			groupPath := fmt.Sprintf("%s/%s", basePath, sanitizedChatName)
			dataPath := fmt.Sprintf("%s/%s", groupPath, dataDir)
			
			// Crea le directory
			os.MkdirAll(dataPath, 0755)
			
			// Crea il nome file
			fileName := fmt.Sprintf("%s_%s_ID%s.jpg", oraPrefisso, sanitizedSenderName, v.Info.ID)
			fullPath := fmt.Sprintf("%s/%s", dataPath, fileName)
			
			// Salva il file
			err = os.WriteFile(fullPath, imgData, 0644)
			if err == nil {
				// Crea URL per il browser
				mediaPath = fmt.Sprintf("/images/%s/%s/%s", sanitizedChatName, dataDir, fileName)
			}
		}
		return contentText, true, mediaPath, nil
	}

	// Video
	if videoMsg := v.Message.GetVideoMessage(); videoMsg != nil {
		caption := videoMsg.GetCaption()
		contentText := "🎥 Video"
		if caption != "" {
			contentText += ": " + caption
		}
		return contentText, true, "", nil
	}

	// Audio
	if audioMsg := v.Message.GetAudioMessage(); audioMsg != nil {
		contentText := "🔊 Messaggio vocale"
		if audioMsg.GetPtt() {
			contentText = "🎤 Nota vocale"
		}
		return contentText, true, "", nil
	}

	// Documento
	if docMsg := v.Message.GetDocumentMessage(); docMsg != nil {
		return "📄 Documento: " + docMsg.GetFileName(), true, "", nil
	}

	// Sticker
	if stickerMsg := v.Message.GetStickerMessage(); stickerMsg != nil {
		return "🏷️ Sticker", true, "", nil
	}

	// Contatto
	if contactMsg := v.Message.GetContactMessage(); contactMsg != nil {
		return "👤 Contatto: " + contactMsg.GetDisplayName(), false, "", nil
	}

	// Posizione
	if locationMsg := v.Message.GetLocationMessage(); locationMsg != nil {
		return fmt.Sprintf("📍 Posizione: lat %f, long %f", 
			locationMsg.GetDegreesLatitude(), 
			locationMsg.GetDegreesLongitude()), false, "", nil
	}

	// Reazione
	if reactionMsg := v.Message.GetReactionMessage(); reactionMsg != nil {
		return fmt.Sprintf("👍 Reazione: %s (al messaggio: %s)", 
			reactionMsg.GetText(), 
			reactionMsg.GetKey().GetId()), false, "", nil
	}

	// Reazione cifrata
	if encReactionMsg := v.Message.GetEncReactionMessage(); encReactionMsg != nil {
		reaction, err := client.DecryptReaction(v)
		if err == nil {
			return fmt.Sprintf("👍 Reazione cifrata: %s", reaction.GetText()), false, "", nil
		}
		return "👍 Reazione cifrata (non decifrabile)", false, "", err
	}

	// Sondaggio
	if pollCreationMsg := v.Message.GetPollCreationMessage(); pollCreationMsg != nil {
		options := make([]string, 0, len(pollCreationMsg.GetOptions()))
		for _, opt := range pollCreationMsg.GetOptions() {
			options = append(options, opt.GetOptionName())
		}
		return fmt.Sprintf("📊 Sondaggio: %s\nOpzioni: %s", 
			pollCreationMsg.GetName(), 
			strings.Join(options, ", ")), false, "", nil
	}

	// Voto sondaggio
	if pollUpdateMsg := v.Message.GetPollUpdateMessage(); pollUpdateMsg != nil {
		vote, err := client.DecryptPollVote(v)
		if err == nil {
			return "📊 Voto a un sondaggio", false, "", nil
		}
		return "📊 Voto a un sondaggio (non decifrabile)", false, "", err
	}

	// Messaggio di protocollo (ricevuta di lettura, cancellazione messaggio, ecc.)
	if protoMsg := v.Message.GetProtocolMessage(); protoMsg != nil {
		switch protoMsg.GetType() {
		case proto.ProtocolMessage_REVOKE:
			return "🗑️ Messaggio cancellato", false, "", nil
		case proto.ProtocolMessage_APP_STATE_SYNC_KEY_SHARE:
			return "🔄 Sincronizzazione app state", false, "", nil
		case proto.ProtocolMessage_HISTORY_SYNC_NOTIFICATION:
			return "🔄 Notifica sincronizzazione cronologia", false, "", nil
		case proto.ProtocolMessage_EPHEMERAL_SETTING:
			ttl := protoMsg.GetEphemeralExpiration() // in secondi
			return fmt.Sprintf("⏱️ Messaggi temporanei impostati a %d secondi", ttl), false, "", nil
		case proto.ProtocolMessage_EDIT:
			return "✏️ Modifica messaggio", false, "", nil
		default:
			return fmt.Sprintf("📩 Messaggio di protocollo di tipo %d", protoMsg.GetType()), false, "", nil
		}
	}

	// Stato temporaneo (story)
	if statusMsg := v.Message.GetDeviceStatusesMessage(); statusMsg != nil {
		return "🕒 Stato temporaneo", true, "", nil
	}

	// Lista prodotti
	if catalogMsg := v.Message.GetProductMessage(); catalogMsg != nil {
		return "🛒 Prodotto: " + catalogMsg.GetProduct().GetTitle(), false, "", nil
	}

	// GIF
	if videoMsg := v.Message.GetVideoMessage(); videoMsg != nil && videoMsg.GetGifPlayback() {
		return "🎬 GIF", true, "", nil
	}

	// Messaggio con pulsanti
	if buttonsMsg := v.Message.GetButtonsMessage(); buttonsMsg != nil {
		contentText := "🔘 " + buttonsMsg.GetContentText()
		return contentText, false, "", nil
	}

	// Risposta a pulsante
	if buttonResp := v.Message.GetButtonsResponseMessage(); buttonResp != nil {
		return fmt.Sprintf("🔘 Risposta al pulsante: %s", buttonResp.GetSelectedDisplayText()), false, "", nil
	}

	// Messaggio lista
	if listMsg := v.Message.GetListMessage(); listMsg != nil {
		return "📋 Lista: " + listMsg.GetTitle(), false, "", nil
	}

	// ViewOnce (foto o video che si può visualizzare una sola volta)
	if viewOnceMsg := v.Message.GetViewOnceMessage(); viewOnceMsg != nil {
		return "👁️‍🗨️ Messaggio visualizzabile una volta", true, "", nil
	}

	// Se arriviamo qui, è un tipo di messaggio non specificamente gestito
	return "📨 Tipo di messaggio sconosciuto", false, "", nil
}