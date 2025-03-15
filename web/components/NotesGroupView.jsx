import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  Typography, 
  Box, 
  Chip, 
  IconButton, 
  Tooltip,
  List,
  ListItem,
  ListItemText,
  TextField,
  InputAdornment
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';

const NotesGroupView = ({ open, onClose, chats }) => {
  const [notes, setNotes] = useState({});
  const [groupedNotes, setGroupedNotes] = useState({});
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    if (open) {
      // Load notes from localStorage
      const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
      setNotes(storedNotes);
      
      // Group notes by their content
      const grouped = {};
      Object.values(storedNotes).forEach(noteEntry => {
        if (!grouped[noteEntry.note]) {
          grouped[noteEntry.note] = [];
        }
        grouped[noteEntry.note].push({
          messageId: noteEntry.messageId,
          chatName: noteEntry.chatName,
          senderName: noteEntry.senderName,
          timestamp: noteEntry.timestamp,
          content: noteEntry.content
        });
      });
      
      setGroupedNotes(grouped);
    }
  }, [open]);

  // Handle deleting a note
  const handleDeleteNote = (messageId) => {
    const updatedNotes = {...notes};
    delete updatedNotes[messageId];
    
    setNotes(updatedNotes);
    localStorage.setItem('messageNotes', JSON.stringify(updatedNotes));
    
    // Aggiorna anche i gruppi
    const newGroupedNotes = {};
    Object.values(updatedNotes).forEach(note => {
      if (!newGroupedNotes[note.note]) {
        newGroupedNotes[note.note] = [];
      }
      newGroupedNotes[note.note].push({
        messageId: note.messageId,
        chatName: note.chatName,
        senderName: note.senderName,
        timestamp: note.timestamp,
        content: note.content
      });
    });
    setGroupedNotes(newGroupedNotes);
  };

  // Filter notes based on input
  const filteredGroupedNotes = Object.entries(groupedNotes)
    .filter(([note]) => 
      note.toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => b[1].length - a[1].length);

  // Format timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6">Note Raggruppate</Typography>
          <Chip 
            label={`${Object.keys(groupedNotes).length} gruppi`} 
            color="primary" 
            size="small" 
          />
        </Box>
        <Box>
          <Tooltip title="Filtra note">
            <IconButton onClick={() => setShowFilter(!showFilter)}>
              <FilterListIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {showFilter && (
          <Box sx={{ mb: 3 }}>
            <TextField
              fullWidth
              variant="outlined"
              size="small"
              placeholder="Filtra note..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        )}
        
        {filteredGroupedNotes.length === 0 ? (
          <Typography variant="body1" sx={{ textAlign: 'center', my: 4, color: 'text.secondary' }}>
            Nessuna nota trovata con i criteri di ricerca attuali.
          </Typography>
        ) : (
          filteredGroupedNotes.map(([note, messageDetails], index) => (
            <Box key={index} sx={{ mb: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                "{note}"
              </Typography>
              <Chip 
                label={`${messageDetails.length} messaggi`} 
                color="secondary" 
                size="small" 
                sx={{ mb: 2 }}
              />
              <List dense>
                {messageDetails.map(detail => (
                  <ListItem 
                    key={detail.messageId} 
                    sx={{ 
                      pl: 0,
                      borderLeft: '3px solid',
                      borderColor: 'primary.light',
                      pl: 2,
                      mb: 1,
                      bgcolor: 'background.default',
                      borderRadius: '0 4px 4px 0'
                    }}
                    secondaryAction={
                      <IconButton 
                        edge="end" 
                        aria-label="delete"
                        size="small"
                        onClick={() => handleDeleteNote(detail.messageId)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                            {detail.chatName}
                          </Typography>
                          {detail.senderName && (
                            <Chip 
                              label={detail.senderName} 
                              size="small" 
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <>
                          {detail.content && (
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
                              {detail.content.length > 50 ? `${detail.content.substring(0, 50)}...` : detail.content}
                            </Typography>
                          )}
                          {detail.timestamp && (
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
                              {formatTime(detail.timestamp)}
                            </Typography>
                          )}
                        </>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          ))
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NotesGroupView;
