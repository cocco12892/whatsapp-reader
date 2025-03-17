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
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

const BotSalvatore = () => {
  const [token, setToken] = useState(null);
  const [bettingData, setBettingData] = useState([]);
  const [error, setError] = useState(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const LOGIN_URL = "https://tennisbestingbet.info:48634/LOGIN";
  const HISTORY_URL = "https://tennisbestingbet.info:48634/PLAY_CONTAINER/GET_HISTORY?from=Sun%20Mar%2016%202025%2000:00:00%20GMT+0100%20(Central%20European%20Standard%20Time)&to=Fri%20Mar%2028%202025%2023:59:00%20GMT+0100%20(Central%20European%20Standard%20Time)";

  const fetchToken = async (customUsername, customPassword) => {
    try {
      const response = await fetch(`${LOGIN_URL}?username=${customUsername || 'tennis'}&password=${customPassword || 'ten10-'}`, {
        method: 'GET'
      });
      const data = await response.json();
      setToken(data.token);
      setLoginDialogOpen(false);
      return data.token;
    } catch (err) {
      console.error('Error fetching token:', err);
      setError('Failed to fetch token');
      setLoginDialogOpen(true);
      return null;
    }
  };

  const fetchBettingHistory = async () => {
    if (!token) {
      const newToken = await fetchToken();
      if (!newToken) return;
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
      setLoginDialogOpen(true);
    }
  };

  const handleCustomLogin = async () => {
    await fetchToken(username, password);
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
        <Button onClick={() => setLoginDialogOpen(true)}>Login</Button>
      </Paper>
    );
  }

  return (
    <>
      <Paper sx={{ 
        minWidth: '40%',  // Take up 40% of the screen width
        maxWidth: '50%',  // But not more than 50%
        width: 'auto',    // Allow dynamic sizing
        height: '80vh', 
        display: 'flex', 
        flexDirection: 'column',
        flex: '0 0 auto'  // Prevent shrinking
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
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', bgcolor: 'primary.light', color: 'primary.contrastText' }}>Data</TableCell>
                <TableCell sx={{ fontWeight: 'bold', bgcolor: 'primary.light', color: 'primary.contrastText' }}>Evento</TableCell>
                <TableCell sx={{ fontWeight: 'bold', bgcolor: 'primary.light', color: 'primary.contrastText' }}>Prono</TableCell>
                <TableCell sx={{ fontWeight: 'bold', bgcolor: 'primary.light', color: 'primary.contrastText' }}>Min Odds</TableCell>
                <TableCell sx={{ fontWeight: 'bold', bgcolor: 'primary.light', color: 'primary.contrastText' }}>Totale Giocato</TableCell>
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
                  <TableCell>{item.prono}</TableCell>
                  <TableCell>{item.minOdds}</TableCell>
                  <TableCell>{item.totalPlayed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)}>
        <DialogTitle>Login</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Username"
            fullWidth
            variant="outlined"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            variant="outlined"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoginDialogOpen(false)}>Annulla</Button>
          <Button onClick={handleCustomLogin} color="primary">Login</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default BotSalvatore;
