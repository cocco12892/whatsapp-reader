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
  Button
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import NoteIcon from '@mui/icons-material/Note';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

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
  
  // Esporta i dati in formato CSV
  const exportToCSV = (noteGroup, recordedItems) => {
    // Crea l'intestazione del CSV
    let csvContent = "Data,Chat,Nota,Quota,Importo\n";
    
    // Aggiungi ogni riga di dati
    recordedItems.forEach(item => {
      // Estrai importo e quota dal formato "importo@quota"
      let importo = '';
      let quota = '';
      if (item.data && item.data.includes('@')) {
        const parts = item.data.split('@');
        importo = parts[0];
        quota = parts[1];
      } else {
        importo = item.data;
      }
      
      // Formatta la data
      const formattedDate = item.timestamp ? formatTime(item.timestamp) : '';
      
      // Escape delle virgole nei campi di testo
      const escapeCsv = (text) => {
        if (!text) return '';
        // Se contiene virgole, virgolette o newline, racchiudi in virgolette e raddoppia le virgolette interne
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      };
      
      // Aggiungi la riga al CSV
      csvContent += `${escapeCsv(formattedDate)},${escapeCsv(item.chatName)},${escapeCsv(noteGroup)},${escapeCsv(quota)},${escapeCsv(importo)}\n`;
    });
    
    // Crea un blob e un link per il download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${noteGroup.replace(/[^a-z0-9]/gi, '_').substring(0, 20)}_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="lg" 
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
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<FileDownloadIcon />}
                        onClick={() => exportToCSV(note, recordedItems)}
                      >
                        Esporta CSV
                      </Button>
                    </Box>
                    
                    {/* Intestazione tabella */}
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
                    
                    {/* Righe tabella */}
                    <List dense disablePadding>
                      {recordedItems.map(item => {
                        // Estrai importo e quota dal formato "importo@quota"
                        let importo = '';
                        let quota = '';
                        if (item.data && item.data.includes('@')) {
                          const parts = item.data.split('@');
                          importo = parts[0];
                          quota = parts[1];
                        } else {
                          importo = item.data;
                        }
                        
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
                              {item.chatName}
                            </Typography>
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {note}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {quota}
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                              {importo}
                            </Typography>
                            <IconButton 
                              edge="end" 
                              aria-label="delete"
                              size="small"
                              onClick={() => handleDeleteRecorded(item.messageId)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
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
  );
};

export default NotesGroupView;
