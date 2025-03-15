import React from 'react';
import { Box, Paper, Typography,Avatar } from '@mui/material';
import MessageList from './MessageList';

function ChatWindow({ 
  chat, 
  unreadMessages, 
  handleScroll, 
  handleImageClick, 
  lastSeenMessages,
  seenMessages
}) {

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
          chat={chat} // Passiamo chat al componente
        />
      </Box>
    </Paper>
  );
}

export default ChatWindow;
