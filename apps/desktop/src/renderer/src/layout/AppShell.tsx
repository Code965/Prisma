import { Outlet } from 'react-router-dom';
import { Sidebar, type SidebarBrand } from '../components/Sidebar/Sidebar';
import { UpdateDialog } from '../components/UpdateDialog/UpdateDialog';
import { useBrand } from '../hooks/brand';
import { useIdeas } from '../hooks/useIdeas';
import { usePublications } from '../hooks/useCalendar';
import { visibleIdeas } from '../services/ideas';
import { queuedPublications } from '../services/queue';
import styles from './AppShell.module.css';
import { ConnectionNotice } from './ConnectionNotice';

const LOADING_BRAND: SidebarBrand = { initials: '··', name: 'Caricamento…', subtitle: '' };
const NO_BRAND: SidebarBrand = {
  initials: '?',
  name: 'Nessun brand',
  subtitle: 'Server non collegato',
};

/**
 * Telaio dell'app: sidebar fissa a sinistra e area della schermata che scorre da sola,
 * così la navigazione resta sempre visibile anche nelle pagine lunghe.
 */
export function AppShell() {
  const { brand, isLoading } = useBrand();
  const ideas = useIdeas();
  const publications = usePublications();

  const sidebarBrand: SidebarBrand = brand
    ? { initials: brand.initials, name: brand.name, subtitle: 'Brand attivo' }
    : isLoading
      ? LOADING_BRAND
      : NO_BRAND;
  const counts = {
    ...(ideas.data ? { idee: visibleIdeas(ideas.data).length } : {}),
    ...(publications.data ? { coda: queuedPublications(publications.data).length } : {}),
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <Sidebar brand={sidebarBrand} counts={counts} />
      </aside>
      <div className={styles.content}>
        <ConnectionNotice />
        <Outlet />
      </div>
      <UpdateDialog />
    </div>
  );
}
