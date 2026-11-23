import { NavLink } from 'react-router-dom';
import { NAV_SECTIONS, type ScreenId } from '../../navigation';
import { useTheme } from '../../theme/theme';
import { Icon } from '../icons/Icon';
import styles from './Sidebar.module.css';
import { useSidebarCollapsed } from './useSidebarCollapsed';

export interface SidebarBrand {
  initials: string;
  name: string;
  subtitle: string;
}

interface SidebarProps {
  brand: SidebarBrand;
  /** Contatori accanto alle voci (es. idee in attesa, post in coda). */
  counts?: Partial<Record<ScreenId, number>>;
}

/** Menu laterale comprimibile, fedele a V3Sidebar del mockup. */
export function Sidebar({ brand, counts = {} }: SidebarProps) {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const { theme, toggleTheme } = useTheme();
  const toggleLabel = collapsed ? 'Espandi menu' : 'Comprimi menu';
  const themeLabel = theme === 'dark' ? 'Tema chiaro' : 'Tema scuro';

  return (
    <nav
      aria-label="Navigazione principale"
      className={styles.sidebar}
      data-collapsed={collapsed || undefined}
    >
      <div className={styles.head}>
        <button
          type="button"
          className={styles.brand}
          aria-label={`Cambia brand: ${brand.name}`}
          title={`${brand.name} · ${brand.subtitle}`}
        >
          <span className={styles.avatar}>{brand.initials}</span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>{brand.name}</span>
            <span className={styles.brandSubtitle}>{brand.subtitle}</span>
          </span>
        </button>
        <button
          type="button"
          className={styles.toggle}
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            <path d={collapsed ? 'M14 10l2 2-2 2' : 'M16 10l-2 2 2 2'} />
          </svg>
        </button>
      </div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className={styles.section}>
          <span className={`${styles.sectionLabel} mono`}>{section.label}</span>
          {section.items.map((item) => {
            const count = counts[item.id];
            return (
              <NavLink
                key={item.id}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                aria-label={count === undefined ? item.label : `${item.label}, ${count}`}
                title={item.label}
              >
                <Icon name={item.icon} className={styles.linkIcon} />
                <span className={styles.linkLabel}>{item.label}</span>
                {count !== undefined && <span className={`${styles.count} mono`}>{count}</span>}
              </NavLink>
            );
          })}
        </div>
      ))}

      <div className={styles.footer}>
        <div className={styles.approval} title="Nulla viene pubblicato senza la tua approvazione">
          <Icon
            name="shield"
            size={14}
            strokeWidth={2}
            label="Approvazione obbligatoria attiva"
            className={styles.approvalIcon}
          />
          <span className={styles.approvalText}>
            Nulla viene pubblicato senza la tua approvazione
          </span>
        </div>
        <button
          type="button"
          className={styles.themeButton}
          onClick={toggleTheme}
          aria-label={themeLabel}
          title={themeLabel}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} className={styles.linkIcon} />
          <span className={styles.linkLabel}>{themeLabel}</span>
        </button>
      </div>
    </nav>
  );
}
