import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Box
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

function NotePopup({ 
  open, 
  onClose, 
  note, 
  onChange, 
  onSave,
  position 
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        style: {
          position: 'absolute',
          left: position.x,
          top: position.y,
          margin: 0
        }
      }}
    >
      <DialogTitle>
        Aggiungi nota
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
      <DialogContent>
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
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button 
          onClick={onSave}
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
