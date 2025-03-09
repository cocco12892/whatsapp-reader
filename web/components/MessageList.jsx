import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';

function MessageList({ messages, handleImageClick, handleMessageRightClick, getNote }) {
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
    }
  };

  const handleRecord = (messageId) => {
    console.log('Registrazione per messaggio:', messageId);
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
    <Box onClick={closeContextMenu}>
      {messages.map((message) => (
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
            onContextMenu={(e) => handleContextMenu(e, message.id)}
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown(e, message.id)}
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
      ))}

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
              }
            }}
            onClick={() => {
              handleMessageRightClick({ clientX: contextMenu.x, clientY: contextMenu.y }, contextMenu.messageId);
              closeContextMenu();
            }}
          >
            📝 Aggiungi nota
          </Box>
          <Box
            sx={{
              p: 1,
              cursor: 'pointer',
              '&:hover': {
                bgcolor: 'action.hover'
              }
            }}
            onClick={() => {
              handleRecord(contextMenu.messageId);
              closeContextMenu();
            }}
          >
            🎙 Registra
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default MessageList;
