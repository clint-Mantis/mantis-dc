import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { AppProvider, useApp } from './lib/context';
import { supabase } from './lib/supabase';
import { ToastProvider, Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage, SetPasswordPage } from './pages/LoginPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { WizardPage } from './pages/WizardPage';
import { DashboardPage } from './pages/DashboardPage';
import { PillarPage } from './pages/PillarPage';
import { ChecklistPage } from './pages/ChecklistPage';
import { SamplesPage } from './pages/SamplesPage';
import { HistoryPage } from './pages/HistoryPage';
import { AdminPage } from './pages/AdminPage';
import { ProfilePage } from './pages/ProfilePage';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } } });

function Root() {
  const { session, meLoading } = useApp();
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((e) => { if (e === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  if (recovery) return <SetPasswordPage onDone={() => setRecovery(false)} />;
  if (meLoading) return <Spinner />;
  if (!session) return <LoginPage />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<WizardPage />} />
        <Route path="/p/:projectId" element={<DashboardPage />} />
        <Route path="/p/:projectId/pillar/:pillar" element={<PillarPage />} />
        <Route path="/p/:projectId/checklist" element={<ChecklistPage />} />
        <Route path="/p/:projectId/samples" element={<SamplesPage />} />
        <Route path="/p/:projectId/history" element={<HistoryPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AppProvider>
          <HashRouter><Root /></HashRouter>
        </AppProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
