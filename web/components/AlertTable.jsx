import React, { useState, useEffect, useMemo, useCallback, useRef, useContext } from 'react';
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
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TimelineIcon from '@mui/icons-material/Timeline';
import CloseIcon from '@mui/icons-material/Close';

// Import components and utilities
import BettingMatrix from './BettingMatrix';
import EventOddsChart from './EventOddsChart';
import { calculateTwoWayNVP, calculateThreeWayNVP } from './NVPCalculations';
import { getDiffColor, isWithin24Hours, isPositiveEV, calculateAlertNVP, addNVPToAlerts, getEventData, sendAlertNotification } from './AlertUtils';

import ReactDOM from 'react-dom';
import html2canvas from 'html2canvas';



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
  const [showOddsChart, setShowOddsChart] = useState(false);
  const [selectedChartEventId, setSelectedChartEventId] = useState(null);
  const [alertsWithNVP, setAlertsWithNVP] = useState([]);
  const [nvpCache, setNvpCache] = useState({});
  const [nvpRefreshTimers, setNvpRefreshTimers] = useState({});
  const [latestCursor, setLatestCursor] = useState(() => {
    const savedCursor = localStorage.getItem('alertCursor');
    return savedCursor || null;
  });
  const timeoutRef = useRef(null);
  
  // Nuove variabili di stato per il grafico integrato nella tabella
  const [selectedChartEventIdForTable, setSelectedChartEventIdForTable] = useState(null);
  const [tableChartLoading, setTableChartLoading] = useState(false);
  const [showTableChart, setShowTableChart] = useState(false);

  const renderChartComponentToImage = async (eventId) => {
    const container = document.createElement('div');
    container.style.width = '600px'; // Aumentato per avere più spazio per il grafico
    container.style.height = '500px'; // Aumentato per avere più spazio per il grafico
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.backgroundColor = '#fff';
    document.body.appendChild(container);
    
    return new Promise((resolve, reject) => {
      try {
        // Renderizza il componente del grafico nel container
        ReactDOM.render(
          <EventOddsChart 
            eventId={eventId}
            onRenderComplete={() => {
              setTimeout(async () => {
                try {
                  console.log('Cattura del grafico in corso...');
                  // Cattura l'immagine del grafico
                  const canvas = await html2canvas(container, {
                    backgroundColor: '#fff',
                    scale: 2,
                    logging: true, // Attiva il logging per debug
                    useCORS: true,
                    allowTaint: true, // Permette di catturare anche elementi con origine diversa
                    width: 600,
                    height: 500
                  });
                  
                  // Pulizia
                  ReactDOM.unmountComponentAtNode(container);
                  document.body.removeChild(container);
                  
                  resolve(canvas);
                } catch (error) {
                  console.error('Errore durante la cattura del grafico:', error);
                  ReactDOM.unmountComponentAtNode(container);
                  document.body.removeChild(container);
                  reject(error);
                }
              }, 3000); // Aumentato il tempo di attesa per assicurarsi che il grafico sia completamente renderizzato
            }}
          />,
          container
        );
      } catch (error) {
        console.error('Errore durante il rendering del grafico:', error);
        if (document.body.contains(container)) {
          ReactDOM.unmountComponentAtNode(container);
          document.body.removeChild(container);
        }
        reject(error);
      }
    });
  };

  // Rendi la funzione disponibile globalmente
  useEffect(() => {
    window.renderChartForAlert = renderChartComponentToImage;
    
    return () => {
      delete window.renderChartForAlert;
    };
  }, []);

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
    
    // Calcola l'NVP per l'alert solo se non è già presente nella cache
    const calculateNvpIfNeeded = async () => {
      const cacheKey = `${alert.eventId}-${alert.lineType}-${alert.outcome}-${alert.points || ''}`;
      
      // Se il valore è già nella cache, non ricalcolare
      if (nvpCache[cacheKey]) {
        // Aggiorna solo lo stato con il valore dalla cache
        setAlertsWithNVP(prev => {
          const alertExists = prev.some(a => a.id === alertId);
          if (!alertExists) {
            return [...prev, { ...alert, nvp: nvpCache[cacheKey] }];
          }
          return prev.map(a => {
            if (a.id === alertId && !a.nvp) {
              return { ...a, nvp: nvpCache[cacheKey] };
            }
            return a;
          });
        });
        return;
      }
      
      // Calcola solo se non è nella cache
      const newNvpValue = await calculateSingleAlertNVP(alert);
      if (newNvpValue) {
        // Update the cache with the new value
        setNvpCache(prev => ({
          ...prev,
          [cacheKey]: newNvpValue
        }));
        
        // Update the alertsWithNVP state
        setAlertsWithNVP(prev => {
          const alertExists = prev.some(a => a.id === alertId);
          if (!alertExists) {
            return [...prev, { ...alert, nvp: newNvpValue }];
          }
          return prev.map(a => {
            if (a.id === alertId) {
              return { ...a, nvp: newNvpValue };
            }
            return a;
          });
        });
      }
    };
    
    // Calcola l'NVP solo se necessario
    calculateNvpIfNeeded();
    
    // Only schedule refresh if the alert is less than 60 seconds old
    // e solo se non è già in corso un timer per questo alert
    if (alertAge < 60000 && !nvpRefreshTimers[alertId]) {
      // Schedule a refresh every 60 seconds until the alert is 60 seconds old
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
        calculateNvpIfNeeded();
      }, 60000);
      
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
  }, [nvpCache]);

  // Funzione per impostare il cursore
  const handleSetCursor = () => {
    if (cursorInput && !isNaN(parseInt(cursorInput))) {
      const newCursor = parseInt(cursorInput);
      setLatestCursor(newCursor);
      localStorage.setItem('alertCursor', newCursor);
      
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
      const data = await getEventData(eventId);
      
      // Aggiungi informazioni sulla linea selezionata
      setMatrixData({
        ...data,
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
  
  const showOddsChartDialog = (eventId) => {
    setSelectedChartEventId(eventId);
    setShowOddsChart(true);
  };
  
  // Funzione per selezionare un evento e mostrarne il grafico nella tabella
  const showChartInTable = async (eventId) => {
    // Se clicchiamo sullo stesso evento, nascondiamo il grafico
    if (selectedChartEventIdForTable === eventId) {
      setShowTableChart(false);
      setSelectedChartEventIdForTable(null);
      return;
    }
    
    setTableChartLoading(true);
    setSelectedChartEventIdForTable(eventId);
    setShowTableChart(true);
    
    // Assicurati che il grafico venga aggiornato
    setTimeout(() => {
      setTableChartLoading(false);
    }, 500);
  };

  // Sort alerts from newest to oldest by timestamp
  const sortAlerts = useCallback((alerts) => 
    [...alerts].sort((a, b) => 
      parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0])
    ), []);

  // Semplice funzione di fetch senza logica di throttling
  const fetchAlerts = useCallback((cursor = null, forceUpdate = false) => {
    // Controlla se il sistema è in pausa e in tal caso non fa nulla (solo se non è una chiamata forzata)
    if (isPaused && !forceUpdate) {
      console.log("Alert system is paused, skipping fetch");
      return;
    }
    
    // Previeni chiamate multiple se già in caricamento
    if (isLoading) return;
    
    setIsLoading(true);
    console.log("Fetching alerts...");
    
    try {
      let url = 'https://pod-dolphin.fly.dev/alerts/user_2ip8HMVMMWrz0jJyFxT86OB5ZnU';
      
      // Usa il cursore fornito o prendi quello da localStorage
      let timestamp;
      if (cursor) {
        timestamp = cursor;
      } else {
        const savedCursor = localStorage.getItem('alertCursor');
        timestamp = savedCursor || 1743067773853; // Valore predefinito
      }
      
      url += `?dropNotificationsCursor=${timestamp}`;
      
      // Imposta un timeout per la richiesta
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      fetch(url, { signal: controller.signal })
        .then(resp => {
          clearTimeout(timeoutId);
          if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
          return resp.json();
        })
        .then(async result => {
          // Se non ci sono nuovi dati, termina subito
          if (!result.data || result.data.length === 0) {
            setIsLoading(false);
            return;
          }
          
          const alertsWithoutNoVig = result.data.map(alert => ({
            ...alert
          }));
          
          // Aggiungi i nuovi alert a quelli esistenti
          setAlerts(prev => {
            const existingIds = new Set(prev.map(a => a.id));
            const uniqueNewAlerts = alertsWithoutNoVig.filter(a => !existingIds.has(a.id));
            
            if (uniqueNewAlerts.length === 0) return prev;
            
            return sortAlerts([...prev, ...uniqueNewAlerts]);
          });
          
          if (result.data.length > 0) {
            // Aggiorna il cursor al timestamp più recente
            const timestamps = result.data.map(item => parseInt(item.id.split('-')[0]));
            const maxTimestamp = Math.max(...timestamps);
            
            if (maxTimestamp > latestCursor) {
              setLatestCursor(maxTimestamp);
              localStorage.setItem('alertCursor', maxTimestamp);
            }
            
            // Calcola NVP per i nuovi alert
            setTimeout(async () => {
              const newAlertsWithNVP = await processAlertsWithNVP(alertsWithoutNoVig);
              
              setAlertsWithNVP(prev => {
                const existingIds = new Set(prev.map(a => a.id));
                const uniqueNewAlerts = newAlertsWithNVP.filter(a => !existingIds.has(a.id));
                
                if (uniqueNewAlerts.length === 0) return prev;
                
                // Non inviamo notifiche qui - le notifiche verranno inviate solo dopo il calcolo NVP
                
                return sortAlerts([...prev, ...uniqueNewAlerts]);
              });
            }, 100);
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
  }, [isLoading, latestCursor, processAlertsWithNVP, sortAlerts, isPaused]);

  // Implementazione semplicissima per il refresh ogni 10 secondi
  useEffect(() => {
    let intervalId = null;
    
    // Se non è in pausa, imposta un semplice intervallo che esegue fetchAlerts ogni 5 secondi
    if (!isPaused) {
      
      // Imposta un intervallo che si ripete ogni 5 secondi
      intervalId = setInterval(() => {
        fetchAlerts(latestCursor);
      }, 5000);
      
      console.log("Avviato intervallo di refresh ogni 5 secondi");
    }
    
    // Pulizia dell'intervallo quando il componente si smonta o quando isPaused cambia
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        console.log("Intervallo di refresh fermato");
      }
    };
  }, [isPaused, latestCursor, fetchAlerts]);

  // Pulizia dei timer NVP quando il componente viene smontato
  useEffect(() => {
    return () => {
      Object.values(nvpRefreshTimers).forEach(timer => {
        clearInterval(timer);
      });
    };
  }, [nvpRefreshTimers]);

  // Inizializzazione
  useEffect(() => {
    setIsExpanded(false);
    localStorage.setItem('alertTableExpanded', 'false');
  }, []);
  
  // Salva lo stato di espansione
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
              <Tooltip title="Aggiorna dati">
                <span>
                  <IconButton 
                    onClick={() => fetchAlerts(latestCursor)} 
                    color="inherit"
                    disabled={isLoading || isPaused} // Disabilitato quando in pausa
                    size="small"
                    sx={{ mr: 1 }}
                  >
                    {isLoading ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={isPaused ? "Riprendi aggiornamenti" : "Metti in pausa"}>
                <IconButton 
                  onClick={() => {
                    const newPausedState = !isPaused;
                    setIsPaused(newPausedState);
                    localStorage.setItem('alertTablePaused', newPausedState.toString());
                    console.log(`Auto-refresh ${newPausedState ? 'paused' : 'resumed'}`);
                    
                    // Aggiungi questa parte: se stiamo attivando il play, facciamo subito una chiamata
                    if (!newPausedState) {
                      setTimeout(() => {
                        fetchAlerts(latestCursor);
                      }, 100);
                    }
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
          {/* Area grafico integrata nella tabella - NUOVA */}
          {showTableChart && (
            <Box sx={{ 
              mb: 2, 
              p: 2, 
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              backgroundColor: 'white'
            }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={8}>
                  {tableChartLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
                      <CircularProgress size={40} />
                    </Box>
                  ) : (
                    <Box sx={{ height: 300, position: 'relative' }}>
                      {/* Qui inseriamo il componente EventOddsChart */}
                      <EventOddsChart 
                        eventId={selectedChartEventIdForTable} 
                        compact={true} // Parametro per versione compatta
                      />
                    </Box>
                  )}
                </Grid>
                <Grid item xs={12} md={4}>
                  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="h6" sx={{ mb: 1 }}>Andamento Quote</Typography>
                      {/* Informazioni sulla partita */}
                      {groupedAlerts.find(g => g.eventId === selectedChartEventIdForTable) && (
                        <>
                          <Typography variant="body1" sx={{ mb: 0.5 }}>
                            <strong>Match:</strong> {groupedAlerts.find(g => g.eventId === selectedChartEventIdForTable).match}
                          </Typography>
                          <Typography variant="body1" sx={{ mb: 0.5 }}>
                            <strong>Lega:</strong> {groupedAlerts.find(g => g.eventId === selectedChartEventIdForTable).league}
                          </Typography>
                          <Typography variant="body1" sx={{ color: 'success.main' }}>
                            <strong>Linea:</strong> {groupedAlerts.find(g => g.eventId === selectedChartEventIdForTable).lineInfo}
                          </Typography>
                        </>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button 
                        variant="outlined" 
                        color="error" 
                        size="small"
                        onClick={() => {
                          setShowTableChart(false);
                          setSelectedChartEventIdForTable(null);
                        }}
                      >
                        Chiudi
                      </Button>
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </Box>
          )}
          
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
              disabled={isLoading || isPaused} // Disabilitato quando in pausa
              size="small"
              startIcon={<RefreshIcon />}
            >
              Refresh
            </Button>
          </Box>

          {/* Aggiungere un feedback visivo quando il sistema è in pausa */}
          {isPaused && (
            <Box sx={{ p: 1, bgcolor: 'warning.light', borderRadius: 1, mb: 2 }}>
              <Typography variant="body2">
                Sistema in pausa: gli aggiornamenti automatici sono disattivati. 
                Clicca il pulsante play per riprendere.
              </Typography>
            </Box>
          )}
          
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
                          bgcolor: selectedChartEventIdForTable === group.eventId ? 'rgba(33, 150, 243, 0.25)' : 
                                  latestAlert.starts && isWithin24Hours(latestAlert.starts) ? 'rgba(33, 150, 243, 0.15)' : 'inherit'
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
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                              variant={selectedChartEventIdForTable === group.eventId ? "contained" : "outlined"}
                              color={selectedChartEventIdForTable === group.eventId ? "success" : "secondary"}
                              size="small"
                              startIcon={<TimelineIcon />}
                              onClick={(e) => {
                                e.stopPropagation();
                                showChartInTable(group.eventId);
                              }}
                            >
                              {selectedChartEventIdForTable === group.eventId ? "Grafico Attivo" : "Mostra Grafico"}
                            </Button>
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
                          </Box>
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
                
                {isLoading && alerts.length === 0 && (
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
      
      {/* Dialog per il grafico delle quote */}
      <Dialog 
        open={showOddsChart} 
        onClose={() => setShowOddsChart(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Andamento Quote</Typography>
          <IconButton onClick={() => setShowOddsChart(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {selectedChartEventId && <EventOddsChart eventId={selectedChartEventId} />}
        </DialogContent>
      </Dialog>
    </Paper>
  );
};

export default AlertTable;
