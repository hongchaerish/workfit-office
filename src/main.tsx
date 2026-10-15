import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { QueryProvider } from './app/QueryProvider';
import { AuthProvider } from './app/auth/AuthProvider';
import { PresenceProvider } from './features/userPresence/PresenceProvider';
import { BirthdayProvider } from '@/features/birthday/BirthdayProvider';
import AuthGate from './app/auth/AuthGate';
import { TestAccountVisibilitySync } from './features/auth/TestAccountVisibilitySync';
import { SharedSettingsGate } from './features/sharedSettings/SharedSettingsGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <QueryProvider>
          <TestAccountVisibilitySync />
          <SharedSettingsGate>
            <BrowserRouter>
              <PresenceProvider>
                <BirthdayProvider>
                  <App />
                </BirthdayProvider>
              </PresenceProvider>
            </BrowserRouter>
          </SharedSettingsGate>
        </QueryProvider>
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
