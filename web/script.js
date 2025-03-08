// URL base dell'API
const API_BASE_URL = 'http://localhost:8080/api';

// Funzione principale per l'applicazione chat
function chatApp() {
    return {
        // Stato dell'applicazione
        chats: [],
        clientJID: '',
        isUserReading: false,
        
        // Inizializzazione delle chat
        async initializeChats() {
            try {
                // Ottieni le chat
                const response = await fetch(`${API_BASE_URL}/chats`);
                const chats = await response.json();
                
                // Array temporaneo per le chat con messaggi
                const preparedChats = [];
                
                // Prepara le chat con i loro messaggi
                for (const chat of chats) {
                    // Ottieni i messaggi per questa chat
                    const messagesResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chat.id)}/messages`);
                    const messages = await messagesResponse.json();
                    
                    // Crea un oggetto chat con messaggi
                    const preparedChat = {
                        ...chat,
                        messages: messages
                    };
                    
                    preparedChats.push(preparedChat);
                    
                    // Imposta il clientJID dal primo messaggio
                    if (!this.clientJID && messages.length > 0) {
                        this.clientJID = messages[0].chat.includes('@g.us') 
                            ? messages[0].sender 
                            : messages[0].chat;
                    }
                }
                
                // Imposta le chat usando $nextTick per assicurare reattività
                this.$nextTick(() => {
                    this.chats = preparedChats;
                    
                    // Scrolla all'ultimo messaggio di ogni chat
                    this.$nextTick(() => {
                        document.querySelectorAll('.chat-messages').forEach(container => {
                            container.scrollTop = container.scrollHeight;
                        });
                    });
                });
                
                // Aggiornamento disabilitato
                // this.startPeriodicUpdate();
            } catch (error) {
                console.error('Errore nel caricamento iniziale delle chat:', error);
            }
        },
        
        // Avvia aggiornamento periodico
        intervalId: null,
        startPeriodicUpdate() {
            // Se c'è già un intervallo attivo, non crearne un altro
            if (this.intervalId !== null) {
                console.log('Aggiornamento periodico già attivo');
                return;
            }
            
            console.log('Avvio aggiornamento periodico ogni 5 secondi');
            this.intervalId = setInterval(() => {
                console.log('Esecuzione aggiornamento periodico...');
                this.updateChats().catch(error => {
                    console.error('Errore durante l\'aggiornamento:', error);
                });
            }, 5000);
        },
        
        // Ferma l'aggiornamento periodico
        stopPeriodicUpdate() {
            if (this.intervalId !== null) {
                console.log('Fermo aggiornamento periodico');
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        },
        
        // Aggiorna le chat
        async updateChats() {
            // Esci se l'utente sta leggendo
            if (this.isUserReading) {
                console.log('Aggiornamento saltato: utente sta leggendo');
                return;
            }
            
            console.log('Inizio aggiornamento chat...');
            
            try {
                // Ottieni le chat
                const chatsResponse = await fetch(`${API_BASE_URL}/chats`);
                const chats = await chatsResponse.json();
                
                // Usa $nextTick per assicurare reattività
                this.$nextTick(async () => {
                    // Controlla se ci sono nuove chat
                    const newChats = chats.filter(newChat => 
                        !this.chats.some(existingChat => exisitingChat.id === newChat.id)
                    );
                    
                    // Aggiungi nuove chat con i loro messaggi
                    for (const newChat of newChats) {
                        const messagesResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(newChat.id)}/messages`);
                        const messages = await messagesResponse.json();
                        
                        this.chats.push({
                            ...newChat,
                            messages: messages,
                            isNew: true // Flag per evidenziare la nuova chat
                        });
                    }
                    
                    // Aggiorna le chat esistenti
                    for (let i = 0; i < chats.length; i++) {
                        const chat = chats[i];
                        
                        // Trova la chat corrispondente nello stato corrente
                        const existingChatIndex = this.chats.findIndex(c => c.id === chat.id);
                        
                        if (existingChatIndex !== -1) {
                            // Ottieni i messaggi per questa chat
                            const messagesResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chat.id)}/messages`);
                            const messages = await messagesResponse.json();
                            
                            // Trova l'ultimo messaggio esistente
                            const existingMessages = this.chats[existingChatIndex].messages;
                            const lastExistingMessage = existingMessages.length > 0 
                                ? existingMessages[existingMessages.length - 1]
                                : null;
                            
                            // Aggiungi solo i nuovi messaggi
                            const newMessages = messages.filter(message => 
                                !lastExistingMessage || 
                                (message.timestamp > lastExistingMessage.timestamp)
                            );
                            
                            // Aggiungi i nuovi messaggi
                            if (newMessages.length > 0) {
                                // Usa $set per assicurare reattività in Vue-like
                                this.chats[existingChatIndex].messages = [
                                    ...this.chats[existingChatIndex].messages, 
                                    ...newMessages
                                ];
                                
                                // Rimuovi il flag "isNew" se presente
                                if (this.chats[existingChatIndex].isNew) {
                                    this.chats[existingChatIndex].isNew = false;
                                }
                                
                                // Scrolla all'ultimo messaggio
                                this.$nextTick(() => {
                                    const chatContainer = document.getElementById(`chat-${chat.id.replace(/[@:.]/g, '_')}`);
                                    if (chatContainer) {
                                        const messagesContainer = chatContainer.querySelector('.chat-messages');
                                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                                    }
                                });
                            }
                        }
                    }
                });
            } catch (error) {
                console.error('Errore nell\'aggiornamento delle chat:', error);
            }
        },
        
        // Formatta il timestamp
        formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },
        
        // Toggle anteprima media
        toggleMediaPreview(el) {
            const img = el.nextElementSibling;
            img.style.display = img.style.display === 'none' ? 'block' : 'none';
        },
        
        // Controlla la posizione dello scroll
        checkScrollPosition(event) {
            const container = event.target;
            const isNearBottom = 
                container.scrollHeight - container.scrollTop - container.clientHeight < 100;
            
            this.isUserReading = !isNearBottom;
        }
    };
}
