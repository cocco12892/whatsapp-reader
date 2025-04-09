import React from 'react';

// NVP Calculation Functions
export const calculateNVPValues = (odds, tolerance = 0.0001, maxIterations = 100) => {
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
export const calculateTwoWayNVP = (home, away) => {
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
export const calculateThreeWayNVP = (home, draw, away) => {
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
