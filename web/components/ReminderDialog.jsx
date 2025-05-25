import React, { useState, useEffect } from 'react';
import { 
  Dialog, DialogTitle, DialogContent, DialogActions, 
  Button, TextField, Typography, Box, 
  IconButton, List, ListItem, ListItemText, 
  Divider, Alert, Chip, Tooltip,
  CircularProgress
} from '@mui/material';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AlarmIcon from '@mui/icons-material/Alarm';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { it } from 'date-fns/locale';
import { format } from 'date-fns';

const ReminderDialog = ({ open, onClose, chatId, chatName, API_BASE_URL }) => {
  const [reminders, setReminders] = useState([]);
  const [message, setMessage] = useState('');
  const [scheduledTime, setScheduledTime] = useState(new Date(Date.now() + 30 * 60000)); // Default 30 min from now
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editReminderId, setEditReminderId] = useState(null);

  // Fetch reminders when dialog opens
  useEffect(() => {
    if (open && chatId) {
      fetchReminders();
    }
  }, [open, chatId]);

  // Fetch reminders for this chat
  const fetchReminders = async () => {
    if (!chatId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/reminders`);
      
      if (!response.ok) {
        throw new Error(`Errore nel caricamento dei reminder: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Sort by scheduled time
      const sortedReminders = data.sort((a, b) => 
        new Date(a.scheduled_time) - new Date(b.scheduled_time)
      );
      
      setReminders(sortedReminders);
    } catch (error) {
      console.error('Errore nel caricamento dei reminder:', error);
      setError(`Errore nel caricamento dei reminder: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!message.trim()) {
      setError('Il messaggio non può essere vuoto');
      return;
    }
    
    if (scheduledTime <= new Date()) {
      setError('Il tempo programmato deve essere nel futuro');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    const reminderData = {
      message: message,
      scheduled_time: scheduledTime.toISOString(),
      created_by: "Utente"
    };
    
    try {
      let response;
      
      if (editMode) {
        // Update existing reminder
        response = await fetch(`${API_BASE_URL}/api/reminders/${editReminderId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reminderData),
        });
      } else {
        // Create new reminder
        response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/reminders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reminderData),
        });
      }
      
      if (!response.ok) {
        throw new Error(`Errore nel ${editMode ? 'aggiornamento' : 'salvataggio'} del reminder: ${response.status}`);
      }
      
      // Reset form
      setMessage('');
      setScheduledTime(new Date(Date.now() + 30 * 60000)); // Reset to 30 min from now
      setEditMode(false);
      setEditReminderId(null);
      
      // Refresh reminders
      await fetchReminders();
    } catch (error) {
      console.error(`Errore nel ${editMode ? 'aggiornamento' : 'salvataggio'} del reminder:`, error);
      setError(`Errore nel ${editMode ? 'aggiornamento' : 'salvataggio'} del reminder: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle deletion
  const handleDelete = async (reminderId) => {
    if (!window.confirm('Sei sicuro di voler eliminare questo reminder?')) {
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/reminders/${reminderId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`Errore nell'eliminazione del reminder: ${response.status}`);
      }
      
      // Refresh reminders
      await fetchReminders();
    } catch (error) {
      console.error('Errore nell\'eliminazione del reminder:', error);
      setError(`Errore nell'eliminazione del reminder: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle edit
  const handleEdit = (reminder) => {
    setMessage(reminder.message);
    setScheduledTime(new Date(reminder.scheduled_time));
    setEditMode(true);
    setEditReminderId(reminder.id);
  };

  // Format scheduled time for display
  const formatScheduledTime = (time) => {
    return format(new Date(time), "d MMM yyyy, HH:mm", { locale: it });
  };

  // Calculate if a reminder is due soon (within 15 minutes)
  const isDueSoon = (time) => {
    const now = new Date();
    const scheduledTime = new Date(time);
    const timeDiff = scheduledTime - now;
    return timeDiff > 0 && timeDiff <= 15 * 60 * 1000; // 15 minutes in milliseconds
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
      PaperProps={{ 
        sx: { 
          borderRadius: 2,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
        } 
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        bgcolor: 'primary.main',
        color: 'white',
        py: 2
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AlarmIcon />
          <Typography variant="h6">
            Gestione Reminder: {chatName}
          </Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ color: 'white' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ p: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}
        
        <Box component="form" onSubmit={handleSubmit} sx={{ mb: 4 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            {editMode ? 'Modifica Reminder' : 'Nuovo Reminder'}
          </Typography>
          
          <TextField
            fullWidth
            label="Messaggio del reminder"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            variant="outlined"
            margin="normal"
            placeholder="Scrivi il messaggio del reminder..."
            required
            disabled={isLoading}
          />
          
          <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={it}>
            <DateTimePicker
              label="Data e ora programmata"
              value={scheduledTime}
              onChange={setScheduledTime}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  fullWidth 
                  margin="normal" 
                  variant="outlined"
                  required
                  disabled={isLoading}
                />
              )}
              disablePast
              ampm={false}
              format="dd/MM/yyyy HH:mm"
              sx={{ width: '100%', mt: 2 }}
            />
          </LocalizationProvider>
          
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isLoading}
              startIcon={editMode ? <EditIcon /> : <AddIcon />}
            >
              {isLoading ? <CircularProgress size={24} /> : (editMode ? 'Aggiorna' : 'Aggiungi')}
            </Button>
            
            {editMode && (
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => {
                  setEditMode(false);
                  setEditReminderId(null);
                  setMessage('');
                  setScheduledTime(new Date(Date.now() + 30 * 60000));
                }}
              >
                Annulla modifica
              </Button>
            )}
          </Box>
        </Box>
        
        <Divider sx={{ my: 3 }} />
        
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <AccessTimeIcon color="primary" />
          Reminder Programmati
        </Typography>
        
        {isLoading && !reminders.length ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
            <CircularProgress />
          </Box>
        ) : reminders.length > 0 ? (
          <List>
            {reminders.map((reminder) => (
              <React.Fragment key={reminder.id}>
                <ListItem
                  secondaryAction={
                    <Box>
                      <Tooltip title="Modifica">
                        <IconButton 
                          edge="end" 
                          aria-label="edit"
                          onClick={() => handleEdit(reminder)}
                          sx={{ mr: 1 }}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Elimina">
                        <IconButton 
                          edge="end" 
                          aria-label="delete"
                          onClick={() => handleDelete(reminder.id)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                  sx={{ 
                    borderLeft: reminder.is_fired ? 
                      '4px solid #9e9e9e' : 
                      isDueSoon(reminder.scheduled_time) ? 
                        '4px solid #ff9800' : 
                        '4px solid #4caf50',
                    bgcolor: reminder.is_fired ? 
                      'rgba(0,0,0,0.05)' : 
                      isDueSoon(reminder.scheduled_time) ? 
                        'rgba(255,152,0,0.05)' : 
                        'rgba(76,175,80,0.05)',
                    mb: 1,
                    borderRadius: 1,
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Typography variant="body1" fontWeight="medium">
                          {reminder.message}
                        </Typography>
                        {reminder.is_fired && (
                          <Chip label="Inviato" size="small" color="default" />
                        )}
                        {!reminder.is_fired && isDueSoon(reminder.scheduled_time) && (
                          <Chip label="In arrivo" size="small" color="warning" />
                        )}
                        {!reminder.is_fired && !isDueSoon(reminder.scheduled_time) && (
                          <Chip label="Programmato" size="small" color="success" />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box sx={{ mt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                          Programmato per: {formatScheduledTime(reminder.scheduled_time)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Creato da: {reminder.created_by || 'Utente'} • 
                          {format(new Date(reminder.created_at), " d MMM yyyy, HH:mm", { locale: it })}
                        </Typography>
                      </Box>
                    }
                    sx={{ opacity: reminder.is_fired ? 0.7 : 1 }}
                  />
                </ListItem>
                <Divider component="li" />
              </React.Fragment>
            ))}
          </List>
        ) : (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body1" color="text.secondary">
              Nessun reminder programmato per questa chat.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Utilizza il form sopra per aggiungere un nuovo reminder.
            </Typography>
          </Box>
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} variant="outlined">
          Chiudi
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReminderDialog; 