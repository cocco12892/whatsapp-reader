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

const BotSalvatore = () => {
  const [token, setToken] = useState(null);
  const [bettingData, setBettingData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const LOGIN_URL = "https://tennisbestingbet.info:48634/LOGIN";
  
  // Costruisce URL con la data di oggi
  const getTodayHistoryUrl = () => {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));
    
    return `https://tennisbestingbet.info:48634/PLAY_CONTAINER/GET_HISTORY?from=${encodeURIComponent(startOfDay.toString())}&to=${encodeURIComponent(endOfDay.toString())}`;
  };

  // Costruisce URL per ottenere le giocate di un container
  const getPlaysUrl = (containerId) => {
    return `https://tennisbestingbet.info:48634/PLAY_CONTAINER/GET_PLAYS?id=${containerId}`;
  };

  const login = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Clear any existing token
      localStorage.removeItem('salvatore_bot_token');
      
      // Login with hardcoded credentials
      const response = await fetch(`${LOGIN_URL}?username=tennis&password=ten10-`, {
        method: 'GET'
      });
      
      const data = await response.json();
      
      if (data.token) {
        localStorage.setItem('salvatore_bot_token', data.token);
        setToken(data.token);
        fetchBettingHistory(data.token);
      } else {
        throw new Error('No token received');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Calcola la quota ponderata
  const calculateWeightedOdds = (plays) => {
    if (!plays || plays.length === 0) return 0;
    
    let totalAmount = 0;
    let weightedSum = 0;
    
    plays.forEach(play => {
      totalAmount += play.realPlay;
      weightedSum += play.realPlay * play.realMultiplier;
    });
    
    return totalAmount > 0 ? (weightedSum / totalAmount) : 0;
  };

  const fetchBettingHistory = async (currentToken = null) => {
    setIsLoading(true);
    setError(null);
    
    // Use provided token or get from state/storage
    const useToken = currentToken || token || localStorage.getItem('salvatore_bot_token');
    
    if (!useToken) {
      setError('Not logged in');
      setIsLoading(false);
      return;
    }

    try {
      console.log('Using token:', useToken); // Debug log
      
      // Usa l'URL con la data di oggi
      const historyUrl = getTodayHistoryUrl();
      console.log('Fetching data from:', historyUrl);
      
      const response = await fetch(historyUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${useToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
      }

      const containers = await response.json();
      
      // Fetch giocate per ogni container
      const containersWithPlays = await Promise.all(
        containers.map(async (container) => {
          try {
            const playsUrl = getPlaysUrl(container._id);
            const playsResponse = await fetch(playsUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${useToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              }
            });
            
            if (!playsResponse.ok) {
              console.error(`Failed to fetch plays for container ${container._id}`);
              return { ...container, plays: [] };
            }
            
            const plays = await playsResponse.json();
            return { ...container, plays };
          } catch (err) {
            console.error(`Error fetching plays for container ${container._id}:`, err);
            return { ...container, plays: [] };
          }
        })
      );
      
      // Format and transform data with quota ponderata
      const processedData = containersWithPlays.map(container => {
        // Create a date object from the startDate
        const date = new Date(container.startDate);
        
        // Format the date as DD/MM HH:MM
        const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

        // Calcola quota ponderata
        const weightedOdds = calculateWeightedOdds(container.plays);
        const formattedOdds = container.event.minOdds.toString().replace('.', ',');
        const formattedWeightedOdds = weightedOdds.toFixed(2).replace('.', ',');

        return {
          id: container._id,
          startDate: formattedDate,
          eventName: container.event.eventName + ' ' + container.event.prono,
          minOdds: formattedOdds,
          weightedOdds: formattedWeightedOdds,
          totalPlayed: container.totalPlayed,
          playsCount: container.plays ? container.plays.length : 0
        };
      });

      setBettingData(processedData);
    } catch (err) {
      console.error('Error fetching betting history:', err);
      setError('Failed to fetch betting data. Please login again.');
      // Clear token if request failed
      localStorage.removeItem('salvatore_bot_token');
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Check for existing token on component mount
  useEffect(() => {
    const savedToken = localStorage.getItem('salvatore_bot_token');
    if (savedToken) {
      setToken(savedToken);
      fetchBettingHistory(savedToken);
    }
    
    // Load expanded state from localStorage if available
    const savedExpandedState = localStorage.getItem('botSalvatoreExpanded');
    if (savedExpandedState !== null) {
      setIsExpanded(savedExpandedState === 'true');
    }
  }, []);
  
  // Save expanded state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('botSalvatoreExpanded', isExpanded.toString());
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
      minWidth: isExpanded ? '500px' : '50px',
      maxWidth: isExpanded ? '500px' : '50px',
    }}>
      <Box sx={{
        p: isExpanded ? 2 : 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'tertiary.main',
        color: 'tertiary.contrastText',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        transition: 'padding 0.3s ease'
      }}>
        {isExpanded ? (
          <>
            <Typography variant="h6">Bot Salvatore - Oggi ({new Date().toLocaleDateString()})</Typography>
            <Box display="flex" alignItems="center">
              {!token ? (
                <Button 
                  onClick={login} 
                  variant="contained" 
                  color="secondary"
                  disabled={isLoading}
                  size="small"
                  sx={{ mr: 1 }}
                >
                  {isLoading ? '...' : 'Login'}
                </Button>
              ) : (
                <IconButton 
                  onClick={() => fetchBettingHistory()} 
                  color="inherit"
                  title="Aggiorna dati"
                  disabled={isLoading}
                  size="small"
                  sx={{ mr: 1 }}
                >
                  <RefreshIcon />
                </IconButton>
              )}
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
          <Tooltip title="Espandi Bot Salvatore">
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
          
          {isLoading && !bettingData.length && (
            <Box sx={{ p: 2 }}>
              <Typography>Caricamento dati...</Typography>
            </Box>
          )}
          
          <TableContainer sx={{ 
            flex: 1, 
            overflowY: 'auto',
          }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'tertiary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Data</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'tertiary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Evento</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'tertiary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Min</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'tertiary.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Totale Giocato</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bettingData.map((item, index) => (
                  <TableRow 
                    key={index} 
                    hover 
                    sx={{ 
                      '&:nth-of-type(even)': { 
                        backgroundColor: 'action.hover' 
                      } 
                    }}
                  >
                    <TableCell>{item.startDate}</TableCell>
                    <TableCell>{item.eventName}</TableCell>
                    <TableCell>min{item.minOdds}</TableCell>
                <TableCell sx={{ textAlign: 'center' }}>{item.totalPlayed}@{item.weightedOdds} | {item.playsCount} bet</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Collapse>
    </Paper>
  );
};

export default BotSalvatore;