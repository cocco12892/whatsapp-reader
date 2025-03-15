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
  DialogActions,
  Alert
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
  const [currentGroup, setCurrentGroup] = useState(null);
  const [currentNote, setCurrentNote] = useState('');
  const [syncWithDuplicates, setSyncWithDuplicates] = useState(true);

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
    if (!chats || !Array.isArray(chats)) {
      setLoading(false);
      return;
    }
    
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
          hasNotes: imagesWithNotes.some(img => img.note)
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

  // Handle opening the note dialog for a group
  const handleOpenNoteDialog = (group) => {
    const note = prompt("Inserisci una nota per il gruppo di messaggi:");
    
    if (note && group && Array.isArray(group)) {
      const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
      
      // Applica la stessa nota a tutti i messaggi del gruppo
      group.forEach(img => {
        messageNotes[img.ID] = note; // Assicurati di usare img.ID
      });
      
      localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
      
      // Aggiorna lo stato UI
      setDuplicates(prev => 
        prev.map(g => ({
          ...g,
          images: g.images.map(img => ({
            ...img,
            note: group.some(gImg => gImg.ID === img.ID) ? note : img.note
          }))
        }))
      );
    }
  };

  const handleMessageRightClick = (e, messageId) => {
    e.preventDefault();
    
    const note = prompt("Inserisci una nota per il messaggio:");
    
    if (note) {
      const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
      
      // Trova il gruppo a cui appartiene il messaggio
      const group = duplicates.find(g => 
        g.images.some(img => img.ID === messageId)
      );
      
      if (group) {
        // Applica la stessa nota a tutti i messaggi del gruppo
        group.images.forEach(img => {
          messageNotes[img.ID] = note;
        });
        
        localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
        
        // Aggiorna lo stato UI
        setDuplicates(prev => 
          prev.map(g => ({
            ...g,
            images: g.images.map(img => ({
              ...img,
              note: group.images.some(gImg => gImg.ID === img.ID) ? note : img.note
            }))
          }))
        );
      }
    }
  };

  // Handle saving the note for the entire group
  const handleSaveNote = () => {
    if (!currentGroup) return;
    
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    const duplicateImageGroupNotes = JSON.parse(localStorage.getItem('duplicateImageGroupNotes') || '{}');
    
    // Salva la nota per tutti i messaggi del gruppo
    currentGroup.images.forEach(image => {
      if (syncWithDuplicates) {
        messageNotes[image.ID] = currentNote;
      }
    });

    // Salva anche la nota di gruppo
    if (currentGroup.images[0]?.imageHash) {
      const groupKey = `${currentGroup.images[0].imageHash}_${currentGroup.groupIndex}`;
      duplicateImageGroupNotes[groupKey] = currentNote;
    }

    // Aggiorna lo storage
    localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
    localStorage.setItem('duplicateImageGroupNotes', JSON.stringify(duplicateImageGroupNotes));
    
    // Aggiorna lo stato UI
    setDuplicates(prev => 
      prev.map(group => ({
        ...group,
        images: group.images.map(img => ({
          ...img,
          note: currentGroup.images.some(gImg => gImg.ID === img.ID) ? currentNote : img.note
        }))
      }))
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
              const group = duplicateGroup.images || [];
              const groupHash = group[0].imageHash;              
              
              return (
                <Card key={groupIndex} sx={{ mb: 3, overflow: 'visible' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle1">
                          Gruppo #{groupIndex + 1} - Trovate {group.length} copie
                        </Typography>
                      </Box>
                      <Button
                        variant="outlined"
                        startIcon={group.some(img => img.note) ? <EditNoteIcon /> : <NoteAddIcon />}
                        onClick={() => handleOpenNoteDialog(group)}
                        size="small"
                      >
                        {group.some(img => img.note) ? 'Modifica nota gruppo' : 'Aggiungi nota gruppo'}
                      </Button>
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
  
      {/* Dialog for adding/editing single note */}
      <Dialog 
        open={noteDialogOpen}
        onClose={() => setNoteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Nota messaggio
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
          {currentGroup && currentGroup.images.length > 1 && (
            <FormControlLabel
              control={
                <Switch 
                  checked={syncWithDuplicates}
                  onChange={(e) => setSyncWithDuplicates(e.target.checked)}
                  color="primary"
                />
              }
              label={`Sincronizza nota con ${currentGroup.images.length} messaggi`}
              sx={{ mb: 2 }}
            />
          )}
          
          <TextField
            autoFocus
            margin="dense"
            id="message-note"
            label="Nota"
            type="text"
            fullWidth
            variant="outlined"
            multiline
            rows={4}
            value={currentNote}
            onChange={(e) => setCurrentNote(e.target.value)}
          />
          
          {currentGroup && currentGroup.images.length > 1 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              La nota verrà applicata a {syncWithDuplicates ? 'tutti' : 'solo questo'} messaggio/i del gruppo
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteDialogOpen(false)}>Annulla</Button>
          <Button 
            onClick={handleSaveNote}
            variant="contained"
            color="primary"
            disabled={!currentNote.trim()}
          >
            Salva nota
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
  
  export default DuplicateImageFinder;
