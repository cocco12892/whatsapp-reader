import React, { useEffect, useState, useCallback } from 'react';
import NotePopup from './components/NotePopup';
import ChatWindow from './components/ChatWindow';
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
    const today = new Date();

    // Controlla se è oggi
    if (date.toDateString() === today.toDateString()) {
      return `Oggi ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return `${date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString([], { hour:
'2-digit', minute: '2-digit' })}`;
    }
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
                  <ChatWindow
                    key={chat.id}
                    chat={chat}
                    unreadMessages={unreadMessages}
                    handleScroll={handleScroll}
                    handleImageClick={handleImageClick}
                    handleMessageRightClick={handleMessageRightClick}
                    getNote={getNote}
                  />
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
