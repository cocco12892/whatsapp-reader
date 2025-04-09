// Modified version of AlertUtils.js with automatic chart sending

import React from 'react';
import html2canvas from 'html2canvas'; // Make sure this is imported

// Cache for sent notifications (persistent between page reloads)
let sentNotificationsCache = {};
// Cache for alerts waiting for NVP calculation before sending
let pendingAlertNotifications = {};

// Load notification cache from localStorage on startup
try {
  const savedCache = localStorage.getItem('sentAlertNotificationsCache');
  if (savedCache) {
    sentNotificationsCache = JSON.parse(savedCache);
    
    // Clean notifications older than 24 hours
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    Object.keys(sentNotificationsCache).forEach(key => {
      if (now - sentNotificationsCache[key] > oneDayMs) {
        delete sentNotificationsCache[key];
      }
    });
  }
} catch (e) {
  console.error('Error loading notification cache:', e);
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

// NEW FUNCTION: Send chart image for an alert
const sendChartImageForAlert = async (alert, chatId) => {
  try {
    // Check if we've already sent a chart for this event in the last hour
    const eventKey = `event_chart_${alert.eventId}`;
    const now = Date.now();
    const lastSentTime = sentNotificationsCache[eventKey] || 0;
    const oneHourMs = 3600000; // 1 hour in milliseconds
    
    if (now - lastSentTime < oneHourMs) {
      console.log(`Chart already sent for EventID ${alert.eventId} in the last hour (${Math.floor((now - lastSentTime) / 60000)} minutes ago)`);
      return false;
    }
    
    // Generate message for chart caption
    const caption = `📊 *MATCH*: ${alert.home} vs ${alert.away}\n` +
                    `Market: ${alert.lineType === 'MONEYLINE' || alert.lineType === 'money_line' ? 
                      `MONEYLINE ${alert.outcome.toUpperCase()}` : 
                      alert.lineType}`;
    
    console.log(`Generating chart for EventID ${alert.eventId}`);
    
    // Send chart image using existing function
    const chartSent = await sendChartImage(alert.eventId, chatId, caption);
    
    if (chartSent) {
      // Mark this chart as sent and save to localStorage
      sentNotificationsCache[eventKey] = now;
      localStorage.setItem('sentAlertNotificationsCache', JSON.stringify(sentNotificationsCache));
      console.log(`Chart sent successfully for EventID ${alert.eventId}`);
    }
    
    return chartSent;
  } catch (error) {
    console.error('Error sending chart for alert:', error);
    return false;
  }
};

// Cache for event data to avoid repeated calls
const eventDataCache = {};
const eventDataTimestamps = {};
const pendingRequests = {};

// Function to send a message
const sendAlertMessage = async (alert, chatId) => {
  try {
    const eventKey = `event_${alert.eventId}`;
    const now = Date.now();
    
    // Prepare message with required information
    const message = `📊 *MATCH*: ${alert.home} vs ${alert.away}\n` +
                    `📈 *FROM*: ${alert.changeFrom}\n` +
                    `📉 *TO*: ${alert.changeTo}\n` +
                    `🔢 *NVP*: ${alert.nvp}\n` +
                    `${alert.lineType === 'MONEYLINE' || alert.lineType === 'money_line' ? 
                      `*MONEYLINE ${alert.outcome.toUpperCase()}*` : 
                      alert.lineType}`;
    
    // Send text message
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
      throw new Error(`Error sending notification: ${response.statusText}`);
    }
    
    // Mark this notification as sent and save to localStorage
    sentNotificationsCache[eventKey] = now;
    localStorage.setItem('sentAlertNotificationsCache', JSON.stringify(sentNotificationsCache));
    
    console.log(`Notification sent successfully for EventID ${alert.eventId}`);
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

export const sendChartImage = async (eventId, chatId, message) => {
  try {
    // Verifica se la funzione renderChartForAlert è disponibile globalmente
    if (typeof window.renderChartForAlert !== 'function') {
      console.error('La funzione renderChartForAlert non è disponibile. Assicurati che AlertTable sia montato.');
      
      // Fallback: usa il metodo tradizionale della finestra
      return sendChartImageFallback(eventId, chatId, message);
    }
    
    console.log(`Generazione grafico per EventID ${eventId}`);
    
    // Usa la funzione globale per renderizzare il grafico
    const chartCanvas = await window.renderChartForAlert(eventId);
    
    // Converti il canvas in un blob
    const blob = await new Promise(resolve => chartCanvas.toBlob(resolve, 'image/png'));
    
    // Crea il FormData per inviare l'immagine
    const formData = new FormData();
    formData.append('image', blob, `chart-${eventId}-${Date.now()}.png`);
    formData.append('caption', message);
    
    // Invia l'immagine alla chat
    const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/send`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`Errore nell'invio dell'immagine: ${response.statusText}`);
    }
    
    console.log(`Immagine del grafico inviata con successo per EventID ${eventId}`);
    return true;
  } catch (error) {
    console.error('Errore nell\'invio dell\'immagine del grafico:', error);
    return false;
  }
};

// Funzione di fallback che usa il metodo della finestra (come metodo alternativo)
const sendChartImageFallback = async (eventId, chatId, message) => {
  try {
    // Apri una finestra nascosta con il grafico
    const chartWindow = window.open('', '_blank', 'width=400,height=400,hidden=true');
    if (!chartWindow) {
      throw new Error('Impossibile aprire la finestra per il grafico');
    }
    
    // Crea un elemento div per il grafico
    chartWindow.document.body.innerHTML = `
      <div id="chart-container" style="width:400px;height:400px;"></div>
    `;
    
    // Aggiungi gli stili necessari
    const styleElement = chartWindow.document.createElement('style');
    styleElement.textContent = `
      body { margin: 0; padding: 0; background-color: white; }
      #chart-container { width: 400px; height: 400px; }
    `;
    chartWindow.document.head.appendChild(styleElement);
    
    // Attendi che il DOM sia pronto
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Cattura l'immagine del grafico
    const chartElement = chartWindow.document.getElementById('chart-container');
    const canvas = await html2canvas(chartElement, {
      backgroundColor: '#fff',
      scale: 2,
      logging: false,
      useCORS: true,
      width: 400,
      height: 400
    });
    
    // Converti il canvas in un blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    
    // Chiudi la finestra
    chartWindow.close();
    
    // Crea un FormData per inviare l'immagine
    const formData = new FormData();
    formData.append('image', blob, `chart-${eventId}-${Date.now()}.png`);
    formData.append('caption', message);
    
    // Invia l'immagine alla chat
    const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/send`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`Errore nell'invio dell'immagine: ${response.statusText}`);
    }
    
    console.log(`Immagine del grafico inviata con successo`);
    return true;
  } catch (error) {
    console.error('Errore nell\'invio dell\'immagine del grafico:', error);
    return false;
  }
};

// Modifica calculateAlertNVP per inviare automaticamente anche il grafico
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
  
      // Verifica se l'alert è più vecchio di 2 minuti
      const alertTimestamp = parseInt(alert.id.split('-')[0]);
      const twoMinutesMs = 2 * 60 * 1000; // 2 minuti in millisecondi
      const isAlertTooOld = now - alertTimestamp > twoMinutesMs;
  
      if (isAlertTooOld) {
        console.log(`Alert non inviato per EventID ${alert.eventId}: l'alert è più vecchio di 2 minuti (${new Date(alertTimestamp).toLocaleString()})`);
        return nvpValue;
      }
  
      // Invia la notifica solo se la partita è entro le prossime 24 ore
      if (!matchTime || (matchTime - now <= oneDayMs)) {
        // Crea una copia dell'alert con il valore NVP
        const alertWithNVP = { ...alert, nvp: nvpValue };
    
        // Invia la notifica di testo
        const notificationSent = await sendAlertNotification(alertWithNVP, "120363401713435750@g.us");
        
        // Se la notifica di testo è stata inviata con successo, invia anche il grafico
        if (notificationSent) {
          // Aggiungi un piccolo ritardo per assicurarti che il messaggio di testo venga inviato prima
          setTimeout(async () => {
            try {
              // Prepara il messaggio per la didascalia del grafico
              const chartCaption = `📊 *MATCH*: ${alert.home} vs ${alert.away}\n` +
                                  `Market: ${alert.lineType === 'MONEYLINE' || alert.lineType === 'money_line' ? 
                                    `MONEYLINE ${alert.outcome.toUpperCase()}` : 
                                    alert.lineType}`;
              
              console.log(`Invio grafico per EventID ${alert.eventId}`);
              
              // Invia l'immagine del grafico usando la funzione esistente
              await sendChartImage(alert.eventId, "120363401713435750@g.us", chartCaption);
            } catch (err) {
              console.error('Errore durante l\'invio del grafico:', err);
            }
          }, 1500); // Attendi 1.5 secondi prima di inviare il grafico
        }
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

// Function to send alert notification to specified chat
export const sendAlertNotification = async (alert, chatId) => {
  try {
    // Check if we've already sent a notification for this EventID in the last hour
    const eventKey = `event_${alert.eventId}`;
    const now = Date.now();
    const lastSentTime = sentNotificationsCache[eventKey] || 0;
    const oneHourMs = 3600000; // 1 hour in milliseconds
    
    if (now - lastSentTime < oneHourMs) {
      console.log(`Notification already sent for EventID ${alert.eventId} in the last hour (${Math.floor((now - lastSentTime) / 60000)} minutes ago)`);
      return false;
    }
    
    // Check that the alert has an NVP value
    if (!alert.nvp) {
      console.log(`Alert ${alert.id} has no NVP value, not sending notification`);
      return false;
    }
    
    // Prepare message with required information
    const message = `📊 *MATCH*: ${alert.home} vs ${alert.away}\n` +
                    `📈 *FROM*: ${alert.changeFrom}\n` +
                    `📉 *TO*: ${alert.changeTo}\n` +
                    `🔢 *NVP*: ${alert.nvp}\n` +
                    `${alert.lineType === 'MONEYLINE' || alert.lineType === 'money_line' ? 
                      `*MONEYLINE ${alert.outcome.toUpperCase()}*` : 
                      alert.lineType}`;
    
    // Add a 500ms delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Send text message
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
      throw new Error(`Error sending notification: ${response.statusText}`);
    }
    
    // Mark this notification as sent and save to localStorage
    sentNotificationsCache[eventKey] = now;
    localStorage.setItem('sentAlertNotificationsCache', JSON.stringify(sentNotificationsCache));
    
    console.log(`Notification sent successfully for EventID ${alert.eventId}`);
    return true;
  } catch (error) {
    console.error('Error sending notification:', error);
    return false;
  }
};

// Function to get event data with cache and request deduplication
export const getEventData = async (eventId) => {
  // If we already have a pending request for this event, wait for that instead of making a new one
  if (pendingRequests[eventId]) {
    return pendingRequests[eventId];
  }
  
  // Check if we have cached data and if it's still valid (less than 5 minutes old)
  const now = Date.now();
  if (eventDataCache[eventId] && eventDataTimestamps[eventId] && 
      (now - eventDataTimestamps[eventId] < 5 * 60 * 1000)) {
    return eventDataCache[eventId];
  }
  
  // Create a new promise for this request
  pendingRequests[eventId] = new Promise(async (resolve, reject) => {
    try {
      console.log(`Fetching event data for ${eventId}`);
      const response = await fetch(`https://swordfish-production.up.railway.app/events/${eventId}`);
      if (response.ok) {
        const result = await response.json();
        // Save data in cache
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
      // Remove this request from the list of pending requests
      delete pendingRequests[eventId];
    }
  });
  
  return pendingRequests[eventId];
};

// Add NVP values to alerts - optimized to reduce API calls
export const addNVPToAlerts = async (alertsList, nvpCache, calculateTwoWayNVP, calculateThreeWayNVP) => {
  // Filter alerts that don't already have an NVP value in the cache
  const alertsNeedingNVP = alertsList.filter(alert => {
    const cacheKey = `${alert.eventId}-${alert.lineType}-${alert.outcome}-${alert.points || ''}`;
    return !nvpCache[cacheKey];
  });
  
  // If all alerts already have NVP values in the cache, return immediately
  if (alertsNeedingNVP.length === 0) {
    const alertsWithCachedNVP = alertsList.map(alert => {
      const cacheKey = `${alert.eventId}-${alert.lineType}-${alert.outcome}-${alert.points || ''}`;
      return { ...alert, nvp: nvpCache[cacheKey] };
    });
    return { alertsWithNVP: alertsWithCachedNVP, updatedNvpCache: nvpCache };
  }
  
  // Get only unique event IDs for alerts that need NVP
  const uniqueEventIds = [...new Set(alertsNeedingNVP.map(alert => alert.eventId))];
  const eventData = {};
  const updatedNvpCache = { ...nvpCache };
  
  // Fetch all event data in parallel, but only for necessary events
  // Use getEventData to leverage cache and deduplicate requests
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
      
    // Add match start time to alert
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