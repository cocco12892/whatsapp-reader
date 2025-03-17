import { createTheme, alpha } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#128C7E',
      contrastText: '#fff',
    },
    tertiary: {
      main: '#020976',
      light: '#3F46A1', // Versione più chiara di #020976
      dark: '#01064F',  // Versione più scura (opzionale)
      contrastText: '#fff',
    },
    secondary: {
      main: '#25D366',
    },
    background: {
      default: '#f0f2f5',
      paper: '#ffffff',
      note: '#f0ffb1',
      record: '#ff8686',
    },
    text: {
      primary: '#3b4a54',
      secondary: '#667781',
      tertiary: '#020976',
    },
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    h1: {
      fontSize: '1.5rem',
      fontWeight: 600,
      color: '#3b4a54',
    },
    body1: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#f0f2f5',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          borderRadius: '8px',
        },
      },
    },
  },
});