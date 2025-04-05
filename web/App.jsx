import React, { useState, useEffect, useCallback, useRef, useMemo, memo, createElement } from 'react';
import ErrorBoundary from './components/ErrorBoundary';

import ChatWindow from './components/ChatWindow';
import DirettaGames from './components/DirettaGames';
import AlertTable from './components/AlertTable';
import { Helmet } from 'react-helmet';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './styles/theme';
import { Box, Typography, CircularProgress, Paper, Dialog, DialogContent, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RefreshIcon from '@mui/icons-material/Refresh';
import DuplicateImageFinder from './components/DuplicateImageFinder';
import NotesGroupView from './components/NotesGroupView';
import NoteIcon from '@mui/icons-material/Note';
import { Button } from '@mui/material';
import BotSalvatore from './components/BotSalvatore';

// Funzione per codificare in modo sicuro i percorsi delle immagini
const safeImagePath = (path) => {
  if (!path) return '';
  
  // Split the path to handle each component correctly
  const pathParts = path.split('/');
  
  // Encode each part of the path except the slashes
  const encodedParts = pathParts.map(part => {
    // Don't encode simple filenames with extension
    if (part.match(/^[^\/]+\.(jpg|jpeg|png|gif)$/i)) {
      return part;
    }
    // Encode directory names that might contain special characters
    return encodeURIComponent(part);
  });
  
  // Join the path back together
  return encodedParts.join('/');
};

// Componenti memorizzati per evitare re-render non necessari
const MemoizedSideComponents = memo(() => {
  return (
    <>
      <BotSalvatore />
      <DirettaGames />
      <AlertTable />
    </>
  );
});

function App() {
  // Track the last fetch time for each chat and a global fetching flag
  const lastFetchTime = {};
  const FETCH_THROTTLE_MS = 3000; // 3 seconds minimum between fetches for same chat
  const isCurrentlyFetchingRef = useRef(false);

  // WebSocket URL basato sull'URL corrente
  const WS_URL = useMemo(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Usa l'host corrente, ma assicurati di usare la porta corretta (8080)
    const host = window.location.hostname;
    const port = 8080; // Porta fissa per il backend
    return `${protocol}//${host}:${port}/ws`;
  }, []);

  const [chats, setChats] = useState([]);
  const [chatOrder, setChatOrder] = useState([]);
  const [clientJID, setClientJID] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState({});
  const [lastSeenMessages, setLastSeenMessages] = useState({});
  const [seenMessages, setSeenMessages] = useState(new Set());
  const [modalImage, setModalImage] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [notesGroupViewOpen, setNotesGroupViewOpen] = useState(false);
  const [chatSynonyms, setChatSynonyms] = useState({});
  

  // Funzione per impostare un sinonimo per una chat
  const setChatSynonym = async (chatId, synonym) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/synonym`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ synonym }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Aggiorna lo stato locale solo dopo che il salvataggio nel DB è avvenuto con successo
      setChatSynonyms(prev => ({
        ...prev,
        [chatId]: synonym
      }));
    } catch (error) {
      console.error("Errore nel salvataggio del sinonimo:", error);
    }
  };


  // Funzione per rimuovere un sinonimo
  const removeChatSynonym = async (chatId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/synonym`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Aggiorna lo stato locale solo dopo che la rimozione dal DB è avvenuta con successo
      setChatSynonyms(prev => {
        const newSynonyms = { ...prev };
        delete newSynonyms[chatId];
        return newSynonyms;
      });
    } catch (error) {
      console.error("Errore nella rimozione del sinonimo:", error);
    }
  };

  // Definisci l'URL base per le API
  const API_BASE_URL = useMemo(() => {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = 8080; // Porta fissa per il backend
    return `${protocol}//${host}:${port}`;
  }, []);
  
  // Carica i sinonimi dal database
  const loadChatSynonyms = useCallback(async () => {
    try {
      const synonymsMap = {};
      const response = await fetch(`${API_BASE_URL}/api/chats`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const chatsData = await response.json();
      
      // Per ogni chat, carica il sinonimo
      for (const chat of chatsData) {
        try {
          const synonymResponse = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chat.id)}/synonym`);
          if (synonymResponse.ok) {
            const data = await synonymResponse.json();
            if (data.synonym) {
              synonymsMap[chat.id] = data.synonym;
            }
          }
        } catch (error) {
          console.warn(`Errore nel caricamento del sinonimo per la chat ${chat.id}:`, error);
        }
      }
      setChatSynonyms(synonymsMap);
    } catch (error) {
      console.error("Errore nel caricamento dei sinonimi:", error);
    }
  }, [API_BASE_URL]);

  const sortChatsByLatestMessage = (chatsArray) => {
    // Crea una copia dell'array per non modificare l'originale
    return [...chatsArray].sort((a, b) => {
      // Get timestamp of last message for each chat
      const timestampA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp) : new Date(0);
      const timestampB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp) : new Date(0);
      
      // Sort by most recent first
      return timestampB - timestampA;
    });
  };

  // Funzione per riordinare le chat in modo sicuro e istantaneo
  const safeReorderChats = useCallback(() => {
    // Verifica se l'utente sta interagendo con la pagina
    if (isUserScrolling) {
      console.log("Saltando riordinamento chat - utente sta interagendo");
      return;
    }
    
    // Memorizza l'ordine attuale delle chat per confronto
    const currentOrder = chats.map(chat => chat.id);
    
    // Calcola il nuovo ordine senza modificare lo stato
    const newOrder = sortChatsByLatestMessage([...chats]).map(chat => chat.id);
    
    // Verifica se l'ordine è effettivamente cambiato
    const orderChanged = newOrder.some((id, index) => id !== currentOrder[index]);
    
    // Aggiorna lo stato solo se l'ordine è cambiato
    if (orderChanged) {
      console.log("Riordinamento chat necessario");
      
      // Usa requestAnimationFrame per sincronizzare con il ciclo di rendering
      requestAnimationFrame(() => {
        setChats(prevChats => {
          // Crea una nuova copia dell'array
          const updatedChats = [...prevChats];
          
          // Ordina le chat in base al nuovo ordine calcolato
          updatedChats.sort((a, b) => {
            const indexA = newOrder.indexOf(a.id);
            const indexB = newOrder.indexOf(b.id);
            return indexA - indexB;
          });
          
          return updatedChats;
        });
      });
    }
  }, [isUserScrolling, chats]);
  
  // Imposta un timer per riordinare le chat periodicamente
  useEffect(() => {
    const reorderInterval = setInterval(() => {
      safeReorderChats();
    }, 60000); // Riordina ogni 60 secondi se l'utente non sta interagendo
    
    return () => clearInterval(reorderInterval);
  }, [safeReorderChats]);
  
  // Fetch all chats from the server
  const fetchChats = useCallback(async () => {
    try {
      // Verifica se stiamo già facendo un fetch o se è passato troppo poco tempo
      const now = Date.now();
      const GLOBAL_THROTTLE_MS = 5000; // 5 secondi di throttle globale
      
      if (isCurrentlyFetchingRef.current) {
        console.log("Saltando fetchChats - fetch già in corso");
        return;
      }
      
      if (window.lastGlobalFetch && now - window.lastGlobalFetch < GLOBAL_THROTTLE_MS) {
        console.log(`Saltando fetchChats - ultimo fetch ${now - window.lastGlobalFetch}ms fa`);
        return;
      }
      
      console.log("Fetching chats...");
      isCurrentlyFetchingRef.current = true;
      window.lastGlobalFetch = now;
      
      // Mostra il loader solo al caricamento iniziale e solo se non è già stato mostrato
      if (chats.length === 0 && !window.initialLoadComplete) {
        setIsLoading(true);
      }
      
      const response = await fetch(`${API_BASE_URL}/api/chats`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const chatsData = await response.json();
      console.log("Received chats data:", chatsData);
      
      // Confronta con lo stato attuale
      const currentChatIds = new Set(chats.map(c => c.id));
      const newChatIds = new Set(chatsData.map(c => c.id));
      
      // Verifica se ci sono chat nuove o rimosse
      const hasNewChats = chatsData.some(c => !currentChatIds.has(c.id));
      const hasRemovedChats = chats.some(c => !newChatIds.has(c.id));
      
      // Se non ci sono cambiamenti, potremmo saltare il caricamento dei messaggi
      if (!hasNewChats && !hasRemovedChats && chats.length > 0) {
        // Aggiorna solo i metadati delle chat
        const updatedChats = chats.map(existingChat => {
          const updatedChatData = chatsData.find(c => c.id === existingChat.id);
          if (updatedChatData) {
            // Mantieni i messaggi esistenti, ma controlla se dobbiamo aggiornare
            // in base al timestamp dell'ultimo messaggio
            const shouldUpdateMessages = 
              updatedChatData.lastMessageTimestamp && 
              existingChat.lastMessageTimestamp &&
              new Date(updatedChatData.lastMessageTimestamp) > new Date(existingChat.lastMessageTimestamp);
            
            if (!shouldUpdateMessages) {
              return {
                ...updatedChatData,
                messages: existingChat.messages
              };
            }
            // Altrimenti, lasceremo che il codice successivo faccia fetch dei messaggi
          }
          return existingChat;
        });
        
        if (!updatedChats.some(chat => 
          chat.lastMessageTimestamp && 
          chats.find(c => c.id === chat.id)?.lastMessageTimestamp &&
          new Date(chat.lastMessageTimestamp) > new Date(chats.find(c => c.id === chat.id).lastMessageTimestamp)
        )) {
          // Se non ci sono chat con nuovi messaggi, possiamo usare lo stato ottimizzato
          // e riordinare in base al timestamp dell'ultimo messaggio
          setChats(sortChatsByLatestMessage(updatedChats));
          console.log("Aggiornati metadati chat senza ricaricare messaggi");
          return;
        }
        // Altrimenti, continuiamo con il fetch dei messaggi solo per le chat che ne hanno bisogno
      }
      
      // Processa le chat in parallelo, ma carica messaggi solo per chat nuove o che necessitano aggiornamento
      const preparedChats = await Promise.all(
        chatsData.map(async (chat) => {
          try {
            // Controlla se abbiamo già questa chat con messaggi
            const existingChat = chats.find(c => c.id === chat.id);
            
            // Verifica se dobbiamo aggiornare i messaggi
            const needsMessageUpdate = !existingChat || 
                                      !existingChat.messages || 
                                      existingChat.messages.length === 0 ||
                                      (chat.lastMessageTimestamp && 
                                       existingChat.lastMessageTimestamp &&
                                       new Date(chat.lastMessageTimestamp) > new Date(existingChat.lastMessageTimestamp));
            
            if (existingChat && existingChat.messages && existingChat.messages.length > 0 && !needsMessageUpdate) {
              // Se abbiamo già questa chat e non necessita aggiornamento, manteniamo i messaggi esistenti
              return {
                ...chat,
                messages: existingChat.messages
              };
            }
            
            console.log(`Caricamento messaggi per chat ${chat.id}${needsMessageUpdate ? ' (aggiornamento necessario)' : ' (nuova chat)'}`);
            
            // Per chat nuove o che necessitano aggiornamento, facciamo fetch dei messaggi
            const messagesResponse = await fetch(
              `${API_BASE_URL}/api/chats/${encodeURIComponent(chat.id)}/messages`
            );
            
            if (!messagesResponse.ok) {
              console.error(`Errore fetch messaggi per chat ${chat.id}: ${messagesResponse.status}`);
              // Se abbiamo messaggi esistenti, li manteniamo invece di restituire un array vuoto
              return { 
                ...chat, 
                messages: existingChat?.messages || [] 
              };
            }
            
            const messages = await messagesResponse.json();
            console.log(`Caricati ${messages.length} messaggi per chat ${chat.id}`);
            
            // Aggiorna timestamp dell'ultimo fetch
            lastFetchTime[chat.id] = now;
            
            return { ...chat, messages };
          } catch (error) {
            console.error(`Errore processing chat ${chat.id}:`, error);
            // Se abbiamo messaggi esistenti, li manteniamo invece di restituire un array vuoto
            const existingChat = chats.find(c => c.id === chat.id);
            return { 
              ...chat, 
              messages: existingChat?.messages || [] 
            };
          }
        })
      );
      
      // Ordina le chat per timestamp dell'ultimo messaggio
      const sortedChats = sortChatsByLatestMessage(preparedChats);
      
      // Aggiorna i messaggi non letti
      setUnreadMessages(prev => {
        const newUnread = { ...prev };
        sortedChats.forEach(chat => {
          const chatElement = document.querySelector(`[data-chat-id="${chat.id}"]`);
          if (chatElement) {
            const isAtBottom = Math.abs(chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight) < 50;
            if (!isAtBottom) {
              newUnread[chat.id] = (newUnread[chat.id] || 0) + 1;
            }
          }
        });
        return newUnread;
      });
      
      // Aggiorna lo stato con le chat ordinate
      setChats(sortedChats);
      
      // Resetta gli errori
      setError(null);
      
      // Segna che il caricamento iniziale è stato completato
      window.initialLoadComplete = true;
    } catch (error) {
      console.error('Errore nel caricamento delle chat:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
      isCurrentlyFetchingRef.current = false;
    }
  }, [API_BASE_URL, chats]);

  const handleNewMessage = useCallback((payload) => {
    const { chatId, message } = payload;
    
    console.log("Nuovo messaggio ricevuto via WebSocket:", message);
    
    // Se non c'è un chatId valido, non possiamo fare nulla
    if (!chatId) {
      console.warn("ChatId mancante nel payload");
      return;
    }
    
    // Verifica se stiamo già facendo un fetch
    if (isCurrentlyFetchingRef.current) {
      console.log("Saltando aggiornamento: fetch già in corso");
      return;
    }
    
    // Verifica se la chat esiste già nel nostro stato
    const chatExists = chats.some(chat => chat.id === chatId);
    
    if (!chatExists) {
      console.log("Chat non trovata nello stato, ma evito di ricaricare tutto");
      // Invece di ricaricare tutte le chat, aggiorneremo solo quando necessario
      return;
    }
    
    // Verifica se il messaggio esiste già
    const messageExists = chats.find(chat => chat.id === chatId)?.messages.some(m => m.id === message?.id);
  
    // Se il messaggio è valido e non esistente, aggiungiamolo direttamente senza fetch
    if (message && !messageExists) {
      setChats(prevChats => {
        // Trova la chat a cui appartiene il messaggio
        const chatIndex = prevChats.findIndex(chat => chat.id === chatId);
                  
        if (chatIndex !== -1) {
          // Crea una copia dell'array chat
          const updatedChats = [...prevChats];
                    
          // Aggiorna la chat esistente
          const updatedChat = { ...updatedChats[chatIndex] };
                    
          // Aggiungi il nuovo messaggio
          updatedChat.messages = [...updatedChat.messages, message];
                    
          // Aggiorna l'ultimo messaggio
          updatedChat.lastMessage = message;
                    
          // Sostituisci la chat nell'array
          updatedChats[chatIndex] = updatedChat;
                    
          // Se l'utente sta scorrendo, aggiorna i messaggi non letti
          if (isUserScrolling) {
            setUnreadMessages(prev => ({
              ...prev,
              [chatId]: (prev[chatId] || 0) + 1
            }));
          }
                    
          // Riordina le chat in modo istantaneo senza causare refresh
          // Manteniamo la stessa struttura DOM ma aggiorniamo l'ordine
          if (!isUserScrolling) {
            // Calcola il nuovo ordine
            const sortedOrder = sortChatsByLatestMessage([...updatedChats])
              .map(chat => chat.id);
                      
            // Assegna un indice di ordinamento a ciascuna chat
            updatedChats.forEach(chat => {
              chat._sortIndex = sortedOrder.indexOf(chat.id);
            });
                      
            // Ordina l'array in base all'indice di ordinamento
            updatedChats.sort((a, b) => a._sortIndex - b._sortIndex);
          }
                    
          // Preserva le referenze degli oggetti non modificati per evitare re-render inutili
          return Object.assign([], prevChats, updatedChats.map((chat, idx) => 
            chat.id === chatId ? chat : prevChats[idx]
          ));
        }
                  
        return prevChats;
      });
      
      return; // Abbiamo aggiornato lo stato, non serve fare fetching
    }
    
    // Verifica se abbiamo fatto fetch recentemente per questa chat
    const now = Date.now();
    if (lastFetchTime.current[chatId] && now - lastFetchTime.current[chatId] < FETCH_THROTTLE_MS) {
      console.log(`Saltando fetch per chat ${chatId} - fetched troppo di recente`);
      return;
    }
    
    // Se necessario, aggiorna la chat con un fetch selettivo
    lastFetchTime.current[chatId] = now;
    isCurrentlyFetchingRef.current = true;
    
    // Funzione per fare fetch di una singola chat
    const fetchSingleChat = async () => {
      try {
        console.log(`Fetching selettivo per chat: ${chatId}`);
      
        // Fetch chat details
        const chatResponse = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}`);
        if (!chatResponse.ok) {
          console.error(`Errore fetch chat ${chatId}: ${chatResponse.status}`);
          return;
        }
      
        const chatData = await chatResponse.json();
      
        // Controlla se abbiamo già questa chat con messaggi sufficienti
        const existingChat = chats.find(c => c.id === chatId);
        if (existingChat && existingChat.messages && existingChat.messages.length > 0) {
          // Verifica se il timestamp dell'ultimo messaggio è più recente
          const lastMessageTimestamp = new Date(existingChat.lastMessage?.timestamp || 0);
          const newLastMessageTimestamp = new Date(chatData.lastMessage?.timestamp || 0);
        
          if (lastMessageTimestamp >= newLastMessageTimestamp) {
            console.log(`Chat ${chatId} già aggiornata, salto il fetch messaggi`);
            return;
          }
        }
      
        // Fetch messaggi solo se necessario
        const messagesResponse = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/messages`);
        if (!messagesResponse.ok) {
          console.error(`Errore fetch messaggi per chat ${chatId}: ${messagesResponse.status}`);
          return;
        }
      
        const messages = await messagesResponse.json();
      
        // Aggiungi gli ID dei messaggi alla lista dei messaggi in arrivo
        if (!window.incomingMessageIds) {
          window.incomingMessageIds = new Set();
        }
      
        // Aggiungi tutti gli ID dei messaggi alla lista
        messages.forEach(msg => {
          if (msg.id) {
            window.incomingMessageIds.add(msg.id);
          }
        });
      
        // Imposta un timeout per rimuovere gli ID dalla lista dopo un po'
        setTimeout(() => {
          if (window.incomingMessageIds) {
            messages.forEach(msg => {
              if (msg.id) {
                window.incomingMessageIds.delete(msg.id);
              }
            });
          }
        }, 10000); // 10 secondi dovrebbero essere sufficienti
        
        // Aggiorna lo stato senza riordinare
        setChats(prevChats => {
          const updatedChats = prevChats.map(chat => 
            chat.id === chatId ? {
              ...chatData,
              messages: messages
            } : chat
          );
        
          // Non riordiniamo qui per evitare di perdere la posizione di visualizzazione
          return updatedChats;
        });
      } catch (error) {
        console.error(`Errore in fetchSingleChat per ${chatId}:`, error);
      } finally {
        isCurrentlyFetchingRef.current = false;
      }
    };
    
    fetchSingleChat();
  }, [isUserScrolling, chats, API_BASE_URL]);

  // Funzione per gestire gli aggiornamenti delle chat
  const handleChatUpdate = useCallback((updatedChat) => {
    console.log("Aggiornamento chat ricevuto via WebSocket:", updatedChat);
    
    // Se non c'è un ID chat valido, non possiamo fare nulla
    if (!updatedChat || !updatedChat.id) {
      console.warn("ID chat mancante nell'aggiornamento");
      return;
    }
    
    // Se stiamo già facendo un fetch, saltiamo questo aggiornamento
    if (isCurrentlyFetchingRef.current) {
      console.log("Saltando aggiornamento chat: fetch già in corso");
      return;
    }
    
    // Verifica se la chat esiste già nel nostro stato
    const chatExists = chats.some(chat => chat.id === updatedChat.id);
    
    if (!chatExists) {
      console.log("Nuova chat rilevata, ma evito il fetch completo");
      // Non facciamo fetch di tutte le chat, aggiorniamo lo stato quando necessario
      return;
    }
    
    // Verifica se abbiamo fatto fetch recentemente per questa chat
    const now = Date.now();
    if (lastFetchTime.current[updatedChat.id] && now - lastFetchTime.current[updatedChat.id] < FETCH_THROTTLE_MS) {
      console.log(`Saltando fetch per chat ${updatedChat.id} - fetched troppo di recente`);
    }
    
    // Aggiorna direttamente la chat con i dati ricevuti senza riordinare
    setChats(prevChats => {
      // Trova l'indice della chat da aggiornare
      const chatIndex = prevChats.findIndex(chat => chat.id === updatedChat.id);
      
      if (chatIndex === -1) return prevChats;
      
      // Crea una copia dell'array delle chat
      const updatedChats = [...prevChats];
      
      // Aggiorna la chat mantenendo i messaggi esistenti
      updatedChats[chatIndex] = {
        ...updatedChats[chatIndex],
        ...updatedChat,
        messages: updatedChats[chatIndex].messages || []
      };
      
      // Restituisci l'array aggiornato senza riordinare
      return updatedChats;
    });
    
    // Aggiorna il timestamp dell'ultimo fetch
    lastFetchTime.current[updatedChat.id] = now;
  }, [chats]);

  // Riferimento al WebSocket
  const wsRef = useRef(null);
  
  // Carica i sinonimi all'avvio
  useEffect(() => {
    loadChatSynonyms();
  }, [loadChatSynonyms]);


  useEffect(() => {
    // Chiudi eventuali connessioni WebSocket esistenti prima di crearne una nuova
    if (wsRef.current) {
      console.log('Chiusura della connessione WebSocket precedente');
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      if (wsRef.current.pingInterval) {
        clearInterval(wsRef.current.pingInterval);
      }
    }
    
    // Memorizza l'ultimo messaggio ricevuto per ogni chat per evitare duplicati
    const lastReceivedMessageIds = {};

    // Variabili per gestire la connessione
    let isConnecting = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;
    let reconnectTimeout = null;
    
    // Funzione per stabilire la connessione WebSocket
    const connectWebSocket = () => {
      // Pulisci eventuali timeout di riconnessione
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      
      // Verifica che non ci sia già una connessione attiva
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('WebSocket già connesso, non ne creo uno nuovo');
        return;
      }
      
      // Verifica che non sia in corso un tentativo di connessione
      if (isConnecting) {
        console.log('Connessione WebSocket già in corso, ignoro la richiesta');
        return;
      }
      
      isConnecting = true;
      console.log(`Tentativo di connessione WebSocket a ${WS_URL}...`);
      
      // Crea una nuova connessione WebSocket
      const ws = new WebSocket(WS_URL);
      
      // Timeout per la connessione
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('Timeout connessione WebSocket');
          ws.close();
        }
      }, 15000); // Aumentiamo il timeout a 15 secondi
      
      ws.onopen = () => {
        console.log('WebSocket connesso con successo');
        clearTimeout(connectionTimeout);
        isConnecting = false;
        reconnectAttempts = 0;
        
        // Memorizza il WebSocket nel riferimento
        wsRef.current = ws;
        
        // Ping ogni 30 secondi per mantenere attiva la connessione
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
            } catch (error) {
              console.error('Errore nell\'invio del ping:', error);
              clearInterval(pingInterval);
            }
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);
        
        wsRef.current.pingInterval = pingInterval;
        
        // Carica le chat dopo la connessione se necessario
        if (chats.length === 0) {
          fetchChats();
        }
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket messaggio ricevuto:', data.type);
          
          switch (data.type) {
            case 'new_message':
              console.log('Nuovo messaggio ricevuto:', data.payload);
              const { chatId, message } = data.payload;
              
              if (!chatId || !message) {
                console.warn("Dati del messaggio incompleti nel payload");
                return;
              }
              
              // Verifica se abbiamo già ricevuto questo messaggio
              if (lastReceivedMessageIds[chatId] === message.id) {
                console.log(`Messaggio duplicato ignorato: ${message.id}`);
                return;
              }
              
              // Memorizza l'ID dell'ultimo messaggio ricevuto per questa chat
              lastReceivedMessageIds[chatId] = message.id;
              
              // Verifica se stiamo già facendo un fetch
              if (isCurrentlyFetchingRef.current) {
                console.log("Saltando aggiornamento: fetch già in corso");
                return;
              }
              
              // Verifica se la chat esiste già nel nostro stato
              const chatExists = chats.some(chat => chat.id === chatId);
              
              if (!chatExists) {
                console.log(`Chat ${chatId} non trovata, carico tutte le chat`);
                fetchChats();
                return;
              }
              
              // Verifica se il messaggio esiste già - controllo più rigoroso
              const messageExists = chats.find(chat => chat.id === chatId)?.messages.some(m => m.id === message?.id);
              
              // Verifica anche se il messaggio è in arrivo tramite API
              const isMessageIncoming = window.incomingMessageIds && window.incomingMessageIds.has(message?.id);
      
              // Se il messaggio è valido, non esistente e non è già in arrivo tramite API, aggiungiamolo direttamente
              if (message && !messageExists && !isMessageIncoming) {
                // Aggiungi l'ID del messaggio alla lista dei messaggi in arrivo
                if (!window.incomingMessageIds) {
                  window.incomingMessageIds = new Set();
                }
                window.incomingMessageIds.add(message.id);
                
                // Imposta un timeout per rimuovere l'ID dalla lista dopo un po'
                setTimeout(() => {
                  if (window.incomingMessageIds) {
                    window.incomingMessageIds.delete(message.id);
                  }
                }, 10000); // 10 secondi dovrebbero essere sufficienti
                setChats(prevChats => {
                  // Trova la chat a cui appartiene il messaggio
                  const chatIndex = prevChats.findIndex(chat => chat.id === chatId);
                  
                  if (chatIndex === -1) return prevChats;
                  
                  // Crea una nuova copia dell'array delle chat
                  const updatedChats = [...prevChats];
                  
                  // Crea una copia profonda della chat da aggiornare
                  const updatedChat = JSON.parse(JSON.stringify(updatedChats[chatIndex]));
                  
                  // Aggiungi il nuovo messaggio
                  updatedChat.messages = [...updatedChat.messages, message];
                  
                  // Aggiorna l'ultimo messaggio
                  updatedChat.lastMessage = message;
                  
                  // Sostituisci la chat nell'array
                  updatedChats[chatIndex] = updatedChat;
                  
                  // Se l'utente sta scorrendo, aggiorna i messaggi non letti
                  if (isUserScrolling) {
                    setUnreadMessages(prev => ({
                      ...prev,
                      [chatId]: (prev[chatId] || 0) + 1
                    }));
                  }
                  
                  // NON riordiniamo qui per evitare refresh completo
                  // Manteniamo l'ordine attuale per evitare salti nell'interfaccia
                  
                  return updatedChats;
                });
              }
              break;

            case 'message_edited':
              console.log('Messaggio modificato ricevuto:', data.payload);
              const { messageId: editedMessageId, chatId: editedChatId, content: editedContent } = data.payload;
              
              if (!editedMessageId || !editedChatId || !editedContent) {
                console.warn("Dati del messaggio modificato incompleti");
                return;
              }
              
              console.log(`Aggiornamento messaggio ${editedMessageId} in chat ${editedChatId} con contenuto: ${editedContent}`);
              
              // Aggiorna il messaggio modificato nello stato
              setChats(prevChats => {
                // Trova la chat che contiene il messaggio
                const chatIndex = prevChats.findIndex(chat => chat.id === editedChatId);
                if (chatIndex === -1) {
                  console.warn(`Chat ${editedChatId} non trovata per messaggio modificato`);
                  return prevChats;
                }
                
                // Crea una copia dell'array delle chat
                const updatedChats = [...prevChats];
                
                // Crea una copia profonda della chat da aggiornare
                const updatedChat = JSON.parse(JSON.stringify(updatedChats[chatIndex]));
                
                // Trova e aggiorna il messaggio
                const messageIndex = updatedChat.messages.findIndex(msg => msg.id === editedMessageId);
                if (messageIndex !== -1) {
                  // Aggiorna il contenuto e imposta il flag isEdited
                  updatedChat.messages[messageIndex].content = editedContent;
                  updatedChat.messages[messageIndex].isEdited = true;
                  
                  // Se è l'ultimo messaggio, aggiorna anche quello
                  if (updatedChat.lastMessage && updatedChat.lastMessage.id === editedMessageId) {
                    updatedChat.lastMessage.content = editedContent;
                    updatedChat.lastMessage.isEdited = true;
                  }
                  
                  // Sostituisci la chat nell'array
                  updatedChats[chatIndex] = updatedChat;
                  
                  console.log(`Messaggio ${editedMessageId} aggiornato con successo`);
                  return updatedChats;
                } else {
                  console.warn(`Messaggio ${editedMessageId} non trovato nella chat ${editedChatId}`);
                }
                
                return prevChats;
              });
              break;
              
            case 'message_deleted':
              console.log('Messaggio eliminato ricevuto:', data.payload);
              const { messageId: deletedMessageId, chatId: deletedChatId } = data.payload;
              
              if (!deletedMessageId || !deletedChatId) {
                console.warn("Dati del messaggio eliminato incompleti");
                return;
              }
              
              console.log(`Eliminazione messaggio ${deletedMessageId} in chat ${deletedChatId}`);
              
              // Aggiorna il messaggio eliminato nello stato
              setChats(prevChats => {
                // Trova la chat che contiene il messaggio
                const chatIndex = prevChats.findIndex(chat => chat.id === deletedChatId);
                if (chatIndex === -1) {
                  console.warn(`Chat ${deletedChatId} non trovata per messaggio eliminato`);
                  return prevChats;
                }
                
                // Crea una copia dell'array delle chat
                const updatedChats = [...prevChats];
                
                // Crea una copia profonda della chat da aggiornare
                const updatedChat = JSON.parse(JSON.stringify(updatedChats[chatIndex]));
                
                // Trova e aggiorna il messaggio
                const messageIndex = updatedChat.messages.findIndex(msg => msg.id === deletedMessageId);
                if (messageIndex !== -1) {
                  // Imposta il messaggio come eliminato
                  updatedChat.messages[messageIndex].isDeleted = true;
                  updatedChat.messages[messageIndex].content = "(Questo messaggio è stato eliminato)";
                  
                  // Se è l'ultimo messaggio, aggiorna anche quello
                  if (updatedChat.lastMessage && updatedChat.lastMessage.id === deletedMessageId) {
                    updatedChat.lastMessage.isDeleted = true;
                    updatedChat.lastMessage.content = "(Questo messaggio è stato eliminato)";
                  }
                  
                  // Sostituisci la chat nell'array
                  updatedChats[chatIndex] = updatedChat;
                  
                  console.log(`Messaggio ${deletedMessageId} contrassegnato come eliminato`);
                  return updatedChats;
                } else {
                  console.warn(`Messaggio ${deletedMessageId} non trovato nella chat ${deletedChatId}`);
                }
                
                return prevChats;
              });
              break;

            case 'chat_updated':
              console.log('Chat aggiornata ricevuta:', data.payload);
              if (!data.payload || !data.payload.id) {
                console.warn("Payload chat_updated non valido");
                return;
              }
              
              const updatedChatId = data.payload.id;
              
              // Se stiamo già facendo un fetch, saltiamo questo aggiornamento
              if (isCurrentlyFetchingRef.current) {
                console.log("Saltando aggiornamento chat: fetch già in corso");
                return;
              }
              
              // Verifica se la chat esiste già nel nostro stato
              const updatedChatExists = chats.some(chat => chat.id === updatedChatId);
              
              if (!updatedChatExists) {
                console.log(`Chat ${updatedChatId} non trovata, carico tutte le chat`);
                fetchChats();
                return;
              }
              
              // Aggiorna direttamente la chat con i dati ricevuti
              setChats(prevChats => {
                return prevChats.map(chat => {
                  if (chat.id === updatedChatId) {
                    return {
                      ...chat,
                      ...data.payload,
                      // Mantieni i messaggi esistenti
                      messages: chat.messages || []
                    };
                  }
                  return chat;
                });
              });
              break;
              
            // Altri case...
            default:
              console.log('Messaggio WebSocket di tipo sconosciuto:', data);
          }
        } catch (error) {
          console.error('Errore nel parsing del messaggio WebSocket:', error);
        }
      };
      
      ws.onclose = (event) => {
        console.log(`WebSocket disconnesso: ${event.code} - ${event.reason || "Nessuna ragione"}`);
        clearTimeout(connectionTimeout);
        
        // Pulisci la connessione
        if (wsRef.current && wsRef.current.pingInterval) {
          clearInterval(wsRef.current.pingInterval);
        }
        
        isConnecting = false;
        
        // Non riconnetterti se la chiusura è stata intenzionale (1000 è "normal closure")
        if (event.code === 1000) {
          console.log('Chiusura normale del WebSocket, non tento la riconnessione');
          return;
        }
        
        // Riconnetti con backoff esponenziale
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(baseReconnectDelay * Math.pow(1.5, reconnectAttempts), 30000);
          console.log(`Riconnessione tra ${delay/1000} secondi (tentativo ${reconnectAttempts}/${maxReconnectAttempts})...`);
          
          // Memorizza il timeout per poterlo pulire se necessario
          reconnectTimeout = setTimeout(connectWebSocket, delay);
        } else {
          console.error('Numero massimo di tentativi di riconnessione raggiunto');
          alert('Impossibile connettersi al server. Ricarica la pagina per riprovare.');
        }
      };
      
      ws.onerror = (error) => {
        console.error('Errore WebSocket:', error);
        // Non chiudiamo la connessione qui, lasciamo che onclose gestisca la riconnessione
      };
    };
    
    // Stabilisci la connessione iniziale
    connectWebSocket();
    
    // Carica le chat iniziali se non ne abbiamo già
    if (chats.length === 0) {
      fetchChats();
    }
    
    // Cleanup alla disconnessione
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      
      if (wsRef.current) {
        console.log('Chiusura della connessione WebSocket durante il cleanup');
        if (wsRef.current.pingInterval) {
          clearInterval(wsRef.current.pingInterval);
        }
        // Chiusura intenzionale con codice 1000 (normal closure)
        wsRef.current.close(1000, "Chiusura normale");
        wsRef.current = null;
      }
    };
  }, [WS_URL, fetchChats, chats.length]);

  const handleScroll = (e) => {
    const element = e.target;
    const chatId = element.dataset.chatId;
    const isAtTop = element.scrollTop < 50;
    setIsUserScrolling(!isAtTop);

    // Trova l'ultimo messaggio visibile
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    
    const visibleMessages = chat.messages.filter(message => {
      const messageElement = document.getElementById(`message-${message.id}`);
      if (messageElement) {
        const rect = messageElement.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= element.clientHeight;
      }
      return false;
    });

    if (visibleMessages.length > 0) {
      const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
      setLastSeenMessages(prev => ({
        ...prev,
        [chatId]: lastVisibleMessage.timestamp
      }));

      // Aggiorna i messaggi non letti
      const totalMessages = chats.find(c => c.id === chatId)?.messages.length || 0;
      const seenMessages = chats.find(c => c.id === chatId)?.messages
        .filter(m => new Date(m.timestamp) <= new Date(lastVisibleMessage.timestamp)).length || 0;

      setUnreadMessages(prev => ({
        ...prev,
        [chatId]: Math.max(0, totalMessages - seenMessages)
      }));
    }

    const isAtBottom = Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) < 50;
    if (isAtBottom) {
      setUnreadMessages(prev => ({
        ...prev,
        [chatId]: 0
      }));
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const today = new Date();

    // Controlla se è oggi
    if (date.toDateString() === today.toDateString()) {
      return `Oggi ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return `${date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString([], { hour:
'2-digit', minute: '2-digit' })}`;
    }
  };

  const handleImageClick = useCallback((imageSrc, chatName, chatSynonym, messageTime) => {
    // Utilizziamo safeImagePath per codificare il percorso dell'immagine
    setModalImage({
      src: imageSrc,
      chatName,
      chatSynonym,
      messageTime
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalImage(null);
  }, []);

  // Funzione per trovare un messaggio in base al suo ID
  const findMessageById = useCallback((messageId) => {
    for (const chat of chats) {
      for (const message of chat.messages) {
        if (message.ID === messageId) {
          return message;
        }
      }
    }
    return null;
  }, [chats]);


  // Inizializza le variabili globali necessarie
  useEffect(() => {
    if (typeof window.initialLoadComplete === 'undefined') {
      window.initialLoadComplete = false;
    }
    
    // Inizializza la struttura dati per tenere traccia dei messaggi in arrivo
    if (typeof window.incomingMessageIds === 'undefined') {
      window.incomingMessageIds = new Set();
    }
    
    // Pulisci la struttura dati quando il componente viene smontato
    return () => {
      window.incomingMessageIds = new Set();
    };
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Helmet>
        <title>WhatsApp Web Viewer</title>
      </Helmet>
      <Box sx={{ 
        p: 3,
        height: '100vh',
        bgcolor: 'background.default'
      }}>
        {isLoading && !window.initialLoadComplete ? (
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%'
          }}>
            <Typography variant="h1" gutterBottom>WhatsApp Web Viewer</Typography>
            <CircularProgress />
            <Typography variant="body1" sx={{ mt: 2 }}>Caricamento chat in corso...</Typography>
          </Box>
        ) : error ? (
          <>
            <Typography variant="h1" gutterBottom>WhatsApp Web Viewer</Typography>
            <Typography color="error">Errore: {error}</Typography>
          </>
        ) : (
          <>
            <Typography variant="h1" gutterBottom>WhatsApp Web Viewer</Typography>
            {chats.length > 0 && (
              <ErrorBoundary>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <DuplicateImageFinder chats={chats} />
                  <Button 
                    variant="outlined" 
                    color="primary" 
                    onClick={() => setNotesGroupViewOpen(true)}
                    startIcon={<NoteIcon />}
                  >
                    Visualizza Note Raggruppate
                  </Button>
                </Box>
              </ErrorBoundary>
            )}
            {chats.length > 0 ? (
              <ErrorBoundary>
                <Box sx={{
                  display: 'flex',
                  gap: 3,
                  overflowX: 'auto',
                  pb: 4,  // Aumentato padding bottom
                  alignItems: 'stretch',  // Ensure all children have same height
                  mt: 2,  // Aggiunto margin top
                  '&::-webkit-scrollbar': {
                    height: '8px',  // Larghezza scrollbar orizzontale
                  },
                  '&::-webkit-scrollbar-track': {
                    backgroundColor: 'rgba(0,0,0,0.05)',  // Colore traccia scrollbar
                    borderRadius: '10px',  // Bordi arrotondati
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: 'rgba(0,0,0,0.2)',  // Colore thumb scrollbar
                    borderRadius: '10px',  // Bordi arrotondati
                  }
                }}>
                  {/* Wrapper per BotSalvatore, DirettaGames e AlertTable con larghezza controllata */}
                  <Box sx={{ 
                    display: 'flex',
                    gap: 2,
                    flexShrink: 0, 
                    flexGrow: 0 
                  }}>
                    <MemoizedSideComponents />
                  </Box>
                  
                  {chats.map((chat) => (
                    <ChatWindow
                      key={chat.id}
                      chat={chat}
                      chats={chats}
                      unreadMessages={unreadMessages}
                      handleScroll={handleScroll}
                      handleImageClick={handleImageClick}
                      lastSeenMessages={lastSeenMessages}
                      seenMessages={seenMessages}
                      chatSynonyms={chatSynonyms}
                      setChatSynonym={setChatSynonym}
                      removeChatSynonym={removeChatSynonym}
                      isLoadingMessages={isCurrentlyFetchingRef.current && (!chat.messages || chat.messages.length === 0)}
                    />
                  ))}
                </Box>
              </ErrorBoundary>
            ) : (
              <Typography variant="body1">Nessuna chat trovata</Typography>
            )}
          </>
        )}
      </Box>
      

      <Dialog
        open={!!modalImage}
        onClose={closeModal}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            width: 'auto',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(18, 18, 18, 0.9)'
          }
        }}
      >
        <DialogContent sx={{ 
          p: 0, 
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '90vh' // Fixed height for the dialog content
        }}>
          {/* Componenti di controllo */}
          <Paper
            elevation={3}
            sx={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: 1,
              p: '4px 12px',
              bgcolor: 'rgba(0, 0, 0, 0.7)',
              borderRadius: 20,
              zIndex: 1100
            }}
          >
            <IconButton 
              onClick={() => {
                // Ruota a sinistra (antiorario)
                setRotation((prevRotation) => (prevRotation - 90) % 360);
              }}
              size="small" 
              sx={{ color: 'white' }}
              title="Ruota a sinistra"
            >
              <RotateLeftIcon />
            </IconButton>
            
            <IconButton 
              onClick={() => {
                // Ruota a destra (orario)
                setRotation((prevRotation) => (prevRotation + 90) % 360);
              }} 
              size="small" 
              sx={{ color: 'white' }}
              title="Ruota a destra"
            >
              <RotateRightIcon />
            </IconButton>
            
            <IconButton 
              onClick={() => {
                // Aumenta zoom
                setZoom((prevZoom) => Math.min(prevZoom + 0.25, 3));
              }}
              size="small" 
              sx={{ color: 'white' }}
              title="Zoom avanti"
            >
              <ZoomInIcon />
            </IconButton>
            
            <IconButton 
              onClick={() => {
                // Diminuisci zoom
                setZoom((prevZoom) => Math.max(prevZoom - 0.25, 0.5));
              }}
              size="small" 
              sx={{ color: 'white' }}
              title="Zoom indietro"
            >
              <ZoomOutIcon />
            </IconButton>
            
            <IconButton 
              onClick={() => {
                // Reset rotazione e zoom
                setRotation(0);
                setZoom(1);
              }}
              size="small" 
              sx={{ color: 'white' }}
              title="Ripristina"
            >
              <RefreshIcon />
            </IconButton>
          </Paper>

          {/* Pulsante di chiusura */}
          <IconButton
            aria-label="close"
            onClick={() => {
              closeModal();
              // Reset valori dopo la chiusura
              setTimeout(() => {
                setRotation(0);
                setZoom(1);
                setModalImage(null);
              }, 300);
            }}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: 'white',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.7)'
              },
              zIndex: 1100
            }}
          >
            <CloseIcon />
          </IconButton>
          
          {/* Informazioni sul messaggio */}
          <Box
            sx={{
              position: 'absolute',
              top: 60, // Posizionato sotto i controlli di rotazione
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              p: '4px 12px',
              bgcolor: 'rgba(0, 0, 0, 0.7)',
              borderRadius: 2,
              zIndex: 1100,
              color: 'white',
              maxWidth: '80%'
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
              {modalImage?.chatName}
            </Typography>
            {modalImage?.chatSynonym && (
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                {modalImage.chatSynonym}
              </Typography>
            )}
            {modalImage?.messageTime && (
              <Typography variant="caption" sx={{ mt: 0.5 }}>
                {modalImage.messageTime}
              </Typography>
            )}
          </Box>

          {/* Immagine con rotazione - Utilizziamo safeImagePath */}
          <Box
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // Spazio per adattarsi alla rotazione
              padding: Math.abs(rotation) % 180 === 90 ? '15% 15%' : '0%'
            }}
          >
            <img 
              src={safeImagePath(modalImage?.src)} 
              alt="Immagine ingrandita" 
              style={{
                maxWidth: Math.abs(rotation) % 180 === 90 ? '70vh' : '90vw',
                maxHeight: Math.abs(rotation) % 180 === 90 ? '70vw' : '90vh',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '4px',
                transform: `rotate(${rotation}deg) scale(${zoom})`,
                padding: '60px 20px 20px 20px',
                transition: 'transform 0.3s ease, max-width 0.3s ease, max-height 0.3s ease',
                cursor: 'grab'
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                const img = e.currentTarget;
                
                // Cambia il cursore durante il trascinamento
                img.style.cursor = 'grabbing';
                
                // Posizione iniziale del mouse
                const startX = e.clientX;
                const startY = e.clientY;
                
                // Estrai i valori di traslazione correnti
                const currentTransform = img.style.transform;
                const initialTranslateX = currentTransform.includes('translateX') 
                  ? parseFloat(currentTransform.split('translateX(')[1].split('px)')[0]) 
                  : 0;
                const initialTranslateY = currentTransform.includes('translateY') 
                  ? parseFloat(currentTransform.split('translateY(')[1].split('px)')[0]) 
                  : 0;
                
                // Funzione per gestire il movimento del mouse
                const handleMouseMove = (moveEvent) => {
                  // Calcola lo spostamento
                  const deltaX = moveEvent.clientX - startX;
                  const deltaY = moveEvent.clientY - startY;
                  
                  // Applica la nuova traslazione
                  const newTranslateX = initialTranslateX + deltaX;
                  const newTranslateY = initialTranslateY + deltaY;
                  
                  // Ottieni le dimensioni dell'immagine e del contenitore
                  const imgRect = img.getBoundingClientRect();
                  const containerRect = img.parentElement.getBoundingClientRect();
                  
                  // Calcola i limiti di traslazione per mantenere almeno il 30% dell'immagine visibile
                  const minVisiblePercent = 0.3; // 30% dell'immagine deve rimanere visibile
                  
                  // Calcola i limiti di traslazione
                  const maxTranslateX = Math.max(0, (imgRect.width * zoom - containerRect.width * minVisiblePercent));
                  const minTranslateX = Math.min(0, -(imgRect.width * zoom - containerRect.width * minVisiblePercent));
                  const maxTranslateY = Math.max(0, (imgRect.height * zoom - containerRect.height * minVisiblePercent));
                  const minTranslateY = Math.min(0, -(imgRect.height * zoom - containerRect.height * minVisiblePercent));
                  
                  // Limita la traslazione
                  const limitedTranslateX = Math.min(Math.max(newTranslateX, minTranslateX), maxTranslateX);
                  const limitedTranslateY = Math.min(Math.max(newTranslateY, minTranslateY), maxTranslateY);
                  
                  // Estrai rotazione e zoom correnti
                  const rotateValue = `rotate(${rotation}deg)`;
                  const scaleValue = `scale(${zoom})`;
                  
                  // Aggiorna la trasformazione
                  img.style.transform = `translateX(${limitedTranslateX}px) translateY(${limitedTranslateY}px) ${rotateValue} ${scaleValue}`;
                };
                
                // Funzione per terminare il trascinamento
                const handleMouseUp = () => {
                  // Ripristina il cursore
                  img.style.cursor = 'grab';
                  
                  // Rimuovi gli event listener
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                
                // Aggiungi gli event listener per il trascinamento
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />
          </Box>
        </DialogContent>
      </Dialog>

      <NotesGroupView 
        open={notesGroupViewOpen} 
        onClose={() => setNotesGroupViewOpen(false)} 
        chats={chats}
      />

    </ThemeProvider>
  );
}

export default App;
