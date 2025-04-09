import React from 'react';

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

// Add NVP values to alerts
export const addNVPToAlerts = async (alertsList, nvpCache, calculateTwoWayNVP, calculateThreeWayNVP) => {
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
  
  return { alertsWithNVP, updatedNvpCache };
};
