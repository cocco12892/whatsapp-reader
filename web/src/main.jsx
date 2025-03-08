import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log('Montaggio applicazione React...');

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Elemento root non trovato!');
} else {
  console.log('Trovato elemento root:', rootElement);
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
