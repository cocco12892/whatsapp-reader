package models

import "time"

type Message struct {
	ID      string
	Chat    string
	Sender  string
	Text    string
	Time    time.Time
}

type Chat struct {
	ID        string
	Name      string
	Messages  []Message
}
