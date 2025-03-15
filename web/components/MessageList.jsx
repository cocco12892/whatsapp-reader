import AudioMessageWrapper from './AudioMessageWrapper';


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
};import React, { useState, useEffect } from 'react';
import { Box, Typography, Badge, Tooltip } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import NoteIcon from '@mui/icons-material/Note';
import ReplyContext from './ReplyContext';

function MessageList({ 
messages, 
handleImageClick, 
handleMessageRightClick, 
lastSeenMessages: initialLastSeen,
seenMessages: initialSeen,
chat
}) {
// Special senders list
const SPECIAL_SENDERS = {
  '393472195905': { color: 'rgb(223, 250, 228)', name: 'Andrea Cocco' },
  '393802541389': { color: 'rgb(225, 237, 247)', name: 'Ste' },
  '971585527723': { color: 'rgb(225, 237, 247)', name: 'Fer87' },
  '393937049799': { color: 'rgb(227, 225, 247)', name: 'Jhs' },
  '393297425198': { color: 'rgb(247, 221, 215)', name: 'Ivan' } 
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
  const stored = localStorage.getItem('messageNotes');
  const notes = stored ? JSON.parse(stored) : {};
  return new Set(Object.keys(notes));
});

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
};

// Handle recording a message
const handleRecord = (messageId) => {
  console.log('Recording message:', messageId);
  
  // Toggle the message in recorded messages
  setRecordedMessages(prev => {
    const newSet = new Set([...prev]);
    
    if (newSet.has(messageId)) {
      newSet.delete(messageId);
    } else {
      newSet.add(messageId);
    }
    
    // Save to storage for persistence
    localStorage.setItem(`recordedMessages_${chat.id}`, JSON.stringify([...newSet]));
    return newSet;
  });
  
  // Add a temporary visual effect to the message
  const messageElement = document.getElementById(`message-${messageId}`);
  if (messageElement) {
    messageElement.style.animation = 'recordPulse 0.8s';
    
    // If the animation style doesn't exist, add it
    if (!document.getElementById('record-animation')) {
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

// Handle noting a message
const handleNote = (messageId) => {
  console.log('Noting message:', messageId);
  
  // Trova il messaggio corrispondente
  const message = messages.find(m => m.id === messageId);
  
  // Chiama la funzione per aprire il popup delle note
  if (handleMessageRightClick) {
    // Simula un evento di right click per aprire il popup delle note
    handleMessageRightClick(
      { 
        preventDefault: () => {}, 
        clientX: window.innerWidth / 2, 
        clientY: window.innerHeight / 2 
      }, 
      messageId
    );
  } else {
    // Fallback: toggle delle noted messages se la funzione non è disponibile
    setNotedMessages(prev => {
      const newSet = new Set([...prev]);
      
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      
      // Save to storage for persistence
      localStorage.setItem(`notedMessages_${chat.id}`, JSON.stringify([...newSet]));
      return newSet;
    });
    
    // Aggiorna lo stato delle note
    setNotedMessages(prev => {
      const newSet = new Set([...prev]);
      
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      
      // Save to storage for persistence
      localStorage.setItem(`notedMessages_${chat.id}`, JSON.stringify([...newSet]));
      return newSet;
    });

    // Mantieni l'effetto visivo
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
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
    }
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
                // Add the message to seen messages
                setSeenMessages(prev => {
                  const newSet = new Set([...prev, message.id]);
                  // Save to storage for persistence
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRecord(message.id);
                  }}
                  title="Messaggio registrato"
                >
                  <MicIcon sx={{ fontSize: 10 }} />
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNote(message.id);
                  }}
                  title="Messaggio annotato"
                >
                  <NoteIcon sx={{ fontSize: 10 }} />
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
                  <Typography variant="body2">
                    {message.content}
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
          🎙 {recordedMessages.has(contextMenu.messageId) ? 'Rimuovi registrazione': 'Registra'}
        </Box>
      </Box>
    )}
  </Box>
);
}

export default MessageList;
