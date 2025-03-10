package main

import (
	"context"
	"fmt"
	"time"
	
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"google.golang.org/protobuf/proto"
)

// Funzioni per inviare diversi tipi di messaggi

// InviaTestoSemplice invia un messaggio di testo base
func InviaTestoSemplice(client *whatsmeow.Client, to types.JID, testo string) (*whatsmeow.SendResponse, error) {
	msg := &waProto.Message{
		Conversation: proto.String(testo),
	}
	
	return client.SendMessage(context.Background(), to, msg)
}

// InviaTestoConMenzioni invia un messaggio con menzioni di utenti
func InviaTestoConMenzioni(client *whatsmeow.Client, to types.JID, testo string, menzioni []types.JID) (*whatsmeow.SendResponse, error) {
	// Converti JID in stringhe
	menzionati := make([]string, len(menzioni))
	for i, jid := range menzioni {
		menzionati[i] = jid.String()
	}
	
	msg := &waProto.Message{
		ExtendedTextMessage: &waProto.ExtendedTextMessage{
			Text: proto.String(testo),
			ContextInfo: &waProto.ContextInfo{
				MentionedJid: menzionati,
			},
		},
	}
	
	return client.SendMessage(context.Background(), to, msg)
}

// InviaRisposta invia un messaggio in risposta a un altro
func InviaRisposta(client *whatsmeow.Client, to types.JID, testo string, originalMsgID string, originalSender types.JID) (*whatsmeow.SendResponse, error) {
	msg := &waProto.Message{
		ExtendedTextMessage: &waProto.ExtendedTextMessage{
			Text: proto.String(testo),
			ContextInfo: &waProto.ContextInfo{
				StanzaId:    proto.String(originalMsgID),
				Participant: proto.String(originalSender.String()),
				QuotedMessage: &waProto.Message{
					Conversation: proto.String("(messaggio originale)"),
				},
			},
		},
	}
	
	return client.SendMessage(context.Background(), to, msg)
}

// InviaReazione invia una reazione emoji a un messaggio
func InviaReazione(client *whatsmeow.Client, to types.JID, targetMsgID string, emoji string) (*whatsmeow.SendResponse, error) {
	reactionMsg := client.BuildReaction(to, client.Store.ID.ToNonAD(), types.MessageID(targetMsgID), emoji)
	return client.SendMessage(context.Background(), to, reactionMsg)
}

// InviaSondaggio invia un messaggio con un sondaggio
func InviaSondaggio(client *whatsmeow.Client, to types.JID, domanda string, opzioni []string) (*whatsmeow.SendResponse, error) {
	pollMsg := client.BuildPollCreation(domanda, opzioni, 1) // 1 = numero di opzioni selezionabili
	return client.SendMessage(context.Background(), to, pollMsg)
}

// InviaVotoSondaggio invia un voto a un sondaggio
func InviaVotoSondaggio(client *whatsmeow.Client, to types.JID, pollInfo *types.MessageInfo, opzioniSelezionate []string) (*whatsmeow.SendResponse, error) {
	voteMsg, err := client.BuildPollVote(pollInfo, opzioniSelezionate)
	if err != nil {
		return nil, err
	}
	return client.SendMessage(context.Background(), to, voteMsg)
}

// ModificaMessaggio modifica un messaggio già inviato
func ModificaMessaggio(client *whatsmeow.Client, to types.JID, msgID string, nuovoTesto string) (*whatsmeow.SendResponse, error) {
	newContent := &waProto.Message{
		Conversation: proto.String(nuovoTesto),
	}
	
	editMsg := client.BuildEdit(to, types.MessageID(msgID), newContent)
	return client.SendMessage(context.Background(), to, editMsg)
}

// EliminaMessaggio elimina un messaggio già inviato
func EliminaMessaggio(client *whatsmeow.Client, to types.JID, msgID string) (*whatsmeow.SendResponse, error) {
	revokeMsg := client.BuildRevoke(to, client.Store.ID.ToNonAD(), types.MessageID(msgID))
	return client.SendMessage(context.Background(), to, revokeMsg)
}

// ContrassegnaComeLetto marca un messaggio come letto
func ContrassegnaComeLetto(client *whatsmeow.Client, chat types.JID, msgIDs []string, sender types.JID) error {
	// Converte le stringhe ID in tipi MessageID
	messageIDs := make([]types.MessageID, len(msgIDs))
	for i, id := range msgIDs {
		messageIDs[i] = types.MessageID(id)
	}
	
	return client.MarkRead(messageIDs, time.Now(), chat, sender)
}

// InviaMessaggioTemporaneo invia un messaggio che scompare dopo un periodo
func InviaMessaggioTemporaneo(client *whatsmeow.Client, to types.JID, testo string, durata time.Duration) (*whatsmeow.SendResponse, error) {
	// Prima imposta il timer per i messaggi a tempo
	err := client.SetDisappearingTimer(to, durata)
	if err != nil {
		return nil, err
	}
	
	// Invia un messaggio normale che scomparirà in base al timer impostato
	msg := &waProto.Message{
		Conversation: proto.String(testo),
	}
	
	return client.SendMessage(context.Background(), to, msg)
}

// ImpostaStato imposta lo stato della chat (in scrittura, in registrazione, ecc.)
func ImpostaStato(client *whatsmeow.Client, chat types.JID, stato types.ChatPresence) error {
	// ChatPresence può essere:
	// types.ChatPresenceComposing (digitando)
	// types.ChatPresencePaused (non sta digitando)
	// types.ChatPresenceRecording (registrando audio)
	return client.SendChatPresence(chat, stato, types.ChatPresenceMediaText)
}

// ImpostaPresenza imposta lo stato generale online/offline
func ImpostaPresenza(client *whatsmeow.Client, online bool) error {
	if online {
		return client.SendPresence(types.PresenceAvailable)
	} else {
		return client.SendPresence(types.PresenceUnavailable)
	}
}