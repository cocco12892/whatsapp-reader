package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// SanitizePathComponent sanitizza una stringa per l'uso nei percorsi dei file
func SanitizePathComponent(s string) string {
	// Rimuovi caratteri non sicuri per i percorsi dei file
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

// GetProtocolMessageTypeName restituisce il nome del tipo di messaggio di protocollo
func GetProtocolMessageTypeName(typeNum int) string {
    switch typeNum {
    case 0:
        return "revoke"
    case 2:
        return "app_state_sync_key_share"
    case 4:
        return "history_sync_notification"
    case 5:
        return "initial_security_notification"
    case 7:
        return "app_state_fatal_exception_notification"
    case 10:
        return "sync_message"
    case 11:
        return "peer_data_operation_request"
    case 12:
        return "peer_data_operation_response"
    case 13:
        return "placeholder_cleanup"
    case 14:
        return "edit"
    default:
        return "unknown"
    }
}

// GetAudioExtension restituisce l'estensione del file audio in base al tipo MIME
func GetAudioExtension(mimetype string) string {
    switch mimetype {
    case "audio/ogg":
        return "ogg"
    case "audio/mp4":
        return "m4a"
    case "audio/wav":
        return "wav"
    case "audio/mpeg":
        return "mp3"
    default:
        return "audio"
    }
}

// LoadConfig carica la configurazione da un file JSON
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
