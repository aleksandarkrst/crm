import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { reportError, startErrorTracking } from './lib/monitoring';
import './styles/global.css';

createRoot(document.getElementById('root')!, {
  // A render error React can't recover from. Replacing the handler replaces React's own logging.
  onUncaughtError: (error, info) => {
    console.error(error);
    reportError(error, { componentStack: info.componentStack });
  },
}).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

startErrorTracking();
