# WhatsApp Reader

Un'applicazione per leggere e gestire i messaggi WhatsApp.

## Come iniziare

1. Installa Node.js (v18+) e Go (v1.20+)
2. Clona il repository
3. Installa le dipendenze:
```bash
npm install

Avvio
Avvia il backend:
go run main.go

In un altro terminale, avvia il frontend:
npm run dev

Il frontend sarà disponibile su http://localhost:3000

Connessione WhatsApp
All'avvio del backend, scansiona il QR code con WhatsApp
Usa l'opzione "Collegare un dispositivo"
La sessione verrà salvata in whatsmeow.db
Struttura del progetto
web/ - Frontend React
main.go - Backend Go
Immagini/ - Immagini ricevute
whatsmeow.db - Database sessioni
Problemi comuni
QR code non funziona? Elimina whatsmeow.db e riavvia
Errori npm? Prova:
rm -rf node_modules package-lock.json
npm cache clean --force
npm install