import React, { useState, useEffect, useRef } from 'react';
import { Box, Paper, Typography, Avatar, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';
import MessageList from './MessageList';
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ImageIcon from '@mui/icons-material/Image';

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
  const [replyingTo, setReplyingTo] = useState(null);
  
  // Nuovo state per la gestione delle immagini
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageCaption, setImageCaption] = useState('');
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const fileInputRef = useRef(null);

  // Carica il sinonimo dal localStorage all'avvio
  useEffect(() => {
    const storedSynonyms = JSON.parse(localStorage.getItem('chatSynonyms') || '{}');
    if (storedSynonyms[chat.id]) {
      setChatSynonym(storedSynonyms[chat.id]);
    }
  }, [chat.id]);
  
  const handleSendMessage = () => {
    if (!messageInput.trim() && !selectedImage) return;
    
    setIsSending(true);
    
    // Se c'è un'immagine selezionata, invia quella
    if (selectedImage) {
      const formData = new FormData();
      formData.append('image', selectedImage);
      if (imageCaption) {
        formData.append('caption', imageCaption);
      }
      
      // Se è una risposta, aggiungi l'ID del messaggio a cui rispondere
      if (replyingTo) {
        formData.append('isReply', 'true');
        formData.append('replyToMessageId', replyingTo.id);
      }
      
      fetch(`/api/chats/${chat.id}/send`, {
        method: 'POST',
        body: formData,
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('Errore nell\'invio dell\'immagine');
        }
        return response.json();
      })
      .then(data => {
        console.log('Immagine inviata:', data);
        setSelectedImage(null);
        setImageCaption('');
        setImageDialogOpen(false);
        setReplyingTo(null);
      })
      .catch(error => {
        console.error('Errore:', error);
        alert('Errore nell\'invio dell\'immagine');
      })
      .finally(() => {
        setIsSending(false);
      });
    } else {
      // Codice esistente per invio messaggi di testo
      const messageData = {
        content: messageInput.trim()
      };
      
      if (replyingTo) {
        messageData.isReply = true;
        messageData.replyToMessageId = replyingTo.id;
      }
      
      fetch(`/api/chats/${chat.id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData),
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('Errore nell\'invio del messaggio');
        }
        return response.json();
      })
      .then(data => {
        console.log('Messaggio inviato:', data);
        setMessageInput('');
        setReplyingTo(null);
      })
      .catch(error => {
        console.error('Errore:', error);
        alert('Errore nell\'invio del messaggio');
      })
      .finally(() => {
        setIsSending(false);
      });
    }
  };

  const handleImageSelect = (event) => {
    if (event.target.files && event.target.files[0]) {
      setSelectedImage(event.target.files[0]);
      setImageDialogOpen(true);
    }
  };
  

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
          onReplyToMessage={(message) => setReplyingTo(message)}
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
      {/* Anteprima risposta */}

      {replyingTo && (
        <Box 
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            p: 1.5, 
            mb: 1.5, 
            borderRadius: 1,
            bgcolor: 'action.hover',
            borderLeft: '4px solid',
            borderColor: 'primary.main'
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="primary.main" fontWeight="bold">
              Risposta a {replyingTo.senderName}
            </Typography>
            <Typography 
              variant="body2" 
              sx={{ 
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                fontSize: '0.85rem',
                color: 'text.secondary'
              }}
            >
              {replyingTo.content}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setReplyingTo(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      <Box sx={{
        p: 2,
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'flex-end',
        bgcolor: 'background.paper'
      }}>
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          ref={fileInputRef}
          onChange={handleImageSelect}
        />
        <IconButton 
          color="primary" 
          onClick={() => fileInputRef.current.click()}
          disabled={isSending}
        >
          <ImageIcon />
        </IconButton>
        
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Scrivi..."
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.shiftKey) {
                // Con Shift+Invio aggiungiamo un ritorno a capo
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
            mx: 1,
            '& .MuiInputBase-root': {
              alignItems: 'flex-start',
              transition: 'min-height 0.1s ease',
            },
            '& .MuiOutlinedInput-input': {
              maxHeight: '200px',
              overflowY: 'auto'
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

        {/* Dialog per l'anteprima e la didascalia dell'immagine */}
        <Dialog 
        open={imageDialogOpen} 
        onClose={() => setImageDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Invia immagine</DialogTitle>
        <DialogContent>
          {selectedImage && (
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <img 
                src={URL.createObjectURL(selectedImage)}
                alt="Anteprima immagine"
                style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '8px' }}
              />
            </Box>
          )}
          <TextField
            autoFocus
            margin="dense"
            label="Didascalia (opzionale)"
            fullWidth
            variant="outlined"
            value={imageCaption}
            onChange={(e) => setImageCaption(e.target.value)}
            multiline
            minRows={2}
            maxRows={4}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setSelectedImage(null);
            setImageCaption('');
            setImageDialogOpen(false);
          }}>
            Annulla
          </Button>
          <Button 
            onClick={handleSendMessage} 
            variant="contained" 
            color="primary"
            disabled={isSending}
          >
            Invia
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export default ChatWindow;
