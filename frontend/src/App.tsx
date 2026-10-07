import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionGate } from './components/SessionGate';
import type { ApiStartPage } from './lib/api';
import { POPUP_MESSAGE, rememberSignInProblem } from './lib/auth';
import { isChunkLoadError, loadChunk } from './lib/chunks';
import { paths } from './lib/paths';
import { useStore } from './store/store';

// Screens load on first visit (CD-24), so the first page doesn't wait for all of them.
const Calendar = lazy(() => loadChunk(() => import('./screens/Calendar')).then((m) => ({ default: m.Calendar })));
const Companies = lazy(() => loadChunk(() => import('./screens/Companies')).then((m) => ({ default: m.Companies })));
const Company = lazy(() => loadChunk(() => import('./screens/Company')).then((m) => ({ default: m.Company })));
const Contact = lazy(() => loadChunk(() => import('./screens/Contact')).then((m) => ({ default: m.Contact })));
const Contacts = lazy(() => loadChunk(() => import('./screens/Contacts')).then((m) => ({ default: m.Contacts })));
const EmployeeCard = lazy(() => loadChunk(() => import('./screens/EmployeeCard')).then((m) => ({ default: m.EmployeeCard })));
const Dashboard = lazy(() => loadChunk(() => import('./screens/Dashboard')).then((m) => ({ default: m.Dashboard })));
const Meeting = lazy(() => loadChunk(() => import('./screens/Meeting')).then((m) => ({ default: m.Meeting })));
const NewMeeting = lazy(() => loadChunk(() => import('./screens/NewMeeting')).then((m) => ({ default: m.NewMeeting })));
const LeadScreen = lazy(() => loadChunk(() => import('./screens/lead/LeadScreen')).then((m) => ({ default: m.LeadScreen })));
const OrgStructure = lazy(() => loadChunk(() => import('./screens/OrgStructure')).then((m) => ({ default: m.OrgStructure })));
const Pipeline = lazy(() => loadChunk(() => import('./screens/Pipeline')).then((m) => ({ default: m.Pipeline })));
const Project = lazy(() => loadChunk(() => import('./screens/Project')).then((m) => ({ default: m.Project })));
const Products = lazy(() => loadChunk(() => import('./screens/Products')).then((m) => ({ default: m.Products })));
const Profile = lazy(() => loadChunk(() => import('./screens/Profile')).then((m) => ({ default: m.Profile })));
const Settings = lazy(() => loadChunk(() => import('./screens/Settings')).then((m) => ({ default: m.Settings })));
const Reports = lazy(() => loadChunk(() => import('./screens/Reports')).then((m) => ({ default: m.Reports })));
const Today = lazy(() => loadChunk(() => import('./screens/Today')).then((m) => ({ default: m.Today })));
const VisitPlan = lazy(() => loadChunk(() => import('./screens/VisitPlan')).then((m) => ({ default: m.VisitPlan })));
const VisitPlans = lazy(() => loadChunk(() => import('./screens/VisitPlans')).then((m) => ({ default: m.VisitPlans })));

const START_PAGES: Record<ApiStartPage, string> = { pipeline: paths.pipeline, overview: paths.overview, today: paths.today, contacts: paths.contacts };

function StartPage() {
  const { s } = useStore();
  return <Navigate to={START_PAGES[s.profile.startPage] ?? paths.pipeline} replace />;
}

/**
 * While a screen's code loads, the sidebar stays and the content area stays blank; a small spinner
 * fades in only if it takes more than a moment. Navigations run in a transition, so moving between
 * screens keeps the current screen up until the next one is ready: this shows on a first load.
 */
function ScreenLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ flex: 1, minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--white)' }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--brand)', opacity: 0, animation: 'dcFade .2s ease-out .4s forwards, dcSpin .8s linear infinite' }} />
    </div>
  );
}

/**
 * A screen that fails to load or render shows a message with a way out instead of a blank page
 * (CD-220). After a deploy that's normally handled by loadChunk's reload; this is what's left when
 * that didn't help. Keyed by the path, so going to another screen tries again.
 */
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const newVersion = isChunkLoadError(error);
    return (
      <div role="alert" style={{ flex: 1, minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', background: 'var(--white)' }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{newVersion ? 'A new version of Pultly is available' : 'This page could not be shown'}</span>
        <span style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 420 }}>
          {newVersion ? 'Reload the page to continue. Your saved work is kept.' : 'Reload the page to try again. If it keeps happening, let us know.'}
        </span>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

function LazyScreens() {
  const { pathname } = useLocation();
  return (
    <ScreenErrorBoundary key={pathname}>
      <Suspense fallback={<ScreenLoading />}>
        <Outlet />
      </Suspense>
    </ScreenErrorBoundary>
  );
}

/**
 * Back from "Continue with Google" (/api/auth/callback sends the browser here with how it went).
 * In the popup of "sign in again" it tells the page that opened it and closes.
 */
function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('result');
    if (params.get('popup') === '1' && window.opener) {
      (window.opener as Window).postMessage({ type: POPUP_MESSAGE, result }, window.location.origin);
      window.close();
      return;
    }
    // On failure, back to the sign-in page, which says what happened (cancelled, refused).
    if (result !== 'ok') rememberSignInProblem(result);
    navigate(result === 'ok' ? '/' : '/login', { replace: true });
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
        <Route element={<LazyScreens />}>
          <Route index element={<StartPage />} />
          <Route path="overview" element={<Dashboard />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="today" element={<Today />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="meetings/new" element={<NewMeeting />} />
          <Route path="meetings/:id" element={<Meeting />} />
          <Route path="visit-plans" element={<VisitPlans />} />
          <Route path="visit-plans/:id" element={<VisitPlan />} />
          <Route path="companies" element={<Companies />} />
          <Route path="companies/:id" element={<Company />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="contacts/:id" element={<Contact />} />
          <Route path="deals/:id" element={<LeadScreen />} />
          <Route path="products" element={<Products />} />
          <Route path="projects/:id" element={<Project />} />
          <Route path="org" element={<OrgStructure />} />
          <Route path="people/:id" element={<EmployeeCard />} />
          <Route path="reports" element={<Navigate to={paths.reports()} replace />} />
          <Route path="reports/:tab" element={<Reports />} />
          <Route path="settings" element={<Navigate to={paths.settings()} replace />} />
          <Route path="settings/:tab" element={<Settings />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
