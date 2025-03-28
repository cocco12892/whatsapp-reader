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
  Tab,
  Button,
  Snackbar,
  Alert
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import NoteIcon from '@mui/icons-material/Note';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const NotesGroupView = ({ open, onClose, chats }) => {
  const [notes, setNotes] = useState({});
  const [recordedData, setRecordedData] = useState({});
  const [groupedNotes, setGroupedNotes] = useState({});
  const [groupedRecorded, setGroupedRecorded] = useState({});
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [chatSynonyms, setChatSynonyms] = useState({});

  useEffect(() => {
    if (open) {
      // Carica le note dal database
      const fetchNotes = async () => {
        try {
          const response = await fetch('/api/notes');
          if (!response.ok) {
            console.warn(`API notes non disponibile: ${response.status}`);
            // Fallback al localStorage per retrocompatibilità
            const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
            setNotes(storedNotes);
            return;
          }
          const notesData = await response.json();
          
          // Converti l'array di note in un oggetto con messageId come chiave
          const notesObj = {};
          notesData.forEach(note => {
            notesObj[note.messageId] = note;
          });
          
          setNotes(notesObj);
        } catch (error) {
          console.error("Errore nel caricamento delle note:", error);
          // Fallback al localStorage in caso di errore
          const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
          setNotes(storedNotes);
        }
      };
      
      // Carica i dati registrati dal database
      const fetchRecordedData = async () => {
        try {
          const response = await fetch('/api/recorded-data');
          if (!response.ok) {
            console.warn(`API recorded-data non disponibile: ${response.status}`);
            // Fallback al localStorage per retrocompatibilità
            const storedRecorded = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
            setRecordedData(storedRecorded);
            return;
          }
          const recordedData = await response.json();
          
          // Converti l'array in un oggetto con messageId come chiave
          const recordedObj = {};
          recordedData.forEach(item => {
            recordedObj[item.messageId] = item;
          });
          
          setRecordedData(recordedObj);
        } catch (error) {
          console.error("Errore nel caricamento dei dati registrati:", error);
          // Fallback al localStorage in caso di errore
          const storedRecorded = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
          setRecordedData(storedRecorded);
        }
      };
      
      fetchNotes();
      fetchRecordedData();
      
      // Carica i sinonimi delle chat dal database
      const loadChatSynonyms = async () => {
        try {
          const response = await fetch('/api/chats');
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const chatsData = await response.json();
          
          const synonymsMap = {};
          for (const chat of chatsData) {
            try {
              const synonymResponse = await fetch(`/api/chats/${encodeURIComponent(chat.id)}/synonym`);
              if (synonymResponse.ok) {
                const data = await synonymResponse.json();
                if (data.synonym) {
                  synonymsMap[chat.id] = data.synonym;
                }
              }
            } catch (error) {
              console.warn(`Errore nel caricamento del sinonimo per la chat ${chat.id}:`, error);
            }
          }
          setChatSynonyms(synonymsMap);
        } catch (error) {
          console.error("Errore nel caricamento dei sinonimi:", error);
        }
      };
      
      loadChatSynonyms();
    }
  }, [open]);
  
  // Raggruppa le note e i dati registrati quando cambiano
  useEffect(() => {
    // Group notes by their content
    const groupedNotesObj = {};
    Object.values(notes).forEach(noteEntry => {
      if (!noteEntry.note) return; // Skip entries without a note value
      
      if (!groupedNotesObj[noteEntry.note]) {
        groupedNotesObj[noteEntry.note] = [];
      }
      
      groupedNotesObj[noteEntry.note].push({
        messageId: noteEntry.messageId,
        chatId: noteEntry.chatId,
        chatName: noteEntry.chatName,
        senderName: noteEntry.senderName,
        timestamp: noteEntry.timestamp,
        content: noteEntry.content
      });
    });
    
    setGroupedNotes(groupedNotesObj);
    
    // Group recorded data by note content
    const groupedRecordedObj = {};
    
    // First group the recorded data by note
    Object.values(recordedData).forEach(recordedEntry => {
      // If the entry already has an associated note, use it directly
      if (recordedEntry.note) {
        const noteText = recordedEntry.note;
        
        if (!groupedRecordedObj[noteText]) {
          groupedRecordedObj[noteText] = [];
        }
        
        groupedRecordedObj[noteText].push(recordedEntry);
      } else {
        // Otherwise look for the note associated with this message
        const associatedNote = Object.values(notes).find(note => 
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
    
    // Add all notes, even those without associated recordings
    Object.entries(groupedNotesObj).forEach(([noteText, noteEntries]) => {
      if (!groupedRecordedObj[noteText]) {
        groupedRecordedObj[noteText] = [];
      }
      
      // Create a set of chatIds that already have recordings for this note
      const recordedChatIds = new Set(
        Object.values(recordedData)
          .filter(record => record.note === noteText)
          .map(record => record.chatId)
      );
      
      // Group notes by chatId
      const notesByChatId = {};
      noteEntries.forEach(noteEntry => {
        if (!noteEntry.chatId) return; // Skip if no chatId
        
        if (!notesByChatId[noteEntry.chatId]) {
          notesByChatId[noteEntry.chatId] = [];
        }
        notesByChatId[noteEntry.chatId].push(noteEntry);
      });
      
      // For each chat with notes, add a Skip item if it has no recordings
      Object.entries(notesByChatId).forEach(([chatId, chatNotes]) => {
        // If this chat has no recordings for this note
        if (!recordedChatIds.has(chatId)) {
          // Take the first note from this chat for this specific note
          const noteEntry = chatNotes[0];
          
          // Add the item with hasNoRecording: true
          const skipItem = {
            messageId: noteEntry.messageId,
            chatId: chatId,
            chatName: getChatName(chatId, noteEntry.chatName),
            timestamp: noteEntry.timestamp,
            note: noteText,
            hasNoRecording: true, // Flag to identify items without recording
            type: 'nota' // Add type for identification
          };
          
          groupedRecordedObj[noteText].push(skipItem);
          console.log('Added Skip item for chat:', skipItem);
        }
      });
    });
    
    // Debug log
    console.log('Items with hasNoRecording:', 
      Object.entries(groupedRecordedObj).flatMap(([note, items]) => 
        items.filter(item => item.hasNoRecording)
      )
    );
    
    setGroupedRecorded(groupedRecordedObj);
  }, [notes, recordedData, chatSynonyms]);

  // Handle deleting a note
  const handleDeleteNote = async (messageId) => {
    try {
      // Tenta di eliminare dal database
      try {
        const response = await fetch(`/api/notes/${messageId}`, {
          method: 'DELETE',
        });
        
        if (!response.ok) {
          console.warn(`API delete note non disponibile: ${response.status}`);
          // Se l'API non è disponibile, elimina solo dal localStorage
          const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
          delete storedNotes[messageId];
          localStorage.setItem('messageNotes', JSON.stringify(storedNotes));
        }
      } catch (error) {
        console.warn("Errore nell'eliminazione della nota dal database:", error);
        // Elimina dal localStorage in caso di errore
        const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
        delete storedNotes[messageId];
        localStorage.setItem('messageNotes', JSON.stringify(storedNotes));
      }
      
      // Aggiorna lo stato locale
      const updatedNotes = {...notes};
      delete updatedNotes[messageId];
      setNotes(updatedNotes);
    
      // Update groups as well
      const newGroupedNotes = {};
      Object.values(updatedNotes).forEach(note => {
        if (!note.note) return; // Skip entries without a note value
        
        if (!newGroupedNotes[note.note]) {
          newGroupedNotes[note.note] = [];
        }
        
        newGroupedNotes[note.note].push({
          messageId: note.messageId,
          chatId: note.chatId,
          chatName: note.chatName,
          senderName: note.senderName,
          timestamp: note.timestamp,
          content: note.content
        });
      });
      setGroupedNotes(newGroupedNotes);
      
      // Update grouped recorded data as well
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
    } catch (error) {
      console.error("Errore durante l'eliminazione della nota:", error);
    }
  };
  
  // Handle deleting recorded data
  const handleDeleteRecorded = async (messageId) => {
    try {
      // Tenta di eliminare dal database
      try {
        const response = await fetch(`/api/recorded-data/${messageId}`, {
          method: 'DELETE',
        });
        
        if (!response.ok) {
          console.warn(`API delete recorded-data non disponibile: ${response.status}`);
          // Se l'API non è disponibile, elimina solo dal localStorage
          const storedRecorded = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
          delete storedRecorded[messageId];
          localStorage.setItem('recordedMessagesData', JSON.stringify(storedRecorded));
        }
      } catch (error) {
        console.warn("Errore nell'eliminazione del dato registrato dal database:", error);
        // Elimina dal localStorage in caso di errore
        const storedRecorded = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
        delete storedRecorded[messageId];
        localStorage.setItem('recordedMessagesData', JSON.stringify(storedRecorded));
      }
      
      // Aggiorna lo stato locale
      const updatedRecorded = {...recordedData};
      delete updatedRecorded[messageId];
      setRecordedData(updatedRecorded);
    
      // Update groups as well
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
    } catch (error) {
      console.error("Errore durante l'eliminazione del dato registrato:", error);
    }
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
  
  // Get chat synonym if available
  const getChatName = (chatId, defaultName) => {
    return chatSynonyms[chatId] || defaultName;
  };

  
  // Copy data in tabular format for Excel
  const copyToClipboard = (noteGroup, recordedItems) => {
    // Initialize table string
    let tableContent = "";
    
    // Add each row of data
    recordedItems.forEach(item => {
      // Skip items with hasNoRecording flag
      if (item.hasNoRecording) return;
      
      // Extract amount and quota from the "amount@quota" format
      let importo = '';
      let quota = '';
      
      if (item.data && item.data.includes('@')) {
        const parts = item.data.split('@');
        importo = parts[0].replace('.', ','); // Sostituisci punto con virgola
        quota = parts[1].replace('.', ','); // Sostituisci punto con virgola
      } else if (item.data) {
        importo = item.data.replace('.', ','); // Sostituisci punto con virgola
      }
      
      // Format date and time separately
      let formattedDate = '';
      let formattedTime = '';
      
      if (item.timestamp) {
        const date = new Date(item.timestamp);
        // Date only in Italian format
        formattedDate = date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        // Time only
        formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      
      // Prepare fields, replacing any tabs with spaces
      const prepareField = (text) => {
        if (!text) return '';
        return text.replace(/\t/g, ' ');
      };
      
      // Add row to table (using tab as separator for Excel)
      // Date and time now in separate cells, using chat synonym
      const chatDisplayName = getChatName(item.chatId, item.chatName);
      tableContent += `${prepareField(formattedDate)}\t${prepareField(formattedTime)}\t${prepareField(chatDisplayName)}\t${prepareField(noteGroup)}\t${prepareField(quota)}\t${prepareField(importo)}\n`;
    });
    
    // Copy to clipboard
    navigator.clipboard.writeText(tableContent)
      .then(() => {
        setSnackbarMessage('Dati copiati negli appunti! Ora puoi incollarli in Excel');
        setSnackbarOpen(true);
      })
      .catch(err => {
        console.error('Errore durante la copia negli appunti:', err);
        setSnackbarMessage('Errore durante la copia. Riprova.');
        setSnackbarOpen(true);
      });
  };

  return (
    <>
      <Dialog 
        open={open} 
        onClose={onClose} 
        maxWidth="lg" 
        fullWidth
      >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6">
            {tabValue === 0 ?  'Importi e Quote Raggruppati' : 'Note Raggruppate'}
          </Typography>
          <Chip 
            label={tabValue === 0 
              ? `${Object.keys(groupedRecorded).length} gruppi`
              :  `${Object.keys(groupedNotes).length} gruppi`} 
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
          icon={<MonetizationOnIcon />} 
          label="Importi e Quote" 
          id="tab-1"
          aria-controls="tabpanel-1"
        />
        <Tab 
          icon={<NoteIcon />} 
          label="Note" 
          id="tab-0"
          aria-controls="tabpanel-0"
        />
      </Tabs>
      
      <DialogContent>
        {showFilter && (
          <Box sx={{ mb: 3 }}>
            <TextField
              fullWidth
              variant="outlined"
              size="small"
              placeholder={tabValue === 0 ? "Filtra importi e quote..." : "Filtra note..." }
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
        
        {/* Tab Panel for Notes */}
        <Box
          role="tabpanel"
          hidden={tabValue !== 1}
          id="tabpanel-0"
          aria-labelledby="tab-0"
        >
          {tabValue === 1 && (
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
                                {/* Show amount/quota if exists */}
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
        
        {/* Tab Panel for Amounts and Quotas */}
        <Box
          role="tabpanel"
          hidden={tabValue !== 0}
          id="tabpanel-1"
          aria-labelledby="tab-1"
        >
          {tabValue === 0 && (
            <>
              {filteredGroupedRecorded.length === 0 ? (
                <Typography variant="body1" sx={{ textAlign: 'center', my: 4, color: 'text.secondary' }}>
                  Nessun importo/quota trovato con i criteri di ricerca attuali.
                </Typography>
              ) : (
                filteredGroupedRecorded.map(([note, recordedItems], index) => (
                  <Box key={index} sx={{ mb: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                          Gruppo: "{note}"
                        </Typography>
                        <Chip 
                          label={`${recordedItems.length} importi/quote`} 
                          color="error" 
                          size="small"
                        />
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<ContentCopyIcon />}
                          onClick={() => copyToClipboard(note, recordedItems)}
                        >
                          Copia per Excel
                        </Button>
                      </Box>
                    </Box>
                    
                    {/* Table header */}
                    <Box sx={{ 
                      display: 'grid', 
                      gridTemplateColumns: '1fr 1fr 1fr 0.7fr 0.7fr auto',
                      bgcolor: 'primary.main',
                      color: 'white',
                      p: 1,
                      borderRadius: '4px 4px 0 0',
                      fontWeight: 'bold',
                      mb: 1
                    }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>Data</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>Chat</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>Nota</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>Quota</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>Importo</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>Azioni</Typography>
                    </Box>
                    
                    {/* Table rows */}
                    <List dense disablePadding>
                      {recordedItems.map(item => {
                        // Extract amount and quota from the "amount@quota" format
                        let importo = '';
                        let quota = '';
                        
                        if (item.data && item.data.includes('@')) {
                          const parts = item.data.split('@');
                          importo = parts[0];
                          quota = parts[1];
                        } else if (item.data) {
                          importo = item.data;
                        }
                        
                        // Get chat display name (real name or synonym)
                        const chatDisplayName = getChatName(item.chatId, item.chatName);
                        
                        return (
                          <ListItem 
                            key={item.messageId}
                            sx={{ 
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr 1fr 0.7fr 0.7fr auto',
                              p: 1,
                              borderBottom: '1px solid',
                              borderColor: 'divider',
                              '&:hover': {
                                bgcolor: 'action.hover'
                              }
                            }}
                          >
                            <Typography variant="body2" color="text.secondary">
                              {item.timestamp ? formatTime(item.timestamp) : ''}
                            </Typography>
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {chatDisplayName}
                            </Typography>
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {note}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {item.hasNoRecording ? '-' : quota}
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                              {item.hasNoRecording ? '-' : importo}
                            </Typography>
                            {item.hasNoRecording === true ? (
                              <Chip
                                label="Skip"
                                size="small"
                                color="default"
                                variant="outlined"
                                sx={{ height: 24, fontSize: '0.7rem' }}
                              />
                            ) : (
                              <IconButton 
                                edge="end" 
                                aria-label="delete"
                                size="small"
                                onClick={() => handleDeleteRecorded(item.messageId)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            )}
                          </ListItem>
                        );
                      })}
                    </List>
                  </Box>
                ))
              )}
            </>
          )}
        </Box>
      </DialogContent>
      </Dialog>
      
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbarOpen(false)} 
          severity="success" 
          sx={{ width: '100%' }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </>
  );
};

export default NotesGroupView;
