import React, { useState, useRef, useEffect } from 'react';
import { 
  Box, 
  IconButton, 
  Slider, 
  Typography, 
  Tooltip 
} from '@mui/material';
import { 
  PlayArrow as PlayIcon, 
  Pause as PauseIcon, 
  VoiceChat as VoiceChatIcon 
} from '@mui/icons-material';

// Componente per la riproduzione di messaggi vocali
const AudioMessage = ({ audioPath, duration }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Formatta il tempo (secondi) in minuti:secondi
  const formatTime = (timeInSeconds) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Aggiorna il progresso della riproduzione
  const updateProgress = () => {
    if (audioRef.current) {
      const currentTime = audioRef.current.currentTime;
      const duration = audioRef.current.duration;
      setProgress((currentTime / duration) * 100);
      
      // Continua ad aggiornare il progresso
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
  };

  // Gestisce la riproduzione/pausa
  const togglePlayPause = () => {
    const audio = audioRef.current;
    
    if (isPlaying) {
      audio.pause();
      cancelAnimationFrame(animationFrameRef.current);
    } else {
      audio.play();
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
    
    setIsPlaying(!isPlaying);
  };

  // Gestisce il cambio di progresso dalla slider
  const handleProgressChange = (_, newValue) => {
    const audio = audioRef.current;
    const time = (newValue / 100) * audio.duration;
    audio.currentTime = time;
    setProgress(newValue);
  };

  // Pulisce l'animazione quando il componente viene smontato
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Gestisce la fine della riproduzione
  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
    cancelAnimationFrame(animationFrameRef.current);
  };

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 1, 
        p: 1, 
        bgcolor: 'action.hover', 
        borderRadius: 2 
      }}
    > 
      {/* Pulsante Play/Pause */}
      <IconButton 
        onClick={togglePlayPause} 
        color="primary"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </IconButton>
      
      {/* Slider di progresso */}
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Slider
          value={progress}
          onChange={handleProgressChange}
          aria-labelledby="audio-progress-slider"
        />
        
        {/* Tempi di riproduzione */}
        <Typography variant="caption" color="text.secondary">
          {formatTime(duration)}
        </Typography>
      </Box>
      
      {/* Audio element nascosto */}
      <audio 
        ref={audioRef} 
        src={audioPath} 
        onEnded={handleEnded}
      />
    </Box>
  );
};

// Componente wrapper per utilizzarlo nel MessageList
const AudioMessageWrapper = ({ message }) => {
  // Estrai il percorso audio e la durata
  const audioPath = message.mediaPath ? 
    `http://localhost:8080${message.mediaPath}` : 
    null;
  
  // Se non c'è un percorso audio, mostra il testo standard
  if (!audioPath) {
    return (
      <Typography variant="body2">
        🔊 Messaggio vocale
      </Typography>
    );
  }

  // Estrai la durata dal testo (se presente)
  const durationMatch = message.content.match(/Durata: (\d+) sec/);
  const duration = durationMatch ? parseInt(durationMatch[1]) : 0;

  return <AudioMessage audioPath={audioPath} duration={duration} />;
};

export default AudioMessageWrapper;