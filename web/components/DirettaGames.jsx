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
  Tooltip
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

const DirettaGames = () => {
  const [games, setGames] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState('current'); // 'current', 'past' o 'future'
  const [gameDetails, setGameDetails] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});

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
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime() / 1000;
    
    return games.filter(game => game.timestamp >= startOfToday && game.timestamp <= endOfToday);
  };
  
  const getPastGames = () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    
    return games.filter(game => game.timestamp < startOfToday);
  };
  
  const getFutureGames = () => {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime() / 1000;
    
    return games.filter(game => game.timestamp > endOfToday);
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
      // Estrai le informazioni dalle stringhe LV÷{...}
      const parts = responseText.split('¬');
      
      for (const part of parts) {
        if (part.includes('PD-FN-')) {
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
      
      return details;
    } catch (error) {
      console.error('Errore durante il parsing dei dettagli:', error);
      return { error: 'Errore di parsing', raw: responseText };
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
  }, []);
  
  // Carica automaticamente i dettagli delle partite quando cambia la tab o vengono caricati nuovi dati
  useEffect(() => {
    if (games.length > 0 && isExpanded) {
      let gamesToFetch = [];
      
      if (activeTab === 'current') {
        gamesToFetch = getCurrentGames().slice(0, 5); // Limita a 5 partite per prestazioni
      } else if (activeTab === 'past') {
        gamesToFetch = getPastGames().slice(0, 5);
      } else if (activeTab === 'future') {
        gamesToFetch = getFutureGames().slice(0, 5);
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
      minWidth: isExpanded ? '300px' : '50px',
      maxWidth: isExpanded ? '300px' : '50px',
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

      <Collapse in={isExpanded} orientation="horizontal" sx={{ width: '100%', height: '100%' }}>
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
                  }}>Tipo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activeTab === 'current' && getCurrentGames().map((game, index) => (
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
                    <TableCell>{game.isDuel ? 'Duel' : 'Altro'}</TableCell>
                  </TableRow>
                ))}
                
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
                    <TableCell>{game.isDuel ? 'Duel' : 'Altro'}</TableCell>
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
                    </TableCell>
                    <TableCell>{game.date}</TableCell>
                    <TableCell>{game.isDuel ? 'Duel' : 'Altro'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          
          {/* Visualizzazione dei dettagli della partita */}
          {Object.keys(gameDetails).length > 0 && (
            <Box sx={{ 
              p: 2, 
              borderTop: 1, 
              borderColor: 'divider',
              maxHeight: '30%',
              overflow: 'auto'
            }}>
              <Typography variant="subtitle1" fontWeight="bold">
                Dettagli Partite
              </Typography>
              
              {Object.entries(gameDetails).map(([gameId, details]) => (
                <Box 
                  key={gameId} 
                  sx={{ 
                    mt: 1, 
                    p: 1, 
                    borderRadius: 1, 
                    bgcolor: 'background.paper',
                    boxShadow: 1
                  }}
                >
                  <Typography variant="subtitle2" fontWeight="bold">
                    {gameId}
                  </Typography>
                  
                  {details.error ? (
                    <Typography color="error" variant="body2">
                      {details.error}
                    </Typography>
                  ) : (
                    <>
                      {details.teams.length > 0 && (
                        <Typography variant="body2">
                          <strong>Squadre:</strong> {details.teams.join(' vs ')}
                        </Typography>
                      )}
                      
                      {details.league && (
                        <Typography variant="body2">
                          <strong>Competizione:</strong> {details.league}
                        </Typography>
                      )}
                      
                      {details.country && (
                        <Typography variant="body2">
                          <strong>Paese:</strong> {details.country}
                        </Typography>
                      )}
                      
                      {details.timestamp && (
                        <Typography variant="body2">
                          <strong>Timestamp:</strong> {formatDate(details.timestamp * 1000)}
                        </Typography>
                      )}
                    </>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default DirettaGames;
