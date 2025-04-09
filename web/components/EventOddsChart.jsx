import React, { useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { 
  Box, Typography, Select, MenuItem, 
  FormControl, InputLabel, Paper, CircularProgress,
  Button, Snackbar, Alert, ButtonGroup
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import ImageIcon from '@mui/icons-material/Image';
import html2canvas from 'html2canvas';
import { getEventData, sendAlertNotification } from './AlertUtils';

const EventOddsChart = ({ eventId }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [marketInfo, setMarketInfo] = useState({
    homeTeam: '',
    awayTeam: '',
    marketType: '',
    marketOption: '',
    hasData: false
  });
  const [sendingAlert, setSendingAlert] = useState(false);
  const [alertSent, setAlertSent] = useState(false);
  const [alertError, setAlertError] = useState(null);
  const [sendingImage, setSendingImage] = useState(false);
  const chartRef = useRef(null);
  const [availableMarkets, setAvailableMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [marketOptions, setMarketOptions] = useState([]);
  
  useEffect(() => {
    const fetchEventData = async () => {
      if (!eventId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const eventData = await getEventData(eventId);
        if (!eventData) {
          throw new Error('Nessun dato disponibile per questo evento');
        }
        
        // Estrai informazioni di base
        const homeTeam = eventData.home;
        const awayTeam = eventData.away;
        
        // Estrai tutti i tipi di mercato disponibili
        const markets = [];
        const period = eventData.periods?.num_0;
        
        if (!period || !period.history) {
          throw new Error('Nessun dato storico disponibile per questo evento');
        }
        
        if (period.history.moneyline && Object.keys(period.history.moneyline).length > 0) {
          markets.push('moneyline');
        }
        
        if (period.history.spreads && Object.keys(period.history.spreads).length > 0) {
          markets.push('spreads');
        }
        
        if (period.history.totals && Object.keys(period.history.totals).length > 0) {
          markets.push('totals');
        }
        
        if (period.history.team_totals && Object.keys(period.history.team_totals).length > 0) {
          markets.push('team_totals');
        }
        
        setAvailableMarkets(markets);
        
        if (markets.length > 0) {
          // Seleziona il primo mercato di default
          const defaultMarket = markets[0];
          setSelectedMarket(defaultMarket);
          
          // Ottieni le opzioni per questo mercato
          const options = getMarketOptions(period.history, defaultMarket);
          setMarketOptions(options);
          
          if (options.length > 0) {
            // Seleziona la prima opzione di default
            const defaultOption = options[0].value;
            setSelectedOption(defaultOption);
            
            // Carica i dati per questa opzione
            const chartData = loadChartData(period.history, defaultMarket, defaultOption);
            setData(chartData);
            
            setMarketInfo({
              homeTeam,
              awayTeam,
              marketType: defaultMarket,
              marketOption: defaultOption,
              hasData: chartData.length > 0
            });
          }
        }
      } catch (error) {
        console.error('Errore nel caricamento dei dati:', error);
        setError(error.message || 'Errore nel caricamento dei dati');
      } finally {
        setLoading(false);
      }
    };
    
    fetchEventData();
  }, [eventId]);
  
  // Funzione per ottenere le opzioni disponibili per un mercato
  const getMarketOptions = (historyData, marketType) => {
    if (!historyData || !marketType || !historyData[marketType]) {
      return [];
    }
    
    const options = [];
    
    if (marketType === 'moneyline') {
      if (historyData.moneyline.home && historyData.moneyline.home.length > 0) {
        options.push({ label: 'Home', value: 'home' });
      }
      if (historyData.moneyline.away && historyData.moneyline.away.length > 0) {
        options.push({ label: 'Away', value: 'away' });
      }
      if (historyData.moneyline.draw && historyData.moneyline.draw.length > 0) {
        options.push({ label: 'Draw', value: 'draw' });
      }
    } 
    else if (marketType === 'totals') {
      for (const [key, value] of Object.entries(historyData.totals)) {
        if (value.over && value.over.length > 0) {
          options.push({ label: `Over ${key}`, value: `${key}-over` });
        }
        if (value.under && value.under.length > 0) {
          options.push({ label: `Under ${key}`, value: `${key}-under` });
        }
      }
    }
    else if (marketType === 'spreads') {
      for (const [key, value] of Object.entries(historyData.spreads)) {
        if (value.home && value.home.length > 0) {
          options.push({ label: `Home ${key}`, value: `${key}-home` });
        }
        if (value.away && value.away.length > 0) {
          options.push({ label: `Away ${key}`, value: `${key}-away` });
        }
      }
    }
    else if (marketType === 'team_totals') {
      for (const team of ['home', 'away']) {
        if (historyData.team_totals[team]) {
          for (const [key, value] of Object.entries(historyData.team_totals[team])) {
            if (value.over && value.over.length > 0) {
              options.push({ label: `${team === 'home' ? 'Home' : 'Away'} Over ${key}`, value: `${team}-${key}-over` });
            }
            if (value.under && value.under.length > 0) {
              options.push({ label: `${team === 'home' ? 'Home' : 'Away'} Under ${key}`, value: `${team}-${key}-under` });
            }
          }
        }
      }
    }
    
    return options;
  };
  
  // Funzione per caricare i dati del grafico in base al mercato e all'opzione selezionati
  const loadChartData = (historyData, marketType, option) => {
    if (!historyData || !marketType || !option) {
      return [];
    }
    
    let rawData = [];
    
    if (marketType === 'moneyline') {
      rawData = historyData.moneyline[option] || [];
    } 
    else if (marketType === 'totals') {
      const [points, side] = option.split('-');
      if (historyData.totals[points] && historyData.totals[points][side]) {
        rawData = historyData.totals[points][side];
      }
    }
    else if (marketType === 'spreads') {
      const [hdp, side] = option.split('-');
      if (historyData.spreads[hdp] && historyData.spreads[hdp][side]) {
        rawData = historyData.spreads[hdp][side];
      }
    }
    else if (marketType === 'team_totals') {
      const [team, points, side] = option.split('-');
      if (historyData.team_totals[team] && 
          historyData.team_totals[team][points] && 
          historyData.team_totals[team][points][side]) {
        rawData = historyData.team_totals[team][points][side];
      }
    }
    
    // Trasforma i dati grezzi in formato per il grafico
    return rawData.map(entry => {
      const [timestamp, odds, max] = entry;
      const date = new Date(timestamp);
      
      return {
        timestamp,
        formattedDate: `${date.getDate()}/${date.getMonth() + 1} ${date.getHours()}:${date.getMinutes()}`,
        label: `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`,
        odds,
        limit: max
      };
    }).filter(item => item.odds !== 0).sort((a, b) => a.timestamp - b.timestamp);
  };
  
  // Gestori degli eventi per i menu a discesa
  const handleMarketChange = async (e) => {
    const newMarket = e.target.value;
    setSelectedMarket(newMarket);
    
    try {
      setLoading(true);
      const eventData = await getEventData(eventId);
      
      if (!eventData || !eventData.periods || !eventData.periods.num_0 || !eventData.periods.num_0.history) {
        throw new Error('Dati non disponibili');
      }
      
      const options = getMarketOptions(eventData.periods.num_0.history, newMarket);
      setMarketOptions(options);
      
      if (options.length > 0) {
        const newOption = options[0].value;
        setSelectedOption(newOption);
        
        const chartData = loadChartData(eventData.periods.num_0.history, newMarket, newOption);
        setData(chartData);
        
        setMarketInfo({
          ...marketInfo,
          marketType: newMarket,
          marketOption: newOption,
          hasData: chartData.length > 0
        });
      } else {
        setData([]);
        setSelectedOption('');
        setMarketInfo({
          ...marketInfo,
          marketType: newMarket,
          marketOption: '',
          hasData: false
        });
      }
    } catch (error) {
      console.error('Errore nel caricamento dei dati:', error);
      setError(error.message || 'Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
    }
  };
  
  const handleOptionChange = async (e) => {
    const newOption = e.target.value;
    setSelectedOption(newOption);
    
    try {
      setLoading(true);
      const eventData = await getEventData(eventId);
      
      if (!eventData || !eventData.periods || !eventData.periods.num_0 || !eventData.periods.num_0.history) {
        throw new Error('Dati non disponibili');
      }
      
      const chartData = loadChartData(eventData.periods.num_0.history, selectedMarket, newOption);
      setData(chartData);
      
      setMarketInfo({
        ...marketInfo,
        marketOption: newOption,
        hasData: chartData.length > 0
      });
    } catch (error) {
      console.error('Errore nel caricamento dei dati:', error);
      setError(error.message || 'Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
    }
  };
  
  // Trova i valori minimi e massimi per le quote e i limiti
  const minOdds = data.length > 0 ? Math.floor((Math.min(...data.map(item => item.odds)) - 0.05) * 100) / 100 : 1.0;
  const maxOdds = data.length > 0 ? Math.ceil((Math.max(...data.map(item => item.odds)) + 0.05) * 100) / 100 : 4.0;
  const minLimit = data.length > 0 ? Math.max(0, Math.min(...data.map(item => item.limit)) - 20) : 80;
  const maxLimit = data.length > 0 ? Math.max(...data.map(item => item.limit)) + 20 : 220;
  
  // Formatta il titolo del mercato per la visualizzazione
  const getMarketTitle = () => {
    if (!selectedMarket || !selectedOption) return '';
    
    if (selectedMarket === 'moneyline') {
      return `Moneyline ${selectedOption.charAt(0).toUpperCase() + selectedOption.slice(1)}`;
    } 
    else if (selectedMarket === 'totals') {
      const [points, side] = selectedOption.split('-');
      return `[totals] ${side.charAt(0).toUpperCase() + side.slice(1)} ${points}`;
    }
    else if (selectedMarket === 'spreads') {
      const [hdp, side] = selectedOption.split('-');
      return `[spreads] ${side.charAt(0).toUpperCase() + side.slice(1)} ${hdp}`;
    }
    else if (selectedMarket === 'team_totals') {
      const [team, points, side] = selectedOption.split('-');
      return `[team_totals] ${team.charAt(0).toUpperCase() + team.slice(1)} ${side.charAt(0).toUpperCase() + side.slice(1)} ${points}`;
    }
    
    return '';
  };
  
  const handleSendAlert = async () => {
    if (!eventId || !data.length || !marketInfo.homeTeam) {
      setAlertError("Dati insufficienti per inviare l'alert");
      return;
    }
    
    setSendingAlert(true);
    setAlertError(null);
    
    try {
      // Prepara i dati dell'alert
      const alertData = {
        id: `${Date.now()}-${eventId}`,
        eventId: eventId,
        home: marketInfo.homeTeam,
        away: marketInfo.awayTeam,
        changeFrom: data.length > 1 ? data[0].odds.toFixed(2) : "N/A",
        changeTo: data.length > 0 ? data[data.length - 1].odds.toFixed(2) : "N/A",
        nvp: data.length > 0 ? data[data.length - 1].odds.toFixed(3) : "N/A",
        lineType: selectedMarket.toUpperCase(),
        outcome: selectedOption.includes('-') ? selectedOption.split('-')[0] : selectedOption
      };
      
      // Usa sempre la stessa chat per inviare il messaggio
      const chatId = "120363401713435750@g.us";
      
      // Prepara il messaggio con le informazioni richieste
      const message = `📊 *MATCH*: ${alertData.home} vs ${alertData.away}\n` +
                      `📈 *FROM*: ${alertData.changeFrom}\n` +
                      `📉 *TO*: ${alertData.changeTo}\n` +
                      `🔢 *NVP*: ${alertData.nvp}\n` +
                      `${alertData.lineType === 'MONEYLINE' ? 
                        `*MONEYLINE ${alertData.outcome.toUpperCase()}*` : 
                        alertData.lineType}`;
      
      // Invia il messaggio direttamente alla chat
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: message
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Errore nell'invio: ${response.statusText}`);
      }
      
      console.log('Alert inviato con successo:', message);
      setAlertSent(true);
      setTimeout(() => setAlertSent(false), 3000);
    } catch (error) {
      console.error("Errore nell'invio dell'alert:", error);
      setAlertError("Errore nell'invio dell'alert: " + (error.message || "Errore sconosciuto"));
    } finally {
      setSendingAlert(false);
    }
  };
  
  const handleSendImage = async () => {
    if (!chartRef.current || !marketInfo.hasData) {
      setAlertError("Impossibile catturare il grafico");
      return;
    }
    
    setSendingImage(true);
    setAlertError(null);
    
    try {
      // Cattura il grafico come immagine
      const chartElement = chartRef.current;
      const canvas = await html2canvas(chartElement, {
        backgroundColor: '#fff',
        scale: 2, // Migliora la qualità dell'immagine
        logging: false,
        useCORS: true,
        width: 400, // Assicura che la larghezza sia fissa
        height: 400 // Assicura che l'altezza sia fissa
      });
      
      // Converti il canvas in un blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png');
      });
      
      if (!blob) {
        throw new Error("Impossibile convertire il grafico in immagine");
      }
      
      // Prepara i dati dell'alert per la didascalia
      const alertData = {
        id: `${Date.now()}-${eventId}`,
        eventId: eventId,
        home: marketInfo.homeTeam,
        away: marketInfo.awayTeam,
        changeFrom: data.length > 1 ? data[0].odds.toFixed(2) : "N/A",
        changeTo: data.length > 0 ? data[data.length - 1].odds.toFixed(2) : "N/A",
        nvp: data.length > 0 ? data[data.length - 1].odds.toFixed(3) : "N/A",
        lineType: selectedMarket.toUpperCase(),
        outcome: selectedOption.includes('-') ? selectedOption.split('-')[0] : selectedOption
      };
      
      // Prepara il messaggio con le informazioni richieste
      const caption = `📊 *MATCH*: ${alertData.home} vs ${alertData.away}\n` +
                      `📈 *FROM*: ${alertData.changeFrom}\n` +
                      `📉 *TO*: ${alertData.changeTo}\n` +
                      `🔢 *NVP*: ${alertData.nvp}\n` +
                      `${alertData.lineType === 'MONEYLINE' ? 
                        `*MONEYLINE ${alertData.outcome.toUpperCase()}*` : 
                        alertData.lineType}`;
      
      // Crea un FormData per inviare l'immagine direttamente
      const formData = new FormData();
      formData.append('image', blob, `chart-${eventId}-${Date.now()}.png`);
      formData.append('caption', caption);
      
      // Usa sempre la stessa chat per inviare l'immagine
      const chatId = "120363401713435750@g.us";
      
      // Invia l'immagine direttamente alla chat
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/send`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`Errore nell'invio dell'immagine: ${response.statusText}`);
      }
      
      console.log('Immagine inviata con successo');
      setAlertSent(true);
      setTimeout(() => setAlertSent(false), 3000);
    } catch (error) {
      console.error("Errore nell'invio dell'immagine:", error);
      setAlertError("Errore nell'invio dell'immagine: " + (error.message || "Errore sconosciuto"));
    } finally {
      setSendingImage(false);
    }
  };
  
  if (loading && !data.length) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <CircularProgress />
      </Box>
    );
  }
  
  if (error) {
    return (
      <Box sx={{ p: 2, bgcolor: 'error.light', borderRadius: 1 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }
  
  return (
    <Paper sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 2, mb: 2 }}>
      <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="subtitle2" color="primary.main" sx={{ mr: 1 }}>Home:</Typography>
            <Typography variant="body2">{marketInfo.homeTeam}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="subtitle2" color="primary.main" sx={{ mr: 1 }}>Away:</Typography>
            <Typography variant="body2">{marketInfo.awayTeam}</Typography>
          </Box>
          <Typography variant="subtitle1" color="secondary.main">{getMarketTitle()}</Typography>
        </Box>
        <Box sx={{ mt: { xs: 2, md: 0 }, display: 'flex', gap: 2 }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Market</InputLabel>
            <Select
              value={selectedMarket}
              onChange={handleMarketChange}
              label="Market"
              disabled={loading}
            >
              {availableMarkets.map(market => (
                <MenuItem key={market} value={market}>
                  {market.charAt(0).toUpperCase() + market.slice(1)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Option</InputLabel>
            <Select
              value={selectedOption}
              onChange={handleOptionChange}
              label="Option"
              disabled={marketOptions.length === 0 || loading}
            >
              {marketOptions.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>
      
      <Box 
        sx={{ 
          height: 400, 
          width: 400, 
          position: 'relative',
          margin: '0 auto' // Centra il grafico
        }} 
        ref={chartRef}
      >
        {loading && (
          <Box sx={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            bgcolor: 'rgba(255, 255, 255, 0.7)',
            zIndex: 1
          }}>
            <CircularProgress />
          </Box>
        )}
        
        {marketInfo.hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="label" 
                tick={{ fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis 
                yAxisId="left"
                domain={[minOdds, maxOdds]} 
                tickFormatter={(value) => value.toFixed(2)}
                tickCount={5}
                allowDecimals={true}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                domain={[minLimit, maxLimit]} 
                tickCount={3}
              />
              <Tooltip 
                formatter={(value, name) => [
                  name === 'odds' ? value.toFixed(2) : value, 
                  name === 'odds' ? 'price' : 'limit'
                ]}
                labelFormatter={(label) => {
                  const matchingData = data.find(item => item.label === label);
                  return matchingData ? `${matchingData.formattedDate}` : label;
                }}
              />
              <Legend />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="odds" 
                name="price" 
                stroke="#4caf50" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="limit" 
                name="limit" 
                stroke="#ff9800" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%',
            color: 'text.secondary'
          }}>
            <Typography>Nessun dato disponibile per il mercato selezionato</Typography>
          </Box>
        )}
      </Box>
      
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: '#4caf50', borderRadius: '50%', mr: 0.5 }}></Box>
            <Typography variant="caption">price</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: 12, height: 12, bgcolor: '#ff9800', borderRadius: '50%', mr: 0.5 }}></Box>
            <Typography variant="caption">limit</Typography>
          </Box>
        </Box>
        
        <ButtonGroup variant="contained" size="small">
          <Button
            color="primary"
            startIcon={<SendIcon />}
            onClick={handleSendAlert}
            disabled={sendingAlert || sendingImage || !marketInfo.hasData}
          >
            {sendingAlert ? 'Invio...' : 'Testo'}
          </Button>
          <Button
            color="secondary"
            startIcon={<ImageIcon />}
            onClick={handleSendImage}
            disabled={sendingAlert || sendingImage || !marketInfo.hasData}
          >
            {sendingImage ? 'Invio...' : 'Immagine'}
          </Button>
        </ButtonGroup>
      </Box>
      
      {/* Feedback per l'utente */}
      <Snackbar 
        open={alertSent} 
        autoHideDuration={3000} 
        onClose={() => setAlertSent(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Alert inviato con successo!
        </Alert>
      </Snackbar>
      
      <Snackbar 
        open={!!alertError} 
        autoHideDuration={5000} 
        onClose={() => setAlertError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" sx={{ width: '100%' }}>
          {alertError}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default EventOddsChart;
