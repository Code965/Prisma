import type { IconName } from './components/icons/Icon';

export type ScreenId =
  | 'dashboard'
  | 'idee'
  | 'studio'
  | 'registra'
  | 'calendario'
  | 'piano'
  | 'coda'
  | 'carosello'
  | 'video'
  | 'template'
  | 'analytics'
  | 'trend'
  | 'concorrenti'
  | 'impostazioni';

export interface NavItem {
  id: ScreenId;
  label: string;
  path: string;
  icon: IconName;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Voci e sezioni della sidebar, nello stesso ordine del mockup (V3Sidebar). */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'LAVORO',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'dashboard' },
      { id: 'idee', label: 'Idee', path: '/idee', icon: 'idee' },
      { id: 'studio', label: 'Studio contenuto', path: '/studio', icon: 'studio' },
      { id: 'calendario', label: 'Calendario', path: '/calendario', icon: 'calendario' },
      { id: 'piano', label: 'Piano editoriale', path: '/piano', icon: 'piano' },
      { id: 'coda', label: 'Coda di pubblicazione', path: '/coda', icon: 'coda' },
    ],
  },
  {
    label: 'CREA',
    items: [
      { id: 'carosello', label: 'Editor carosello', path: '/carosello', icon: 'carosello' },
      { id: 'video', label: 'Editor video', path: '/video', icon: 'video' },
      { id: 'registra', label: 'Registra', path: '/registra', icon: 'mic' },
      { id: 'template', label: 'Template e brand kit', path: '/template', icon: 'template' },
    ],
  },
  {
    label: 'MISURA',
    items: [
      { id: 'analytics', label: 'Analytics', path: '/analytics', icon: 'analytics' },
      { id: 'trend', label: 'Trend', path: '/trend', icon: 'trend' },
      { id: 'concorrenti', label: 'Concorrenti', path: '/concorrenti', icon: 'concorrenti' },
      { id: 'impostazioni', label: 'Impostazioni', path: '/impostazioni', icon: 'impostazioni' },
    ],
  },
];
