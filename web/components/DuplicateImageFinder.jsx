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
  Divider,
  TextField,
  Tooltip,
  DialogActions
} from '@mui/material';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import CloseIcon from '@mui/icons-material/Close';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import EditNoteIcon from '@mui/icons-material/EditNote';

const DuplicateImageFinder = ({ chats }) => {
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [currentNoteGroup, setCurrentNoteGroup] = useState(null);
  const [currentNote, setCurrentNote] = useState('');
  const [currentGroupMessageIds, setCurrentGroupMessageIds] = useState([]);

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
  
    // Prepara le note dai vari storage
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
  
    // Processa i gruppi di duplicati
    const processedDuplicates = Object.entries(hashGroups)
      .filter(([_, group]) => group.length > 1)
      .map(([imageHash, group], groupIndex) => {
        // Ordina il gruppo per timestamp più recente
        const sortedGroup = group.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
  
        // Trova note individuali per ogni immagine
        const imagesWithNotes = sortedGroup.map(image => ({
          ...image,
          note: messageNotes[image.ID] || '',
          groupNoteKey: `${imageHash}_${groupIndex}`
        }));
  
        // Trova la nota di gruppo per questo hash
        const groupNoteKey = `${imageHash}_${groupIndex}`;
  
        return {
          imageHash,
          groupIndex,
          images: imagesWithNotes,
          hasNotes: imagesWithNotes.some(img => img.note) || !!groupNote
        };
      })
      // Ordina per numero di immagini e poi per timestamp più recente
      .sort((a, b) => {
        if (b.images.length !== a.images.length) {
          return b.images.length - a.images.length;
        }
        return new Date(b.images[0].timestamp) - new Date(a.images[0].timestamp);
      });
  
    setDuplicates(processedDuplicates);
    setLoading(false);
  };

  // Calcola la differenza di tempo tra due messaggi in minuti
  const getTimeDifference = (timestamp1, timestamp2) => {
    const date1 = new Date(timestamp1);
    const date2 = new Date(timestamp2);
    return Math.abs(date1 - date2) / (1000 * 60); // Differenza in minuti
  };

  // Handle opening the note dialog for a specific group
  const handleOpenNoteDialog = (group, groupHash, groupIndex) => {
    const groupKey = `${groupHash}_${groupIndex}`;
    setCurrentNoteGroup(groupKey);
    
    // Raccogli tutti gli ID dei messaggi in questo gruppo
    const messageIds = group.map(image => image.ID);
    setCurrentGroupMessageIds(messageIds);
    
    // Verifica se esiste già una nota per uno dei messaggi del gruppo
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    const existingNote = messageIds.find(id => messageNotes[id]);
    
    if (existingNote) {
      setCurrentNote(messageNotes[existingNote]);
    } else {
      setCurrentNote('');
    }
    
    setNoteDialogOpen(true);
  };

  // Handle saving the note for all images in the group
  const handleSaveGroupNote = () => {
    if (currentGroupMessageIds.length === 0) return;
    
    // Save the same note for all message IDs in this group
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    const duplicateImageGroupNotes = JSON.parse(localStorage.getItem('duplicateImageGroupNotes') || '{}');
    
    // Save individual notes
    currentGroupMessageIds.forEach(messageId => {
      if (messageId) {
        messageNotes[messageId] = currentNote;
      }
    });
    
    // Save group note with hash and timestamp as key
    if (currentNoteGroup) {
      duplicateImageGroupNotes[currentNoteGroup] = currentNote;
    }
    
    // Save back to localStorage
    localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
    localStorage.setItem('duplicateImageGroupNotes', JSON.stringify(duplicateImageGroupNotes));
    
    // Update UI state
    setDuplicates(prev => 
      prev.map(group => {
        if (group.groupNoteKey === currentNoteGroup) {
          return {
            ...group,
            hasNotes: currentNote.trim() !== '',
            images: group.images.map(img => ({
              ...img,
              note: currentNote
            }))
          };
        }
        return group;
      })
    );
    
    setNoteDialogOpen(false);
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
            duplicates.map((duplicateGroup, groupIndex) => {
              const group = duplicateGroup.images;
              const groupHash = group[0].imageHash;              
              
              return (
                <Card key={groupIndex} sx={{ mb: 3, overflow: 'visible' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle1">
                        Gruppo #{groupIndex + 1} - Trovate {group.length} copie
                      </Typography>
                    </Box>
                    
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
                      {group.map((image, imageIndex) => {
                        // Verifica se c'è una nota per questa immagine
                        const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
                        const hasNote = messageNotes[image.id] ? true : false;
                        
                        return (
                          <Box 
                            key={imageIndex} 
                            sx={{ 
                              width: 'calc(50% - 8px)',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              border: hasNote ? '2px solid #4caf50' : '1px solid #eee',
                              position: 'relative'
                            }}
                          >
                            {hasNote && (
                              <Box 
                                sx={{ 
                                  position: 'absolute', 
                                  top: 5, 
                                  right: 5, 
                                  bgcolor: '#4caf50', 
                                  p: '2px', 
                                  borderRadius: '50%',
                                  width: 20,
                                  height: 20,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}
                              >
                                <EditNoteIcon sx={{ color: 'white', fontSize: 14 }} />
                              </Box>
                            )}
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
                              <Typography variant="caption" display="block">
                                ID messaggio: {image.id}
                              </Typography>
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </CardContent>
                </Card>
              );
            })
          )}
        </DialogContent>
      </Dialog>
  
      {/* Dialog for adding/editing group notes */}
      <Dialog 
        open={noteDialogOpen}
        onClose={() => setNoteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Nota di gruppo
          <IconButton
            aria-label="close"
            onClick={() => setNoteDialogOpen(false)}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Questa nota verrà applicata a tutte le {currentGroupMessageIds.length} immagini duplicate in questo gruppo.
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            id="group-note"
            label="Nota di gruppo"
            type="text"
            fullWidth
            variant="outlined"
            multiline
            rows={4}
            value={currentNote}
            onChange={(e) => setCurrentNote(e.target.value)}
            helperText={`La nota verrà applicata a ${currentGroupMessageIds.length} messaggi`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteDialogOpen(false)}>Annulla</Button>
          <Button 
            onClick={handleSaveGroupNote}
            variant="contained"
            color="primary"
            disabled={!currentNote.trim()}
          >
            Salva nota su {currentGroupMessageIds.length} messaggi
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
  
  export default DuplicateImageFinder;
