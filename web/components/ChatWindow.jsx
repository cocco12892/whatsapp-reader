import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, Avatar, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';
import MessageList from './MessageList';
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';

function ChatWindow({ 
  chat, 
  chats,
  unreadMessages, 
  handleScroll, 
  handleImageClick, 
  lastSeenMessages,
  seenMessages
}) {
  const [chatSynonym, setChatSynonym] = useState('');
  const [synonymDialogOpen, setSynonymDialogOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  const handleSendMessage = () => {
    if (!messageInput.trim()) return;
    
    setIsSending(true);
    
    fetch(`/api/chats/${chat.id}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: messageInput
      }),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Errore nell\'invio del messaggio');
      }
      return response.json();
    })
    .then(data => {
      console.log('Messaggio inviato:', data);
      setMessageInput(''); // Pulisci l'input dopo l'invio
    })
    .catch(error => {
      console.error('Errore:', error);
      alert('Errore nell\'invio del messaggio');
    })
    .finally(() => {
      setIsSending(false);
    });
  };

  // Carica il sinonimo dal localStorage all'avvio
  useEffect(() => {
    const storedSynonyms = JSON.parse(localStorage.getItem('chatSynonyms') || '{}');
    if (storedSynonyms[chat.id]) {
      setChatSynonym(storedSynonyms[chat.id]);
    }
  }, [chat.id]);
  
  // Salva il sinonimo nel localStorage
  const saveSynonym = () => {
    const storedSynonyms = JSON.parse(localStorage.getItem('chatSynonyms') || '{}');
    storedSynonyms[chat.id] = chatSynonym;
    localStorage.setItem('chatSynonyms', JSON.stringify(storedSynonyms));
    setSynonymDialogOpen(false);
  };

  const profileImageUrl = chat.profileImage 
  ? (chat.profileImage.startsWith('http') 
    ? chat.profileImage 
    : `http://localhost:8080${chat.profileImage}`) 
  : null;

  return (
    <Paper sx={{
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
        color: 'primary.contrastText',
        display: 'flex',
        alignItems: 'center',
        gap: 2
      }}>
        {profileImageUrl && (
          <Avatar 
            src={profileImageUrl} 
            alt={`Profilo di ${chat.name}`}
            sx={{ 
              width: 40, 
              height: 40,
              border: '2px solid white'
            }}
            onError={(e) => {
              console.error('Errore caricamento immagine profilo:', profileImageUrl);
              e.target.style.display = 'none';
            }}
          />
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6">
              {chat.name}
            </Typography>
            <Tooltip title="Imposta sinonimo per questa chat">
              <IconButton 
                size="small" 
                onClick={() => setSynonymDialogOpen(true)}
                sx={{ color: 'white', opacity: 0.8 }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          {chatSynonym && (
            <Typography variant="label" sx={{ color: 'rgba(255, 255, 255, 0.7)', mt: -0.5 }}>
              {chatSynonym}
            </Typography>
          )}
        </Box>
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
        <MessageList 
          messages={chat.messages}
          handleImageClick={handleImageClick}          
          lastSeenMessages={lastSeenMessages}
          seenMessages={seenMessages}
          chat={chat}
          chats={chats} // Passiamo chats al componente
        />
      </Box>
      
      {/* Dialog per impostare il sinonimo */}
      <Dialog 
        open={synonymDialogOpen} 
        onClose={() => setSynonymDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Imposta un sinonimo per {chat.name}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Sinonimo"
            fullWidth
            variant="outlined"
            value={chatSynonym}
            onChange={(e) => setChatSynonym(e.target.value)}
            placeholder={chat.name}
            helperText="Questo nome verrà utilizzato nelle tabelle di esportazione"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSynonymDialogOpen(false)}>Annulla</Button>
          <Button 
            onClick={saveSynonym} 
            variant="contained" 
            color="primary"
          >
            Salva
          </Button>
          {chatSynonym && (
            <Button 
              onClick={() => {
                setChatSynonym('');
                const storedSynonyms = JSON.parse(localStorage.getItem('chatSynonyms') || '{}');
                delete storedSynonyms[chat.id];
                localStorage.setItem('chatSynonyms', JSON.stringify(storedSynonyms));
                setSynonymDialogOpen(false);
              }} 
              color="error"
            >
              Rimuovi
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Box sx={{
        p: 2,
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'flex-end',
        bgcolor: 'background.paper'
      }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Scrivi un messaggio..."
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.shiftKey) {
                // Con Shift+Invio aggiungiamo un ritorno a capo
                // Non facciamo nulla qui perché il comportamento predefinito è corretto
              } else {
                // Solo Invio invia il messaggio
                e.preventDefault();
                handleSendMessage();
              }
            }
          }}
          size="small"
          disabled={isSending}
          sx={{ 
            mr: 1,
            '& .MuiInputBase-root': {
              alignItems: 'flex-start', // Allinea il testo all'inizio
              transition: 'min-height 0.1s ease', // Animazione fluida quando si espande
            },
            '& .MuiOutlinedInput-input': {
              maxHeight: '200px', // Altezza massima prima di mostrare scrollbar
              overflowY: 'auto' // Abilita scrollbar quando supera maxHeight
            }
          }}
          multiline
          minRows={1}
          maxRows={8} 
        />
        <IconButton 
          color="primary" 
          onClick={handleSendMessage}
          disabled={isSending}
          sx={{ mb: 0.5 }}
        >
          <SendIcon />
        </IconButton>
      </Box>
    </Paper>
  );
}

export default ChatWindow;
