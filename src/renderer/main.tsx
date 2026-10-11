import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Cleanly retire the initial static pre-splash once React boots
const preSplash = document.getElementById('app-pre-splash');
if (preSplash) {
  preSplash.remove();
}
