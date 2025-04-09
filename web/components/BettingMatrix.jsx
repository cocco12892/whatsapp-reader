import React from 'react';
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
import CloseIcon from '@mui/icons-material/Close';
import { calculateTwoWayNVP, calculateThreeWayNVP } from './NVPCalculations';

// Betting Matrix Component
const BettingMatrix = ({ data, onClose }) => {
  if (!data) return <Box p={2}>No data available</Box>;

  // Extract the latest data for match intero (period 0)
  const periodData = data.periods?.num_0;
  const spreads = periodData?.spreads || {};
  const totals = periodData?.totals || {};
  const moneyline = periodData?.money_line || {};
  
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
        
        {/* Titolo della sezione */}
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Dati di Scommessa
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
        
        {/* MATCH INTERO */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, bgcolor: 'primary.main', color: 'primary.contrastText', p: 1, borderRadius: 1 }}>
            Match Intero
          </Typography>
          
          {/* Money Line Match Intero */}
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
        
        {/* PRIMO TEMPO */}
        {data.periods?.num_1 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, bgcolor: 'secondary.main', color: 'secondary.contrastText', p: 1, borderRadius: 1 }}>
              Primo Tempo
            </Typography>
            
            {/* Money Line Primo Tempo */}
            {data.periods.num_1.money_line && (
              <Box sx={{ mb: 4 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                  Money Line
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
                      {data.periods.num_1.money_line.home && data.periods.num_1.money_line.draw && data.periods.num_1.money_line.away && (() => {
                        const ml = data.periods.num_1.money_line;
                        const nvp = calculateThreeWayNVP(ml.home, ml.draw, ml.away);
                        return (
                          <>
                            <TableRow sx={{ 
                              bgcolor: parseFloat(nvp.homeNVP) > parseFloat(ml.home) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                            }}>
                              <TableCell sx={{ fontWeight: 'medium' }}>{data.home}</TableCell>
                              <TableCell>{ml.home}</TableCell>
                              <TableCell>{nvp.homeNVP}</TableCell>
                              <TableCell sx={{ color: 'success.main' }}>
                                {parseFloat(nvp.homeNVP) > parseFloat(ml.home) ? 
                                  `+${(parseFloat(nvp.homeNVP) - parseFloat(ml.home)).toFixed(3)}` : 
                                  (parseFloat(nvp.homeNVP) - parseFloat(ml.home)).toFixed(3)}
                              </TableCell>
                            </TableRow>
                            <TableRow sx={{ 
                              bgcolor: parseFloat(nvp.drawNVP) > parseFloat(ml.draw) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                            }}>
                              <TableCell sx={{ fontWeight: 'medium' }}>Draw</TableCell>
                              <TableCell>{ml.draw}</TableCell>
                              <TableCell>{nvp.drawNVP}</TableCell>
                              <TableCell sx={{ color: 'success.main' }}>
                                {parseFloat(nvp.drawNVP) > parseFloat(ml.draw) ? 
                                  `+${(parseFloat(nvp.drawNVP) - parseFloat(ml.draw)).toFixed(3)}` : 
                                  (parseFloat(nvp.drawNVP) - parseFloat(ml.draw)).toFixed(3)}
                              </TableCell>
                            </TableRow>
                            <TableRow sx={{ 
                              bgcolor: parseFloat(nvp.awayNVP) > parseFloat(ml.away) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                            }}>
                              <TableCell sx={{ fontWeight: 'medium' }}>{data.away}</TableCell>
                              <TableCell>{ml.away}</TableCell>
                              <TableCell>{nvp.awayNVP}</TableCell>
                              <TableCell sx={{ color: 'success.main' }}>
                                {parseFloat(nvp.awayNVP) > parseFloat(ml.away) ? 
                                  `+${(parseFloat(nvp.awayNVP) - parseFloat(ml.away)).toFixed(3)}` : 
                                  (parseFloat(nvp.awayNVP) - parseFloat(ml.away)).toFixed(3)}
                              </TableCell>
                            </TableRow>
                          </>
                        );
                      })()}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
            
            {/* Spreads Primo Tempo */}
            {data.periods.num_1.spreads && Object.keys(data.periods.num_1.spreads).length > 0 && (
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
                      {Object.keys(data.periods.num_1.spreads)
                        .sort((a, b) => parseFloat(a) - parseFloat(b))
                        .map(key => {
                          const spread = data.periods.num_1.spreads[key];
                          if (!spread.home || !spread.away) return null;
                          
                          const nvp = calculateTwoWayNVP(spread.home, spread.away);
                          return (
                            <React.Fragment key={key}>
                              <TableRow sx={{ 
                                bgcolor: nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(spread.home) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                              }}>
                                <TableCell rowSpan="2">{key}</TableCell>
                                <TableCell sx={{ fontWeight: 'medium' }}>{data.home} {key}</TableCell>
                                <TableCell>{spread.home}</TableCell>
                                <TableCell>{nvp.homeNVP || ''}</TableCell>
                                <TableCell sx={{ color: 'success.main' }}>
                                  {nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(spread.home) ? 
                                    `+${(parseFloat(nvp.homeNVP) - parseFloat(spread.home)).toFixed(3)}` : 
                                    nvp.homeNVP ? (parseFloat(nvp.homeNVP) - parseFloat(spread.home)).toFixed(3) : ''}
                                </TableCell>
                                <TableCell rowSpan="2">{nvp.margin ? `${nvp.margin}%` : ''}</TableCell>
                              </TableRow>
                              <TableRow sx={{ 
                                bgcolor: nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(spread.away) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                              }}>
                                <TableCell sx={{ fontWeight: 'medium' }}>{data.away} {parseFloat(key) * -1}</TableCell>
                                <TableCell>{spread.away}</TableCell>
                                <TableCell>{nvp.awayNVP || ''}</TableCell>
                                <TableCell sx={{ color: 'success.main' }}>
                                  {nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(spread.away) ? 
                                    `+${(parseFloat(nvp.awayNVP) - parseFloat(spread.away)).toFixed(3)}` : 
                                    nvp.awayNVP ? (parseFloat(nvp.awayNVP) - parseFloat(spread.away)).toFixed(3) : ''}
                                </TableCell>
                              </TableRow>
                            </React.Fragment>
                          );
                        })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
            
            {/* Totals Primo Tempo */}
            {data.periods.num_1.totals && Object.keys(data.periods.num_1.totals).length > 0 && (
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
                      {Object.keys(data.periods.num_1.totals)
                        .sort((a, b) => parseFloat(a) - parseFloat(b))
                        .map(key => {
                          const total = data.periods.num_1.totals[key];
                          if (!total.over || !total.under) return null;
                          
                          const nvp = calculateTwoWayNVP(total.over, total.under);
                          return (
                            <React.Fragment key={key}>
                              <TableRow sx={{ 
                                bgcolor: nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(total.over) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                              }}>
                                <TableCell rowSpan="2">{key}</TableCell>
                                <TableCell sx={{ fontWeight: 'medium' }}>Over {key}</TableCell>
                                <TableCell>{total.over}</TableCell>
                                <TableCell>{nvp.homeNVP || ''}</TableCell>
                                <TableCell sx={{ color: 'success.main' }}>
                                  {nvp.homeNVP && parseFloat(nvp.homeNVP) > parseFloat(total.over) ? 
                                    `+${(parseFloat(nvp.homeNVP) - parseFloat(total.over)).toFixed(3)}` : 
                                    nvp.homeNVP ? (parseFloat(nvp.homeNVP) - parseFloat(total.over)).toFixed(3) : ''}
                                </TableCell>
                                <TableCell rowSpan="2">{nvp.margin ? `${nvp.margin}%` : ''}</TableCell>
                              </TableRow>
                              <TableRow sx={{ 
                                bgcolor: nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(total.under) ? 'rgba(76, 175, 80, 0.1)' : 'inherit'
                              }}>
                                <TableCell sx={{ fontWeight: 'medium' }}>Under {key}</TableCell>
                                <TableCell>{total.under}</TableCell>
                                <TableCell>{nvp.awayNVP || ''}</TableCell>
                                <TableCell sx={{ color: 'success.main' }}>
                                  {nvp.awayNVP && parseFloat(nvp.awayNVP) > parseFloat(total.under) ? 
                                    `+${(parseFloat(nvp.awayNVP) - parseFloat(total.under)).toFixed(3)}` : 
                                    nvp.awayNVP ? (parseFloat(nvp.awayNVP) - parseFloat(total.under)).toFixed(3) : ''}
                                </TableCell>
                              </TableRow>
                            </React.Fragment>
                          );
                        })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        )}
      </Box>
      </Box>
    </Paper>
  );
};

export default BettingMatrix;
