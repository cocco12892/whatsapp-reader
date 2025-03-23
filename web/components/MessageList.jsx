import AudioMessageWrapper from './AudioMessageWrapper';
import { Box, Typography, Badge, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Radio } from '@mui/material';
import NoteIcon from '@mui/icons-material/Note';
import NotesGroupView from './NotesGroupView';
import ReplyContext from './ReplyContext';
import NoteSelectionDialog from './NoteSelectionDialog';
import React, { useState, useEffect, useCallback } from 'react';

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
  
  // Sostituisce il testo "\n" con veri ritorni a capo
  return content.replace(/\\n/g, '\n');
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
chats
}) {
// Special senders list
const SPECIAL_SENDERS = {
  '393472195905': { color: 'rgb(223, 250, 228)', name: 'Andrea Cocco' },
  '393802541389': { color: 'rgb(225, 237, 247)', name: 'Ste' },
  '971585527723': { color: 'rgb(225, 237, 247)', name: 'Fer87' },
  '393937049799': { color: 'rgb(227, 225, 247)', name: 'Jhs' },
  '393297425198': { color: 'rgb(247, 221, 215)', name: 'Ivan' } 
};

const markMessagesAsRead = (chatId, messageIds) => {
  if (messageIds.length === 0) return;
  
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
      console.error('Errore nel segnare i messaggi come letti:', response.statusText);
    }
  })
  .catch(error => {
    console.error('Errore di rete nel segnare i messaggi come letti:', error);
  });
};

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
const [recordedMessages, setRecordedMessages] = useState(() => {
  const stored = localStorage.getItem(`recordedMessages_${chat.id}`);
  return new Set(stored ? JSON.parse(stored) : []);
});

// State for noted messages
const [notedMessages, setNotedMessages] = useState(() => {
  const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
  return new Set(Object.keys(messageNotes));
});

// State for notes group view
const [notesGroupViewOpen, setNotesGroupViewOpen] = useState(false);
const [noteSelectionOpen, setNoteSelectionOpen] = useState(false);
const [currentMessageId, setCurrentMessageId] = useState(null);
const [amountQuotaDialogOpen, setAmountQuotaDialogOpen] = useState(false);
const [selectedNote, setSelectedNote] = useState(null);
const [amountQuotaInput, setAmountQuotaInput] = useState('');

const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, messageId: null });

// Handle context menu
const handleContextMenu = (e, messageId) => {
  e.preventDefault();
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

// Handle recording a message with amount and quota
const handleRecord = (messageId) => {
  console.log('Recording message:', messageId);
  
  // Check if the message is already recorded
  const recordedData = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
  
  if (recordedData[messageId]) {
    // If already recorded, remove it
    const newRecordedData = { ...recordedData };
    delete newRecordedData[messageId];
    localStorage.setItem('recordedMessagesData', JSON.stringify(newRecordedData));
    
    // Also remove from the set of recorded messages
    setRecordedMessages(prev => {
      const newSet = new Set([...prev]);
      newSet.delete(messageId);
      localStorage.setItem(`recordedMessages_${chat.id}`, JSON.stringify([...newSet]));
      return newSet;
    });
  } else {
    // Trova tutte le note esistenti per questa chat
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    const chatNotes = Object.values(messageNotes).filter(note => note.chatId === chat.id);
    
    if (chatNotes.length === 0) {
      alert("Non ci sono note in questa chat. Aggiungi prima una nota a un messaggio.");
      return;
    }
    
    // Apri direttamente il dialog contestuale
    setCurrentMessageId(messageId);
    setAmountQuotaDialogOpen(true);
  }
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

// Funzione per gestire l'inserimento di importo e quota
const handleAmountQuotaSubmit = () => {
  if (!amountQuotaInput || !amountQuotaInput.includes('@')) {
    alert("Formato non valido. Usa il formato importo@quota (es: 1800@1,23)");
    return;
  }
    
  const messageId = currentMessageId;
  const recordedData = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
    
  // Find the message in the chat
  const message = chat.messages.find(m => m.id === messageId);
  if (!message) {
    console.error('Messaggio non trovato:', messageId);
    return;
  }
    
  // Save the recorded data
  const newRecordedData = { ...recordedData };
  newRecordedData[messageId] = {
    messageId: messageId,
    data: amountQuotaInput,
    chatId: chat.id,
    chatName: getChatName(chat.id, chat.name),
    senderName: message.senderName,
    content: message.content,
    timestamp: message.timestamp,
    recordedAt: new Date().toISOString(),
    noteId: selectedNote.messageId,
    note: selectedNote.note
  };
  
  localStorage.setItem('recordedMessagesData', JSON.stringify(newRecordedData));
  
  // Add to the set of recorded messages
  setRecordedMessages(prev => {
    const newSet = new Set([...prev]);
    newSet.add(messageId);
    localStorage.setItem(`recordedMessages_${chat.id}`, JSON.stringify([...newSet]));
    return newSet;
  });
  
  // Reset state and close dialog
  setAmountQuotaDialogOpen(false);
  setAmountQuotaInput('');
  setSelectedNote(null);
  
  // Add visual effect
  addVisualEffect(messageId, 'recordPulse');
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
    
    // Remove the animation after it finishes
    setTimeout(() => {
      messageElement.style.animation = '';
    }, 800);
  }
};

// Handle noting a message - versione pragmatica
const addMessageNote = (messageId) => {
  console.log('Adding note for message:', messageId);
    
  const note = prompt("Inserisci una nota per il messaggio:");
  if (!note) return;

  // Ottieni le note esistenti come oggetto
  const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    
  // Salva direttamente la nota usando l'ID del messaggio come chiave
  messageNotes[messageId] = {
    messageId: messageId,
    note: note,
    type: 'nota',
    chatName: getChatName(chat?.id, chat?.name) || 'Chat sconosciuta',
    chatId: chat?.id || '',
    addedAt: new Date().toISOString()
  };
  
  // Salva nel localStorage
  localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
  
  // Debug logging
  console.log('New note entry:', messageNotes[messageId]);
  console.log('All message notes:', messageNotes);
  
  // Update state
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
};

const removeMessageNote = (messageId) => {
  console.log('Removing note for message:', messageId);
  
  // Ottieni le note esistenti come oggetto
  const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
  
  // Rimuovi la nota per questo messaggio specifico
  if (messageNotes[messageId]) {
    delete messageNotes[messageId];
  }
  
  // Salva nel localStorage
  localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
  
  // Update state
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
};

// Replace handleNote with these two functions
const handleNote = (messageId) => {
  const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
  
  if (messageNotes[messageId]) {
    removeMessageNote(messageId);
  } else {
    addMessageNote(messageId);
  }
};

// Close context menu
const closeContextMenu = () => {
  setContextMenu({ visible: false, x: 0, y: 0, messageId: null });
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
      const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
      const isNoted = messageNotes[message.id] ? true : false;
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
                <Tooltip title={() => {
                  const recordedData = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
                  return recordedData[message.id] ? 
                    `Importo/Quota: ${recordedData[message.id].data}` : 
                    "Messaggio registrato";
                }}>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRecord(message.id);
                    }}
                  >
                    <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      {/* Mostra il valore registrato */}
                      {(() => {
                        const recordedData = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
                        if (recordedData[message.id]?.data) {
                          return (
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
                                color: 'text.white',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: 100,
                                zIndex: 10
                              }}
                            >
                              {recordedData[message.id].data}
                            </Typography>
                          );
                        }
                        return null;
                      })()}
                      <span style={{ fontSize: '10px' }}>💰</span>
                    </Box>
                  </Box>
                </Tooltip>
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNote(message.id);
                  }}
                  title={`Messaggio annotato: ${messageNotes[message.id]?.note}`}
                >
                  <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    {messageNotes[message.id]?.note && (
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
                        {messageNotes[message.id]?.note}
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
                        onClick={() => handleImageClick(message.mediaPath)}
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    </Box>
                    )}
                  </>
                )}
                {!message.isMedia && (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
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
      <Box
        sx={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          boxShadow: 3,
          zIndex: 1000
        }}
      >
        <Box
          sx={{
            p: 1,
            cursor: 'pointer',
            '&:hover': {
              bgcolor: 'action.hover'
            },
            display: 'flex',
            alignItems: 'center',
            color: notedMessages.has(contextMenu.messageId) ? '#4caf50' : 'inherit'
          }}
          onClick={() => {
            handleNote(contextMenu.messageId);
            closeContextMenu();
          }}
        >
          📝 {notedMessages.has(contextMenu.messageId) ? 'Rimuovi nota' : 'Aggiungi nota'}
        </Box>
        {/* Menu item for recording */}
        <Box
          sx={{
            p: 1,
            cursor: 'pointer',
            '&:hover': {
              bgcolor: 'action.hover'
            },
            display: 'flex',
            alignItems: 'center',
            color: recordedMessages.has(contextMenu.messageId) ? '#e91e63' : 'inherit'
          }}
          onClick={() => {
            handleRecord(contextMenu.messageId);
            closeContextMenu();
          }}
        >
          💰 {recordedMessages.has(contextMenu.messageId) ? 'Rimuovi importo/quota': 'Registra importo/quota'}
        </Box>
        {/* Menu item for copying selected text */}
        <Box
          sx={{
            p: 1,
            cursor: 'pointer',
            '&:hover': {
              bgcolor: 'action.hover'
            },
            display: 'flex',
            alignItems: 'center'
          }}
          onClick={() => {
            // Ottieni il testo selezionato
            const selectedText = window.getSelection().toString();
            if (selectedText) {
              navigator.clipboard.writeText(selectedText)
                .then(() => {
                  // Feedback visivo opzionale
                  const messageElement = document.getElementById(`message-${contextMenu.messageId}`);
                  if (messageElement) {
                    messageElement.style.animation = 'copyPulse 0.5s';
                    
                    // Aggiungi l'animazione se non esiste
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
                })
                .catch(err => console.error('Errore durante la copia: ', err));
            }
            closeContextMenu();
          }}
        >
          📋 Copia testo selezionato
        </Box>
        
        {/* Menu item for copying entire message text */}
        <Box
          sx={{
            p: 1,
            cursor: 'pointer',
            '&:hover': {
              bgcolor: 'action.hover'
            },
            display: 'flex',
            alignItems: 'center'
          }}
          onClick={() => {
            // Trova il messaggio corrente
            const currentMessage = messages.find(m => m.id === contextMenu.messageId);
            if (currentMessage && currentMessage.content) {
              // Formatta il contenuto del messaggio
              const messageText = formatMessageContent(currentMessage.content);
              
              navigator.clipboard.writeText(messageText)
                .then(() => {
                  // Feedback visivo
                  const messageElement = document.getElementById(`message-${contextMenu.messageId}`);
                  if (messageElement) {
                    messageElement.style.animation = 'copyFullPulse 0.5s';
                    
                    // Aggiungi l'animazione se non esiste
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
                })
                .catch(err => console.error('Errore durante la copia del messaggio completo: ', err));
            }
            closeContextMenu();
          }}
        >
          📄 Copia intero messaggio
        </Box>
      </Box>
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
      notes={Object.values(JSON.parse(localStorage.getItem('messageNotes') || '{}')).filter(note => note.chatId === chat.id)}
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
      <DialogTitle>Inserisci Importo e Quota</DialogTitle>
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
                    <Box sx={{ 
                      width: '100%', 
                      height: '100%',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}>
                      <img 
                        src={safeImagePath(mediaMessage.mediaPath)} 
                        alt="Media content" 
                        style={{ 
                          maxWidth: '100%',
                          maxHeight: '400px',
                          objectFit: 'contain',
                          borderRadius: '8px',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
                        }}
                        onError={(e) => {
                          console.error("Errore caricamento immagine:", mediaMessage.mediaPath);
                          e.target.style.display = 'none';
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
              {Object.values(JSON.parse(localStorage.getItem('messageNotes') || '{}')).filter(note => note.chatId === chat.id).map((note, index) => (
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
            
            {/* Campo importo@quota */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'medium' }}>Importo@Quota</Typography>
              <TextField
                autoFocus
                fullWidth
                variant="outlined"
                value={amountQuotaInput}
                onChange={(e) => setAmountQuotaInput(e.target.value)}
                placeholder="Es: 1800@1,23"
                helperText="Inserisci nel formato importo@quota"
                InputProps={{
                  sx: { fontSize: '1.2rem' }
                }}
              />
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setAmountQuotaDialogOpen(false)} color="primary">
          Annulla
        </Button>
        <Button 
          onClick={handleAmountQuotaSubmit} 
          color="primary" 
          variant="contained"
          disabled={!amountQuotaInput || !amountQuotaInput.includes('@') || !selectedNote}
        >
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  </Box>
);
}

export default MessageList;
