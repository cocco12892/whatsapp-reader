import React, { useState, useEffect } from 'react';
import { 
  Paper, 
  Typography, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow, 
  IconButton,
  Box,
  Button,
  Collapse,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AlarmIcon from '@mui/icons-material/Alarm';
import NotificationsIcon from '@mui/icons-material/Notifications';

const DirettaGames = () => {
  const [games, setGames] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [activeTab, setActiveTab] = useState('current'); // 'current', 'past' o 'future'
  const [gameDetails, setGameDetails] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});
  
  // Stati per il dialog del promemoria
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [reminderTime, setReminderTime] = useState('');
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderType, setReminderType] = useState('before');
  const [reminderMinutes, setReminderMinutes] = useState(30);
  
  // Stato per i promemoria salvati
  const [savedReminders, setSavedReminders] = useState([]);

  const fetchGames = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch("https://lsid.eu/v4/getdata", {
        method: 'POST',
        headers: {
          "accept": "*/*",
          "accept-encoding": "gzip, deflate, br, zstd",
          "accept-language": "en-US,en;q=0.9,it;q=0.8",
          "content-type": "application/json",
          "origin": "https://www.diretta.it",
          "referer": "https://www.diretta.it/",
          "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"134\"",
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": "\"macOS\"",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
        },
        body: JSON.stringify({
          "loggedIn": {
            "id": "6196204e1b3bb65121e72e4e",
            "hash": "e1c5aeafa8993ffbbf27131803eacc2662ccae30"
          },
          "project": 400
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data.data && data.data.mygames && data.data.mygames.data) {
        // Trasforma l'oggetto in un array di oggetti
        const gamesArray = Object.entries(data.data.mygames.data).map(([id, gameData]) => {
          return {
            id,
            timestamp: gameData.AD,
            date: formatDate(gameData.AD * 1000), // Converti timestamp in millisecondi
            isDuel: gameData.is_duel === 1,
            detailId: id.replace('g_1_', 'el_').replace('g_2_', 'el_').replace('g_3_', 'el_').replace('g_8_', 'el_')
          };
        });
        
        // Ordina per data
        gamesArray.sort((a, b) => a.timestamp - b.timestamp);
        
        setGames(gamesArray);
      } else {
        throw new Error('Formato dati non valido');
      }
    } catch (err) {
      console.error('Errore nel recupero dei dati:', err);
      setError(`Errore: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return `${day}/${month} ${hours}:${minutes}`;
  };
  
  // Filtra le partite in base alla data corrente
  const getCurrentGames = () => {
    const now = new Date();
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime() / 1000;
    
    return games.filter(game => game.timestamp >= startOfToday && game.timestamp <= endOfToday);
  };
  
  const getPastGames = () => {
    const now = new Date();
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    
    return games.filter(game => game.timestamp < nowTimestamp);
  };
  
  const getFutureGames = () => {
    const now = new Date();
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    
    return games.filter(game => game.timestamp > nowTimestamp);
  };
  
  // Funzione per ottenere i dettagli di una partita
  const fetchGameDetails = async (game) => {
    if (gameDetails[game.id] || loadingDetails[game.id]) {
      return; // Evita di richiedere i dettagli se già presenti o in caricamento
    }
    
    setLoadingDetails(prev => ({ ...prev, [game.id]: true }));
    
    try {
      const response = await fetch(`https://400.flashscore.ninja/400/x/feed/${game.detailId}`, {
        method: 'GET',
        headers: {
          "accept": "*/*",
          "accept-encoding": "gzip, deflate, br, zstd",
          "accept-language": "en-US,en;q=0.9,it;q=0.8",
          "origin": "https://www.diretta.it",
          "referer": "https://www.diretta.it/",
          "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"134\"",
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": "\"macOS\"",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
          "x-fsign": "SW9D1eZo"
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.text();
      
      // Estrai le informazioni dalla risposta
      const parsedDetails = parseGameDetails(data, game.id);
      
      setGameDetails(prev => ({
        ...prev,
        [game.id]: parsedDetails
      }));
    } catch (err) {
      console.error(`Errore nel recupero dei dettagli per ${game.id}:`, err);
    } finally {
      setLoadingDetails(prev => ({ ...prev, [game.id]: false }));
    }
  };
  
  // Funzione per caricare i dettagli di più partite in batch
  const fetchMultipleGameDetails = async (gamesToFetch) => {
    // Limita il numero di richieste simultanee per evitare sovraccarichi
    const batchSize = 3;
    const batches = [];
    
    // Dividi le partite in batch
    for (let i = 0; i < gamesToFetch.length; i += batchSize) {
      batches.push(gamesToFetch.slice(i, i + batchSize));
    }
    
    // Processa ogni batch in sequenza
    for (const batch of batches) {
      // Avvia tutte le richieste del batch in parallelo
      await Promise.all(batch.map(game => fetchGameDetails(game)));
      
      // Piccola pausa tra i batch per evitare rate limiting
      if (batches.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  };
  
  // Funzione per analizzare la risposta dell'API
  const parseGameDetails = (responseText, gameId) => {
    const details = {
      teams: [],
      league: '',
      country: '',
      timestamp: ''
    };
    
    try {
      // Extract information from LV÷{...} strings
      const parts = responseText.split('¬');
      
      for (const part of parts) {
        // Check for multiple possible player/team name formats
        if (part.includes('PD-FN-') || part.includes('PD-FNWC-')) {
          const teamName = part.split('}_')[1];
          if (teamName && !details.teams.includes(teamName)) {
            details.teams.push(teamName);
          }
        } else if (part.includes('EL-TN-')) {
          details.league = part.split('}_')[1];
        } else if (part.includes('EL-TK-')) {
          details.country = part.split('}_')[1];
        } else if (part.includes('EL-EH-')) {
          const timestampPart = part.split('}_')[1];
          if (timestampPart && timestampPart.includes('|')) {
            details.timestamp = timestampPart.split('|')[0];
          }
        }
      }
      
      // For doubles matches, arrange players into teams
      if (details.teams.length === 4 && (gameId.includes('_DOPPIO') || responseText.includes('DOPPIO'))) {
        // Group into two teams of doubles partners
        const team1 = `${details.teams[0]}/${details.teams[1]}`;
        const team2 = `${details.teams[2]}/${details.teams[3]}`;
        details.teams = [team1, team2];
      }
      
      return details;
    } catch (error) {
      console.error('Error parsing details:', error);
      return { error: 'Parsing error', raw: responseText };
    }
  };

  // Carica i dati all'avvio e imposta lo stato di espansione
  useEffect(() => {
    fetchGames();
    
    // Carica lo stato di espansione dal localStorage se disponibile
    const savedExpandedState = localStorage.getItem('direttaGamesExpanded');
    if (savedExpandedState !== null) {
      setIsExpanded(savedExpandedState === 'true');
    }
    
    // Carica lo stato di pausa dal localStorage se disponibile
    const savedPausedState = localStorage.getItem('direttaGamesPaused');
    if (savedPausedState !== null) {
      setIsPaused(savedPausedState === 'true');
    }
  }, []);
  
  // Carica automaticamente i dettagli delle partite quando cambia la tab o vengono caricati nuovi dati
  useEffect(() => {
    if (games.length > 0 && isExpanded) {
      let gamesToFetch = [];
      
      if (activeTab === 'current') {
        gamesToFetch = getCurrentGames().slice(0, 50); // Limita a 5 partite per prestazioni
      } else if (activeTab === 'past') {
        gamesToFetch = getPastGames().slice(0, 50);
      } else if (activeTab === 'future') {
        gamesToFetch = getFutureGames().slice(0, 50);
      }
      
      // Filtra solo le partite di cui non abbiamo già i dettagli
      const newGamesToFetch = gamesToFetch.filter(game => 
        !gameDetails[game.id] && !loadingDetails[game.id]
      );
      
      if (newGamesToFetch.length > 0) {
        fetchMultipleGameDetails(newGamesToFetch);
      }
    }
  }, [games, activeTab, isExpanded]);
  
  // Salva lo stato di espansione nel localStorage quando cambia
  useEffect(() => {
    localStorage.setItem('direttaGamesExpanded', isExpanded.toString());
  }, [isExpanded]);
  
  // Salva lo stato di pausa nel localStorage quando cambia
  useEffect(() => {
    localStorage.setItem('direttaGamesPaused', isPaused.toString());
  }, [isPaused]);
  
  // Imposta aggiornamento automatico ogni 30 secondi se non in pausa
  useEffect(() => {
    let intervalId;
    
    if (!isPaused) {
      intervalId = setInterval(() => {
        fetchGames();
      }, 30000); // 30 secondi
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPaused]);
  
  // Carica i promemoria salvati dal localStorage
  useEffect(() => {
    const savedRemindersData = localStorage.getItem('gameReminders');
    if (savedRemindersData) {
      try {
        const parsedReminders = JSON.parse(savedRemindersData);
        setSavedReminders(parsedReminders);
      } catch (e) {
        console.error('Errore nel parsing dei promemoria salvati:', e);
      }
    }
  }, []);
  
  // Controlla periodicamente se ci sono promemoria da inviare
  useEffect(() => {
    const checkRemindersInterval = setInterval(() => {
      checkAndSendReminders();
    }, 60000); // Controlla ogni minuto
    
    // Controlla anche all'avvio
    checkAndSendReminders();
    
    return () => {
      clearInterval(checkRemindersInterval);
    };
  }, [savedReminders]);
  
  // Funzione per controllare e inviare i promemoria
  const checkAndSendReminders = () => {
    const now = new Date();
    const remindersToSend = savedReminders.filter(reminder => {
      const reminderTime = new Date(reminder.triggerTime);
      return reminderTime <= now && !reminder.sent;
    });
    
    if (remindersToSend.length > 0) {
      remindersToSend.forEach(reminder => {
        sendReminderMessage(reminder);
      });
      
      // Aggiorna lo stato dei promemoria inviati
      const updatedReminders = savedReminders.map(reminder => {
        if (remindersToSend.some(r => r.id === reminder.id)) {
          return { ...reminder, sent: true };
        }
        return reminder;
      });
      
      setSavedReminders(updatedReminders);
      localStorage.setItem('gameReminders', JSON.stringify(updatedReminders));
    }
  };
  
  // Funzione per inviare il messaggio di promemoria
  const sendReminderMessage = async (reminder) => {
    try {
      const chatId = "393472195905@s.whatsapp.net";
      const messageData = {
        content: reminder.message || `⏰ Promemoria: ${reminder.gameTeams} - ${reminder.gameLeague} - ${new Date(reminder.gameTime).toLocaleString('it-IT')}`
      };
      
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData),
      });
      
      if (!response.ok) {
        throw new Error(`Errore nell'invio del promemoria: ${response.statusText}`);
      }
      
      console.log('Promemoria inviato con successo:', reminder);
    } catch (error) {
      console.error('Errore nell\'invio del promemoria:', error);
    }
  };
  
  // Funzione per aprire il dialog del promemoria
  const openReminderDialog = (game) => {
    setSelectedGame(game);
    
    // Imposta valori predefiniti
    const gameDate = new Date(game.timestamp * 1000);
    setReminderTime('');
    setReminderMessage('');
    setReminderType('before');
    setReminderMinutes(30);
    
    setReminderDialogOpen(true);
  };
  
  // Funzione per salvare un nuovo promemoria
  const saveReminder = () => {
    if (!selectedGame) return;
    
    const gameDate = new Date(selectedGame.timestamp * 1000);
    let triggerTime;
    
    if (reminderType === 'custom' && reminderTime) {
      // Usa l'orario personalizzato
      const [hours, minutes] = reminderTime.split(':').map(Number);
      triggerTime = new Date(gameDate);
      triggerTime.setHours(hours, minutes, 0, 0);
    } else if (reminderType === 'before') {
      // Calcola l'orario in base ai minuti prima della partita
      triggerTime = new Date(gameDate);
      triggerTime.setMinutes(triggerTime.getMinutes() - reminderMinutes);
    }
    
    // Se l'orario del promemoria è già passato, non salvare
    if (triggerTime < new Date()) {
      alert('L\'orario del promemoria è già passato. Scegli un orario futuro.');
      return;
    }
    
    const gameDetails = gameDetails[selectedGame.id] || {};
    const teams = gameDetails.teams || ['Squadra 1', 'Squadra 2'];
    const league = gameDetails.league || 'Competizione sconosciuta';
    
    const newReminder = {
      id: `reminder_${Date.now()}`,
      gameId: selectedGame.id,
      gameTime: gameDate.toISOString(),
      gameTeams: teams.join(' vs '),
      gameLeague: league,
      triggerTime: triggerTime.toISOString(),
      message: reminderMessage,
      created: new Date().toISOString(),
      sent: false
    };
    
    const updatedReminders = [...savedReminders, newReminder];
    setSavedReminders(updatedReminders);
    localStorage.setItem('gameReminders', JSON.stringify(updatedReminders));
    
    setReminderDialogOpen(false);
  };
  
  // Funzione per eliminare un promemoria
  const deleteReminder = (reminderId) => {
    const updatedReminders = savedReminders.filter(reminder => reminder.id !== reminderId);
    setSavedReminders(updatedReminders);
    localStorage.setItem('gameReminders', JSON.stringify(updatedReminders));
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <Paper sx={{ 
      width: 'auto',
      height: '80vh', 
      display: 'flex', 
      flexDirection: 'column',
      flex: '0 0 auto',
      borderRadius: 2,
      overflow: 'hidden',
      boxShadow: 3,
      // Animazione per transizione fluida della larghezza
      transition: 'all 0.3s ease-in-out',
      // Controlla la larghezza in base allo stato
      minWidth: isExpanded ? '500px' : '50px',
      maxWidth: isExpanded ? '1900px' : '50px',
    }}>
      <Box sx={{
        p: isExpanded ? 2 : 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'secondary.main',
        color: 'secondary.contrastText',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        transition: 'padding 0.3s ease'
      }}>
        {isExpanded ? (
          <>
            <Typography variant="h6">Diretta.it - Partite</Typography>
            <Box display="flex" alignItems="center">
              <IconButton 
                onClick={fetchGames} 
                color="inherit"
                title="Aggiorna dati"
                disabled={isLoading}
                size="small"
                sx={{ mr: 1 }}
              >
                <RefreshIcon />
              </IconButton>
              <Tooltip title={isPaused ? "Riprendi aggiornamenti" : "Metti in pausa"}>
                <IconButton 
                  onClick={() => setIsPaused(!isPaused)} 
                  color={isPaused ? "error" : "inherit"}
                  size="small"
                  sx={{ mr: 1 }}
                >
                  {isPaused ? <PlayArrowIcon /> : <PauseIcon />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Chiudi">
                <IconButton 
                  onClick={toggleExpanded} 
                  color="inherit"
                  size="small"
                >
                  <ChevronLeftIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </>
        ) : (
          <Tooltip title="Espandi Diretta.it">
            <IconButton 
              onClick={toggleExpanded} 
              color="inherit"
              size="small"
              sx={{ width: '100%' }}
            >
              <ChevronRightIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Collapse in={isExpanded} orientation="horizontal" sx={{ width: '100%', height: '100%', paddingBottom: '67px' }}>
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {error && (
            <Box sx={{ p: 2, color: 'error.main' }}>
              <Typography>{error}</Typography>
            </Box>
          )}
          
          {isLoading && !games.length && (
            <Box sx={{ p: 2 }}>
              <Typography>Caricamento dati...</Typography>
            </Box>
          )}
          
          {/* Tabs per selezionare partite correnti, passate o future */}
          <Box sx={{ 
            display: 'flex', 
            borderBottom: 1, 
            borderColor: 'divider',
            bgcolor: 'background.paper'
          }}>
            <Button 
              variant={activeTab === 'current' ? 'contained' : 'text'}
              onClick={() => setActiveTab('current')}
              sx={{ 
                flex: 1, 
                borderRadius: 0,
                py: 1
              }}
            >
              Oggi ({getCurrentGames().length})
            </Button>
            <Button 
              variant={activeTab === 'past' ? 'contained' : 'text'}
              onClick={() => setActiveTab('past')}
              sx={{ 
                flex: 1, 
                borderRadius: 0,
                py: 1
              }}
            >
              Passate ({getPastGames().length})
            </Button>
            <Button 
              variant={activeTab === 'future' ? 'contained' : 'text'}
              onClick={() => setActiveTab('future')}
              sx={{ 
                flex: 1, 
                borderRadius: 0,
                py: 1
              }}
            >
              Future ({getFutureGames().length})
            </Button>
          </Box>
          
          <TableContainer sx={{ 
            flex: 1, 
            overflowY: 'auto',
          }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'secondary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>ID</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'secondary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Data</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'secondary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Squadre</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'secondary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Competizione</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activeTab === 'current' && getCurrentGames().map((game, index) => {
                  const now = new Date();
                  const nowTimestamp = Math.floor(now.getTime() / 1000);
                  const isFutureGame = game.timestamp > nowTimestamp;
                  
                  return (
                    <TableRow 
                      key={index} 
                      hover 
                      sx={{ 
                        '&:nth-of-type(even)': { 
                          backgroundColor: 'action.hover' 
                        },
                        ...(gameDetails[game.id] ? { backgroundColor: 'rgba(25, 118, 210, 0.08)' } : {})
                      }}
                    >
                      <TableCell>
                        {game.id}
                        {loadingDetails[game.id] && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            Caricamento...
                          </Typography>
                        )}
                        {/* Indicatore di promemoria attivo */}
                        {savedReminders.some(r => r.gameId === game.id && !r.sent) && (
                          <Chip 
                            icon={<AlarmIcon fontSize="small" />} 
                            label="Promemoria" 
                            size="small" 
                            color="secondary" 
                            sx={{ mt: 0.5 }}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {game.date}
                        {isFutureGame && (
                          <IconButton 
                            size="small" 
                            color="primary" 
                            onClick={() => openReminderDialog(game)}
                            sx={{ ml: 1 }}
                            title="Imposta promemoria"
                          >
                            <NotificationsIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                      <TableCell>
                        {gameDetails[game.id] && gameDetails[game.id].teams && gameDetails[game.id].teams.length > 0 
                          ? gameDetails[game.id].teams.join(' vs ') 
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {gameDetails[game.id] && gameDetails[game.id].league 
                          ? `${gameDetails[game.id].country}: ${gameDetails[game.id].league}` 
                          : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                
                {activeTab === 'past' && getPastGames().map((game, index) => (
                  <TableRow 
                    key={index} 
                    hover 
                    sx={{ 
                      '&:nth-of-type(even)': { 
                        backgroundColor: 'action.hover' 
                      },
                      ...(gameDetails[game.id] ? { backgroundColor: 'rgba(25, 118, 210, 0.08)' } : {})
                    }}
                  >
                    <TableCell>
                      {game.id}
                      {loadingDetails[game.id] && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Caricamento...
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{game.date}</TableCell>
                    <TableCell>
                      {gameDetails[game.id] && gameDetails[game.id].teams && gameDetails[game.id].teams.length > 0 
                        ? gameDetails[game.id].teams.join(' vs ') 
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {gameDetails[game.id] && gameDetails[game.id].league 
                        ? `${gameDetails[game.id].country}: ${gameDetails[game.id].league}` 
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
                
                {activeTab === 'future' && getFutureGames().map((game, index) => (
                  <TableRow 
                    key={index} 
                    hover 
                    sx={{ 
                      '&:nth-of-type(even)': { 
                        backgroundColor: 'action.hover' 
                      },
                      ...(gameDetails[game.id] ? { backgroundColor: 'rgba(25, 118, 210, 0.08)' } : {})
                    }}
                  >
                    <TableCell>
                      {game.id}
                      {loadingDetails[game.id] && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Caricamento...
                        </Typography>
                      )}
                      {/* Indicatore di promemoria attivo */}
                      {savedReminders.some(r => r.gameId === game.id && !r.sent) && (
                        <Chip 
                          icon={<AlarmIcon fontSize="small" />} 
                          label="Promemoria" 
                          size="small" 
                          color="secondary" 
                          sx={{ mt: 0.5 }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {game.date}
                      <IconButton 
                        size="small" 
                        color="primary" 
                        onClick={() => openReminderDialog(game)}
                        sx={{ ml: 1 }}
                        title="Imposta promemoria"
                      >
                        <NotificationsIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      {gameDetails[game.id] && gameDetails[game.id].teams && gameDetails[game.id].teams.length > 0 
                        ? gameDetails[game.id].teams.join(' vs ') 
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {gameDetails[game.id] && gameDetails[game.id].league 
                        ? `${gameDetails[game.id].country}: ${gameDetails[game.id].league}` 
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          
          {/* Sezione promemoria attivi */}
          {(activeTab === 'future' || activeTab === 'current') && savedReminders.filter(r => !r.sent).length > 0 && (
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
                Promemoria attivi
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {savedReminders
                  .filter(r => !r.sent)
                  .map(reminder => (
                    <Chip
                      key={reminder.id}
                      label={`${reminder.gameTeams} - ${new Date(reminder.triggerTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                      onDelete={() => deleteReminder(reminder.id)}
                      color="primary"
                      variant="outlined"
                      icon={<AlarmIcon />}
                    />
                  ))}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
      
      {/* Dialog per impostare un promemoria */}
      <Dialog 
        open={reminderDialogOpen} 
        onClose={() => setReminderDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Imposta promemoria per la partita
        </DialogTitle>
        <DialogContent>
          {selectedGame && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                {gameDetails[selectedGame.id]?.teams?.join(' vs ') || 'Partita'}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {new Date(selectedGame.timestamp * 1000).toLocaleString('it-IT')}
              </Typography>
              
              <Box sx={{ mt: 3 }}>
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Tipo di promemoria</InputLabel>
                  <Select
                    value={reminderType}
                    onChange={(e) => setReminderType(e.target.value)}
                    label="Tipo di promemoria"
                  >
                    <MenuItem value="before">Minuti prima della partita</MenuItem>
                    <MenuItem value="custom">Orario specifico</MenuItem>
                  </Select>
                </FormControl>
                
                {reminderType === 'before' ? (
                  <TextField
                    fullWidth
                    label="Minuti prima"
                    type="number"
                    value={reminderMinutes}
                    onChange={(e) => setReminderMinutes(parseInt(e.target.value) || 30)}
                    InputProps={{ inputProps: { min: 1, max: 1440 } }}
                    sx={{ mb: 2 }}
                  />
                ) : (
                  <TextField
                    fullWidth
                    label="Orario del promemoria"
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ mb: 2 }}
                  />
                )}
                
                <TextField
                  fullWidth
                  label="Messaggio personalizzato (opzionale)"
                  multiline
                  rows={3}
                  value={reminderMessage}
                  onChange={(e) => setReminderMessage(e.target.value)}
                  placeholder="Lascia vuoto per un messaggio standard"
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReminderDialogOpen(false)}>Annulla</Button>
          <Button 
            onClick={saveReminder} 
            variant="contained" 
            color="primary"
            disabled={reminderType === 'custom' && !reminderTime}
          >
            Salva promemoria
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default DirettaGames;
