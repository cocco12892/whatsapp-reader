package handlers

import (
	"net/http"
	"path/filepath"
	"strings"
	"github.com/gin-gonic/gin"
)

// ServeProfileImage serve le immagini del profilo
func ServeProfileImage(c *gin.Context) {
	// Ottieni il tipo (users/groups) e il nome del file dai parametri
	imageType := c.Param("type")
	fileName := c.Param("file")
	
	// Verifica che il tipo sia valido
	if imageType != "users" && imageType != "groups" {
		c.String(http.StatusBadRequest, "Tipo non valido")
		return
	}
	
	// Costruisci il percorso del file
	filePath := filepath.Join("ProfileImages", strings.Title(imageType), fileName)
	
	// Servi il file
	c.File(filePath)
}

// SetupRoutes configura le route HTTP
func SetupRoutes(router *gin.Engine) {
	// Route per servire le immagini del profilo
	router.GET("/profile-images/:type/*file", ServeProfileImage)
	
	// Health check endpoint per monitoring
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"service": "whatsapp-reader-backend",
		})
	})
	
	// Servi file statici del frontend dalla directory dist
	router.Static("/assets", "./dist/assets")
	router.StaticFile("/favicon.ico", "./dist/favicon.ico")
	
	// Route per servire il frontend React
	router.GET("/", func(c *gin.Context) {
		c.File("./dist/index.html")
	})
	
	router.GET("/web", func(c *gin.Context) {
		c.File("./dist/index.html")
	})
	
	router.GET("/web/*path", func(c *gin.Context) {
		c.File("./dist/index.html")
	})
	
	// Catch-all per React Router - serve index.html per tutte le rotte non API
	router.NoRoute(func(c *gin.Context) {
		// Se la richiesta è per un'API, restituisci 404
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "Endpoint non trovato"})
			return
		}
		
		// Per tutto il resto, servi il frontend React
		c.File("./dist/index.html")
	})
}

