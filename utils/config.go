package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

// Configurazione del database
type DatabaseConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	DBName   string `json:"dbname"`
}

// Configurazione del server
type ServerConfig struct {
	Port int `json:"port"`
}

// Configurazione completa
type Config struct {
	Database DatabaseConfig `json:"database"`
	Server   ServerConfig   `json:"server"`
}

// Carica la configurazione dal file o dalle variabili di ambiente
func LoadConfig(filePath string) (*Config, error) {
	var config Config
	
	// Prima prova a caricare dal file se esiste
	if _, err := os.Stat(filePath); err == nil {
		file, err := os.Open(filePath)
		if err != nil {
			return nil, fmt.Errorf("errore nell'apertura del file di configurazione: %v", err)
		}
		defer file.Close()

		decoder := json.NewDecoder(file)
		if err := decoder.Decode(&config); err != nil {
			return nil, fmt.Errorf("errore nella decodifica del file di configurazione: %v", err)
		}
	}
	
	// Sovrascrivi con le variabili di ambiente se presenti
	if dbHost := os.Getenv("DB_HOST"); dbHost != "" {
		config.Database.Host = dbHost
	}
	
	if dbPortStr := os.Getenv("DB_PORT"); dbPortStr != "" {
		if dbPort, err := strconv.Atoi(dbPortStr); err == nil {
			config.Database.Port = dbPort
		}
	}
	
	if dbUser := os.Getenv("DB_USER"); dbUser != "" {
		config.Database.User = dbUser
	}
	
	if dbPassword := os.Getenv("DB_PASSWORD"); dbPassword != "" {
		config.Database.Password = dbPassword
	}
	
	if dbName := os.Getenv("DB_NAME"); dbName != "" {
		config.Database.DBName = dbName
	}
	
	if serverPortStr := os.Getenv("PORT"); serverPortStr != "" {
		if serverPort, err := strconv.Atoi(serverPortStr); err == nil {
			config.Server.Port = serverPort
		}
	}
	
	// Valori di default se non specificati
	if config.Database.Host == "" {
		config.Database.Host = "localhost"
	}
	if config.Database.Port == 0 {
		config.Database.Port = 3306
	}
	if config.Database.User == "" {
		config.Database.User = "root"
	}
	if config.Database.DBName == "" {
		config.Database.DBName = "whatsapp_viewer"
	}
	if config.Server.Port == 0 {
		config.Server.Port = 8080
	}

	return &config, nil
}

// Ottieni la stringa di connessione al database
func (c *DatabaseConfig) GetDSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&loc=Local", 
		c.User, c.Password, c.Host, c.Port, c.DBName)
}
