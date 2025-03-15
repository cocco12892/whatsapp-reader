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
  ListItemText
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';

const NotesGroupView = ({ open, onClose, chats }) => {
  const [notes, setNotes] = useState({});
  const [groupedNotes, setGroupedNotes] = useState({});
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (open) {
      // Load notes from localStorage
      const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '[]');
      setNotes(storedNotes);
      
      // Group notes by their content
      const grouped = {};
      storedNotes.forEach(noteEntry => {
        if (!grouped[noteEntry.note]) {
          grouped[noteEntry.note] = [];
        }
        grouped[noteEntry.note].push({
          messageId: noteEntry.messageId,
          chatName: noteEntry.chatName
        });
      });
      
      setGroupedNotes(grouped);
    }
  }, [open]);

  // Filter notes based on input
  const filteredGroupedNotes = Object.entries(groupedNotes)
    .filter(([note]) => 
      note.toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => b[1].length - a[1].length);

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
            <IconButton>
              <FilterListIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {filteredGroupedNotes.map(([note, messageDetails], index) => (
          <Box key={index} sx={{ mb: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
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
                <ListItem key={detail.messageId} sx={{ pl: 0 }}>
                  <ListItemText
                    primary={`Chat: ${detail.chatName}`}
                    secondary={`Message ID: ${detail.messageId}`}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
};

export default NotesGroupView;
