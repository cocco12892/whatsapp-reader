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
  Box
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

const BotSalvatore = () => {
  const [token, setToken] = useState(null);
  const [bettingData, setBettingData] = useState([]);
  const [error, setError] = useState(null);

  const LOGIN_URL = "https://tennisbestingbet.info:48634/LOGIN?username=tennis&password=ten10-";
  const HISTORY_URL = "https://tennisbestingbet.info:48634/PLAY_CONTAINER/GET_HISTORY?from=Sun%20Mar%2016%202025%2000:00:00%20GMT+0100%20(Central%20European%20Standard%20Time)&to=Fri%20Mar%2028%202025%2023:59:00%20GMT+0100%20(Central%20European%20Standard%20Time)";

  const fetchToken = async () => {
    try {
      const response = await fetch(LOGIN_URL);
      const data = await response.json();
      setToken(data.token);
    } catch (err) {
      console.error('Error fetching token:', err);
      setError('Failed to fetch token');
    }
  };

  const fetchBettingHistory = async () => {
    if (!token) {
      await fetchToken();
      return;
    }

    try {
      const response = await fetch(HISTORY_URL, {
        headers: {
          'Authorization': token
        }
      });
      const data = await response.json();
      
      // Filter and transform data
      const filteredData = data.filter(item => item.totalPlayed >= 400).map(item => ({
        startDate: new Date(item.startDate).toLocaleString(),
        eventName: item.event.eventName,
        prono: item.event.prono,
        minOdds: item.event.minOdds,
        totalPlayed: item.totalPlayed
      }));

      setBettingData(filteredData);
    } catch (err) {
      console.error('Error fetching betting history:', err);
      setError('Failed to fetch betting history');
    }
  };

  useEffect(() => {
    fetchBettingHistory();
    
    // Refresh every 5 minutes
    const intervalId = setInterval(fetchBettingHistory, 5 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [token]);

  if (error) {
    return (
      <Paper sx={{ p: 2, height: '80vh', overflowY: 'auto' }}>
        <Typography color="error">{error}</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ 
      minWidth: 300, 
      maxWidth: 400, 
      height: '80vh', 
      display: 'flex', 
      flexDirection: 'column' 
    }}>
      <Box sx={{
        p: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Typography variant="h6">Bot Salvatore</Typography>
        <IconButton 
          onClick={fetchBettingHistory} 
          color="inherit"
          title="Aggiorna dati"
        >
          <RefreshIcon />
        </IconButton>
      </Box>
      
      <TableContainer sx={{ flex: 1, overflowY: 'auto' }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Data</TableCell>
              <TableCell>Evento</TableCell>
              <TableCell>Prono</TableCell>
              <TableCell>Min Odds</TableCell>
              <TableCell>Totale Giocato</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bettingData.map((item, index) => (
              <TableRow key={index}>
                <TableCell>{item.startDate}</TableCell>
                <TableCell>{item.eventName}</TableCell>
                <TableCell>{item.prono}</TableCell>
                <TableCell>{item.minOdds}</TableCell>
                <TableCell>{item.totalPlayed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default BotSalvatore;
