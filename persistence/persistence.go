package persistence

import (
	"bytes"
	"encoding/gob"
	"fmt"
	"sync"
	"time"

	"go.etcd.io/bbolt"
	"whatsapp-reader/models"
)

var (
	chatsBucket     = []byte("chats")
	messagesBucket  = []byte("messages")
)

type PersistenceManager struct {
	db *bbolt.DB
	mu sync.RWMutex
}

func NewPersistenceManager(path string) (*PersistenceManager, error) {
	db, err := bbolt.Open(path, 0600, &bbolt.Options{Timeout: 1 * time.Second})
	if err != nil {
		return nil, err
	}

	err = db.Update(func(tx *bbolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists(chatsBucket)
		if err != nil {
			return err
		}
		_, err = tx.CreateBucketIfNotExists(messagesBucket)
		return err
	})

	if err != nil {
		db.Close()
		return nil, err
	}

	return &PersistenceManager{db: db}, nil
}

// Salva una chat
func (pm *PersistenceManager) SaveChat(chat *models.Chat) error {
	return pm.db.Update(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(chatsBucket)
		data, err := encodeToBinary(chat)
		if err != nil {
			return err
		}
		return bucket.Put([]byte(chat.ID), data)
	})
}

// Carica una chat
func (pm *PersistenceManager) LoadChat(chatID string) (*models.Chat, error) {
	var chat models.Chat
	err := pm.db.View(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(chatsBucket)
		data := bucket.Get([]byte(chatID))
		if data == nil {
			return fmt.Errorf("chat non trovata")
		}
		return decodeBinary(data, &chat)
	})
	return &chat, err
}

// Salva un messaggio
func (pm *PersistenceManager) SaveMessage(message *models.Message) error {
	return pm.db.Update(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(messagesBucket)
		data, err := encodeToBinary(message)
		if err != nil {
			return err
		}
		return bucket.Put([]byte(message.ID), data)
	})
}

// Carica tutti i messaggi di una chat
func (pm *PersistenceManager) LoadChatMessages(chatID string) ([]models.Message, error) {
	var messages []models.Message

	err := pm.db.View(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(messagesBucket)
		cursor := bucket.Cursor()

		for k, v := cursor.First(); k != nil; k, v = cursor.Next() {
			var msg models.Message
			if err := decodeBinary(v, &msg); err != nil {
				continue
			}
			if msg.Chat == chatID {
				messages = append(messages, msg)
			}
		}

		return nil
	})

	return messages, err
}

// Cancella un messaggio
func (pm *PersistenceManager) DeleteMessage(messageID string) error {
	return pm.db.Update(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(messagesBucket)
		return bucket.Delete([]byte(messageID))
	})
}

func (pm *PersistenceManager) Close() error {
	return pm.db.Close()
}

func encodeToBinary(data interface{}) ([]byte, error) {
	var buf bytes.Buffer
	err := gob.NewEncoder(&buf).Encode(data)
	return buf.Bytes(), err
}

func decodeBinary(data []byte, target interface{}) error {
	buf := bytes.NewBuffer(data)
	return gob.NewDecoder(buf).Decode(target)
}
