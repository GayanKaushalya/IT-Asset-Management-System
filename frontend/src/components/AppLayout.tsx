import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getOrgMeta } from '../services/metaCache';
import NotificationBell from './NotificationBell';
import UserAvatar from './ui/UserAvatar';

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
  /** Open in a new browser tab (keeps ITAMS open). */
  external?: boolean;
};

type NavGroup = { title: string; items: NavItem[] };

/** IT Help Desk Vite app — same host as ITAMS, port 5173. */
function helpDeskUrl(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5173/';
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:5173/`;
}

const groups: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', end: true, icon: <IconDashboard /> },
      { to: '/organization', label: 'Organization', icon: <IconOrg /> },
    ],
  },
  {
    title: 'Asset Management',
    items: [
      { to: '/assets/laptop', label: 'Laptops', icon: <IconLaptop /> },
      { to: '/assets/mobile-phones', label: 'Mobile Phones', icon: <IconPhone /> },
      { to: '/assets/all', label: 'PC Inventory', icon: <IconPc /> },
      { to: '/assets/others', label: 'Other assets', icon: <IconOthers /> },
      { to: '/agreements', label: 'Agreements', icon: <IconAgreements /> },
    ],
  },
  {
    title: 'Finance & Procurement',
    items: [
      { to: '/expenditures', label: 'IT Expenditure', icon: <IconFinance /> },
    ],
  },
  {
    title: 'Credential Management',
    items: [
      { to: '/credentials/emails', label: 'Credential Vault', icon: <IconShield /> },
      { to: '/credentials/wifi', label: 'WiFi Passwords', icon: <IconWifi /> },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/reports/assets', label: 'Asset Reports', icon: <IconReport /> },
      { to: '/reports/handovers', label: 'Handover Reports', icon: <IconReport /> },
      { to: '/reports/maintenance', label: 'Maintenance Report', icon: <IconReport /> },
      { to: '/reports/branches', label: 'Branch Asset Report', icon: <IconReport /> },
      { to: '/reports/stock', label: 'Stock Report', icon: <IconReport /> },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: <IconSettings /> },
    ],
  },
  {
    title: 'Support',
    items: [
      {
        to: 'helpdesk',
        label: 'IT Help Desk',
        icon: <IconHelpDesk />,
        external: true,
      },
    ],
  },
];

const MOBILE_NAV_MAX = 720;

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // Prefer full sidebar; clear any old collapsed preference
    localStorage.setItem('itam_sidebar', '0');
  }, []);

  // Warm org meta cache once so Assets / Credentials skip cold round-trips
  useEffect(() => {
    void getOrgMeta();
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > MOBILE_NAV_MAX) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const shellClass = ['app-shell', mobileOpen ? 'mobile-nav-open' : ''].filter(Boolean).join(' ');

  return (
    <div className={shellClass}>
      {mobileOpen ? (
        <div className="mobile-nav-backdrop" onClick={() => setMobileOpen(false)} aria-hidden />
      ) : null}

      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <div className="brand-mark">IG</div>
          <div className="sidebar-brand-text">
            <p className="brand-kicker">Indra Group</p>
            <h1>ITAM</h1>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          {groups.map((g) => (
            <div key={g.title} className="nav-group">
              <p className="nav-group-title">{g.title}</p>
              {g.items.map((item) =>
                item.external ? (
                  <a
                    key={item.to}
                    href={helpDeskUrl()}
                    className="nav-item"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className="nav-icon" aria-hidden>
                      {item.icon}
                    </span>
                    <span className="nav-label">{item.label}</span>
                    <span className="nav-tooltip">{item.label}</span>
                  </a>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className="nav-icon" aria-hidden>
                      {item.icon}
                    </span>
                    <span className="nav-label">{item.label}</span>
                    <span className="nav-tooltip">{item.label}</span>
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-user">
          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
            <UserAvatar name={user?.name} size="sm" />
            <div className="sidebar-user-meta">
              <strong>{user?.name}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost sidebar-signout-btn"
            onClick={() => void logout()}
            aria-label="Sign out"
          >
            <span className="sidebar-signout-label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="main-pane">
        <button
          type="button"
          className="icon-btn mobile-menu-fab"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          id="mobile-menu-btn"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <div className="main-topbar">
          <NotificationBell />
        </div>
        <div className="main-content">
          <Outlet />
        </div>

        <footer className="app-footer">
          <p>© {new Date().getFullYear()} Indra Group · ITAM System. All rights reserved.</p>
        </footer>
      </div>

      <style>{`
        .main-topbar {
          position: absolute;
          top: 0.85rem;
          right: 1.25rem;
          z-index: 30;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 0.5rem;
          pointer-events: none;
        }
        .main-topbar > * {
          pointer-events: auto;
        }
        .mobile-menu-fab {
          display: none;
          position: fixed;
          top: 0.85rem;
          left: 0.85rem;
          z-index: 40;
          background: #fff;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
        }
        @media (max-width: 720px) {
          .mobile-menu-fab { display: inline-grid; }
          .sidebar-toggle { display: grid !important; }
        }
        @media (min-width: 721px) {
          #mobile-menu-btn { display: none !important; }
          .sidebar-toggle { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function IconOrg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7" r="3" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
    </svg>
  );
}

function IconLaptop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function IconPc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function IconFinance() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v18M7 7.5c0-1.5 2-2.5 5-2.5s5 1 5 2.5-2 2.5-5 2.5-5 1-5 2.5 2 2.5 5 2.5 5-1 5-2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAgreements() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6M9 9h2" />
    </svg>
  );
}

function IconOthers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6M9 12h6M9 15h4" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  );
}

function IconWifi() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5a9 9 0 0 1 14 0" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconHelpDesk() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconReport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15v-4M12 15V8M16 15v-7" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
