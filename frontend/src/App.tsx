import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionGate } from './components/SessionGate';
import { completeSignIn } from './lib/auth';
import { paths } from './lib/paths';
import { Companies } from './screens/Companies';
import { Company } from './screens/Company';
import { Contact } from './screens/Contact';
import { Contacts } from './screens/Contacts';
import { Dashboard } from './screens/Dashboard';
import { LeadScreen } from './screens/lead/LeadScreen';
import { Pipeline } from './screens/Pipeline';
import { Products } from './screens/Products';
import { Profile } from './screens/Profile';
import { Roadmap } from './screens/Roadmap';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { useStore } from './store/store';

const START_PAGES: Record<string, string> = { Pipeline: paths.pipeline, Overview: paths.overview, Today: paths.today, Contacts: paths.contacts };

function StartPage() {
  const { s } = useStore();
  return <Navigate to={START_PAGES[s.profile.startPage || 'Pipeline'] || paths.pipeline} replace />;
}

function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    completeSignIn()
      .catch((err: unknown) => console.error('Sign-in failed', err))
      .finally(() => navigate('/', { replace: true }));
  }, [navigate]);
  return null;
}

export function App() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="*"
        element={
          <SessionGate>
            <AppRoutes />
          </SessionGate>
        }
      />
    </Routes>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<StartPage />} />
        <Route path="overview" element={<Dashboard />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="today" element={<Today />} />
        <Route path="companies" element={<Companies />} />
        <Route path="companies/:name" element={<Company />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<Contact />} />
        <Route path="deals/:id" element={<LeadScreen />} />
        <Route path="products" element={<Products />} />
        <Route path="roadmap" element={<Roadmap />} />
        <Route path="settings" element={<Navigate to={paths.settings()} replace />} />
        <Route path="settings/:tab" element={<Settings />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
