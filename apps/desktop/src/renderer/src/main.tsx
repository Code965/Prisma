import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Font inclusi nell'app (niente Google Fonts): l'interfaccia funziona anche offline.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/tokens.css';
import './styles/screen-tokens.css';
import './styles/base.css';
import { App } from './App';
import { initialTheme } from './theme/theme';

// Classe del tema applicata prima del primo render, per evitare un lampo del tema sbagliato.
document.documentElement.classList.replace(
  'th-light',
  initialTheme() === 'dark' ? 'th-dark' : 'th-light',
);

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root mancante');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
