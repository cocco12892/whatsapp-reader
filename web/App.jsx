import React, { useState, useEffect, useCallback } from 'react';
import ErrorBoundary from './components/ErrorBoundary';

import ChatWindow from './components/ChatWindow';
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

const API_BASE_URL = '/api';
const POLLING_INTERVAL = 5000; // 5 secondi

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
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [notesGroupViewOpen, setNotesGroupViewOpen] = useState(false);
  

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

  const handleImageClick = useCallback((imageSrc) => {
    // Utilizziamo safeImagePath per codificare il percorso dell'immagine
    setModalImage(imageSrc);
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
                {/* Wrapper per BotSalvatore con larghezza controllata */}
                <Box sx={{ 
                  flexShrink: 0, 
                  flexGrow: 0 
                }}>
                  <BotSalvatore />
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
              src={safeImagePath(modalImage)} 
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
                transition: 'transform 0.3s ease, max-width 0.3s ease, max-height 0.3s ease'
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
