import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Box,
  Typography,
  Chip,
  Switch,
  FormControlLabel,
  Divider,
  Alert
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

function NotePopup({ 
  open, 
  onClose, 
  note, 
  onChange, 
  onSave,
  position,
  message,
  chats,
  currentMessageId
}) {
  const [syncWithDuplicates, setSyncWithDuplicates] = useState(true);
  const [duplicateImages, setDuplicateImages] = useState([]);
  const [hasDuplicates, setHasDuplicates] = useState(false);
  const [existingGroupNote, setExistingGroupNote] = useState('');
  const [groupNoteExists, setGroupNoteExists] = useState(false);
  const [groupKey, setGroupKey] = useState('');

  // Cerca immagini duplicate all'apertura del popup
  useEffect(() => {
    if (open && message && message.imageHash && chats) {
      findDuplicateImages(message.imageHash);
    }
  }, [open, message, chats]);

  // Funzione per trovare immagini duplicate
  const findDuplicateImages = (imageHash) => {
    if (!imageHash || !chats) return;

    const duplicates = [];
    
    // Cerca in tutte le chat per messaggi con lo stesso hash
    chats.forEach(chat => {
      chat.messages.forEach(msg => {
        // Escludi il messaggio corrente
        if (msg.imageHash === imageHash && msg.ID !== message.ID) {
          duplicates.push({
            ...msg,
            chatName: chat.name,
            chatId: chat.id
          });
        }
      });
    });

    setHasDuplicates(duplicates.length > 0);
    setDuplicateImages(duplicates);

    // Verifica se esiste già una nota di gruppo
    const duplicateImageGroupNotes = JSON.parse(localStorage.getItem('duplicateImageGroupNotes') || '{}');
    
    // Cerca in tutte le chiavi per trovare il gruppo corrispondente
    let foundGroupKey = null;
    for (const key of Object.keys(duplicateImageGroupNotes)) {
      if (key.startsWith(imageHash)) {
        foundGroupKey = key;
        break;
      }
    }
    
    if (foundGroupKey && duplicateImageGroupNotes[foundGroupKey]) {
      setExistingGroupNote(duplicateImageGroupNotes[foundGroupKey]);
      setGroupNoteExists(true);
      setGroupKey(foundGroupKey);
    } else {
      setExistingGroupNote('');
      setGroupNoteExists(false);
      setGroupKey('');
    }
  };

  // Gestisci il salvataggio della nota
  const handleSave = () => {
    // Prima salva la nota per il messaggio corrente
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    messageNotes[message.ID] = note;
    
    // Se ci sono duplicati e l'opzione di sincronizzazione è attiva
    if (hasDuplicates && syncWithDuplicates) {
      // Aggiorna la nota per tutti i messaggi duplicati
      duplicateImages.forEach(duplicate => {
        messageNotes[duplicate.ID] = note;
      });
      
      // Aggiorna anche la nota di gruppo nel duplicateImageGroupNotes
      if (message.imageHash) {
        const duplicateImageGroupNotes = JSON.parse(localStorage.getItem('duplicateImageGroupNotes') || '{}');
        
        // Se abbiamo già un group key valido, usalo, altrimenti creane uno nuovo
        const useGroupKey = groupKey || `${message.imageHash}_${Date.now()}`;
        
        // Aggiorna o crea la nota di gruppo
        duplicateImageGroupNotes[useGroupKey] = note;
        localStorage.setItem('duplicateImageGroupNotes', JSON.stringify(duplicateImageGroupNotes));
      }
    } else if (!syncWithDuplicates && groupKey) {
      // Se l'utente sceglie di non sincronizzare, ma esiste già una nota di gruppo,
      // rimuovi questo messaggio dal gruppo mantenendo la nota solo per questo messaggio
      const duplicateImageGroupNotes = JSON.parse(localStorage.getItem('duplicateImageGroupNotes') || '{}');
      
      // Qui potremmo scegliere di mantenere la nota di gruppo per gli altri messaggi
      // ma non per questo specifico messaggio
      if (duplicateImageGroupNotes[groupKey]) {
        duplicateImageGroupNotes[groupKey] = note;
        localStorage.setItem('duplicateImageGroupNotes', JSON.stringify(duplicateImageGroupNotes));
      }
    }
    
    // Salva le note dei messaggi
    localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
    
    // Chiudi il popup
    onClose();
  };

  // Funzione per utilizzare la nota di gruppo esistente
  const useGroupNote = () => {
    if (existingGroupNote) {
      onChange({ target: { value: existingGroupNote } });
    }
  };

  // Formatta la data e l'ora
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        style: {
          position: 'absolute',
          left: position.x,
          top: position.y,
          margin: 0,
          minWidth: '350px'
        }
      }}
    >
      <DialogTitle sx={{ paddingBottom: 1 }}>
        Note sul messaggio
        <IconButton
          aria-label="close"
          onClick={onClose}
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
      
      <DialogContent sx={{ paddingTop: 1 }}>
        {groupNoteExists && (
          <Alert 
            severity="info" 
            sx={{ mb: 2 }}
            action={
              <Button 
                color="inherit" 
                size="small" 
                onClick={useGroupNote}
              >
                Usa
              </Button>
            }
          >
            Esiste già una nota di gruppo: "{existingGroupNote.substring(0, 30)}{existingGroupNote.length > 30 ? '...' : ''}"
          </Alert>
        )}
        
        <Box sx={{ minWidth: 300 }}>
          <TextField
            autoFocus
            margin="dense"
            id="note"
            label="Nota"
            type="text"
            fullWidth
            variant="outlined"
            multiline
            rows={4}
            value={note}
            onChange={onChange}
          />
          
          {hasDuplicates && (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" gutterBottom>
                Immagine duplicata in {duplicateImages.length} altri messaggi
              </Typography>
              
              <FormControlLabel
                control={
                  <Switch 
                    checked={syncWithDuplicates}
                    onChange={(e) => setSyncWithDuplicates(e.target.checked)}
                    color="primary"
                  />
                }
                label="Sincronizza nota con i duplicati"
                sx={{ mb: 1 }}
              />
              
              {duplicateImages.length > 0 && syncWithDuplicates && (
                <Box sx={{ mb: 2, mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    La nota sarà applicata anche a:
                  </Typography>
                  <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {duplicateImages.slice(0, 5).map((img, idx) => (
                      <Chip 
                        key={idx} 
                        label={`${img.chatName} - ${formatTime(img.timestamp)}`}
                        size="small"
                      />
                    ))}
                    {duplicateImages.length > 5 && (
                      <Chip 
                        label={`+${duplicateImages.length - 5} altri`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose} color="inherit">Annulla</Button>
        <Button 
          onClick={handleSave}
          variant="contained"
          color="primary"
        >
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default NotePopup;