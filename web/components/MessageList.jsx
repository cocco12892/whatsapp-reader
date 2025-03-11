import React, { useState, useEffect } from 'react';
import { Box, Typography, Badge } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import NoteIcon from '@mui/icons-material/Note';
import ReplyContext from './ReplyContext';

function MessageList({ 
  messages, 
  handleImageClick, 
  handleMessageRightClick, 
  getNote,
  lastSeenMessages: initialLastSeen,
  seenMessages: initialSeen,
  chat
}) {
  // Carica lo stato iniziale da localStorage
  const [seenMessages, setSeenMessages] = useState(() => {
    const stored = localStorage.getItem(`seenMessages_${chat.id}`);
    return new Set(stored ? JSON.parse(stored) : initialSeen);
  });

  const [lastSeenMessages, setLastSeenMessages] = useState(() => {
    const stored = localStorage.getItem('lastSeenMessages');
    return stored ? JSON.parse(stored) : initialLastSeen;
  });

  // Stato per i messaggi registrati
  const [recordedMessages, setRecordedMessages] = useState(() => {
    const stored = localStorage.getItem(`recordedMessages_${chat.id}`);
    return new Set(stored ? JSON.parse(stored) : []);
  });

  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, messageId: null });

  const handleContextMenu = (e, messageId) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      messageId
    });
  };

  const handleKeyDown = (e, messageId) => {
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      handleRecord(messageId);
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      handleMessageRightClick({ clientX: 0, clientY: 0 }, messageId);
    }
  };

  const handleRecord = (messageId) => {
    console.log('Registrazione per messaggio:', messageId);
    
    // Aggiungi o rimuovi il messaggio dai registrati (toggle)
    setRecordedMessages(prev => {
      const newSet = new Set([...prev]);
      
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      
      // Salva nello storage per persistenza
      localStorage.setItem(`recordedMessages_${chat.id}`, JSON.stringify([...newSet]));
      return newSet;
    });
    
    // Aggiungi un effetto visivo temporaneo al messaggio
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
      messageElement.style.animation = 'recordPulse 0.8s';
      
      // Se non esiste lo stile per l'animazione, aggiungilo
      if (!document.getElementById('record-animation')) {
        const styleTag = document.createElement('style');
        styleTag.id = 'record-animation';
        styleTag.innerHTML = `
          @keyframes recordPulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.03); background-color: rgba(233, 30, 99, 0.2); }
            100% { transform: scale(1); }
          }
          @keyframes notePulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.03); background-color: rgba(255, 193, 7, 0.2); }
            100% { transform: scale(1); }
          }
        `;
        document.head.appendChild(styleTag);
      }
      
      // Rimuovi l'animazione dopo che è finita
      setTimeout(() => {
        messageElement.style.animation = '';
      }, 800);
    }
  };

  const handleNote = (e, messageId) => {
    // Interrompe la propagazione dell'evento per evitare conflitti
    e.stopPropagation();
    
    // Mostra il popup per la nota
    handleMessageRightClick(e, messageId);
    
    // Aggiungi effetto visivo al messaggio
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
      messageElement.style.animation = 'notePulse 0.8s';
      
      // Rimuovi l'animazione dopo che è finita
      setTimeout(() => {
        messageElement.style.animation = '';
      }, 800);
    }
  };
  
  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null });
  };

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
      {messages.map((message) => {
        const hasNote = getNote(message.id) !== '';
        
        return (
          <Box key={message.id} sx={{ mb: 2 }}>
            <Box
              id={`message-${message.id}`}
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: recordedMessages.has(message.id) 
                  ? 'rgba(233, 30, 99, 0.1)' 
                  : hasNote 
                    ? 'rgba(255, 193, 7, 0.05)' 
                    : 'background.paper',
                position: 'relative',
                maxWidth: '80%',
                float: 'left',
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
                border: recordedMessages.has(message.id) 
                  ? '2px solid rgba(233, 30, 99, 0.5)' 
                  : hasNote 
                    ? '2px solid rgba(255, 193, 7, 0.5)' 
                    : 'none'
              }}
              onContextMenu={(e) => handleContextMenu(e, message.id)}
              tabIndex={0}
              onKeyDown={(e) => handleKeyDown(e, message.id)}
              onMouseEnter={() => {
                if (!seenMessages.has(message.id)) {
                  // Aggiungi il messaggio ai visti
                  setSeenMessages(prev => {
                    const newSet = new Set([...prev, message.id]);
                    // Salva nello storage per persistenza
                    localStorage.setItem(`seenMessages_${chat.id}`, JSON.stringify([...newSet]));
                    return newSet;
                  });
                  
                  // Aggiorna lastSeenMessages per questa chat
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
              {/* Indicatori in alto a destra del messaggio */}
              <Box sx={{ position: 'absolute', top: -5, right: -5, display: 'flex', gap: 1 }}>
                {hasNote && (
                  <Box
                    sx={{
                      bgcolor: 'warning.main',
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
                    onClick={(e) => handleNote(e, message.id)}
                    title="Messaggio con nota"
                  >
                    <NoteIcon sx={{ fontSize: 10 }} />
                  </Box>
                )}
                
                {recordedMessages.has(message.id) && (
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
              </Box>
              
              <ReplyContext message={message} messages={messages} />
              
              <Typography variant="caption" color="text.secondary">
                {message.senderName}
              </Typography>
              
              <Box>
                {message.isMedia && message.mediaPath && (
                  <img 
                    src={message.mediaPath} 
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
                )}
                {!message.isMedia && (
                  <Typography variant="body2">
                    {message.content}
                  </Typography>
                )}
              </Box>
              
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
              color: getNote(contextMenu.messageId) ? 'warning.main' : 'inherit'
            }}
            onClick={() => {
              handleMessageRightClick({ clientX: contextMenu.x, clientY: contextMenu.y }, contextMenu.messageId);
              closeContextMenu();
            }}
          >
            📝 {getNote(contextMenu.messageId) ? 'Modifica nota' : 'Aggiungi nota'}
          </Box>
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
            🎙 {recordedMessages.has(contextMenu.messageId) ? 'Rimuovi registrazione' : 'Registra'}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default MessageList;