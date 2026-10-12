import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { QueryProvider } from './app/QueryProvider';
import { AuthProvider } from './app/auth/AuthProvider';
import { PresenceProvider } from './features/userPresence/PresenceProvider';
import AuthGate from './app/auth/AuthGate';
import { TestAccountVisibilitySync } from './features/auth/TestAccountVisibilitySync';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <QueryProvider>
          <TestAccountVisibilitySync />
          <BrowserRouter>
            <PresenceProvider>
              <App />
            </PresenceProvider>
          </BrowserRouter>
        </QueryProvider>
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
