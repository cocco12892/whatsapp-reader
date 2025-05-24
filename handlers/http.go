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
}

