import React, { useState } from 'react';
import { Box, Typography, Dialog, DialogContent, IconButton, Button } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

function ReplyContext({ message, messages }) {
  const [showFullReply, setShowFullReply] = useState(false);
  
  // Controllo restrittivo - deve avere almeno replyToMessageId per essere considerato una vera risposta
  if (!message.isReply || !message.replyToMessageId) {
    return null; // Non è una risposta valida, non mostrare nulla
  }

  // Imposta valori predefiniti per i campi mancanti
  const replyToSender = message.replyToSender || "Sconosciuto";
  const replyToContent = message.replyToContent || "(contenuto non disponibile)";
  
  // Find the original message that was replied to - usa SOLO l'ID del messaggio
  const originalMessage = messages.find(m => m.id === message.replyToMessageId);
  
  const handleReplyClick = () => {
    setShowFullReply(true);
  };
  
  const handleCloseModal = () => {
    setShowFullReply(false);
  };
  
  const navigateToOriginalMessage = () => {
    if (originalMessage) {
      // Close the modal first
      setShowFullReply(false);
      
      // Small delay to allow modal to close
      setTimeout(() => {
        const originalElement = document.getElementById(`message-${originalMessage.id}`);
        if (originalElement) {
          // Scroll to the original message
          originalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Add highlight effect
          originalElement.style.backgroundColor = '#e3f2fd';
          originalElement.style.boxShadow = '0 0 0 2px #2196f3';
          
          // Create a pulsating border effect
          originalElement.style.animation = 'pulseBorder 1.5s 3'; // Run animation 3 times
          
          // Add a temporary style tag for the animation if it doesn't exist
          if (!document.getElementById('pulse-animation')) {
            const styleTag = document.createElement('style');
            styleTag.id = 'pulse-animation';
            styleTag.innerHTML = `
              @keyframes pulseBorder {
                0% { box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.7); }
                50% { box-shadow: 0 0 0 5px rgba(33, 150, 243, 0.3); }
                100% { box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.7); }
              }
            `;
            document.head.appendChild(styleTag);
          }
          
          // Remove highlight after animation completes
          setTimeout(() => {
            originalElement.style.backgroundColor = '';
            originalElement.style.boxShadow = '';
            originalElement.style.animation = '';
          }, 5000); // Wait longer than animation duration (1.5s * 3 = 4.5s)
        }
      }, 300);
    }
  };

  // Generate a unique matching color for this message pair
  const getMatchingColor = () => {
    // Generate a consistent color based on the message ID
    const colors = [
      '#2196f3', // Blue
      '#4caf50', // Green
      '#f44336', // Red
      '#9c27b0', // Purple
      '#ff9800', // Orange
      '#009688'  // Teal
    ];
    
    const colorIndex = Math.abs(hashCode(message.id) % colors.length);
    return colors[colorIndex];
  };
  
  // Simple hash function for strings
  const hashCode = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  };
  
  const matchingColor = getMatchingColor();

  return (
    <>
      <Box 
        sx={{
          bgcolor: 'action.hover',
          borderLeft: '4px solid',
          borderColor: matchingColor,
          p: 1,
          mb: 1,
          borderRadius: 1,
          maxWidth: '100%',
          overflow: 'hidden',
          cursor: 'pointer',
          position: 'relative',
        }}
        onClick={handleReplyClick}
      >
        <Box 
          sx={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            border: `2px solid ${matchingColor}`,
            borderRadius: 1,
            opacity: 0.3
          }} 
        />

        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', color: matchingColor }}>
          Risposta a: {replyToSender}
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            whiteSpace: 'nowrap', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis' 
          }}
        >
          {replyToContent}
        </Typography>
      </Box>
      
      {/* Modal for full reply content */}
      <Dialog
        open={showFullReply}
        onClose={handleCloseModal}
        maxWidth="sm"
        fullWidth
      >
        <DialogContent sx={{ position: 'relative', p: 3 }}>
          <IconButton
            aria-label="close"
            onClick={handleCloseModal}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
          
          <Typography variant="h6" gutterBottom color={matchingColor}>
            Messaggio di {replyToSender}
          </Typography>
          
          <Box sx={{ 
            mt: 2, 
            p: 2, 
            bgcolor: 'background.default', 
            borderRadius: 1,
            borderLeft: `4px solid ${matchingColor}`,
            cursor: originalMessage ? 'pointer' : 'default',
            '&:hover': {
              bgcolor: originalMessage ? 'rgba(33, 150, 243, 0.08)' : 'inherit'
            }
          }}
          onClick={originalMessage ? navigateToOriginalMessage : undefined}
          >
            <Typography variant="body1">
              {replyToContent}
            </Typography>
            
            {originalMessage && originalMessage.isMedia && originalMessage.mediaPath && (
              <Box sx={{ mt: 2 }}>
                <img 
                  src={originalMessage.mediaPath} 
                  alt="Media content" 
                  style={{ 
                    maxWidth: '100%', 
                    borderRadius: '5px',
                  }}
                />
              </Box>
            )}
            
            {originalMessage && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button 
                  startIcon={<OpenInNewIcon />}
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent triggering the parent box click
                    navigateToOriginalMessage();
                  }}
                  sx={{ color: matchingColor }}
                >
                  Vai al messaggio
                </Button>
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ReplyContext;