import React from 'react';

// Cache per le notifiche inviate (persistente tra ricaricamenti della pagina)
let sentNotificationsCache = {};
// Cache per gli alert in attesa di calcolo NVP prima dell'invio
let pendingAlertNotifications = {};

// Carica la cache delle notifiche dal localStorage all'avvio
try {
  const savedCache = localStorage.getItem('sentAlertNotificationsCache');
  if (savedCache) {
    sentNotificationsCache = JSON.parse(savedCache);
    
    // Pulizia delle notifiche più vecchie di 24 ore
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    Object.keys(sentNotificationsCache).forEach(key => {
      if (now - sentNotificationsCache[key] > oneDayMs) {
        delete sentNotificationsCache[key];
      }
    });
  }
} catch (e) {
  console.error('Errore nel caricamento della cache delle notifiche:', e);
  sentNotificationsCache = {};
}

// Utility functions for AlertTable component
export const getDiffColor = (diffValue) => {
  if (!diffValue) return 'inherit';
  const diff = parseFloat(diffValue);
  
  if (diff > 0.5) return 'success.main'; // Very good value
  if (diff > 0.2) return 'success.light'; // Good value
  if (diff > 0) return '#4caf50'; // Positive but small value
  if (diff > -0.1) return 'text.primary'; // Negative but close to fair
  return 'error.light'; // Bad value
};

export const isWithin24Hours = (timestamp) => {
  if (!timestamp) return false;
  
  const matchTime = new Date(parseInt(timestamp));
  const now = new Date();
  const diffMs = matchTime - now;
  const diffHours = diffMs / (1000 * 60 * 60);
  
  return diffHours >= 0 && diffHours <= 24;
};

// Function to calculate if a bet is worth taking (positive EV)
export const isPositiveEV = (nvp, currentOdds) => {
  if (!nvp || !currentOdds) return false;
  return parseFloat(nvp) > parseFloat(currentOdds);
};

// Calculate NVP for a specific alert
export const calculateAlertNVP = async (alert, calculateTwoWayNVP, calculateThreeWayNVP) => {
  try {
    // Usa la funzione getEventData per ottenere i dati dell'evento con cache
    const data = await getEventData(alert.eventId);
    if (!data) {
      return null;
    }
    
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
    
    // Dopo aver calcolato il valore NVP, verifica se è un alert di tipo money_line e invia la notifica
    if (nvpValue && (alert.lineType === 'MONEYLINE' || alert.lineType === 'money_line') && 
        (alert.outcome.toLowerCase().includes('home') || alert.outcome.toLowerCase().includes('away'))) {

      // Verifica se la partita è tra più di un giorno
      const now = Date.now();
      const matchTime = parseInt(alert.starts);
      const oneDayMs = 24 * 60 * 60 * 1000; // 24 ore in millisecondi
  
      // Invia la notifica solo se la partita è entro le prossime 24 ore
      if (!matchTime || (matchTime - now <= oneDayMs)) {
        // Crea una copia dell'alert con il valore NVP
        const alertWithNVP = { ...alert, nvp: nvpValue };
    
        // Invia la notifica solo dopo aver calcolato il valore NVP
        // Utilizziamo await per assicurarci che la notifica venga inviata prima di continuare
        await sendAlertNotification(alertWithNVP, "120363401713435750@g.us");
      } else {
        console.log(`Alert non inviato per EventID ${alert.eventId}: la partita è tra più di un giorno (${new Date(matchTime).toLocaleString()})`);
      }
    }
    
    return nvpValue;
  } catch (err) {
    console.error('Error calculating NVP for alert:', err);
    return null;
  }
};

// Cache globale per i dati degli eventi per evitare chiamate ripetute
const eventDataCache = {};
const eventDataTimestamps = {};
const pendingRequests = {};


// Funzione interna per inviare effettivamente il messaggio
const sendAlertMessage = async (alert, chatId) => {
  try {
    const eventKey = `event_${alert.eventId}`;
    const now = Date.now();
    
    // Prepara il messaggio con le informazioni richieste
    const message = `🚨 *ALERT NoVig*\n\n` +
                    `📊 *MATCH*: ${alert.home} vs ${alert.away}\n` +
                    `📈 *FROM*: ${alert.changeFrom}\n` +
                    `📉 *TO*: ${alert.changeTo}\n` +
                    `🔢 *NVP*: ${alert.nvp}\n` +
                    `🆔 *EventID*: ${alert.eventId}`;
    
    // Invia il messaggio alla chat
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
      throw new Error(`Errore nell'invio della notifica: ${response.statusText}`);
    }
    
    // Segna questa notifica come inviata e salva nel localStorage
    sentNotificationsCache[eventKey] = now;
    localStorage.setItem('sentAlertNotificationsCache', JSON.stringify(sentNotificationsCache));
    
    console.log(`Notifica inviata con successo per l'EventID ${alert.eventId}`);
  } catch (error) {
    console.error('Errore nell\'invio della notifica:', error);
  }
};

// Funzione per inviare una notifica di alert alla chat specificata
export const sendAlertNotification = async (alert, chatId) => {
  try {
    // Verifica se abbiamo già inviato una notifica per questo EventID nell'ultima ora
    const eventKey = `event_${alert.eventId}`;
    const now = Date.now();
    const lastSentTime = sentNotificationsCache[eventKey] || 0;
    const oneHourMs = 3600000; // 1 ora in millisecondi
    
    if (now - lastSentTime < oneHourMs) {
      console.log(`Notifica già inviata per l'EventID ${alert.eventId} nell'ultima ora (${Math.floor((now - lastSentTime) / 60000)} minuti fa)`);
      return false;
    }
    
    // Verifica che l'alert abbia un valore NVP
    if (!alert.nvp) {
      console.log(`Alert ${alert.id} non ha un valore NVP, non invio notifica`);
      return false;
    }
    
    // Prepara il messaggio con le informazioni richieste
    const message = `🚨 *ALERT NoVig*\n\n` +
                    `📊 *MATCH*: ${alert.home} vs ${alert.away}\n` +
                    `📈 *FROM*: ${alert.changeFrom}\n` +
                    `📉 *TO*: ${alert.changeTo}\n` +
                    `🔢 *NVP*: ${alert.nvp}\n` +
                    `🆔 *EventID*: ${alert.eventId}`;
    
    // Aggiungiamo un ritardo di 500ms tra le richieste per evitare problemi di rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Invia il messaggio alla chat
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
      throw new Error(`Errore nell'invio della notifica: ${response.statusText}`);
    }
    
    // Segna questa notifica come inviata e salva nel localStorage
    sentNotificationsCache[eventKey] = now;
    localStorage.setItem('sentAlertNotificationsCache', JSON.stringify(sentNotificationsCache));
    
    console.log(`Notifica inviata con successo per l'EventID ${alert.eventId}`);
    return true;
  } catch (error) {
    console.error('Errore nell\'invio della notifica:', error);
    return false;
  }
};

// Funzione per ottenere i dati dell'evento con cache e deduplicazione delle richieste
export const getEventData = async (eventId) => {
  // Se abbiamo già una richiesta in corso per questo evento, attendiamo quella invece di farne una nuova
  if (pendingRequests[eventId]) {
    return pendingRequests[eventId];
  }
  
  // Controlla se abbiamo dati in cache e se sono ancora validi (meno di 5 minuti)
  const now = Date.now();
  if (eventDataCache[eventId] && eventDataTimestamps[eventId] && 
      (now - eventDataTimestamps[eventId] < 5 * 60 * 1000)) {
    return eventDataCache[eventId];
  }
  
  // Crea una nuova promessa per questa richiesta
  pendingRequests[eventId] = new Promise(async (resolve, reject) => {
    try {
      console.log(`Fetching event data for ${eventId}`);
      const response = await fetch(`https://swordfish-production.up.railway.app/events/${eventId}`);
      if (response.ok) {
        const result = await response.json();
        // Salva i dati nella cache
        eventDataCache[eventId] = result.data;
        eventDataTimestamps[eventId] = now;
        resolve(result.data);
      } else {
        reject(new Error(`HTTP error! Status: ${response.status}`));
      }
    } catch (err) {
      console.error(`Error fetching data for event ${eventId}:`, err);
      reject(err);
    } finally {
      // Rimuovi questa richiesta dall'elenco delle richieste in corso
      delete pendingRequests[eventId];
    }
  });
  
  return pendingRequests[eventId];
};

// Add NVP values to alerts - ottimizzato per ridurre le chiamate API
export const addNVPToAlerts = async (alertsList, nvpCache, calculateTwoWayNVP, calculateThreeWayNVP) => {
  // Filtra gli alert che non hanno già un valore NVP nella cache
  const alertsNeedingNVP = alertsList.filter(alert => {
    const cacheKey = `${alert.eventId}-${alert.lineType}-${alert.outcome}-${alert.points || ''}`;
    return !nvpCache[cacheKey];
  });
  
  // Se tutti gli alert hanno già un valore NVP nella cache, restituisci subito
  if (alertsNeedingNVP.length === 0) {
    const alertsWithCachedNVP = alertsList.map(alert => {
      const cacheKey = `${alert.eventId}-${alert.lineType}-${alert.outcome}-${alert.points || ''}`;
      return { ...alert, nvp: nvpCache[cacheKey] };
    });
    return { alertsWithNVP: alertsWithCachedNVP, updatedNvpCache: nvpCache };
  }
  
  // Ottieni solo gli ID evento unici per gli alert che necessitano di NVP
  const uniqueEventIds = [...new Set(alertsNeedingNVP.map(alert => alert.eventId))];
  const eventData = {};
  const updatedNvpCache = { ...nvpCache };
  
  // Fetch all event data in parallel, ma solo per gli eventi necessari
  // Usa la funzione getEventData per sfruttare la cache e deduplicare le richieste
  await Promise.all(uniqueEventIds.map(async (eventId) => {
    try {
      const data = await getEventData(eventId);
      eventData[eventId] = data;
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
  
  return { alertsWithNVP, updatedNvpCache };
};
