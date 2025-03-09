import React, { useEffect, useState, useCallback } from 'react';
import NotePopup from './components/NotePopup';
import { Helmet } from 'react-helmet';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './styles/theme';
import { Box, Typography, CircularProgress, Paper, Dialog, DialogContent, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const API_BASE_URL = '/api';
const POLLING_INTERVAL = 5000; // 5 secondi

function App() {
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
  const [notePopup, setNotePopup] = useState({
    visible: false,
    messageId: null,
    position: { x: 0, y: 0 },
    note: ''
  });

  const fetchChats = async () => {
    try {
      console.log("Fetching chats...");
      const response = await fetch(`${API_BASE_URL}/chats`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const chatsData = await response.json();
      console.log("Received chats data:", chatsData);
      
      const preparedChats = await Promise.all(chatsData.map(async (chat) => {
        const messagesResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chat.id)}/messages`);
        if (!messagesResponse.ok) {
          throw new Error(`HTTP error! status: ${messagesResponse.status}`);
        }
        const messages = await messagesResponse.json();
        
        return {
          ...chat,
          messages: messages
        };
      }));
      
      const orderedChats = chatOrder.length > 0 
        ? chatOrder.map(id => preparedChats.find(c => c.id === id)).filter(c => c)
        : preparedChats;

      // Aggiorna i messaggi non letti
      setUnreadMessages(prev => {
        const newUnread = { ...prev };
        orderedChats.forEach(chat => {
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
      
      if (chatOrder.length !== orderedChats.length) {
        setChatOrder(orderedChats.map(c => c.id));
      }
      
      setChats(orderedChats);
    } catch (error) {
      console.error('Errore nel caricamento delle chat:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();

    const intervalId = setInterval(() => {
      if (!isUserScrolling) {
        fetchChats();
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [clientJID, isUserScrolling]);

  const handleScroll = (e) => {
    const element = e.target;
    const chatId = element.dataset.chatId;
    const isAtTop = element.scrollTop < 50;
    setIsUserScrolling(!isAtTop);

    // Trova l'ultimo messaggio visibile
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

    if (isAtBottom) {
      setUnreadMessages(prev => ({
        ...prev,
        [chatId]: 0
      }));
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleImageClick = useCallback((imageSrc) => {
    setModalImage(imageSrc);
  }, []);

  const closeModal = useCallback(() => {
    setModalImage(null);
  }, []);

  const saveNote = useCallback((messageId, note) => {
    const notes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    notes[messageId] = note;
    localStorage.setItem('messageNotes', JSON.stringify(notes));
  }, []);

  const getNote = useCallback((messageId) => {
    const notes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    return notes[messageId] || '';
  }, []);

  const handleMessageRightClick = useCallback((e, messageId) => {
    e.preventDefault();
    setNotePopup({
      visible: true,
      messageId,
      position: { x: e.clientX, y: e.clientY },
      note: getNote(messageId)
    });
  }, [getNote]);

  const handleNoteChange = useCallback((e) => {
    setNotePopup(prev => ({
      ...prev,
      note: e.target.value
    }));
  }, []);

  const handleSaveNote = useCallback(() => {
    saveNote(notePopup.messageId, notePopup.note);
    setNotePopup(prev => ({ ...prev, visible: false }));
  }, [notePopup, saveNote]);

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
        {isLoading ? (
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
            {chats.length > 0 ? (
              <Box sx={{
                display: 'flex',
                gap: 3,
                overflowX: 'auto',
                pb: 2
              }}>
                {chats.map((chat) => (
                  <Paper key={chat.id} sx={{
                    minWidth: 300,
                    maxWidth: 400,
                    height: '80vh',
                    display: 'flex',
                    flexDirection: 'column'
                  }}>
                    <Box sx={{
                      p: 2,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText'
                    }}>
                      <Typography variant="h6">{chat.name || 'Chat'}</Typography>
                    </Box>
                    <Box 
                      sx={{
                        flex: 1,
                        overflowY: 'auto',
                        p: 2,
                        bgcolor: 'background.default',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column-reverse'
                      }} 
                      onScroll={handleScroll}
                      data-chat-id={chat.id}
                      ref={element => {
                        if (element) {
                          // Scroll automatico in fondo al caricamento
                          element.scrollTop = element.scrollHeight;
                        }
                      }}
                    >
                      {unreadMessages[chat.id] > 0 && (
                        <Box
                          sx={{
                            position: 'absolute',
                            bottom: 16,
                            right: 16,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            borderRadius: '50%',
                            width: 24,
                            height: 24,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            cursor: 'pointer',
                            zIndex: 1,
                            boxShadow: 2
                          }}
                          onClick={() => {
                            const element = document.querySelector(`[data-chat-id="${chat.id}"]`);
                            element.scrollTop = element.scrollHeight;
                          }}
                        >
                          {unreadMessages[chat.id]}
                        </Box>
                      )}
                      {[...chat.messages].reverse().map((message) => (
                        <Box key={message.id} sx={{ mb: 2 }}>
                          <Box
                            id={`message-${message.id}`}
                            sx={{
                              p: 1.5,
                              borderRadius: 2,
                              bgcolor: 'background.paper',
                              position: 'relative',
                              maxWidth: '80%',
                              float: 'left',
                              clear: 'both',
                              mb: 2,
                              opacity: lastSeenMessages[chat.id] && 
                                new Date(message.timestamp) <= new Date(lastSeenMessages[chat.id]) ? 0.8 : 1,
                              animation: seenMessages.has(message.id) ? 'none' : 'blink 1.5s infinite',
                              '@keyframes blink': {
                                '0%': { backgroundColor: 'background.paper' },
                                '50%': { backgroundColor: '#fff9c4' },
                                '100%': { backgroundColor: 'background.paper' }
                              },
                              '&:hover': {
                                animation: 'none'
                              }
                            }}
                            onMouseEnter={() => {
                              setSeenMessages(prev => new Set([...prev, message.id]));
                            }}
                            onContextMenu={(e) => handleMessageRightClick(e, message.id)}
                          >
                            {getNote(message.id) && (
                              <Box
                                sx={{
                                  position: 'absolute',
                                  top: -5,
                                  right: -5,
                                  bgcolor: 'warning.main',
                                  color: 'text.primary',
                                  width: 16,
                                  height: 16,
                                  borderRadius: '50%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 10,
                                  cursor: 'pointer'
                                }}
                                onClick={(e) => handleMessageRightClick(e, message.id)}
                              >
                                !
                              </Box>
                            )}
                            <Typography variant="caption" color="text.secondary">
                              {message.senderName}
                            </Typography>
                            <Box>
                              {message.isMedia && message.mediaPath && (
                                <img 
                                  src={message.mediaPath} 
                                  alt="Immagine" 
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
                      ))}
                    </Box>
                  </Paper>
                ))}
              </Box>
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
            justifyContent: 'center'
          }
        }}
      >
        <DialogContent sx={{ 
          p: 0, 
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <IconButton
            aria-label="close"
            onClick={closeModal}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: 'white',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.7)'
              }
            }}
          >
            <CloseIcon />
          </IconButton>
          <Box
            sx={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <img 
              src={modalImage} 
              alt="Immagine ingrandita" 
              style={{
                maxWidth: '100%',
                maxHeight: '90vh',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '4px'
              }}
            />
          </Box>
        </DialogContent>
      </Dialog>

      <NotePopup
        open={notePopup.visible}
        onClose={() => setNotePopup(prev => ({ ...prev, visible: false }))}
        note={notePopup.note}
        onChange={handleNoteChange}
        onSave={handleSaveNote}
        position={notePopup.position}
      />
    </ThemeProvider>
  );
}

export default App;
