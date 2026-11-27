import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BrandProvider } from './hooks/brand';
import { createQueryClient } from './hooks/query-client';
import { AppShell } from './layout/AppShell';
import { CalendarioScreen } from './screens/Calendario/CalendarioScreen';
import { CodaScreen } from './screens/Coda/CodaScreen';
import { DashboardScreen } from './screens/Dashboard/DashboardScreen';
import { IdeeScreen } from './screens/Idee/IdeeScreen';
import { ImpostazioniScreen } from './screens/Impostazioni/ImpostazioniScreen';
import { StudioScreen } from './screens/Studio/StudioScreen';
import { CaroselloScreen } from './screens/Carosello/CaroselloScreen';
import { AnalyticsScreen } from './screens/Analytics/AnalyticsScreen';
import { RecordScreen } from './screens/Registra/RecordScreen';
import { VideoScreen } from './screens/Video/VideoScreen';
import { TrendScreen } from './screens/Trend/TrendScreen';
import { TemplateScreen } from './screens/Template/TemplateScreen';
import { ThemeProvider } from './theme/theme';

/** HashRouter: funziona sia caricando i file da disco in Electron sia dal server di Vite. */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrandProvider>
          <HashRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<DashboardScreen />} />
                <Route path="idee" element={<IdeeScreen />} />
                <Route path="studio" element={<StudioScreen />} />
                <Route path="studio/:contentId" element={<StudioScreen />} />
                <Route path="calendario" element={<CalendarioScreen />} />
                <Route path="coda" element={<CodaScreen />} />
                <Route path="carosello" element={<CaroselloScreen />} />
                <Route path="carosello/:contentId/:variantId" element={<CaroselloScreen />} />
                <Route path="video" element={<VideoScreen />} />
                <Route path="video/:projectId" element={<VideoScreen />} />
                <Route path="registra" element={<RecordScreen />} />
                <Route path="template" element={<TemplateScreen />} />
                <Route path="analytics" element={<AnalyticsScreen />} />
                <Route path="trend" element={<TrendScreen />} />
                <Route path="impostazioni" element={<ImpostazioniScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </BrandProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
