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
  TextField,
  Dialog,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
  CircularProgress
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

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

  // NVP Calculation Functions
  const calculateNVPValues = (odds, tolerance = 0.0001, maxIterations = 100) => {
    // Extract odds and convert to probabilities
    const probabilities = {};
    let totalProbability = 0;
    
    for (const [key, value] of Object.entries(odds)) {
      if (value !== undefined && value > 0) {
        probabilities[key] = 1 / value;
        totalProbability += probabilities[key];
      }
    }
    
    // Calculate bookmaker's margin
    const margin = totalProbability - 1;
    
    // Convert to array for processing
    const probabilityValues = Object.values(probabilities);
    
    // Apply power method to remove vigorish
    const fairProbabilities = powerMethod(probabilityValues, tolerance, maxIterations);
    
    // Convert fair probabilities back to odds (NVP)
    const nvpValues = {};
    const keys = Object.keys(probabilities);
    
    fairProbabilities.forEach((fairProb, index) => {
      nvpValues[keys[index]] = 1 / fairProb;
    });
    
    // Return the results
    return {
      nvp: nvpValues,
      fairProbabilities: fairProbabilities.reduce((obj, prob, i) => {
        obj[keys[i]] = prob;
        return obj;
      }, {}),
      rawProbabilities: probabilities,
      margin: margin * 100 // Convert to percentage
    };
  };

  const powerMethod = (probabilities, tolerance, maxIterations) => {
    let r = 1; // Initial exponent
    let adjustedProbs = probabilities.map(p => Math.pow(p, r));
    
    for (let i = 0; i < maxIterations; i++) {
      // Calculate difference from 1
      const sumProbs = adjustedProbs.reduce((sum, p) => sum + p, 0);
      const diff = sumProbs - 1;
      
      // If close enough to 1, we're done
      if (Math.abs(diff) < tolerance) {
        break;
      }
      
      // Calculate gradient for Newton-Raphson method
      const gradient = probabilities.reduce(
        (sum, p) => sum + Math.log(p) * Math.pow(p, r), 
        0
      );
      
      // Adjust r using Newton-Raphson step
      r -= diff / gradient;
      
      // Recalculate probabilities with new r
      adjustedProbs = probabilities.map(p => Math.pow(p, r));
    }
    
    return adjustedProbs;
  };

  // Calculate NVP for a 2-way market (spreads, totals)
  const calculateTwoWayNVP = (home, away) => {
    const odds = {
      home: parseFloat(home),
      away: parseFloat(away)
    };
    
    const result = calculateNVPValues(odds);
    return {
      homeNVP: result.nvp.home.toFixed(3),
      awayNVP: result.nvp.away.toFixed(3),
      margin: result.margin.toFixed(2)
    };
  };

  // Calculate NVP for a 3-way market (moneyline with draw)
  const calculateThreeWayNVP = (home, draw, away) => {
    const odds = {
      home: parseFloat(home),
      draw: parseFloat(draw),
      away: parseFloat(away)
    };
    
    const result = calculateNVPValues(odds);
    return {
      homeNVP: result.nvp.home.toFixed(3),
      drawNVP: result.nvp.draw.toFixed(3),
      awayNVP: result.nvp.away.toFixed(3),
      margin: result.margin.toFixed(2)
    };
  };

  // Calculate NVP for a specific alert
  const calculateAlertNVP = async (alert) => {
    try {
      const response = await fetch(`https://swordfish-production.up.railway.app/events/${alert.eventId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const result = await response.json();
      const data = result.data;
      
      // Extract necessary data based on the line type
      const period0 = data.periods?.num_0;
      if (!period0) return null;
      
      let nvpValue = null;
      
      if (alert.lineType === 'MONEYLINE' || alert.lineType === 'money_line') {
        const moneyline = period0.money_line || {};
        if (moneyline.home && moneyline.draw && moneyline.away) {
          const nvp = calculateThreeWayNVP(moneyline.home, moneyline.draw, moneyline.away);
          
          if (alert.outcome.toLowerCase().includes('home')) {
            nvpValue = nvp.homeNVP;
          } else if (alert.outcome.toLowerCase().includes('draw')) {
            nvpValue = nvp.drawNVP;
          } else {
            nvpValue = nvp.awayNVP;
          }
        }
      } 
      else if (alert.lineType === 'SPREAD') {
        const spreads = period0.spreads || {};
        const points = alert.points || Object.keys(spreads)[0];
        
        if (spreads[points] && spreads[points].home && spreads[points].away) {
          const nvp = calculateTwoWayNVP(spreads[points].home, spreads[points].away);
          
          nvpValue = alert.outcome.toLowerCase().includes('home') ? 
            nvp.homeNVP : nvp.awayNVP;
        }
      }
      else if (alert.lineType === 'TOTAL') {
        const totals = period0.totals || {};
        const points = alert.points || Object.keys(totals)[0];
        
        if (totals[points] && totals[points].over && totals[points].under) {
          const nvp = calculateTwoWayNVP(totals[points].over, totals[points].under);
          
          nvpValue = alert.outcome.toLowerCase().includes('over') ? 
            nvp.homeNVP : nvp.awayNVP;
        }
      }
      
      return nvpValue;
    } catch (err) {
      console.error('Error calculating NVP for alert:', err);
      return null;
    }
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
      const newNvpValue = await calculateAlertNVP(alert);
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
  const addNVPToAlerts = async (alertsList) => {
    const uniqueEventIds = [...new Set(alertsList.map(alert => alert.eventId))];
    const eventData = {};
    const updatedNvpCache = { ...nvpCache };
    
    // Fetch all event data in parallel
    await Promise.all(uniqueEventIds.map(async (eventId) => {
      try {
        const response = await fetch(`https://swordfish-production.up.railway.app/events/${eventId}`);
        if (response.ok) {
          const result = await response.json();
          eventData[eventId] = result.data;
        }
      } catch (err) {
        console.error(`Error fetching data for event ${eventId}:`, err);
      }
    }));
    
    // Calculate NVP for each alert
    const alertsWithNVP = alertsList.map(alert => {
      // Check if we already have the NVP value in cache
      const cacheKey = `${alert.eventId}-${alert.lineType}-${alert.outcome}-${alert.points || ''}`;
      if (updatedNvpCache[cacheKey]) {
        return { ...alert, nvp: updatedNvpCache[cacheKey] };
      }
        
      const data = eventData[alert.eventId];
      if (!data) return { ...alert, nvp: null };
        
      // Aggiungi l'orario di inizio partita all'alert
      const alertWithStarts = { 
        ...alert, 
        starts: data.starts 
      };
      
      const period0 = data.periods?.num_0;
      if (!period0) return { ...alertWithStarts, nvp: null };
      
      let nvpValue = null;
      
      if (alert.lineType === 'MONEYLINE' || alert.lineType === 'money_line') {
        const moneyline = period0.money_line || {};
        if (moneyline.home && moneyline.draw && moneyline.away) {
          const nvp = calculateThreeWayNVP(moneyline.home, moneyline.draw, moneyline.away);
          
          if (alert.outcome.toLowerCase().includes('home')) {
            nvpValue = nvp.homeNVP;
          } else if (alert.outcome.toLowerCase().includes('draw')) {
            nvpValue = nvp.drawNVP;
          } else {
            nvpValue = nvp.awayNVP;
          }
        }
      } 
      else if (alert.lineType === 'SPREAD') {
        const spreads = period0.spreads || {};
        const points = alert.points || Object.keys(spreads)[0];
        
        if (spreads[points] && spreads[points].home && spreads[points].away) {
          const nvp = calculateTwoWayNVP(spreads[points].home, spreads[points].away);
          
          nvpValue = alert.outcome.toLowerCase().includes('home') ? 
            nvp.homeNVP : nvp.awayNVP;
        }
      }
      else if (alert.lineType === 'TOTAL') {
        const totals = period0.totals || {};
        const points = alert.points || Object.keys(totals)[0];
        
        if (totals[points] && totals[points].over && totals[points].under) {
          const nvp = calculateTwoWayNVP(totals[points].over, totals[points].under);
          
          nvpValue = alert.outcome.toLowerCase().includes('over') ? 
            nvp.homeNVP : nvp.awayNVP;
        }
      }
      
      // Save to cache
      if (nvpValue) {
        updatedNvpCache[cacheKey] = nvpValue;
      }
      
      return { ...alertWithStarts, nvp: nvpValue };
    });
    
    // Update the NVP cache
    setNvpCache(updatedNvpCache);
    
    // Schedule NVP refresh for new alerts
    alertsList.forEach(alert => {
      scheduleNvpRefresh(alert);
    });
    
    return alertsWithNVP;
  };

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


  // Changed to Promise-based approach
  const fetchAlerts = (cursor = null) => {
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
          
          // Sort alerts from newest to oldest by timestamp
          const sortAlerts = (alerts) => 
            [...alerts].sort((a, b) => 
              parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0])
            );
          
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
            const newAlertsWithNVP = await addNVPToAlerts(alertsWithoutNoVig);
            
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
  };

  // Effetto per impostare lo stato iniziale di pausa
  useEffect(() => {
    // Sempre in pausa all'avvio, indipendentemente dal valore salvato
    setIsPaused(true);
    localStorage.setItem('alertTablePaused', 'true');
    
    // Carica gli alert iniziali
    fetchAlerts();
  }, []);
  
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
  }, [isPaused, latestCursor]);
  
  // Effetto per la pulizia dei timer NVP quando il componente viene smontato
  useEffect(() => {
    return () => {
      // Clear all NVP refresh timers
      Object.values(nvpRefreshTimers).forEach(timer => {
        clearInterval(timer);
      });
    };
  }, []);

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
  
  // Function to get a color for diff value 
  const getDiffColor = (diffValue) => {
    if (!diffValue) return 'inherit';
    const diff = parseFloat(diffValue);
    
    if (diff > 0.5) return 'success.main'; // Very good value
    if (diff > 0.2) return 'success.light'; // Good value
    if (diff > 0) return '#4caf50'; // Positive but small value
    if (diff > -0.1) return 'text.primary'; // Negative but close to fair
    return 'error.light'; // Bad value
  };

  // Group alerts by eventId and line info
  const groupedAlerts = React.useMemo(() => {
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
  }, [alerts]);

  // Betting Matrix Component
  const BettingMatrix = ({ data, onClose }) => {
    if (!data) return <Box p={2}>No data available</Box>;

    // Extract the latest spreads data from period 0
    const period0 = data.periods?.num_0;
    const spreads = period0?.spreads || {};
    const totals = period0?.totals || {};
    const moneyline = period0?.money_line || {};
    
    // Informazioni sulla linea selezionata dall'alert
    const selectedLine = data.selectedLine || {};
    const { lineType, outcome, points } = selectedLine;

    // Create sorted arrays of spread and total keys
    const spreadKeys = Object.keys(spreads).sort((a, b) => parseFloat(a) - parseFloat(b));
    const totalKeys = Object.keys(totals).sort((a, b) => parseFloat(a) - parseFloat(b));

    // Calculate NVP for moneyline (3-way)
    let moneylineNVP = null;
    if (moneyline.home && moneyline.draw && moneyline.away) {
      moneylineNVP = calculateThreeWayNVP(moneyline.home, moneyline.draw, moneyline.away);
    }

    // Calculate NVP for spreads and totals (2-way)
    const spreadsNVP = {};
    spreadKeys.forEach(key => {
      if (spreads[key].home && spreads[key].away) {
        spreadsNVP[key] = calculateTwoWayNVP(spreads[key].home, spreads[key].away);
      }
    });

    const totalsNVP = {};
    totalKeys.forEach(key => {
      if (totals[key].over && totals[key].under) {
        totalsNVP[key] = calculateTwoWayNVP(totals[key].over, totals[key].under);
      }
    });
    
    // Determina il valore NVP specifico per la linea selezionata
    let selectedNVP = null;
    let selectedCurrentOdds = null;
    
    if (lineType === 'SPREAD') {
      const spreadKey = points || spreadKeys[0];
      if (spreadsNVP[spreadKey]) {
        selectedNVP = outcome.toLowerCase().includes('home') ? 
          spreadsNVP[spreadKey].homeNVP : 
          spreadsNVP[spreadKey].awayNVP;
        selectedCurrentOdds = outcome.toLowerCase().includes('home') ? 
          spreads[spreadKey].home : 
          spreads[spreadKey].away;
      }
    } 
    else if (lineType === 'TOTAL') {
      const totalKey = points || totalKeys[0];
      if (totalsNVP[totalKey]) {
        selectedNVP = outcome.toLowerCase().includes('over') ? 
          totalsNVP[totalKey].homeNVP : 
          totalsNVP[totalKey].awayNVP;
        selectedCurrentOdds = outcome.toLowerCase().includes('over') ? 
          totals[totalKey].over : 
          totals[totalKey].under;
      }
    }
    else if (lineType === 'MONEYLINE' && moneylineNVP) {
      if (outcome.toLowerCase().includes('home')) {
        selectedNVP = moneylineNVP.homeNVP;
        selectedCurrentOdds = moneyline.home;
      } 
      else if (outcome.toLowerCase().includes('draw')) {
        selectedNVP = moneylineNVP.drawNVP;
        selectedCurrentOdds = moneyline.draw;
      }
      else {
        selectedNVP = moneylineNVP.awayNVP;
        selectedCurrentOdds = moneyline.away;
      }
    }

    return (
      <Paper 
        sx={{ 
          width: '90%', 
          maxWidth: '1200px', 
          maxHeight: '90%',
          overflow: 'auto',
          position: 'relative'
        }}
      >
        <Box sx={{ 
          p: 2, 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'primary.main',
          color: 'primary.contrastText'
        }}>
          <Typography variant="h6">
            {data.home} vs {data.away} | {data.league_name}
          </Typography>
          <IconButton onClick={onClose} size="small" color="inherit">
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: 3, overflow: 'auto' }}>
          <Box sx={{ mb: 2, p: 1, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
              Match Time: {new Date(data.starts).toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Event ID: {data.event_id}
            </Typography>
          </Box>
          
          {/* Mostra il valore NVP specifico per la linea selezionata */}
          {data.selectedLine && selectedNVP && (
            <Box sx={{ 
              mb: 3, 
              p: 2, 
              bgcolor: 'primary.light', 
              color: 'primary.contrastText',
              borderRadius: 1
            }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                Selected Line: {data.selectedLine.lineType} {data.selectedLine.outcome} {data.selectedLine.points}
              </Typography>
              <Box sx={{ display: 'flex', gap: 4 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>Current Odds:</Typography>
                  <Typography variant="h6">{selectedCurrentOdds}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>No Vig Price (NVP):</Typography>
                  <Typography variant="h6" sx={{ color: 'success.light' }}>{selectedNVP}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>Difference:</Typography>
                  <Typography 
                    variant="h6" 
                    sx={{ 
                      color: parseFloat(selectedNVP) > parseFloat(selectedCurrentOdds) ? 'success.light' : 'error.light',
                      fontWeight: 'bold'
                    }}
                  >
                    {parseFloat(selectedNVP) > parseFloat(selectedCurrentOdds) ? 
                      `+${(parseFloat(selectedNVP) - parseFloat(selectedCurrentOdds)).toFixed(3)}` : 
                      (parseFloat(selectedNVP) - parseFloat(selectedCurrentOdds)).toFixed(3)}
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}
          
          {moneylineNVP && (
            <Box sx={{ mb: 4 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                Money Line (Margin: {moneylineNVP.margin}%)
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'background.default' }}>
                      <TableCell>Outcome</TableCell>
                      <TableCell>Current</TableCell>
                      <TableCell>NVP</TableCell>
                      <TableCell>Diff</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow sx={{ 
                      bgcolor: parseFloat(moneylineNVP.homeNVP) > parseFloat(moneyline.home) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                    }}>
                      <TableCell sx={{ fontWeight: 'medium' }}>{data.home}</TableCell>
                      <TableCell>{moneyline.home}</TableCell>
                      <TableCell>{moneylineNVP.homeNVP}</TableCell>
                      <TableCell sx={{ color: 'success.main' }}>
                        {parseFloat(moneylineNVP.homeNVP) > parseFloat(moneyline.home) ? 
                          `+${(parseFloat(moneylineNVP.homeNVP) - parseFloat(moneyline.home)).toFixed(3)}` : 
                          (parseFloat(moneylineNVP.homeNVP) - parseFloat(moneyline.home)).toFixed(3)}
                      </TableCell>
                    </TableRow>
                    <TableRow sx={{ 
                      bgcolor: parseFloat(moneylineNVP.drawNVP) > parseFloat(moneyline.draw) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                    }}>
                      <TableCell sx={{ fontWeight: 'medium' }}>Draw</TableCell>
                      <TableCell>{moneyline.draw}</TableCell>
                      <TableCell>{moneylineNVP.drawNVP}</TableCell>
                      <TableCell sx={{ color: 'success.main' }}>
                        {parseFloat(moneylineNVP.drawNVP) > parseFloat(moneyline.draw) ? 
                          `+${(parseFloat(moneylineNVP.drawNVP) - parseFloat(moneyline.draw)).toFixed(3)}` : 
                          (parseFloat(moneylineNVP.drawNVP) - parseFloat(moneyline.draw)).toFixed(3)}
                      </TableCell>
                    </TableRow>
                    <TableRow sx={{ 
                      bgcolor: parseFloat(moneylineNVP.awayNVP) > parseFloat(moneyline.away) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                    }}>
                      <TableCell sx={{ fontWeight: 'medium' }}>{data.away}</TableCell>
                      <TableCell>{moneyline.away}</TableCell>
                      <TableCell>{moneylineNVP.awayNVP}</TableCell>
                      <TableCell sx={{ color: 'success.main' }}>
                        {parseFloat(moneylineNVP.awayNVP) > parseFloat(moneyline.away) ? 
                          `+${(parseFloat(moneylineNVP.awayNVP) - parseFloat(moneyline.away)).toFixed(3)}` : 
                          (parseFloat(moneylineNVP.awayNVP) - parseFloat(moneyline.away)).toFixed(3)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
          
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
              Spreads
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'background.default' }}>
                    <TableCell>Line</TableCell>
                    <TableCell>Outcome</TableCell>
                    <TableCell>Current</TableCell>
                    <TableCell>NVP</TableCell>
                    <TableCell>Diff</TableCell>
                    <TableCell>Margin</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {spreadKeys.map(key => {
                    const nvp = spreadsNVP[key] || {};
                    return (
                      <React.Fragment key={key}>
                        <TableRow sx={{ 
                          bgcolor: nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(spreads[key].home) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                        }}>
                          <TableCell rowSpan="2">{key}</TableCell>
                          <TableCell sx={{ fontWeight: 'medium' }}>{data.home} {key}</TableCell>
                          <TableCell>{spreads[key].home}</TableCell>
                          <TableCell>{nvp.homeNVP || ''}</TableCell>
                          <TableCell sx={{ color: 'success.main' }}>
                            {nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(spreads[key].home) ? 
                              `+${(parseFloat(nvp.homeNVP) - parseFloat(spreads[key].home)).toFixed(3)}` : 
                              nvp.homeNVP ? (parseFloat(nvp.homeNVP) - parseFloat(spreads[key].home)).toFixed(3) : ''}
                          </TableCell>
                          <TableCell rowSpan="2">{nvp.margin ? `${nvp.margin}%` : ''}</TableCell>
                        </TableRow>
                        <TableRow sx={{ 
                          bgcolor: nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(spreads[key].away) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                        }}>
                          <TableCell sx={{ fontWeight: 'medium' }}>{data.away} {parseFloat(key) * -1}</TableCell>
                          <TableCell>{spreads[key].away}</TableCell>
                          <TableCell>{nvp.awayNVP || ''}</TableCell>
                          <TableCell sx={{ color: 'success.main' }}>
                            {nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(spreads[key].away) ? 
                              `+${(parseFloat(nvp.awayNVP) - parseFloat(spreads[key].away)).toFixed(3)}` : 
                              nvp.awayNVP ? (parseFloat(nvp.awayNVP) - parseFloat(spreads[key].away)).toFixed(3) : ''}
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
          
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
              Totals
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'background.default' }}>
                    <TableCell>Line</TableCell>
                    <TableCell>Outcome</TableCell>
                    <TableCell>Current</TableCell>
                    <TableCell>NVP</TableCell>
                    <TableCell>Diff</TableCell>
                    <TableCell>Margin</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {totalKeys.map(key => {
                    const nvp = totalsNVP[key] || {};
                    return (
                      <React.Fragment key={key}>
                        <TableRow sx={{ 
                          bgcolor: nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(totals[key].over) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                        }}>
                          <TableCell rowSpan="2">{key}</TableCell>
                          <TableCell sx={{ fontWeight: 'medium' }}>Over {key}</TableCell>
                          <TableCell>{totals[key].over}</TableCell>
                          <TableCell>{nvp.homeNVP || ''}</TableCell>
                          <TableCell sx={{ color: 'success.main' }}>
                            {nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(totals[key].over) ? 
                              `+${(parseFloat(nvp.homeNVP) - parseFloat(totals[key].over)).toFixed(3)}` : 
                              nvp.homeNVP ? (parseFloat(nvp.homeNVP) - parseFloat(totals[key].over)).toFixed(3) : ''}
                          </TableCell>
                          <TableCell rowSpan="2">{nvp.margin ? `${nvp.margin}%` : ''}</TableCell>
                        </TableRow>
                        <TableRow sx={{ 
                          bgcolor: nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(totals[key].under) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                        }}>
                          <TableCell sx={{ fontWeight: 'medium' }}>Under {key}</TableCell>
                          <TableCell>{totals[key].under}</TableCell>
                          <TableCell>{nvp.awayNVP || ''}</TableCell>
                          <TableCell sx={{ color: 'success.main' }}>
                            {nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(totals[key].under) ? 
                              `+${(parseFloat(nvp.awayNVP) - parseFloat(totals[key].under)).toFixed(3)}` : 
                              nvp.awayNVP ? (parseFloat(nvp.awayNVP) - parseFloat(totals[key].under)).toFixed(3) : ''}
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>
      </Paper>
    );
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
                        sx={{ cursor: 'pointer' }}
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
