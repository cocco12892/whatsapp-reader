package utils

import (
	"encoding/json"
	"fmt"
	"os"
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

// Carica la configurazione dal file
func LoadConfig(filePath string) (*Config, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("errore nell'apertura del file di configurazione: %v", err)
	}
	defer file.Close()

	var config Config
	decoder := json.NewDecoder(file)
	if err := decoder.Decode(&config); err != nil {
		return nil, fmt.Errorf("errore nella decodifica del file di configurazione: %v", err)
	}

	return &config, nil
}

// Ottieni la stringa di connessione al database
func (c *DatabaseConfig) GetDSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true", 
		c.User, c.Password, c.Host, c.Port, c.DBName)
}
