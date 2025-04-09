import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  TextField,
  Tab,
  Tabs,
  CircularProgress
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

// Import components and utilities
import BettingMatrix from './BettingMatrix';
import { calculateTwoWayNVP, calculateThreeWayNVP } from './NVPCalculations';
import { getDiffColor, isWithin24Hours, isPositiveEV, calculateAlertNVP, addNVPToAlerts } from './AlertUtils';
};


const AlertTable = () => {
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursorInput, setCursorInput] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [activeTab, setActiveTab] = useState('alerts');
  const [showMatrix, setShowMatrix] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [matrixData, setMatrixData] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [alertsWithNVP, setAlertsWithNVP] = useState([]);
  const [nvpCache, setNvpCache] = useState({});  // Cache for NVP values to avoid redundant calculations
  const [nvpRefreshTimers, setNvpRefreshTimers] = useState({});  // Timers for refreshing NVP values
  const [latestCursor, setLatestCursor] = useState(() => {
    // Initialize latestCursor from localStorage if available
    const savedCursor = localStorage.getItem('alertCursor');
    return savedCursor || null;
  });


  // Calculate NVP for a specific alert
  const calculateSingleAlertNVP = async (alert) => {
    return calculateAlertNVP(alert, calculateTwoWayNVP, calculateThreeWayNVP);
  };

  // Schedule NVP refresh for a specific alert
  const scheduleNvpRefresh = (alert) => {
    const alertId = alert.id;
    const alertTimestamp = parseInt(alertId.split('-')[0]);
    const currentTime = Date.now();
    
    // Calculate how long ago the alert was created
    const alertAge = currentTime - alertTimestamp;
    
    // Calcola immediatamente l'NVP per l'alert, indipendentemente dall'età
    const calculateNvpImmediately = async () => {
      const newNvpValue = await calculateSingleAlertNVP(alert);
      if (newNvpValue) {
        // Update the cache with the new value
        const cacheKey = `${alert.eventId}-${alert.lineType}-${alert.outcome}-${alert.points || ''}`;
        setNvpCache(prev => ({
          ...prev,
          [cacheKey]: newNvpValue
        }));
        
        // Update the alertsWithNVP state
        setAlertsWithNVP(prev => {
          return prev.map(a => {
            if (a.id === alertId) {
              return { ...a, nvp: newNvpValue };
            }
            return a;
          });
        });
      }
    };
    
    // Calcola l'NVP immediatamente
    calculateNvpImmediately();
    
    // Only schedule refresh if the alert is less than 60 seconds old
    if (alertAge < 60000) {
      // Clear any existing timer for this alert
      if (nvpRefreshTimers[alertId]) {
        clearTimeout(nvpRefreshTimers[alertId]);
      }
      
      // Schedule a refresh every 10 seconds until the alert is 60 seconds old
      const refreshTimer = setInterval(async () => {
        const newCurrentTime = Date.now();
        const newAlertAge = newCurrentTime - alertTimestamp;
        
        // Stop refreshing after 60 seconds
        if (newAlertAge >= 60000) {
          clearInterval(nvpRefreshTimers[alertId]);
          setNvpRefreshTimers(prev => {
            const newTimers = {...prev};
            delete newTimers[alertId];
            return newTimers;
          });
          return;
        }
        
        // Recalculate NVP
        calculateNvpImmediately();
      }, 10000); // Refresh every 10 seconds
      
      // Save the timer reference
      setNvpRefreshTimers(prev => ({
        ...prev,
        [alertId]: refreshTimer
      }));
    }
  };

  // New function to calculate and add NVP values to alerts
  const processAlertsWithNVP = useCallback(async (alertsList) => {
    const { alertsWithNVP, updatedNvpCache } = await addNVPToAlerts(
      alertsList, 
      nvpCache, 
      calculateTwoWayNVP, 
      calculateThreeWayNVP
    );
    
    // Update the NVP cache
    setNvpCache(updatedNvpCache);
    
    // Schedule NVP refresh for new alerts
    alertsList.forEach(alert => {
      scheduleNvpRefresh(alert);
    });
    
    return alertsWithNVP;
  }, [nvpCache, scheduleNvpRefresh]);

  const handleSetCursor = () => {
    if (cursorInput && !isNaN(parseInt(cursorInput))) {
      const newCursor = parseInt(cursorInput);
      setLatestCursor(newCursor);
      localStorage.setItem('alertCursor', newCursor);
      fetchAlerts(newCursor);
      setCursorInput('');
    }
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const showBettingMatrix = async (eventId, lineType, outcome, points) => {
    setSelectedEventId(eventId);
    setMatrixLoading(true);
    
    try {
      const response = await fetch(`https://swordfish-production.up.railway.app/events/${eventId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const result = await response.json();
      
      // Aggiungi informazioni sulla linea selezionata
      setMatrixData({
        ...result.data,
        selectedLine: {
          lineType,
          outcome,
          points
        }
      });
      
      setShowMatrix(true);
    } catch (err) {
      console.error("Error fetching matrix data:", err);
      setError("Could not load betting matrix data");
    } finally {
      setMatrixLoading(false);
    }
  };

  // Fixed function declaration
  const fetchMarketData = (eventId) => {
    return fetch(`https://swordfish-production.up.railway.app/events/${eventId}`)
      .then(resp => resp.ok ? resp.json() : null)
      .catch(err => null);
  };


  // Sort alerts from newest to oldest by timestamp
  const sortAlerts = useCallback((alerts) => 
    [...alerts].sort((a, b) => 
      parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0])
    ), []);

  // Changed to Promise-based approach with useCallback
  const fetchAlerts = useCallback((cursor = null) => {
    setIsLoading(true);
    
    try {
      let url = 'https://pod-dolphin.fly.dev/alerts/user_2ip8HMVMMWrz0jJyFxT86OB5ZnU';
      
      // Use cursor from parameters first, then localStorage, then default timestamp
      let timestamp;
      if (cursor) {
        timestamp = cursor;
      } else {
        // Try to get cursor from localStorage
        const savedCursor = localStorage.getItem('alertCursor');
        if (savedCursor) {
          timestamp = savedCursor;
        } else {
          // Default timestamp if nothing else is available
          timestamp = 1743067773853;
        }
      }
      
      url += `?dropNotificationsCursor=${timestamp}`;
      
      fetch(url)
        .then(resp => {
          if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
          return resp.json();
        })
        .then(async result => {
          // Process the alerts without NoVig calculation
          const alertsWithoutNoVig = result.data.map(alert => ({
            ...alert
          }));
          
          // ALWAYS append new alerts to existing ones, never replace
          setAlerts(prev => {
            // Create combined array with duplicates removed (based on ID)
            const existingIds = new Set(prev.map(a => a.id));
            const uniqueNewAlerts = alertsWithoutNoVig.filter(a => !existingIds.has(a.id));
            
            // Combine previous alerts with new ones and sort
            return sortAlerts([...prev, ...uniqueNewAlerts]);
          });
          
          if (result.data.length > 0) {
            const timestamps = result.data.map(item => parseInt(item.id.split('-')[0]));
            const maxTimestamp = Math.max(...timestamps);
            setLatestCursor(maxTimestamp);
            // Save latest cursor to localStorage
            localStorage.setItem('alertCursor', maxTimestamp);
            
            // Calculate NVP values for new alerts
            const newAlertsWithNVP = await processAlertsWithNVP(alertsWithoutNoVig);
            
            // Update alertsWithNVP state
            setAlertsWithNVP(prev => {
              const existingIds = new Set(prev.map(a => a.id));
              const uniqueNewAlerts = newAlertsWithNVP.filter(a => !existingIds.has(a.id));
              return sortAlerts([...prev, ...uniqueNewAlerts]);
            });
          }
        })
        .catch(err => {
          setError(err.message);
          console.error('Error:', err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } catch (err) {
      setError(err.message);
      console.error('Error:', err);
      setIsLoading(false);
    }
  }, [latestCursor, processAlertsWithNVP, sortAlerts]);

  // Effetto per impostare lo stato iniziale di pausa
  useEffect(() => {
    // Sempre in pausa all'avvio, indipendentemente dal valore salvato
    setIsPaused(true);
    localStorage.setItem('alertTablePaused', 'true');
    
    // Carica gli alert iniziali
    fetchAlerts();
  }, [fetchAlerts]);
  
  // Effetto separato per gestire l'intervallo di aggiornamento
  useEffect(() => {
    // Set up auto-refresh every 5 seconds, but only if not paused
    let intervalId;
    if (!isPaused) {
      console.log("Starting auto-refresh interval");
      intervalId = setInterval(() => {
        console.log("Auto-refreshing alerts...");
        fetchAlerts(latestCursor);
      }, 5000);
    } else {
      console.log("Auto-refresh paused");
    }
    
    // Clean up interval on component unmount or when isPaused changes
    return () => {
      if (intervalId) {
        console.log("Clearing auto-refresh interval");
        clearInterval(intervalId);
      }
    };
  }, [isPaused, latestCursor, fetchAlerts]);
  
  // Effetto per la pulizia dei timer NVP quando il componente viene smontato
  useEffect(() => {
    return () => {
      // Clear all NVP refresh timers
      Object.values(nvpRefreshTimers).forEach(timer => {
        clearInterval(timer);
      });
    };
  }, [nvpRefreshTimers]);

  // Sempre collassato all'avvio, indipendentemente dal valore salvato
  useEffect(() => {
    setIsExpanded(false);
    localStorage.setItem('alertTableExpanded', 'false');
  }, []);
  
  // Save expanded state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('alertTableExpanded', isExpanded.toString());
  }, [isExpanded]);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Find NVP for a specific alert
  const findNVPForAlert = (alertId) => {
    const alertWithNVP = alertsWithNVP.find(a => a.id === alertId);
    return alertWithNVP ? alertWithNVP.nvp : null;
  };
  
  // Function to calculate if a bet is worth taking (positive EV)
  const isPositiveEV = (nvp, currentOdds) => {
    if (!nvp || !currentOdds) return false;
    return parseFloat(nvp) > parseFloat(currentOdds);
  };
  

  // Group alerts by eventId and line info
  const groupedAlerts = useMemo(() => {
    const groups = {};
    
    alerts.forEach(alert => {
      const eventId = alert.eventId || alert.id.split('-')[1];
      const lineInfo = `${alert.lineType} ${alert.outcome} ${alert.points || ''}`.trim();
      const groupKey = `${eventId}-${lineInfo}`;
      
      if (!groups[groupKey]) {
        groups[groupKey] = {
          eventId,
          lineInfo,
          match: `${alert.home} vs ${alert.away}`,
          league: alert.leagueName,
          alerts: []
        };
      }
      
      groups[groupKey].alerts.push(alert);
    });
    
    // Sort groups by the timestamp of their most recent alert
    return Object.values(groups).sort((a, b) => {
      const aLatest = Math.max(...a.alerts.map(alert => parseInt(alert.id.split('-')[0])));
      const bLatest = Math.max(...b.alerts.map(alert => parseInt(alert.id.split('-')[0])));
      return bLatest - aLatest;
    });
  }, [alerts, alertsWithNVP]);


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
        bgcolor: 'info.main',
        color: 'info.contrastText',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        transition: 'padding 0.3s ease'
      }}>
        {isExpanded ? (
          <>
            <Typography variant="h6">Alerts - NoVig Price</Typography>
            <Box display="flex" alignItems="center">
              <IconButton 
                onClick={() => fetchAlerts(latestCursor)} 
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
                  onClick={() => {
                    const newPausedState = !isPaused;
                    setIsPaused(newPausedState);
                    localStorage.setItem('alertTablePaused', newPausedState.toString());
                    console.log(`Auto-refresh ${newPausedState ? 'paused' : 'resumed'}`);
                  }} 
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
          <Tooltip title="Espandi Alerts">
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

      <Collapse in={isExpanded} orientation="horizontal" sx={{ width: '100%', height: '100%', position: 'relative' }}>
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2, position: 'relative' }}>
          {/* Modale delle odds all'interno del Box principale */}
          {showMatrix && matrixData && (
            <Box sx={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              right: 0, 
              bottom: 0, 
              zIndex: 1200,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <BettingMatrix 
                data={matrixData} 
                onClose={() => {
                  setShowMatrix(false);
                  setMatrixData(null);
                }}
              />
            </Box>
          )}
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextField
              size="small"
              label="Cursor timestamp"
              value={cursorInput}
              onChange={(e) => setCursorInput(e.target.value)}
              sx={{ width: 200 }}
            />
            <Button 
              variant="contained" 
              color="primary"
              onClick={handleSetCursor}
              size="small"
            >
              Set Cursor
            </Button>
            <Button 
              variant="outlined"
              color="primary"
              onClick={() => fetchAlerts(latestCursor)} 
              disabled={isLoading}
              size="small"
              startIcon={<RefreshIcon />}
            >
              Refresh
            </Button>
          </Box>
          
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2">Current cursor: {latestCursor || 'None'}</Typography>
            <Typography variant="body2">Total groups: {groupedAlerts.length}, Total alerts: {alerts.length}</Typography>
          </Box>
          
          {error && (
            <Box sx={{ p: 2, mb: 2, bgcolor: 'error.light', color: 'error.contrastText', borderRadius: 1 }}>
              <Typography>{error}</Typography>
            </Box>
          )}
          
          <Tabs 
            value={activeTab} 
            onChange={(e, newValue) => setActiveTab(newValue)}
            sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
          >
            <Tab label="Alerts" value="alerts" />
          </Tabs>
          
          <TableContainer sx={{ flex: 1, overflowY: 'auto' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'info.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Match</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'info.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>League</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'info.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Line Type</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'info.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>EventID</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'info.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Alerts</TableCell>
                  <TableCell sx={{ 
                    fontWeight: 'bold', 
                    bgcolor: 'info.light',
                    color: 'primary.contrastText',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groupedAlerts.map((group) => {
                  const isExpanded = expandedGroups[`${group.eventId}-${group.lineInfo}`] || false;
                  const latestAlert = group.alerts.reduce((latest, current) => {
                    const latestTime = parseInt(latest.id.split('-')[0]);
                    const currentTime = parseInt(current.id.split('-')[0]);
                    return currentTime > latestTime ? current : latest;
                  }, group.alerts[0]);
                  
                  return (
                    <React.Fragment key={`${group.eventId}-${group.lineInfo}`}>
                      <TableRow 
                        hover
                        onClick={() => toggleGroup(`${group.eventId}-${group.lineInfo}`)}
                        sx={{ 
                          cursor: 'pointer',
                          bgcolor: latestAlert.starts && isWithin24Hours(latestAlert.starts) ? 'rgba(33, 150, 243, 0.15)' : 'inherit'
                        }}
                      >
                        <TableCell>
                          <Box>
                            <Typography variant="body2">{group.match}</Typography>
                            {latestAlert.starts && (
                              <Typography variant="caption" color="text.secondary">
                                {new Date(parseInt(latestAlert.starts)).toLocaleString()}
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>{group.league}</TableCell>
                        <TableCell>{group.lineInfo}</TableCell>
                        <TableCell>{latestAlert.id.split('-')[0]}</TableCell>
                        <TableCell>
                          {group.alerts.length} alerts • Latest: {new Date(parseInt(latestAlert.id.split('-')[0])).toLocaleTimeString()}
                          <IconButton size="small" sx={{ ml: 1 }}>
                            {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                          </IconButton>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outlined"
                            color="primary"
                            size="small"
                            startIcon={<VisibilityIcon />}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Estrai le informazioni sulla linea dal gruppo
                              const lineInfo = group.lineInfo.split(' ');
                              const lineType = lineInfo[0];
                              const outcome = lineInfo[1];
                              const points = lineInfo[2] || '';
                              showBettingMatrix(group.eventId, lineType, outcome, points);
                            }}
                          >
                            View Odds
                          </Button>
                        </TableCell>
                      </TableRow>
                      
                      <TableRow sx={{ display: isExpanded ? 'table-row' : 'none' }}>
                        <TableCell colSpan={6} sx={{ p: 0 }}>
                          <TableContainer sx={{ maxHeight: 300 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'action.hover' }}>
                                  <TableCell>Time</TableCell>
                                  <TableCell>ID</TableCell>
                                  <TableCell>Change</TableCell>
                                  <TableCell>From</TableCell>
                                  <TableCell>To</TableCell>
                                  <TableCell>NVP</TableCell>
                                  <TableCell>Diff</TableCell>
                                  <TableCell>% Change</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {group.alerts
                                  .sort((a, b) => parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0]))
                                  .map(alert => {
                                    const parts = alert.id.split('-');
                                    const timestamp = parts[0];
                                    const idPart = parts.slice(1).join('-');
                                    const date = new Date(parseInt(timestamp));
                                    const timeStr = date.toLocaleTimeString();
                                    
                                    // Find NVP for this alert 
                                    const nvpValue = findNVPForAlert(alert.id);
                                    
                                    // Calculate difference between NVP and current odds
                                    let diffValue = null;
                                    if (nvpValue && alert.changeTo) {
                                      diffValue = (parseFloat(nvpValue) - parseFloat(alert.changeTo)).toFixed(3);
                                    }
                                    
                                    return (
                                      <TableRow key={alert.id} hover sx={{
                                        bgcolor: diffValue && parseFloat(diffValue) > 0.2 ? 'rgba(76, 175, 80, 0.15)' : 
                                                diffValue && parseFloat(diffValue) > 0 ? 'rgba(76, 175, 80, 0.05)' : 'inherit'
                                      }}>
                                        <TableCell>{timeStr}</TableCell>
                                        <TableCell>{idPart}</TableCell>
                                        <TableCell>{alert.changeDirection}</TableCell>
                                        <TableCell>{alert.changeFrom}</TableCell>
                                        <TableCell>{alert.changeTo}</TableCell>
                                        <TableCell sx={{ fontWeight: 'medium' }}>
                                          {nvpValue ? nvpValue : (
                                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                              <CircularProgress size={16} sx={{ mr: 1 }} />
                                              <Typography variant="body2">Caricamento...</Typography>
                                            </Box>
                                          )}
                                        </TableCell>
                                        <TableCell sx={{ 
                                          color: diffValue ? getDiffColor(diffValue) : 'inherit',
                                          fontWeight: 'bold'
                                        }}>
                                          {diffValue ? (parseFloat(diffValue) > 0 ? `+${diffValue}` : diffValue) : '-'}
                                        </TableCell>
                                        <TableCell>{parseFloat(alert.percentageChange).toFixed(2)}%</TableCell>
                                      </TableRow>
                                    );
                                  })}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
                
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                      <CircularProgress size={24} sx={{ mr: 1 }} />
                      <Typography variant="body2" component="span">
                        Loading alerts...
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                
                {!isLoading && groupedAlerts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                      <Typography variant="body2">
                        No alerts found
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          
          {/* Indicatore di caricamento per i dati delle quote */}
          {matrixLoading && (
            <Box sx={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              right: 0, 
              bottom: 0, 
              zIndex: 1200,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <Paper sx={{ p: 4, display: 'flex', alignItems: 'center' }}>
                <CircularProgress size={24} sx={{ mr: 2 }} />
                <Typography>Loading odds data...</Typography>
              </Paper>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default AlertTable;
