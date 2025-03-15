import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Button, 
  Dialog, 
  DialogTitle, 
  DialogContent,
  Typography,
  IconButton,
  Card,
  CardContent,
  Chip,
  Divider
} from '@mui/material';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import CloseIcon from '@mui/icons-material/Close';

const DuplicateImageFinder = ({ chats }) => {
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleOpen = () => {
    setOpen(true);
    findDuplicateImages();
  };

  const handleClose = () => {
    setOpen(false);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const findDuplicateImages = () => {
    setLoading(true);
    
    // Raccogliamo tutte le immagini da tutte le chat
    const allImages = [];
    chats.forEach(chat => {
      chat.messages.forEach(message => {
        if (message.isMedia && message.mediaPath && message.imageHash) {
          allImages.push({
            ...message,
            chatId: chat.id,
            chatName: chat.name
          });
        }
      });
    });

    // Raggruppiamo per hash e troviamo i duplicati
    const hashGroups = {};
    allImages.forEach(image => {
      if (!hashGroups[image.imageHash]) {
        hashGroups[image.imageHash] = [];
      }
      hashGroups[image.imageHash].push(image);
    });

    // Filtriamo per avere solo gruppi con più di un'immagine (i duplicati)
    const duplicateGroups = Object.values(hashGroups)
      .filter(group => group.length > 1)
      // Ordiniamo i gruppi in base alla data del messaggio più recente
      .sort((a, b) => {
        const latestA = Math.max(...a.map(img => new Date(img.timestamp)));
        const latestB = Math.max(...b.map(img => new Date(img.timestamp)));
        return latestB - latestA; // Ordine decrescente
      });

    setDuplicates(duplicateGroups);
    setLoading(false);
  };

  // Calcola la differenza di tempo tra due messaggi in minuti
  const getTimeDifference = (timestamp1, timestamp2) => {
    const date1 = new Date(timestamp1);
    const date2 = new Date(timestamp2);
    return Math.abs(date1 - date2) / (1000 * 60); // Differenza in minuti
  };

  return (
    <>
      <Button 
        variant="outlined" 
        startIcon={<FindReplaceIcon />} 
        onClick={handleOpen}
        sx={{ m: 2 }}
      >
        Trova immagini duplicate
      </Button>

      <Dialog 
        open={open} 
        onClose={handleClose}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Immagini duplicate trovate: {duplicates.length} gruppi</span>
          <IconButton onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {loading ? (
            <Typography>Ricerca duplicati in corso...</Typography>
          ) : duplicates.length === 0 ? (
            <Typography>Nessuna immagine duplicata trovata.</Typography>
          ) : (
            duplicates.map((group, groupIndex) => (
              <Card key={groupIndex} sx={{ mb: 3, overflow: 'visible' }}>
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    Gruppo #{groupIndex + 1} - Trovate {group.length} copie
                  </Typography>
                  
                  {/* Prima immagine come riferimento */}
                  <Box sx={{ display: 'flex', mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Box sx={{ mr: 2, flexBasis: '150px', flexShrink: 0 }}>
                      <img 
                        src={`http://localhost:8080${group[0].mediaPath}`} 
                        alt="Immagine duplicata"
                        style={{ 
                          width: '100%', 
                          borderRadius: '4px',
                          border: '2px solid #128C7E'
                        }} 
                      />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                        Hash: {group[0].imageHash.substring(0, 8)}...
                      </Typography>
                      
                      <Box sx={{ mt: 1 }}>
                        {group.map((image, imageIndex) => (
                          <Chip 
                            key={imageIndex}
                            label={`${image.chatName} - ${formatTime(image.timestamp)}`}
                            sx={{ m: 0.5 }}
                            color={imageIndex === 0 ? "primary" : "default"}
                          />
                        ))}
                      </Box>
                      
                      {/* Analisi temporale */}
                      {group.length > 1 && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="caption">
                            Analisi temporale:
                          </Typography>
                          {group.slice(0, -1).map((image, idx) => {
                            const nextImage = group[idx + 1];
                            const timeDiff = getTimeDifference(image.timestamp, nextImage.timestamp);
                            return (
                              <Typography key={idx} variant="caption" display="block">
                                Da {image.chatName} a {nextImage.chatName}: {timeDiff.toFixed(1)} minuti
                              </Typography>
                            );
                          })}
                        </Box>
                      )}
                    </Box>
                  </Box>
                  
                  <Divider sx={{ my: 2 }} />
                  
                  {/* Lista di tutte le occorrenze */}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {group.map((image, imageIndex) => (
                      <Box 
                        key={imageIndex} 
                        sx={{ 
                          width: 'calc(50% - 8px)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          border: '1px solid #eee',
                          position: 'relative'
                        }}
                      >
                        <img 
                          src={`http://localhost:8080${image.mediaPath}`} 
                          alt={`Occorrenza #${imageIndex + 1}`}
                          style={{ width: '100%' }} 
                        />
                        <Box sx={{ p: 1, bgcolor: 'rgba(0,0,0,0.03)' }}>
                          <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                            Chat: {image.chatName}
                          </Typography>
                          <Typography variant="caption" display="block">
                            Inviato da: {image.senderName}
                          </Typography>
                          <Typography variant="caption" display="block">
                            {formatTime(image.timestamp)}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            ))
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DuplicateImageFinder;