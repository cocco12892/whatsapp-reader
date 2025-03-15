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
  InputAdornment,
  Tabs,
  Tab
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import NoteIcon from '@mui/icons-material/Note';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';

const NotesGroupView = ({ open, onClose, chats }) => {
  const [notes, setNotes] = useState({});
  const [recordedData, setRecordedData] = useState({});
  const [groupedNotes, setGroupedNotes] = useState({});
  const [groupedRecorded, setGroupedRecorded] = useState({});
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [tabValue, setTabValue] = useState(0);

  useEffect(() => {
    if (open) {
      // Load notes from localStorage
      const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
      setNotes(storedNotes);
      
      // Load recorded data from localStorage
      const storedRecorded = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
      setRecordedData(storedRecorded);
      
      // Group notes by their content
      const groupedNotesObj = {};
      Object.values(storedNotes).forEach(noteEntry => {
        if (!groupedNotesObj[noteEntry.note]) {
          groupedNotesObj[noteEntry.note] = [];
        }
        groupedNotesObj[noteEntry.note].push({
          messageId: noteEntry.messageId,
          chatName: noteEntry.chatName,
          senderName: noteEntry.senderName,
          timestamp: noteEntry.timestamp,
          content: noteEntry.content
        });
      });
      
      setGroupedNotes(groupedNotesObj);
      
      // Group recorded data by note content
      const groupedRecordedObj = {};
      
      // Prima raggruppiamo i dati registrati per nota
      Object.values(storedRecorded).forEach(recordedEntry => {
        // Se l'entry ha già una nota associata, usala direttamente
        if (recordedEntry.note) {
          const noteText = recordedEntry.note;
          
          if (!groupedRecordedObj[noteText]) {
            groupedRecordedObj[noteText] = [];
          }
          
          groupedRecordedObj[noteText].push(recordedEntry);
        } else {
          // Altrimenti cerca la nota associata a questo messaggio
          const associatedNote = Object.values(storedNotes).find(note => 
            note.messageId === recordedEntry.messageId
          );
          
          if (associatedNote) {
            const noteText = associatedNote.note;
            
            if (!groupedRecordedObj[noteText]) {
              groupedRecordedObj[noteText] = [];
            }
            
            groupedRecordedObj[noteText].push({
              ...recordedEntry,
              note: noteText
            });
          }
        }
      });
      
      setGroupedRecorded(groupedRecordedObj);
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
    
    // Aggiorna anche i dati registrati raggruppati
    const newGroupedRecorded = {...groupedRecorded};
    Object.keys(newGroupedRecorded).forEach(noteText => {
      newGroupedRecorded[noteText] = newGroupedRecorded[noteText].filter(
        item => item.messageId !== messageId
      );
      
      if (newGroupedRecorded[noteText].length === 0) {
        delete newGroupedRecorded[noteText];
      }
    });
    setGroupedRecorded(newGroupedRecorded);
  };
  
  // Handle deleting recorded data
  const handleDeleteRecorded = (messageId) => {
    const updatedRecorded = {...recordedData};
    delete updatedRecorded[messageId];
    
    setRecordedData(updatedRecorded);
    localStorage.setItem('recordedMessagesData', JSON.stringify(updatedRecorded));
    
    // Aggiorna anche i gruppi
    const newGroupedRecorded = {...groupedRecorded};
    Object.keys(newGroupedRecorded).forEach(noteText => {
      newGroupedRecorded[noteText] = newGroupedRecorded[noteText].filter(
        item => item.messageId !== messageId
      );
      
      if (newGroupedRecorded[noteText].length === 0) {
        delete newGroupedRecorded[noteText];
      }
    });
    setGroupedRecorded(newGroupedRecorded);
  };

  // Filter notes based on input
  const filteredGroupedNotes = Object.entries(groupedNotes)
    .filter(([note]) => 
      note.toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => b[1].length - a[1].length);
    
  // Filter recorded data based on input
  const filteredGroupedRecorded = Object.entries(groupedRecorded)
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
          <Typography variant="h6">
            {tabValue === 0 ? 'Note Raggruppate' : 'Importi e Quote Raggruppati'}
          </Typography>
          <Chip 
            label={tabValue === 0 
              ? `${Object.keys(groupedNotes).length} gruppi` 
              : `${Object.keys(groupedRecorded).length} gruppi`} 
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
      
      <Tabs
        value={tabValue}
        onChange={(e, newValue) => setTabValue(newValue)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab 
          icon={<NoteIcon />} 
          label="Note" 
          id="tab-0"
          aria-controls="tabpanel-0"
        />
        <Tab 
          icon={<MonetizationOnIcon />} 
          label="Importi e Quote" 
          id="tab-1"
          aria-controls="tabpanel-1"
        />
      </Tabs>
      
      <DialogContent>
        {showFilter && (
          <Box sx={{ mb: 3 }}>
            <TextField
              fullWidth
              variant="outlined"
              size="small"
              placeholder={tabValue === 0 ? "Filtra note..." : "Filtra importi e quote..."}
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
        
        {/* Tab Panel per le Note */}
        <Box
          role="tabpanel"
          hidden={tabValue !== 0}
          id="tabpanel-0"
          aria-labelledby="tab-0"
        >
          {tabValue === 0 && (
            <>
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
                                {/* Mostra l'importo/quota se esiste */}
                                {(() => {
                                  const recordedItem = recordedData[detail.messageId];
                                  if (recordedItem) {
                                    return (
                                      <Chip 
                                        label={recordedItem.data} 
                                        size="small" 
                                        color="error"
                                        sx={{ height: 20, fontSize: '0.7rem' }}
                                      />
                                    );
                                  }
                                  return null;
                                })()}
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
            </>
          )}
        </Box>
        
        {/* Tab Panel per gli Importi e Quote */}
        <Box
          role="tabpanel"
          hidden={tabValue !== 1}
          id="tabpanel-1"
          aria-labelledby="tab-1"
        >
          {tabValue === 1 && (
            <>
              {filteredGroupedRecorded.length === 0 ? (
                <Typography variant="body1" sx={{ textAlign: 'center', my: 4, color: 'text.secondary' }}>
                  Nessun importo/quota trovato con i criteri di ricerca attuali.
                </Typography>
              ) : (
                filteredGroupedRecorded.map(([note, recordedItems], index) => (
                  <Box key={index} sx={{ mb: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                      "Nota: {note}"
                    </Typography>
                    <Chip 
                      label={`${recordedItems.length} importi/quote`} 
                      color="error" 
                      size="small" 
                      sx={{ mb: 2 }}
                    />
                    <List dense>
                      {recordedItems.map(item => (
                        <ListItem 
                          key={item.messageId} 
                          sx={{ 
                            pl: 0,
                            borderLeft: '3px solid',
                            borderColor: 'error.light',
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
                              onClick={() => handleDeleteRecorded(item.messageId)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          }
                        >
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                  {item.chatName}
                                </Typography>
                                <Chip 
                                  label={item.data} 
                                  size="small" 
                                  color="error"
                                  sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }}
                                  title={`Nota associata: ${item.note || 'Nessuna'}`}
                                />
                              </Box>
                            }
                            secondary={
                              <>
                                {item.content && (
                                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
                                    {item.content.length > 50 ? `${item.content.substring(0, 50)}...` : item.content}
                                  </Typography>
                                )}
                                {item.timestamp && (
                                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
                                    {formatTime(item.timestamp)}
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
            </>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default NotesGroupView;
