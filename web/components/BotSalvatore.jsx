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
  Button
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

const BotSalvatore = () => {
  const [token, setToken] = useState(null);
  const [bettingData, setBettingData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const LOGIN_URL = "https://tennisbestingbet.info:48634/LOGIN";
  
  // Costruisce URL con la data di oggi
  const getTodayHistoryUrl = () => {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));
    
    return `https://tennisbestingbet.info:48634/PLAY_CONTAINER/GET_HISTORY?from=${encodeURIComponent(startOfDay.toString())}&to=${encodeURIComponent(endOfDay.toString())}`;
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
        console.error('Response status:', response.status);
        throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Filter and transform data
      const filteredData = data
      .map(item => {
        // Create a date object from the startDate
        const date = new Date(item.startDate);
        
        // Format the date as DD/MM HH:MM
        const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        
        return {
          startDate: formattedDate,
          eventName: item.event.eventName +' '+ item.event.prono,
          minOdds: item.event.minOdds,
          totalPlayed: item.totalPlayed
        };
      });

      setBettingData(filteredData);
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
  }, []);

  return (
    <Paper sx={{ 
      width: 'auto',
      height: '80vh', 
      display: 'flex', 
      flexDirection: 'column',
      flex: '0 0 auto',
      borderRadius: 2,
      overflow: 'hidden',
      boxShadow: 3
    }}>
      <Box sx={{
        p: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'tertiary.main',
        color: 'tertiary.contrastText',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Typography variant="h6">Bot Salvatore - Oggi ({new Date().toLocaleDateString()})</Typography>
        <Box>
          {!token ? (
            <Button 
              onClick={login} 
              variant="contained" 
              color="secondary"
              disabled={isLoading}
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </Button>
          ) : (
            <IconButton 
              onClick={() => fetchBettingHistory()} 
              color="inherit"
              title="Aggiorna dati"
              disabled={isLoading}
            >
              <RefreshIcon />
            </IconButton>
          )}
        </Box>
      </Box>
      
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
                <TableCell>{item.minOdds}</TableCell>
                <TableCell>{item.totalPlayed} €</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default BotSalvatore;