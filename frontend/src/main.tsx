import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useRouteError } from 'react-router-dom';
import { App } from './App';
import { reportError, startErrorTracking } from './lib/monitoring';
import './styles/global.css';
import './styles/employee-timesheet.css';

/** A render error the router caught: thrown on, so React's own handler below reports it as before. */
function Rethrow(): never {
  throw useRouteError();
}

/**
 * A data router (CD-225: the employee card's "Discard your changes?" uses useBlocker) with one
 * catch-all route; the screens' own <Routes> in App work below it as with BrowserRouter.
 */
const router = createBrowserRouter([{ path: '*', element: <App />, errorElement: <Rethrow /> }]);

createRoot(document.getElementById('root')!, {
  // A render error React can't recover from. Replacing the handler replaces React's own logging.
  onUncaughtError: (error, info) => {
    console.error(error);
    reportError(error, { componentStack: info.componentStack });
  },
}).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

startErrorTracking();
