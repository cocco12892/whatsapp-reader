import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Button, 
  Dialog, 
  DialogTitle, 
  DialogContent,
  Typography,
  IconButton,
  Card,
  CardContent,
  Chip,
  Divider,
  TextField,
  Tooltip,
  DialogActions,
  Alert
} from '@mui/material';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import CloseIcon from '@mui/icons-material/Close';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import EditNoteIcon from '@mui/icons-material/EditNote';

const DuplicateImageFinder = ({ chats }) => {
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [currentNote, setCurrentNote] = useState('');
  const [syncWithDuplicates, setSyncWithDuplicates] = useState(true);
  const [messageNotes, setMessageNotes] = useState({});

  const checkIndividualImageNotes = (imageId) => {
    if (!imageId) return;
    
    fetch(`/api/messages/${imageId}/note`)
      .then(response => {
        if (response.ok) {
          // La nota esiste
          return response.json().then(noteData => {
            // Aggiorna UI per mostrare la nota
            const noteContainer = document.getElementById(`note-container-${imageId}`);
            const noteContent = document.getElementById(`note-content-${imageId}`);
            
            if (noteContainer && noteContent) {
              noteContainer.style.display = 'block';
              noteContent.textContent = noteData.note || '';
              
              // Aggiorna anche lo stato locale
              setMessageNotes(prev => ({
                ...prev,
                [imageId]: noteData
              }));
            }
          });
        } else if (response.status === 404) {
          // La nota non esiste
          const noteContainer = document.getElementById(`note-container-${imageId}`);
          if (noteContainer) {
            noteContainer.style.display = 'none';
          }
        }
      })
      .catch(error => {
        console.error(`Errore nella verifica della nota per l'immagine ${imageId}:`, error);
      });
  };

  
  // Carica le note dal database
  useEffect(() => {
    if (open) {
      // Invece di fare una singola chiamata per tutte le note,
      // verifichiamo ogni immagine individualmente
      duplicates.forEach(group => {
        group.images.forEach(image => {
          if (image.id) {
            checkIndividualImageNotes(image.id);
          }
        });
      });
    }
  }, [open, duplicates]);

  // Aggiungi questa funzione per gestire l'aggiunta/modifica di note per singola immagine
  const handleSingleImageNote = (image) => {
    if (!image || !image.id) return;
    
    fetch(`/api/messages/${image.id}/note`)
      .then(response => {
        if (response.ok) {
          // La nota esiste
          return response.json().then(noteData => {
            const existingNote = noteData.note || '';
            const updatedNote = prompt("Modifica nota per questa immagine:", existingNote);
            
            if (updatedNote !== null) { // L'utente non ha premuto Annulla
              saveSingleImageNote(image, updatedNote, true);
            }
          });
        } else if (response.status === 404) {
          // La nota non esiste
          const newNote = prompt("Inserisci una nota per questa immagine:");
          if (newNote) {
            saveSingleImageNote(image, newNote, false);
          }
        } else {
          console.error("Errore nel controllo della nota:", response.status);
          // Fallback
          const note = prompt("Inserisci una nota per questa immagine:");
          if (note) {
            saveSingleImageNote(image, note, false);
          }
        }
      })
      .catch(error => {
        console.error("Errore nella verifica della nota:", error);
        // Fallback
        const note = prompt("Inserisci una nota per questa immagine:");
        if (note) {
          saveSingleImageNote(image, note, false);
        }
      });
  };

  // Funzione per salvare la nota di una singola immagine
  const saveSingleImageNote = (image, note, isUpdate) => {
    if (!image || !image.id || !note) return;
    
    // Prepara i dati della nota
    const noteData = {
      note: note,
      type: 'nota',
      chatId: image.chatId || '',
      chatName: image.chatName || 'Chat sconosciuta',
      addedAt: new Date().toISOString(),
      fromDuplicateGroup: false,
      imageHash: image.imageHash
    };
    
    // Invia la nota al server
    fetch(`/api/messages/${image.id}/note`, {
      method: 'POST', // Usiamo sempre POST perché il backend gestisce sia l'inserimento che l'aggiornamento
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(noteData),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Errore nel salvataggio della nota per il messaggio ${image.id}`);
      }
      return response.json();
    })
    .then(() => {
      console.log('Nota salvata con successo');
      
      // Aggiorna l'interfaccia utente
      const noteContainer = document.getElementById(`note-container-${image.id}`);
      const noteContent = document.getElementById(`note-content-${image.id}`);
      
      if (noteContainer && noteContent) {
        noteContainer.style.display = 'block';
        noteContent.textContent = note;
      }
      
      // Aggiorna lo stato delle note
      checkIndividualImageNotes(image.id);
    })
    .catch(error => {
      console.error('Errore nel salvataggio della nota:', error);
      alert('Si è verificato un errore nel salvataggio della nota');
    });
  };
  
  // Funzione per verificare se un gruppo ha note
  const checkGroupHasNotes = (group) => {
    if (!group || !Array.isArray(group)) return false;
    return group.some(image => image.id && messageNotes[image.id]);
  };
  
  // Funzione per ottenere la nota di un gruppo
  const getGroupNote = (group) => {
    if (!group || !Array.isArray(group)) return '';
    
    // Trova la prima immagine con una nota
    const imageWithNote = group.find(image => image.id && messageNotes[image.id]);
    if (imageWithNote && messageNotes[imageWithNote.id]) {
      return messageNotes[imageWithNote.id].note || '';
    }
    return '';
  };

  const handleOpen = () => {
    setOpen(true);
    findDuplicateImages();
  };

  const handleClose = () => {
    setOpen(false);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
  };

  const findDuplicateImages = () => {
    setLoading(true);
    
    // Raccogliamo tutte le immagini da tutte le chat
    const allImages = [];
    if (!chats || !Array.isArray(chats)) {
      setLoading(false);
      return;
    }
    
    chats.forEach(chat => {
      chat.messages.forEach(message => {
        if (message.isMedia && message.mediaPath && message.imageHash) {
          allImages.push({
            ...message,
            chatId: chat.id,
            chatName: chat.name
          });
        }
      });
    });
  
    // Raggruppiamo per hash e troviamo i duplicati
    const hashGroups = {};
    allImages.forEach(image => {
      if (!hashGroups[image.imageHash]) {
        hashGroups[image.imageHash] = [];
      }
      hashGroups[image.imageHash].push(image);
    });
  
    // Prepara le note dai vari storage
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
  
    // Processa i gruppi di duplicati
    const processedDuplicates = Object.entries(hashGroups)
      .filter(([_, group]) => group.length > 1)
      .map(([imageHash, group], groupIndex) => {
        // Ordina il gruppo per timestamp più recente
        const sortedGroup = group.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
  
        // Trova note individuali per ogni immagine
        const imagesWithNotes = sortedGroup.map(image => ({
          ...image,
          note: messageNotes[image.ID] || '',
          groupNoteKey: `${imageHash}_${groupIndex}`
        }));
  
        // Trova la nota di gruppo per questo hash
        const groupNoteKey = `${imageHash}_${groupIndex}`;
  
        return {
          imageHash,
          groupIndex,
          images: imagesWithNotes,
          hasNotes: imagesWithNotes.some(img => img.note)
        };
      })
      // Ordina per numero di immagini e poi per timestamp più recente
      .sort((a, b) => {
        if (b.images.length !== a.images.length) {
          return b.images.length - a.images.length;
        }
        return new Date(b.images[0].timestamp) - new Date(a.images[0].timestamp);
      });
  
    setDuplicates(processedDuplicates);
    setLoading(false);
  };

  // Calcola la differenza di tempo tra due messaggi in minuti
  const getTimeDifference = (timestamp1, timestamp2) => {
    const date1 = new Date(timestamp1);
    const date2 = new Date(timestamp2);
    return Math.abs(date1 - date2) / (1000 * 60); // Differenza in minuti
  };

  // Handle opening the note dialog for a group
  const handleOpenNoteDialog = (group) => {
    // Verifica se esiste già una nota per questo gruppo
    const firstImageWithId = group.find(img => img.id);
    if (!firstImageWithId) {
      alert("Nessun messaggio valido trovato nel gruppo");
      return;
    }
    
    // Controlla se esiste già una nota per questo messaggio
    fetch(`/api/messages/${firstImageWithId.id}/note`)
      .then(response => {
        // Se la nota esiste, ottieni il suo contenuto
        if (response.ok) {
          return response.json().then(noteData => {
            const existingNote = noteData.note;
            const updatedNote = prompt("Modifica la nota per il gruppo di messaggi:", existingNote);
            
            if (updatedNote !== null) { // L'utente non ha premuto Annulla
              saveGroupNote(group, updatedNote, true);
            }
          });
        } else if (response.status === 404) {
          // Se la nota non esiste, chiedi di crearne una nuova
          const newNote = prompt("Inserisci una nota per il gruppo di messaggi:");
          if (newNote) {
            saveGroupNote(group, newNote, false);
          }
        } else {
          console.error("Errore nel controllo della nota:", response.status);
          // Fallback al comportamento precedente
          const note = prompt("Inserisci una nota per il gruppo di messaggi:");
          if (note) {
            saveGroupNote(group, note, false);
          }
        }
      })
      .catch(error => {
        console.error("Errore nella verifica della nota:", error);
        // Fallback al comportamento precedente
        const note = prompt("Inserisci una nota per il gruppo di messaggi:");
        if (note) {
          saveGroupNote(group, note, false);
        }
      });
  };
  
  // Funzione per salvare la nota di gruppo
  const saveGroupNote = (group, note, isUpdate) => {
    if (!group || !Array.isArray(group) || !note) return;
    
    const groupId = `group_${Date.now()}`;
    
    // Crea un array di promesse per salvare ogni nota nel database
    const savePromises = group.map(image => {
      if (image.id) {
        console.log(`ID messaggio: ${image.id}`); // Stampa l'ID del messaggio
        
        // Prepara i dati della nota
        const noteData = {
          note: note,
          type: 'nota',
          chatId: image.chatId || '',
          chatName: image.chatName || 'Chat sconosciuta',
          addedAt: new Date().toISOString(),
          fromDuplicateGroup: true,
          groupId: groupId,
          imageHash: image.imageHash
        };
        
        // Invia la nota al server
        return fetch(`/api/messages/${image.id}/note`, {
          method: 'POST', // Usiamo sempre POST perché il backend gestisce sia l'inserimento che l'aggiornamento
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(noteData),
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Errore nel salvataggio della nota per il messaggio ${image.id}`);
          }
          return response.json();
        });
      }
      return Promise.resolve(); // Per i messaggi senza ID
    });
      
      // Esegui tutte le promesse
      Promise.all(savePromises)
        .then(() => {
          console.log('Tutte le note del gruppo salvate con successo');
          
          // Aggiorna lo stato UI
          setDuplicates(prev =>
            prev.map(g => ({
              ...g,
              images: g.images.map(img => ({
                ...img,
                note: group.some(gImg => gImg.id === img.id) ? note : img.note
              }))
            }))
          );
          
          // Aggiorna l'interfaccia utente per mostrare le note
          group.forEach(image => {
            if (image.id) {
              const noteContainer = document.getElementById(`note-container-${image.id}`);
              const noteContent = document.getElementById(`note-content-${image.id}`);
              
              if (noteContainer && noteContent) {
                noteContainer.style.display = 'block';
                noteContent.textContent = note;
              }
            }
          });
          
          // Aggiorna anche lo stato delle note
          fetch('/api/notes')
            .then(response => {
              if (!response.ok) {
                console.warn(`API notes non disponibile: ${response.status}`);
                return {};
              }
              return response.json();
            })
            .then(notes => {
              setMessageNotes(notes);
            })
            .catch(error => {
              console.error('Errore nel caricamento delle note:', error);
            });
        })
        .catch(error => {
          console.error('Errore nel salvataggio delle note di gruppo:', error);
          alert('Si è verificato un errore nel salvataggio delle note di gruppo');
        });
    }

  // Handle saving the note for the entire group
  const handleSaveNote = () => {
    if (!currentGroup) return;
    
    const messageNotes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    const duplicateImageGroupNotes = JSON.parse(localStorage.getItem('duplicateImageGroupNotes') || '{}');
    
    // Salva la nota per tutti i messaggi del gruppo
    currentGroup.images.forEach(image => {
      if (syncWithDuplicates) {
        messageNotes[image.ID] = currentNote;
      }
    });

    // Salva anche la nota di gruppo
    if (currentGroup.images[0]?.imageHash) {
      const groupKey = `${currentGroup.images[0].imageHash}_${currentGroup.groupIndex}`;
      duplicateImageGroupNotes[groupKey] = currentNote;
    }

    // Aggiorna lo storage
    localStorage.setItem('messageNotes', JSON.stringify(messageNotes));
    localStorage.setItem('duplicateImageGroupNotes', JSON.stringify(duplicateImageGroupNotes));
    
    // Aggiorna lo stato UI
    setDuplicates(prev => 
      prev.map(group => ({
        ...group,
        images: group.images.map(img => ({
          ...img,
          note: currentGroup.images.some(gImg => gImg.ID === img.ID) ? currentNote : img.note
        }))
      }))
    );
    
    setNoteDialogOpen(false);
  };
  
  return (
    <>
      <Button 
        variant="outlined" 
        startIcon={<FindReplaceIcon />} 
        onClick={handleOpen}
        sx={{ m: 2 }}
      >
        Trova immagini duplicate
      </Button>
  
      <Dialog 
        open={open} 
        onClose={handleClose}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Immagini duplicate trovate: {duplicates.length} gruppi</span>
          <IconButton onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {loading ? (
            <Typography>Ricerca duplicati in corso...</Typography>
          ) : duplicates.length === 0 ? (
            <Typography>Nessuna immagine duplicata trovata.</Typography>
          ) : (
            duplicates.map((duplicateGroup, groupIndex) => {
              const group = duplicateGroup.images || [];
              const groupHash = group[0].imageHash;              
              
              return (
                <Card key={groupIndex} sx={{ mb: 3, overflow: 'visible' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle1">
                          Gruppo #{groupIndex + 1} - Trovate {group.length} copie
                        </Typography>
                      </Box>
                      <Button
                        variant="outlined"
                        startIcon={checkGroupHasNotes(group) ? <EditNoteIcon /> : <NoteAddIcon />}
                        onClick={() => handleOpenNoteDialog(group)}
                        size="small"
                      >
                        {checkGroupHasNotes(group) ? 'Modifica nota gruppo' : 'Aggiungi nota gruppo'}
                      </Button>
                    </Box>
                    
                    {/* Prima immagine come riferimento */}
                    <Box sx={{ display: 'flex', mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Box sx={{ mr: 2, flexBasis: '150px', flexShrink: 0 }}>
                        <img 
                          src={`http://localhost:8080${group[0].mediaPath}`} 
                          alt="Immagine duplicata"
                          style={{ 
                            width: '100%', 
                            borderRadius: '4px',
                            border: '2px solid #128C7E'
                          }} 
                        />
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          Hash: {group[0].imageHash.substring(0, 25)}...
                        </Typography>
                        
                        <Box sx={{ mt: 1 }}>
                          {group.map((image, imageIndex) => (
                            <Chip 
                              key={imageIndex}
                              label={`${image.chatName} - ${formatTime(image.timestamp)}`}
                              sx={{ m: 0.5 }}
                              color={"default"}
                            />
                          ))}
                        </Box>
                        
                        {/* Analisi temporale */}
                        {group.length > 1 && (
                          <Box sx={{ mt: 2 }}>
                            <Typography variant="caption">
                              Analisi temporale:
                            </Typography>
                            {group.slice(0, -1).map((image, idx) => {
                              const nextImage = group[idx + 1];
                              const timeDiff = getTimeDifference(image.timestamp, nextImage.timestamp);
                              return (
                                <Typography key={idx} variant="caption" display="block">
                                  Da {image.chatName} a {nextImage.chatName}: {timeDiff.toFixed(1)} minuti
                                </Typography>
                              );
                            })}
                          </Box>
                        )}
                      </Box>
                    </Box>
                    
                    <Divider sx={{ my: 2 }} />
                    
                    {/* Lista di tutte le occorrenze */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      {group.map((image, imageIndex) => {
                        // Verifica se c'è una nota per questa immagine
                        const hasNote = messageNotes[image.id] ? true : false;
                        
                        return (
                          <Box 
                            key={imageIndex} 
                            sx={{ 
                              width: 'calc(33% - 8px)',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              padding: '10px',
                              border: hasNote ? '3px solid #4caf50' : '1px solid #eee',
                              position: 'relative'
                            }}
                          >
                            {/* Verifica se c'è una nota per questa immagine */}
                            {image.id && (
                              <Box 
                                id={`note-container-${image.id}`} 
                                sx={{ 
                                  mb: 1, 
                                  p: 1, 
                                  bgcolor: 'rgba(103, 58, 183, 0.1)', 
                                  borderRadius: '4px', 
                                  borderLeft: '4px solid #673ab7',
                                  position: 'relative',
                                  display: 'none' // Inizialmente nascosto, verrà mostrato se c'è una nota
                                }}
                              >
                                <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#4a148c' }}>
                                  Nota:
                                </Typography>
                                <Typography 
                                  variant="body2" 
                                  sx={{ fontWeight: 'medium' }}
                                  id={`note-content-${image.id}`}
                                >
                                  Caricamento...
                                </Typography>
                              </Box>
                            )}
                            <img 
                              src={`http://localhost:8080${image.mediaPath}`} 
                              alt={`Occorrenza #${imageIndex + 1}`}
                              style={{ width: '100%' }} 
                            />
                            <Box sx={{ p: 1, bgcolor: 'rgba(0,0,0,0.03)' }}>
                              <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                                Chat: {image.chatName}
                              </Typography>
                              <Typography variant="caption" display="block">
                                Inviato da: {image.senderName}
                              </Typography>
                              
                              {/* Pulsante per aggiungere/modificare nota individuale */}
                              <Button
                                variant="text"
                                size="small"
                                startIcon={hasNote ? <EditNoteIcon /> : <NoteAddIcon />}
                                onClick={() => handleSingleImageNote(image)}
                                sx={{ mt: 1, fontSize: '0.75rem' }}
                              >
                                {hasNote ? 'Modifica nota' : 'Aggiungi nota'}
                              </Button>
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </CardContent>
                </Card>
              );
            })
          )}
        </DialogContent>
      </Dialog>
  
    </>
  );
};
  
  export default DuplicateImageFinder;
