import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  Button,
  Typography,
  Box,
  TextField,
  InputAdornment,
  Divider,
  Chip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import NoteIcon from '@mui/icons-material/Note';

const NoteSelectionDialog = ({ 
  open, 
  onClose, 
  notes, 
  onSelectNote,
  chatName
}) => {
  const [filter, setFilter] = useState('');
  
  // Filtra le note in base all'input
  const filteredNotes = notes.filter(note => 
    note.note.toLowerCase().includes(filter.toLowerCase())
  );

  // Formatta la data
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="sm" 
      fullWidth
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">
            Seleziona una nota per {chatName}
          </Typography>
          <Chip 
            label={`${notes.length} note disponibili`} 
            color="primary" 
            size="small" 
          />
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <TextField
          fullWidth
          variant="outlined"
          size="small"
          placeholder="Filtra note..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        
        <Divider sx={{ mb: 2 }} />
        
        {filteredNotes.length === 0 ? (
          <Typography variant="body1" sx={{ textAlign: 'center', my: 4, color: 'text.secondary' }}>
            Nessuna nota trovata con i criteri di ricerca attuali.
          </Typography>
        ) : (
          <List sx={{ maxHeight: '50vh', overflow: 'auto' }}>
            {filteredNotes.map((note, index) => (
              <ListItem 
                key={index} 
                button 
                onClick={() => onSelectNote(note)}
                sx={{ 
                  borderLeft: '3px solid',
                  borderColor: 'primary.main',
                  mb: 1,
                  bgcolor: 'background.paper',
                  borderRadius: '0 4px 4px 0',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: 'action.hover',
                    transform: 'translateX(4px)'
                  }
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <NoteIcon color="primary" fontSize="small" />
                      <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                        {note.note}
                      </Typography>
                    </Box>
                  }
                  secondary={
                    <>
                      {note.content && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
                          {note.content.length > 50 ? `${note.content.substring(0, 50)}...` : note.content}
                        </Typography>
                      )}
                      {note.addedAt && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
                          Aggiunta: {formatTime(note.addedAt)}
                        </Typography>
                      )}
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose} color="primary">
          Annulla
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NoteSelectionDialog;
