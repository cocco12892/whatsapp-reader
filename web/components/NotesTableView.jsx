import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Paper, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow,
  Typography,
  Button,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const NotesTableView = ({ open, onClose, chats }) => {
  const [notes, setNotes] = useState({});
  const [recordedData, setRecordedData] = useState({});
  const [tableData, setTableData] = useState([]);
  
  useEffect(() => {
    if (open) {
      // Carica le note e i dati registrati
      const storedNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
      const storedRecordedData = JSON.parse(localStorage.getItem('recordedMessagesData') || '{}');
      
      setNotes(storedNotes);
      setRecordedData(storedRecordedData);
      
      // Prepara i dati per la tabella
      prepareTableData(storedNotes, storedRecordedData, chats);
    }
  }, [open, chats]);
  
  const prepareTableData = (notes, recordedData, chats) => {
    const data = [];
    
    // Raggruppa per nota
    const groupedByNote = {};
    
    // Processa tutti i messaggi registrati
    Object.entries(recordedData).forEach(([messageId, recordInfo]) => {
      // Ottieni la nota associata al messaggio
      let noteText = '';
      if (notes[messageId]) {
        noteText = notes[messageId].note || '';
      }
      const noteKey = noteText.trim() || 'Senza nota';
      
      if (!groupedByNote[noteKey]) {
        groupedByNote[noteKey] = [];
      }
      
      // Trova il messaggio e la chat corrispondenti
      let chatName = '';
      let message = null;
      
      for (const chat of chats) {
        const foundMessage = chat.messages?.find(msg => msg.id === messageId);
        if (foundMessage) {
          chatName = chat.name;
          message = foundMessage;
          break;
        }
      }
      
      if (message) {
        // Estrai quota e importo dal formato "importo@quota"
        let quota = '';
        let importo = '';
        
        // Cerca pattern come "4000@1,77" o "1200@1.79"
        let dataString = '';
        
        if (typeof recordInfo === 'string') {
          dataString = recordInfo;
        } else if (recordInfo.data) {
          dataString = recordInfo.data;
        }
        
        const contentMatch = dataString.match(/(\d+)@([\d,.]+)/);
        if (contentMatch) {
          importo = contentMatch[1];
          quota = contentMatch[2].replace('.', ',');
        }
        
        groupedByNote[noteKey].push({
          id: messageId,
          chat: chatName || (message.senderName ? message.senderName : 'Chat sconosciuta'),
          nota: noteKey,
          quota: quota,
          importo: importo,
          timestamp: message.timestamp,
          content: message.content
        });
      }
    });
    
    // Converti i gruppi in array piatto per la tabella
    Object.entries(groupedByNote).forEach(([noteKey, items]) => {
      // Aggiungi intestazione del gruppo
      if (noteKey !== 'Senza nota') {
        data.push({
          id: `header-${noteKey}`,
          isHeader: true,
          nota: noteKey,
          items: items.length
        });
      }
      
      // Aggiungi elementi del gruppo
      items.forEach(item => {
        data.push(item);
      });
      
      // Aggiungi separatore
      data.push({
        id: `separator-${noteKey}`,
        isSeparator: true
      });
    });
    
    setTableData(data);
  };
  
  const copyTableToClipboard = () => {
    // Crea una versione testuale della tabella
    let tableText = 'chat | Nota | quota | importo\n';
    
    // Filtra solo le righe di dati (non header o separatori)
    const dataRows = tableData.filter(row => !row.isHeader && !row.isSeparator);
    
    // Genera il testo della tabella
    dataRows.forEach(item => {
      tableText += `${item.chat} | ${item.nota} | ${item.quota} | ${item.importo}\n`;
    });
    
    navigator.clipboard.writeText(tableText)
      .then(() => {
        alert('Tabella copiata negli appunti!');
      })
      .catch(err => {
        console.error('Errore durante la copia: ', err);
        alert('Errore durante la copia della tabella');
      });
  };
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Tabella Quote e Note</Typography>
          <Tooltip title="Copia tabella">
            <IconButton onClick={copyTableToClipboard}>
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>
      <DialogContent>
        {tableData.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              Nessun dato disponibile. Registra messaggi con quote per visualizzarli qui.
            </Typography>
          </Box>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Chat</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Nota</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Quota</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Importo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tableData.map((row) => {
                if (row.isHeader) {
                  return (
                    <TableRow key={row.id} sx={{ backgroundColor: '#f5f5f5' }}>
                      <TableCell colSpan={4}>
                        <Typography variant="subtitle1" fontWeight="bold">
                          {row.nota} ({row.items} elementi)
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                } else if (row.isSeparator) {
                  return (
                    <TableRow key={row.id}>
                      <TableCell colSpan={4} padding="none">
                        <Divider />
                      </TableCell>
                    </TableRow>
                  );
                } else {
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.chat}</TableCell>
                      <TableCell>{row.nota}</TableCell>
                      <TableCell>{row.quota}</TableCell>
                      <TableCell>{row.importo}</TableCell>
                    </TableRow>
                  );
                }
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Chiudi</Button>
      </DialogActions>
    </Dialog>
  );
};

export default NotesTableView;
