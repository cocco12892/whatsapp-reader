package main

import (
	"fmt"
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"go.mau.fi/whatsmeow"
)

// Registra gli endpoint API
func registerAPIEndpoints(router *gin.Engine, client *whatsmeow.Client) {
	// Endpoint di test
	router.GET("/api/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"message": "Il backend funziona correttamente",
		})
	})

	// API per ottenere le ultime chat
	router.GET("/api/chats", func(c *gin.Context) {
		fmt.Println("Richiesta API /api/chats ricevuta")
		
		mutex.RLock()
		defer mutex.RUnlock()
		
		fmt.Println("Numero di chat trovate:", len(chats))
		
		// Converti la mappa in slice per ordinarla
		var chatList []*Chat
		for _, chat := range chats {
			chatList = append(chatList, chat)
		}
		
		// Ordina le chat per timestamp dell'ultimo messaggio (più recente prima)
		sort.Slice(chatList, func(i, j int) bool {
			return chatList[i].LastMessage.Timestamp.After(chatList[j].LastMessage.Timestamp)
		})
		
		// Prendi solo le ultime 10 (o meno se ce ne sono meno di 10)
		limit := 10
		if len(chatList) < limit {
			limit = len(chatList)
		}
		
		c.JSON(http.StatusOK, chatList[:limit])
	})

	// API per ottenere i messaggi di una chat specifica
	router.GET("/api/chats/:id/messages", func(c *gin.Context) {
		chatID := c.Param("id")
		
		mutex.RLock()
		defer mutex.RUnlock()
		
		chat, exists := chats[chatID]
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chat non trovata"})
			return
		}
		
		c.JSON(http.StatusOK, chat.Messages)
	})
	
	// Qui puoi aggiungere altri endpoint API come necessario
}