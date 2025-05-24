package utils

import (
	"path/filepath"
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
	case "audio/ogg", "audio/ogg; codecs=opus":
		return ".ogg"
	case "audio/aac":
		return ".aac"
	case "audio/mp4":
		return ".m4a"
	case "audio/wav", "audio/wave":
		return ".wav"
	case "audio/mpeg":
		return ".mp3"
	case "audio/amr":
		return ".amr"
	default:
		return ".aud" // Estensione generica per audio sconosciuto
	}
}

// GetImageExtension restituisce l'estensione del file immagine in base al tipo MIME
func GetImageExtension(mimetype string) string {
	switch mimetype {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/bmp":
		return ".bmp"
	case "image/tiff":
		return ".tiff"
	default:
		return ".img" // Estensione generica per immagine sconosciuta
	}
}

// GetVideoExtension restituisce l'estensione del file video in base al tipo MIME
func GetVideoExtension(mimetype string) string {
	switch mimetype {
	case "video/mp4":
		return ".mp4"
	case "video/3gpp":
		return ".3gp"
	case "video/quicktime":
		return ".mov"
	case "video/x-msvideo":
		return ".avi"
	case "video/webm":
		return ".webm"
	default:
		return ".vid" // Estensione generica per video sconosciuto
	}
}

// GetDocumentExtension restituisce l'estensione del file documento
func GetDocumentExtension(mimetype string, filename string) string {
	// Prova prima a ottenere l'estensione dal nome del file, se fornito
	if filename != "" {
		ext := filepath.Ext(filename)
		if ext != "" {
			return ext
		}
	}

	// Altrimenti, basati sul mimetype
	switch mimetype {
	case "application/pdf":
		return ".pdf"
	case "application/msword":
		return ".doc"
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return ".docx"
	case "application/vnd.ms-excel":
		return ".xls"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return ".xlsx"
	case "application/vnd.ms-powerpoint":
		return ".ppt"
	case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return ".pptx"
	case "text/plain":
		return ".txt"
	case "text/csv":
		return ".csv"
	case "application/zip", "application/x-zip-compressed":
		return ".zip"
	case "application/vnd.rar", "application/x-rar-compressed":
		return ".rar"
	default:
		return ".docfile" // Estensione generica per documento sconosciuto
	}
}

