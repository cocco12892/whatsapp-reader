import AudioMessageWrapper from './AudioMessageWrapper';
import { Box, Typography, Badge,IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Radio } from '@mui/material';
import NoteIcon from '@mui/icons-material/Note';
import NotesGroupView from './NotesGroupView';
import ReplyContext from './ReplyContext';
import NoteSelectionDialog from './NoteSelectionDialog';
import React, { useState, useEffect, useCallback } from 'react';
import ReplyIcon from '@mui/icons-material/Reply';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import CloseIcon from '@mui/icons-material/Close';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import DOMPurify from 'dompurify'; // A library to sanitize HTML
import parse from 'html-react-parser'; // A library to parse HTML into React components

DOMPurify.addHook('afterSanitizeAttributes', function(node) {
  // Se il nodo è un link
  if (node.tagName === 'A') {
    // Aggiungi target="_blank" a tutti i link
    node.setAttribute('target', '_blank');
    // Aggiungi anche rel="noopener noreferrer" per sicurezza
    node.setAttribute('rel', 'noopener noreferrer');
    // Aggiungi stile iniziale
    node.setAttribute('style', 'color: #5aa3ec;');
  }
});

// Extract image content from the message content
const extractImageContent = (content) => {
  if (!content || !content.startsWith('📷 Immagine')) {
    return null;
  }
  
  // Check if there's content after "📷 Immagine"
  const match = content.match(/📷 Immagine:?\s*(.*)/);
  if (match && match[1] && match[1].trim() !== '') {
    return match[1].trim();
  }
  
  return null;
};

const formatMessageContent = (content) => {
  if (!content) return '';
  
  // Replace "\n" with real line breaks
  let formattedText = content.replace(/\\n/g, '\n');
  
  // Controlla se il contenuto contiene già tag HTML <a>
  if (!formattedText.includes('<a href=')) {
    // Converti URL in link
    formattedText = formattedText.replace(
      /(https?:\/\/[^\s]+)/g, 
      '<a href="$1">$1</a>'
    );
  }
  
  // Sanitize the HTML to prevent XSS attacks
  const sanitizedHtml = DOMPurify.sanitize(formattedText, {
    ADD_ATTR: ['target', 'rel', 'style'], // Consenti questi attributi
    ALLOWED_TAGS: ['a', 'p', 'br', 'span'], // Consenti questi tag
  });
  
  // Parse the sanitized HTML into React components
  return parse(sanitizedHtml);
};

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function MessageList({ 
messages, 
handleImageClick, 
lastSeenMessages: initialLastSeen,
seenMessages: initialSeen,
chat,
chats,
onReplyToMessage
}) {
// Special senders list
const SPECIAL_SENDERS = {
  '393472195905': { color: 'rgb(223, 250, 228)', name: 'Andrea Cocco' },
  '393518669456': { color: 'rgb(223, 250, 228)', name: 'AC iliad' },
  '393802541389': { color: 'rgb(225, 237, 247)', name: 'Ste' },
  '971585527723': { color: 'rgb(225, 237, 247)', name: 'Fer87' },
  '393937049799': { color: 'rgb(227, 225, 247)', name: 'Jhs' },
  '393297425198': { color: 'rgb(247, 221, 215)', name: 'Ivan' } 
};

// Utilizziamo debounce per limitare le chiamate API
const markMessagesAsRead = debounce((chatId, messageIds) => {
  if (messageIds.length === 0) return;
  
  // Verifica se l'API è disponibile prima di fare la richiesta
  // Utilizziamo un flag per evitare di mostrare errori ripetuti
  if (window.markReadApiUnavailable) return;
  
  fetch(`/api/chats/${chatId}/mark-read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messageIds: messageIds
    }),
  })
  .then(response => {
    if (!response.ok) {
      console.warn('API mark-read non disponibile:', response.status, response.statusText);
      // Imposta un flag per evitare di fare ulteriori richieste inutili
      window.markReadApiUnavailable = true;
    }
  })
  .catch(error => {
    console.warn('Errore di rete nel segnare i messaggi come letti:', error);
    // Imposta un flag per evitare di fare ulteriori richieste inutili
    window.markReadApiUnavailable = true;
  });
}, 1000); // Limita a una chiamata ogni secondo

// Check if it's a special sender
const isSpecialSender = (sender) => {
  // Extract the primary ID from the sender string
  let senderId;
  // First split by @ to get the part before the domain
  const beforeAt = sender.split('@')[0];
  
  if (beforeAt.includes(':')) {
    // If there's a colon in this part, extract just the first part
    senderId = beforeAt.split(':')[0];
  } else {
    // If no colon, use the entire part before @
    senderId = beforeAt;
  }
  
  return !!SPECIAL_SENDERS[senderId];
};

// Get special sender style
const getSpecialSenderStyle = (sender) => {
  // Extract the primary ID from the sender string
  let senderId;
  
  // First split by @ to get the part before the domain
  const beforeAt = sender.split('@')[0];
  
  if (beforeAt.includes(':')) {
    // If there's a colon in this part, extract just the first part
    senderId = beforeAt.split(':')[0];
  } else {
    // If no colon, use the entire part before @
    senderId = beforeAt;
  }
  
  return SPECIAL_SENDERS[senderId]?.color || 'background.paper';
};

// Nel componente MessageList.jsx
const filteredMessages = messages.filter(message => 
  // Filtra i messaggi di tipo protocollo "edit" (14)
  !(message.protocolMessageType === 99 || message.protocolMessageType === 14 || message.protocolMessageName === "edit") && 
  // Mantieni gli altri filtri esistenti
  message.content !== " (tipo: sconosciuto)" && 
  !message.content.includes("Reazione:") &&
  !message.content.includes("(tipo: reazione)")
);

// Group reactions by message ID
const reactions = {};
messages.forEach(message => {
        if (message.content && message.content.includes("Reazione:")) {
    // Extract reaction information
    // More flexible regex to handle various reaction formats
    const reactionMatch = message.content.match(/(?:👍 )?Reazione: (.*?) \(al messaggio: (.*?)\)/);
    if (reactionMatch) {
      const emoji = reactionMatch[1];
      const targetMessageId = reactionMatch[2];
      
      if (!reactions[targetMessageId]) {
        reactions[targetMessageId] = [];
      }
      
      // Check if this exact reaction from this sender already exists
      const existingReaction = reactions[targetMessageId].find(r => 
        r.emoji === emoji && r.sender === message.senderName
      );
      
      // Only add if it's not a duplicate
      if (!existingReaction) {
        reactions[targetMessageId].push({
          emoji,
          sender: message.senderName,
          timestamp: message.timestamp
        });
      }
    }
  }
});

// Load initial state from localStorage
const [seenMessages, setSeenMessages] = useState(() => {
  const stored = localStorage.getItem(`seenMessages_${chat.id}`);
  return new Set(stored ? JSON.parse(stored) : initialSeen);
});

const [lastSeenMessages, setLastSeenMessages] = useState(() => {
  const stored = localStorage.getItem('lastSeenMessages');
  return stored ? JSON.parse(stored) : initialLastSeen;
});

// State for recorded messages
const [recordedMessages, setRecordedMessages] = useState(new Set());

// Carica i messaggi registrati dal database
useEffect(() => {
  let isMounted = true;
  
  if (chat && chat.id) {
    fetch(`/api/recorded-data/chat/${chat.id}`)
      .then(response => {
        if (!response.ok) {
          if (response.status !== 404) { // 404 è ok, significa solo che non ci sono dati
            console.warn('API recorded-data non disponibile:', response.status);
          }
          return [];
        }
        return response.json();
      })
      .then(data => {
        // Verifica che il componente sia ancora montato prima di aggiornare lo stato
        if (!isMounted) return;
        
        if (Array.isArray(data) && data.length > 0) {
          // Estrai gli ID dei messaggi registrati
          const messageIds = data.map(item => item.messageId);
          setRecordedMessages(new Set(messageIds));
          
          // Carica i valori per ogni messaggio registrato
          data.forEach(item => {
            setTimeout(() => {
              if (!isMounted) return;
              const valueElement = document.getElementById(`recorded-value-${item.messageId}`);
              if (valueElement && item.data) {
                valueElement.textContent = item.data;
              }
            }, 100); // Piccolo ritardo per assicurarsi che l'elemento esista nel DOM
          });
        }
      })
      .catch(error => {
        console.error('Errore nel caricamento dei dati registrati:', error);
      });
  }
  
  // Cleanup function per evitare aggiornamenti di stato su componenti smontati
  return () => {
    isMounted = false;
  };
}, [chat?.id]); // Dipendenza più specifica per evitare chiamate inutili

// State for noted messages
const [notedMessages, setNotedMessages] = useState(new Set());
const [messageNotes, setMessageNotes] = useState({});
const [notesGroupViewOpen, setNotesGroupViewOpen] = useState(false);
const [noteSelectionOpen, setNoteSelectionOpen] = useState(false);
const [currentMessageId, setCurrentMessageId] = useState(null);
const [amountQuotaDialogOpen, setAmountQuotaDialogOpen] = useState(false);
const [selectedNote, setSelectedNote] = useState(null);
const [amountQuotaInput, setAmountQuotaInput] = useState('');

const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, messageId: null });
const [selectedText, setSelectedText] = useState('');
const [separateImporto, setSeparateImporto] = useState('');
const [separateQuota, setSeparateQuota] = useState('');
const [isEditMode, setIsEditMode] = useState(false);


// Funzione per caricare le note dal database
const loadNotesFromDB = useCallback(() => {
  fetch('/api/message-notes')
    .then(response => {
      if (!response.ok) {
        throw new Error('Errore nel caricamento delle note');
      }
      return response.json();
    })
    .then(notes => {
      setMessageNotes(notes);
      setNotedMessages(new Set(Object.keys(notes)));
    })
    .catch(error => {
      console.error('Errore nel caricamento delle note:', error);
    });
}, []);

// Carica le note dal server all'avvio
useEffect(() => {
  loadNotesFromDB();
}, [loadNotesFromDB]);

const resetDialogState = () => {
  setAmountQuotaDialogOpen(false);
  setAmountQuotaInput('');
  setSeparateImporto('');
  setSeparateQuota('');
  setSelectedNote(null);
  setIsEditMode(false);
};



// Aggiungi qui l'hook useEffect
useEffect(() => {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && contextMenu.visible) {
      closeContextMenu();
    }
  };
  
  window.addEventListener('keydown', handleKeyDown);
  
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
}, [contextMenu.visible]);

// Handle context menu
const handleContextMenu = (e, messageId) => {
  e.preventDefault();
  
  // Salva il testo selezionato prima di aprire il menu contestuale
  const selection = window.getSelection().toString();
  setSelectedText(selection);
  
  setContextMenu({
    visible: true,
    x: e.clientX,
    y: e.clientY,
    messageId
  });
};

// Handle keyboard shortcuts
const handleKeyDown = (e, messageId) => {
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    handleRecord(messageId);
  }
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    handleNote(messageId);
  }
  if (e.key === 'c' && e.ctrlKey) {
    // Ctrl+C è già gestito dal browser per la copia
    const selectedText = window.getSelection().toString();
    if (selectedText) {
      // Feedback visivo opzionale
      const messageElement = document.getElementById(`message-${messageId}`);
      if (messageElement) {
        messageElement.style.animation = 'copyPulse 0.5s';
        setTimeout(() => {
          messageElement.style.animation = '';
        }, 500);
      }
    }
  }
};

const handleRecord = (messageId) => {
  console.log('Recording message:', messageId);
  
  // Verifica se il messaggio è già registrato nel database
  fetch(`/api/recorded-data/${messageId}`)
    .then(response => {
      if (response.status === 404) {
        // Messaggio non registrato, procedi con la registrazione
        // Verifica se ci sono note nel database per questa chat
        const chatNotesFromDB = Object.values(messageNotes).filter(note => note.chatId === chat.id);
        
        if (chatNotesFromDB.length === 0) {
          alert("Non ci sono note in questa chat. Aggiungi prima una nota a un messaggio.");
          return;
        }
        
        // Reset modalità di modifica
        setIsEditMode(false);
        
        // Apri direttamente il dialog contestuale
        setCurrentMessageId(messageId);
        setAmountQuotaDialogOpen(true);
      } else if (response.ok) {
        // Messaggio già registrato, carica i dati per la modifica
        return response.json().then(existingData => {
          // Prepopola i campi separati se i dati esistono
          if (existingData.data && existingData.data.includes('@')) {
            const parts = existingData.data.split('@');
            if (parts.length === 2) {
              setSeparateImporto(parts[0]);
              setSeparateQuota(parts[1]);
            }
          }
          
          // Recupera la nota associata
          setSelectedNote(existingData.noteId ? {
            messageId: existingData.noteId,
            note: existingData.note
          } : null);
          
          // Imposta la modalità di modifica
          setIsEditMode(true);
          
          // Apri il dialog
          setCurrentMessageId(messageId);
          setAmountQuotaDialogOpen(true);
        });
      } else {
        console.error('Errore nel recupero dei dati registrati:', response.status);
        alert('Errore nel recupero dei dati registrati');
      }
    })
    .catch(error => {
      console.error('Errore di rete:', error);
      alert('Errore di rete nel recupero dei dati');
    });
};

// Funzione per gestire la selezione di una nota
const handleNoteSelection = (note) => {
  setSelectedNote(note);
  setNoteSelectionOpen(false);
  setAmountQuotaDialogOpen(true);
};



// Funzione per gestire il record diretto (senza passare per la selezione della nota)
const handleDirectRecord = (messageId) => {
  setCurrentMessageId(messageId);
  setAmountQuotaDialogOpen(true);
};

// Funzione per ottenere il sinonimo della chat
const getChatName = (chatId, defaultName) => {
  const storedSynonyms = JSON.parse(localStorage.getItem('chatSynonyms') || '{}');
  return storedSynonyms[chatId] || defaultName;
};

const handleAmountQuotaSubmit = () => {
  let formattedInput = '';
  
  // Determina quale opzione usare - priorità al campo singolo se presente
  const useSingleField = amountQuotaInput && amountQuotaInput.includes('@');
  
  if (useSingleField) {
    // Logica per il campo unico
    formattedInput = amountQuotaInput;
    
    // Verifica se l'input è nel formato Importo@Vincita/Importo
    if (amountQuotaInput.includes('/')) {
      const parts = amountQuotaInput.split('@');
      const importo = parseFloat(parts[0].replace(',', '.'));
      
      // Estrai vincita/importo
      const vincitaImporto = parts[1].split('/');
      if (vincitaImporto.length === 2) {
        const vincita = parseFloat(vincitaImporto[0].replace(',', '.'));
        const importoDivisore = parseFloat(vincitaImporto[1].replace(',', '.'));
        
        if (!isNaN(importo) && !isNaN(vincita) && !isNaN(importoDivisore) && importoDivisore !== 0) {
          // Calcola la quota (vincita/importo) e arrotonda a 3 decimali
          const quota = Math.round((vincita / importoDivisore) * 1000) / 1000;
          // Formatta nel formato standard Importo@Quota
          formattedInput = `${importo}@${quota}`;
        } else {
          alert("Formato non valido. Controlla i numeri inseriti.");
          return;
        }
      } else {
        alert("Formato non valido per vincita/importo. Usa il formato importo@vincita/importo");
        return;
      }
    } else {
      // Formato Importo@Quota - verifica che sia valido
      const parts = amountQuotaInput.split('@');
      if (parts.length !== 2) {
        alert("Formato non valido. Usa il formato importo@quota o importo@vincita/importo");
        return;
      }
      
      const importo = parseFloat(parts[0].replace(',', '.'));
      const quota = parseFloat(parts[1].replace(',', '.'));
      
      if (isNaN(importo) || isNaN(quota)) {
        alert("Formato non valido. Controlla i numeri inseriti.");
        return;
      }
      
      // Arrotonda la quota a 3 decimali se necessario
      const quotaArrotondata = Math.round(quota * 1000) / 1000;
      formattedInput = `${importo}@${quotaArrotondata}`;
    }
  } 
  else if (separateImporto && separateQuota) {
    // Logica per i campi separati
    const importo = parseFloat(separateImporto.replace(',', '.'));
    
    if (isNaN(importo)) {
      alert("Importo non valido. Inserisci un numero valido.");
      return;
    }
    
    // Verifica se il campo quota contiene vincita/importo
    if (separateQuota.includes('/')) {
      const vincitaImporto = separateQuota.split('/');
      if (vincitaImporto.length === 2) {
        const vincita = parseFloat(vincitaImporto[0].replace(',', '.'));
        const importoDivisore = parseFloat(vincitaImporto[1].replace(',', '.'));
        
        if (!isNaN(vincita) && !isNaN(importoDivisore) && importoDivisore !== 0) {
          // Calcola la quota (vincita/importo) e arrotonda a 3 decimali
          const quota = Math.round((vincita / importoDivisore) * 1000) / 1000;
          // Formatta nel formato standard
          formattedInput = `${importo}@${quota}`;
        } else {
          alert("Formato vincita/importo non valido. Controlla i numeri inseriti.");
          return;
        }
      } else {
        alert("Formato vincita/importo non valido. Usa il formato vincita/importo.");
        return;
      }
    } 
    else {
      // È una quota diretta
      const quota = parseFloat(separateQuota.replace(',', '.'));
      
      if (isNaN(quota)) {
        alert("Quota non valida. Inserisci un numero valido.");
        return;
      }
      
      // Arrotonda la quota a 3 decimali
      const quotaArrotondata = Math.round(quota * 1000) / 1000;
      formattedInput = `${importo}@${quotaArrotondata}`;
    }
  }
  else {
    alert("Inserisci i dati in uno dei due formati disponibili");
    return;
  }
  
  const messageId = currentMessageId;
    
  // Find the message in the chat
  const message = messages.find(m => m.id === messageId);
  if (!message) {
    console.error('Messaggio non trovato:', messageId);
    return;
  }
    
  // Prepara i dati da salvare nel database
  const recordedData = {
    messageId: messageId,
    data: formattedInput,
    chatId: chat.id,
    chatName: getChatName(chat.id, chat.name),
    senderName: message.senderName,
    content: message.content,
    timestamp: message.timestamp,
    noteId: selectedNote.messageId,
    note: selectedNote.note
  };

  // Determina se è un'aggiunta o un aggiornamento
  const method = isEditMode ? 'PUT' : 'POST';
  const url = `/api/recorded-data/${messageId}`;
  
  // Salva i dati nel database
  fetch(url, {
    method: method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(recordedData),
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Errore HTTP: ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    console.log('Dati salvati con successo:', data);
    
    // Aggiorna lo stato locale per riflettere il cambiamento
    setRecordedMessages(prev => {
      const newSet = new Set([...prev]);
      newSet.add(messageId);
      return newSet;
    });
    
    resetDialogState();
    
    // Add visual effect
    addVisualEffect(messageId, isEditMode ? 'updatePulse' : 'recordPulse');
  })
  .catch(error => {
    console.error('Errore nel salvataggio dei dati:', error);
    alert('Errore nel salvataggio dei dati');
  });
};

// Funzione per aggiungere effetti visivi
const addVisualEffect = (messageId, effectName) => {
  const messageElement = document.getElementById(`message-${messageId}`);
  if (messageElement) {
    messageElement.style.animation = `${effectName} 0.8s`;
    
    // If the animation style doesn't exist, add it
    if (!document.getElementById('record-animation') && effectName === 'recordPulse') {
      const styleTag = document.createElement('style');
      styleTag.id = 'record-animation';
      styleTag.innerHTML = `
        @keyframes recordPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.03); background-color: rgba(233, 30, 99, 0.2); }
          100% { transform: scale(1); }
        }
      `;
      document.head.appendChild(styleTag);
    }
    
    // Aggiungi animazione per l'aggiornamento
    if (!document.getElementById('update-animation') && effectName === 'updatePulse') {
      const styleTag = document.createElement('style');
      styleTag.id = 'update-animation';
      styleTag.innerHTML = `
        @keyframes updatePulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.03); background-color: rgba(156, 39, 176, 0.2); }
          100% { transform: scale(1); }
        }
      `;
      document.head.appendChild(styleTag);
    }
    
    // Remove the animation after it finishes
    setTimeout(() => {
      messageElement.style.animation = '';
    }, 800);
  }
};

// Handle noting a message - versione con database
const addMessageNote = (messageId) => {
  console.log('Adding note for message:', messageId);
    
  const note = prompt("Inserisci una nota per il messaggio:");
  if (!note) return;

  // Crea l'oggetto nota
  const noteData = {
    note: note,
    type: 'nota',
    chatId: chat?.id || '',
    chatName: getChatName(chat?.id, chat?.name) || 'Chat sconosciuta',
    addedAt: new Date().toISOString()
  };
  
  // Invia la nota al server
  fetch(`/api/messages/${messageId}/note`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(noteData),
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Errore nel salvataggio della nota');
    }
    return response.json();
  })
  .then(data => {
    console.log('Nota salvata con successo:', data);
    
    // Aggiorna lo stato locale
    setMessageNotes(prev => {
      const newNotes = {...prev};
      newNotes[messageId] = {
        messageId: messageId,
        ...noteData
      };
      return newNotes;
    });
    
    setNotedMessages(prev => new Set([...prev, messageId]));
    
    // Visual effect with requestAnimationFrame for better performance
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
      requestAnimationFrame(() => {
        messageElement.style.animation = 'notePulse 0.8s';
        
        // If the animation style doesn't exist, add it
        if (!document.getElementById('note-animation')) {
          const styleTag = document.createElement('style');
          styleTag.id = 'note-animation';
          styleTag.innerHTML = `
            @keyframes notePulse {
              0% { transform: scale(1); }
              50% { transform: scale(1.03); background-color: rgba(76, 175, 80, 0.2); }
              100% { transform: scale(1); }
            }
          `;
          document.head.appendChild(styleTag);
        }
        
        // Remove the animation after it finishes
        setTimeout(() => {
          messageElement.style.animation = '';
        }, 800);
      });
    }
  })
  .catch(error => {
    console.error('Errore nel salvataggio della nota:', error);
    alert('Errore nel salvataggio della nota');
  });
};

// Funzione per gestire l'eliminazione
const handleDeleteRecord = () => {
  if (!currentMessageId) return;
  
  // Conferma prima di eliminare
  if (!window.confirm("Sei sicuro di voler eliminare questo importo/quota?")) {
    return;
  }
  
  // Elimina il record dal database
  fetch(`/api/recorded-data/${currentMessageId}`, {
    method: 'DELETE',
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Errore HTTP: ${response.status}`);
    }
    
    // Rimuovi dalla lista dei messaggi registrati
    setRecordedMessages(prev => {
      const newSet = new Set([...prev]);
      newSet.delete(currentMessageId);
      return newSet;
    });
    
    // Aggiungi effetto visivo di rimozione
    addVisualEffect(currentMessageId, 'deleteAnimation');
    
    // Chiudi il dialog
    resetDialogState();
  })
  .catch(error => {
    console.error('Errore nell\'eliminazione del record:', error);
    alert('Errore nell\'eliminazione del record');
  });
};

const removeMessageNote = (messageId) => {
  console.log('Removing note for message:', messageId);
  
  // Rimuovi la nota dal server
  fetch(`/api/messages/${messageId}/note`, {
    method: 'DELETE',
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Errore nella rimozione della nota');
    }
    
    // Aggiorna lo stato locale
    setMessageNotes(prev => {
      const newNotes = {...prev};
      delete newNotes[messageId];
      return newNotes;
    });
    
    setNotedMessages(prev => {
      const newSet = new Set([...prev]);
      newSet.delete(messageId);
      return newSet;
    });

    // Visual effect
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
      messageElement.style.animation = 'noteRemovePulse 0.8s';
      
      // If the animation style doesn't exist, add it
      if (!document.getElementById('note-remove-animation')) {
        const styleTag = document.createElement('style');
        styleTag.id = 'note-remove-animation';
        styleTag.innerHTML = `
          @keyframes noteRemovePulse {
            0% { transform: scale(1); }
            50% { transform: scale(0.97); background-color: rgba(244, 67, 54, 0.1); }
            100% { transform: scale(1); }
          }
        `;
        document.head.appendChild(styleTag);
      }
      
      // Remove the animation after it finishes
      setTimeout(() => {
        messageElement.style.animation = '';
      }, 800);
    }
  })
  .catch(error => {
    console.error('Errore nella rimozione della nota:', error);
    alert('Errore nella rimozione della nota');
  });
};

// Replace handleNote with these two functions
const handleNote = (messageId) => {
  if (notedMessages.has(messageId)) {
    removeMessageNote(messageId);
  } else {
    addMessageNote(messageId);
  }
};

// Close context menu
const closeContextMenu = () => {
  setContextMenu({ visible: false, x: 0, y: 0, messageId: null });
  // Resetta il testo selezionato quando si chiude il menu
  setSelectedText('');
};

// Function to safely encode image paths
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

// Format timestamp to readable time
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Oggi ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

return (
  <Box onClick={closeContextMenu} className="message-container">
    {filteredMessages.map((message) => {
      const isRecorded = recordedMessages.has(message.id);
      const isNoted = notedMessages.has(message.id);
      const imageContent = extractImageContent(message.content);
      
      return (
        <Box key={message.id} sx={{ mb: 2 }}>
          <Box
            id={`message-${message.id}`}
            sx={{
              p: 1.5,
              borderRadius: 2,
              backgroundColor: notedMessages.has(message.id)
                ? 'rgba(200, 255, 200, 0.3)' // Soft green background for noted messages
                : isRecorded 
                  ? 'rgba(255, 192, 203, 0.3)' // Soft pink background for recorded messages
                  : getSpecialSenderStyle(message.sender) || 'background.paper',
              position: 'relative',
              maxWidth: '80%',
              float: isSpecialSender(message.sender) ? 'right' : 'left',
              clear: 'both',
              mb: 2,
              opacity: lastSeenMessages && chat && lastSeenMessages[chat.id] && 
                new Date(message.timestamp) <= new Date(lastSeenMessages[chat.id]) ? 0.8 : 1,
              transform: 'translateY(0)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease, background-color 0.3s ease',
              animation: seenMessages.has(message.id) ? 'none' : 'blink 1.5s infinite',
              '@keyframes blink': {
                '0%': { backgroundColor: 'background.paper' },
                '50%': { backgroundColor: '#fff9c4' },
                '100%': { backgroundColor: 'background.paper' }
              },
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: 2,
                animation: 'none'
              },
              border: isRecorded
                ? '2px solid rgba(255, 20, 147, 0.5)' // More vibrant pink border for recorded messages
                : isNoted
                  ? '2px solid rgba(76, 175, 80, 0.5)' // More vibrant green border for noted messages
                  : 'none'
            }}
            onContextMenu={(e) => handleContextMenu(e, message.id)}
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown(e, message.id)}
            onMouseEnter={() => {
              if (!seenMessages.has(message.id)) {
                // Add the message to seen messages locally
                setSeenMessages(prev => {
                  const newSet = new Set([...prev, message.id]);
                  localStorage.setItem(`seenMessages_${chat.id}`, JSON.stringify([...newSet]));
                  return newSet;
                });
                
                // Update lastSeenMessages for this chat
                setLastSeenMessages(prev => {
                  const newLastSeen = {
                    ...prev,
                    [chat.id]: message.timestamp
                  };
                  localStorage.setItem('lastSeenMessages', JSON.stringify(newLastSeen));
                  return newLastSeen;
                });

                markMessagesAsRead(chat.id, [message.id]);
              }
            }}
          >
            {/* Indicators at the top right of the message */}
            <Box sx={{ position: 'absolute', top: -5, right: -5, display: 'flex', gap: 1 }}>
              {isRecorded && (
                <Box
                  sx={{
                    bgcolor: '#e91e63', // Pink-500
                    color: 'white',
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    cursor: 'pointer'
                  }}
                >
                  <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    {/* Mostra il valore registrato - caricato dinamicamente */}
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        position: 'absolute', 
                        right: '100%', 
                        mr: 0.5,
                        bgcolor: 'background.record', 
                        p: 0.5, 
                        borderRadius: 1,
                        boxShadow: 1,
                        fontSize: 12,
                        color: 'white',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 100,
                        zIndex: 10,
                        display: 'block' // Sempre visibile
                      }}
                      id={`recorded-value-${message.id}`}
                    >
                      Caricamento...
                    </Typography>
                    <span style={{ fontSize: '10px' }}>💰</span>
                  </Box>
                </Box>
              )}
              {/* Indicator for noted messages */}
              {isNoted && (
                <Box
                  sx={{
                    bgcolor: '#4caf50', // Green-500
                    color: 'white',
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    cursor: 'pointer'
                  }}
                  title={`Messaggio annotato: ${messageNotes[message.id]?.note || ''}`}
                >
                  <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    {messageNotes[message.id] && messageNotes[message.id].note && (
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          position: 'absolute', 
                          right: '100%', 
                          mr: 0.5,
                          bgcolor: 'background.note', 
                          p: 0.5, 
                          borderRadius: 1,
                          boxShadow: 1,
                          fontSize: 12,
                          color: 'text.secondary',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: 200,
                          zIndex: 10
                        }}
                      >
                        {messageNotes[message.id].note}
                      </Typography>
                    )}
                    <NoteIcon sx={{ fontSize: 10 }} />
                  </Box>
                </Box>
              )}
            </Box>
            
            <ReplyContext message={message} messages={messages} />
            
            <Typography variant="caption" color="text.secondary">
              {message.senderName}
            </Typography>
            
            <Box>
              {message.isDeleted ? (
              // Se il messaggio è stato eliminato, mostra solo il testo standard 
              <Typography variant="body2">
                (Questo messaggio è stato eliminato)
              </Typography>
              ) : (
              <>
                {message.isMedia && message.mediaPath && (
                  <>
                  {/* Gestisci i diversi tipi di media */}
                  {message.content.includes("🔊 Messaggio vocale") ? (
                    <AudioMessageWrapper message={message} />
                  ) : (
                    <Box>
                      <img 
                        src={safeImagePath(message.mediaPath)} 
                        alt="Media content" 
                        style={{ 
                          maxWidth: '100%', 
                          borderRadius: '5px', 
                          marginTop: '10px',
                          cursor: 'pointer'
                        }}
                        onClick={() => handleImageClick(message.mediaPath, formatTime(message.timestamp))}
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    </Box>
                    )}
                  </>
                )}
                {!message.isMedia && (
                  <Typography 
                    variant="body2" 
                    component="div" // Changed to div to allow HTML content
                    sx={{ 
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      '& a': { // Styling for links
                        color: '#1976d2',
                        textDecoration: 'none',
                        '&:hover': {
                          textDecoration: 'underline'
                        }
                      }
                    }}
                    >
                    {formatMessageContent(message.content)}
                    {message.isEdited && (
                      <Typography 
                        component="span" 
                        sx={{ 
                          fontSize: '0.75rem', 
                          ml: 1, 
                          color: 'text.secondary',
                          fontStyle: 'italic' 
                        }}
                      >
                        (modificato)
                      </Typography>
                    )}
                  </Typography>
                )}
              </>
            )}
              
              {/* Display image content if available */}
              {imageContent && (
                <Typography 
                  variant="body2" 
                  sx={{ 
                    mt: 1,
                    fontWeight: 'medium'
                  }}
                >
                  {imageContent}
                </Typography>
              )}
            </Box>

            {/* Display reactions if they exist for this message */}
            {reactions[message.id] && reactions[message.id].length > 0 && (
              <Box sx={{ 
                display: 'flex', 
                flexWrap: 'wrap',
                gap: 0.8, 
                mt: 1.2,
                justifyContent: isSpecialSender(message.sender) ? 'flex-end' : 'flex-start'
              }}>
                {reactions[message.id].map((reaction, index) => (
                    <Box 
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        backgroundColor: 'rgba(255,255,255,0.8)',
                        borderRadius: '12px',
                        padding: '3px 8px',
                        fontSize: '0.9rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        border: '1px solid rgba(0,0,0,0.05)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: '0 3px 5px rgba(0,0,0,0.15)'
                        }
                      }}
                    >
                      <span style={{ fontSize: '1.0rem' }}>{reaction.emoji}</span>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          ml: 0.8, 
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          color: 'text.secondary'
                        }}
                      >
                        {reaction.sender}
                      </Typography>
                    </Box>
                ))}
              </Box>
            )}

            
            <Typography variant="caption" color="text.secondary" sx={{ 
              display: 'block',
              textAlign: 'right',
              mt: 0.5
            }}>
              {formatTime(message.timestamp)}
            </Typography>
          </Box>
        </Box>
      );
    })}

    {contextMenu.visible && (
      <>
        {/* Overlay per chiudere il menu quando si fa clic altrove */}
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={closeContextMenu}
        />
        
        <Box
          sx={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            bgcolor: 'background.paper',
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            overflow: 'hidden',
            width: 230,
            transition: 'all 0.2s ease',
            animation: 'scaleIn 0.15s ease-out forwards',
            '@keyframes scaleIn': {
              '0%': { opacity: 0, transform: 'scale(0.95) translateY(5px)' },
              '100%': { opacity: 1, transform: 'scale(1) translateY(0)' }
            },
            zIndex: 1000
          }}
        >
          
          {/* Sovramenu per reazioni rapide */}
          <Box sx={{ 
            p: 2, 
            display: 'flex', 
            justifyContent: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
            gap: 3
          }}>
            <Tooltip title={notedMessages.has(contextMenu.messageId) ? "Rimuovi nota" : "Aggiungi nota"}>
              <IconButton 
                size="medium" 
                onClick={() => {
                  handleNote(contextMenu.messageId);
                  closeContextMenu();
                }}
                sx={{ 
                  bgcolor: notedMessages.has(contextMenu.messageId) ? 'rgba(76, 175, 80, 0.15)' : 'transparent',
                  border: '1px solid',
                  borderColor: notedMessages.has(contextMenu.messageId) ? 'success.main' : 'divider',
                  '&:hover': { 
                    bgcolor: notedMessages.has(contextMenu.messageId) ? 'rgba(76, 175, 80, 0.25)' : 'rgba(0, 0, 0, 0.04)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  },
                  transition: 'all 0.2s ease',
                  color: notedMessages.has(contextMenu.messageId) ? 'success.main' : 'text.secondary',
                }}
              >
                <NoteIcon />
              </IconButton>
            </Tooltip>
            
            <Tooltip title={recordedMessages.has(contextMenu.messageId) ? "Modifica importo/quota" : "Registra importo/quota"}>
              <IconButton 
                size="medium" 
                onClick={() => {
                  handleRecord(contextMenu.messageId);
                  closeContextMenu();
                }}
                sx={{ 
                  bgcolor: recordedMessages.has(contextMenu.messageId) ? 'rgba(233, 30, 99, 0.15)' : 'transparent',
                  border: '1px solid',
                  borderColor: recordedMessages.has(contextMenu.messageId) ? 'secondary.main' : 'divider',
                  '&:hover': { 
                    bgcolor: recordedMessages.has(contextMenu.messageId) ? 'rgba(233, 30, 99, 0.25)' : 'rgba(0, 0, 0, 0.04)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  },
                  transition: 'all 0.2s ease',
                  color: recordedMessages.has(contextMenu.messageId) ? 'secondary.main' : 'text.secondary',
                }}
              >
                <AttachMoneyIcon />
              </IconButton>
            </Tooltip>
          </Box>
          
          {/* Menu principale */}
          <Box sx={{ py: 0.5 }}>
            {/* Opzione Rispondi */}
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                '&:hover': {
                  bgcolor: 'rgba(25, 118, 210, 0.08)'
                },
                transition: 'background-color 0.15s'
              }}
              onClick={() => {
                const messageToReply = messages.find(m => m.id === contextMenu.messageId);
                if (messageToReply) {
                  onReplyToMessage(messageToReply);
                }
                closeContextMenu();
              }}
            >
              <ReplyIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body2" fontWeight="500">Rispondi</Typography>
            </Box>
            
            {/* Opzione Copia testo selezionato - visibile solo se c'è testo selezionato */}
            {selectedText && (
              <Box
                sx={{
                  px: 2.5,
                  py: 1.5,
                  cursor: selectedText ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  '&:hover': {
                    bgcolor: selectedText ? 'rgba(3, 169, 244, 0.08)' : 'transparent'
                  },
                  transition: 'background-color 0.15s',
                  opacity: selectedText ? 1 : 0.6
                }}
                onClick={() => {
                  if (selectedText) {
                    navigator.clipboard.writeText(selectedText)
                      .then(() => {
                        // Feedback visivo che indica il successo
                        const messageElement = document.getElementById(`message-${contextMenu.messageId}`);
                        if (messageElement) {
                          messageElement.style.animation = 'copyPulse 0.5s';
                          
                          if (!document.getElementById('copy-animation')) {
                            const styleTag = document.createElement('style');
                            styleTag.id = 'copy-animation';
                            styleTag.innerHTML = `
                              @keyframes copyPulse {
                                0% { transform: scale(1); }
                                50% { transform: scale(1.02); background-color: rgba(33, 150, 243, 0.2); }
                                100% { transform: scale(1); }
                              }
                            `;
                            document.head.appendChild(styleTag);
                          }
                          
                          setTimeout(() => {
                            messageElement.style.animation = '';
                          }, 500);
                        }
                      });
                  }
                  closeContextMenu();
                }}
              >
                <ContentCopyIcon sx={{ color: 'info.main' }} />
                <Typography variant="body2" fontWeight="500">
                  Copia testo selezionato
                </Typography>
              </Box>
            )}
            {/* Opzione Copia messaggio intero */}
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                '&:hover': {
                  bgcolor: 'rgba(158, 158, 158, 0.08)'
                },
                transition: 'background-color 0.15s'
              }}
              onClick={() => {
                const currentMessage = messages.find(m => m.id === contextMenu.messageId);
                if (currentMessage && currentMessage.content) {
                  const messageText = formatMessageContent(currentMessage.content);
                  
                  navigator.clipboard.writeText(messageText)
                    .then(() => {
                      // Feedback visivo
                      const messageElement = document.getElementById(`message-${contextMenu.messageId}`);
                      if (messageElement) {
                        messageElement.style.animation = 'copyFullPulse 0.5s';
                        
                        if (!document.getElementById('copy-full-animation')) {
                          const styleTag = document.createElement('style');
                          styleTag.id = 'copy-full-animation';
                          styleTag.innerHTML = `
                            @keyframes copyFullPulse {
                              0% { transform: scale(1); }
                              50% { transform: scale(1.02); background-color: rgba(156, 39, 176, 0.2); }
                              100% { transform: scale(1); }
                            }
                          `;
                          document.head.appendChild(styleTag);
                        }
                        
                        setTimeout(() => {
                          messageElement.style.animation = '';
                        }, 500);
                      }
                    });
                }
                closeContextMenu();
              }}
            >
              <FileCopyIcon sx={{ color: 'text.secondary' }} />
              <Typography variant="body2" fontWeight="500">
                Copia messaggio
              </Typography>
            </Box>
          </Box>
          
        </Box>
      </>
    )}

    {/* Notes Group View Dialog */}
    <NotesGroupView 
      open={notesGroupViewOpen} 
      onClose={() => setNotesGroupViewOpen(false)} 
    />
    
    {/* Note Selection Dialog */}
    <NoteSelectionDialog
      open={noteSelectionOpen}
      onClose={() => setNoteSelectionOpen(false)}
      notes={Object.values(messageNotes).filter(note => note.chatId === chat.id)}
      onSelectNote={handleNoteSelection}
      chatName={chat.name}
    />
    
    {/* Amount and Quota Input Dialog */}
    <Dialog 
      open={amountQuotaDialogOpen} 
      onClose={() => setAmountQuotaDialogOpen(false)}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        {isEditMode ? "Modifica Importo e Quota" : "Inserisci Importo e Quota"}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', mt: 1, gap: 1 }}>
          {/* Colonna sinistra SOLO con l'immagine */}
          <Box sx={{ flex: '0 0 45%' }}>
            {(() => {
              // Trova il messaggio corrente
              const currentMessage = messages.find(m => m.id === currentMessageId);
              
              if (currentMessage) {
                // Cerca il messaggio media associato (stesso ID)
                const mediaMessage = messages.find(m => 
                  m.id === currentMessage.id && m.isMedia && m.mediaPath
                );
                
                // Se abbiamo trovato un messaggio media, mostra l'immagine
                if (mediaMessage && mediaMessage.mediaPath) {
                  return (
                    <Box 
                      sx={{ 
                        width: '100%', 
                        height: '100%',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        overflow: 'hidden',
                        position: 'relative'
                      }}
                      className="zoomable-image-container"
                    >
                      <IconButton
                        size="small"
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          backgroundColor: 'rgba(0, 0, 0, 0.5)',
                          color: 'white',
                          zIndex: 10,
                          '&:hover': {
                            backgroundColor: 'rgba(0, 0, 0, 0.7)'
                          }
                        }}
                        onClick={() => {
                          const img = document.querySelector('.zoomable-image');
                          if (img) {
                            img.style.transform = 'scale(1)';
                          }
                        }}
                      >
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                      <img 
                        src={safeImagePath(mediaMessage.mediaPath)} 
                        alt="Media content" 
                        className="zoomable-image"
                        style={{ 
                          maxWidth: '100%',
                          maxHeight: '400px',
                          objectFit: 'contain',
                          borderRadius: '8px',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
                          transform: 'scale(1)',
                          transition: 'transform 0.1s ease',
                          cursor: 'grab',
                          transformOrigin: 'center'
                        }}
                        onError={(e) => {
                          console.error("Errore caricamento immagine:", mediaMessage.mediaPath);
                          e.target.style.display = 'none';
                        }}
                        onWheel={(e) => {
                          e.preventDefault();
                          const img = e.currentTarget;
                          const currentScale = parseFloat(img.style.transform.split('scale(')[1]?.split(')')[0] || '1');
                          
                          // Calcola il nuovo scale basato sulla direzione dello scroll
                          let newScale = currentScale - (e.deltaY * 0.01);
                          
                          // Limita lo scale tra 0.5 e 3
                          newScale = Math.min(Math.max(newScale, 0.5), 3);
                          
                          // Estrai i valori di traslazione correnti
                          const currentTransform = img.style.transform;
                          const translateX = currentTransform.includes('translateX') 
                            ? parseFloat(currentTransform.split('translateX(')[1].split('px)')[0]) 
                            : 0;
                          const translateY = currentTransform.includes('translateY') 
                            ? parseFloat(currentTransform.split('translateY(')[1].split('px)')[0]) 
                            : 0;
                          
                          // Applica il nuovo scale mantenendo la traslazione
                          img.style.transform = `translateX(${translateX}px) translateY(${translateY}px) scale(${newScale})`;
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
                          const currentScale = parseFloat(currentTransform.split('scale(')[1]?.split(')')[0] || '1');
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
                            
                            // Calcola i limiti di traslazione con Math.max/min per evitare valori estremi
                            const maxTranslateX = Math.max(0, (imgRect.width * currentScale - containerRect.width * minVisiblePercent));
                            const minTranslateX = Math.min(0, -(imgRect.width * currentScale - containerRect.width * minVisiblePercent));
                            const maxTranslateY = Math.max(0, (imgRect.height * currentScale - containerRect.height * minVisiblePercent));
                            const minTranslateY = Math.min(0, -(imgRect.height * currentScale - containerRect.height * minVisiblePercent));
                            
                            // Limita la traslazione
                            const limitedTranslateX = Math.min(Math.max(newTranslateX, minTranslateX), maxTranslateX);
                            const limitedTranslateY = Math.min(Math.max(newTranslateY, minTranslateY), maxTranslateY);
                            
                            // Aggiorna la trasformazione
                            img.style.transform = `translateX(${limitedTranslateX}px) translateY(${limitedTranslateY}px) scale(${currentScale})`;
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
                  );
                } else {
                  // Se non c'è un'immagine, mostra un placeholder o un messaggio
                  return (
                    <Box sx={{ 
                      width: '100%', 
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      p: 2,
                      bgcolor: 'background.paper',
                      borderRadius: 2,
                      border: '1px dashed',
                      borderColor: 'divider'
                    }}>
                      <Typography variant="body1" sx={{ 
                        whiteSpace: 'pre-wrap',
                        textAlign: 'center',
                        color: 'text.secondary'
                      }}>
                        {currentMessage.content || "Nessuna immagine disponibile"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        {currentMessage.senderName} - {formatTime(currentMessage.timestamp)}
                      </Typography>
                    </Box>
                  );
                }
              }
              
              return null;
            })()}
          </Box>
          
          {/* Colonna destra con input e selezione nota */}
          <Box sx={{ flex: '0 0 55%', display: 'flex', flexDirection: 'column' }}>          
            {/* Selezione della nota */}
            <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" sx={{ 
              mb: 1, 
              fontWeight: 'bold',
              color: 'primary.main',
              fontSize: '1.1rem',
              display: 'flex',
              alignItems: 'center'
            }}>
              <span style={{ color: 'red', marginRight: '4px' }}>*</span>
              Seleziona una giocata:
            </Typography>
            <Box sx={{ 
              height: '180px', 
              overflow: 'auto', 
              border: '2px solid', 
              borderColor: 'primary.main', 
              borderRadius: 1,
              p: 1,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
            }}>
              {Object.values(messageNotes).filter(note => note.chatId === chat.id).map((note, index) => (
                <Box 
                  key={index} 
                  sx={{ 
                    p: 1.5, 
                    mb: 0.5, 
                    borderRadius: 1, 
                    cursor: 'pointer',
                    bgcolor: selectedNote && selectedNote.messageId === note.messageId ? 'primary.light' : 'background.paper',
                    color: selectedNote && selectedNote.messageId === note.messageId ? 'primary.contrastText' : 'text.primary',
                    '&:hover': {
                      bgcolor: selectedNote && selectedNote.messageId === note.messageId ? 'primary.main' : 'action.hover'
                    },
                    borderLeft: '4px solid',
                    borderColor: selectedNote && selectedNote.messageId === note.messageId ? 'primary.dark' : 'transparent',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onClick={() => setSelectedNote(note)}
                >
                  <Radio 
                    checked={selectedNote && selectedNote.messageId === note.messageId}
                    onChange={() => setSelectedNote(note)}
                    color="primary"
                    sx={{ mr: 1 }}
                  />
                  <Box>
                    <Typography variant="body1" sx={{ fontWeight: 'medium' }}>{note.note}</Typography>
                    <Typography variant="caption" color={selectedNote && selectedNote.messageId === note.messageId ? 'inherit' : 'text.secondary'}>
                      Aggiunta: {new Date(note.addedAt).toLocaleString()}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
            
            <Box sx={{ mb: 3 }}>
              {/* Opzione 1: Campo unico */}
              <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'medium' }}>
                  Opzione 1: Campo unico
                </Typography>
                <TextField
                  fullWidth
                  variant="outlined"
                  value={amountQuotaInput}
                  onChange={(e) => setAmountQuotaInput(e.target.value)}
                  placeholder="Es: 1800@1,23 o 1800@2214/1200"
                  helperText="Inserisci nel formato importo@quota o importo@vincita/importo"
                  InputProps={{
                    sx: { fontSize: '1.1rem' }
                  }}
                />
              </Box>
            
              {/* Opzione 2: Campi separati */}
              <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'medium' }}>
                  Opzione 2: Campi separati
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                  <TextField
                    label="Importo"
                    variant="outlined"
                    value={separateImporto}
                    onChange={(e) => setSeparateImporto(e.target.value)}
                    placeholder="Es: 1800"
                    sx={{ flex: '0 0 40%' }}
                  />
                  
                  <TextField
                    label="Quota o Vincita/Importo"
                    variant="outlined"
                    value={separateQuota}
                    onChange={(e) => setSeparateQuota(e.target.value)}
                    placeholder="Es: 1,23 o 2214/1200"
                    sx={{ flex: '1' }}
                    helperText="Quota diretta o formato vincita/importo"
                  />
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Box>
          {isEditMode && (
            <Button 
              onClick={handleDeleteRecord} 
              color="error"
              variant="outlined"
              startIcon={<DeleteIcon />}
            >
              Elimina
            </Button>
          )}
        </Box>
        <Box>
          <Button onClick={resetDialogState} color="primary" sx={{ mr: 1 }}>
            Annulla
          </Button>
          <Button 
            onClick={handleAmountQuotaSubmit} 
            color="primary" 
            variant="contained"
            disabled={
              (!amountQuotaInput || !amountQuotaInput.includes('@')) && 
              (!separateImporto || !separateQuota) || 
              !selectedNote
            }
          >
            {isEditMode ? "Aggiorna" : "Salva"}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  </Box>
);
}

export default MessageList;
