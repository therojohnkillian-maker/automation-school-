import { useCallback, useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { Profile } from '../data/db';
import { listProfiles } from '../data/profiles';
import { useSession } from './session';
import { usePwa } from './pwa';
import { FirstRun } from '../features/profiles/FirstRun';
import { ProfilePicker } from '../features/profiles/ProfilePicker';
import { Home } from '../features/home/Home';
import { Trainer } from '../features/trainer/Trainer';
import { Settings } from '../features/settings/Settings';
import { LearnList } from '../features/learn/LearnList';
import { LessonPage } from '../features/learn/LessonPage';
import { Placement } from '../features/learn/Placement';
import { TemplateList } from '../features/templates/TemplateList';
import { TemplatePage } from '../features/templates/TemplatePage';
import { Notice } from '../components/ui';

export function App() {
  const profile = useSession((s) => s.profile);
  const setProfile = useSession((s) => s.setProfile);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfiles(await listProfiles());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  let body;
  if (loadError) {
    body = (
      <main className="narrow">
        <Notice kind="error">The app could not open its storage: {loadError}. Private or incognito windows may block storage. Open the app in a normal window.</Notice>
      </main>
    );
  } else if (profiles === null) {
    body = <main className="narrow"><p>Loading…</p></main>;
  } else if (profiles.length === 0) {
    body = <FirstRun onDone={load} />;
  } else if (!profile) {
    body = (
      <>
        {flash && <div className="narrow"><Notice kind="ok">{flash}</Notice></div>}
        <ProfilePicker profiles={profiles} />
      </>
    );
  } else {
    body = (
      <Shell profile={profile} onSwitch={() => { setFlash(null); setProfile(null); window.location.hash = '#/'; void load(); }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/learn" element={<LearnList />} />
          <Route path="/learn/:lessonId" element={<LessonPage />} />
          <Route path="/learn/:lessonId/:step" element={<LessonPage />} />
          <Route path="/placement/:moduleId" element={<Placement />} />
          <Route path="/templates" element={<TemplateList />} />
          <Route path="/templates/:templateId" element={<TemplatePage />} />
          {profile.role === 'trainer' && <Route path="/trainer" element={<Trainer />} />}
          <Route
            path="/settings"
            element={
              <Settings
                onRestored={() => {
                  setProfile(null);
                  setFlash('Backup restored. Choose your profile.');
                  void load();
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    );
  }

  return (
    <HashRouter>
      <Banners />
      {body}
    </HashRouter>
  );
}

function Shell({ profile, onSwitch, children }: { profile: Profile; onSwitch: () => void; children: React.ReactNode }) {
  const links = [
    { to: '/', label: 'Home', icon: '⌂' },
    { to: '/learn', label: 'Learn', icon: '▤' },
    { to: '/templates', label: 'Templates', icon: '◫' },
    ...(profile.role === 'trainer' ? [{ to: '/trainer', label: 'Trainer', icon: '☑' }] : []),
    { to: '/settings', label: 'Settings', icon: '⚙' },
  ];
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Automation School</span>
        <span className="who">
          {profile.name} · {profile.role === 'trainer' ? 'Trainer' : 'Apprentice'}
        </span>
        <button className="switch" onClick={onSwitch}>Switch user</button>
      </header>
      <nav className="nav" aria-label="Main">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span aria-hidden="true" className="nav-icon">{l.icon}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="content">{children}</div>
    </div>
  );
}

function Banners() {
  const { needRefresh, update, dismissUpdate, online } = usePwa();
  return (
    <div className="banners" aria-live="polite">
      {!online && <div className="banner banner-offline"><span aria-hidden="true">⦸</span> Offline. Everything still works and saves on this device.</div>}
      {needRefresh && (
        <div className="banner banner-update">
          A new version is ready.
          <button onClick={update}>Update now</button>
          <button onClick={dismissUpdate}>Later</button>
        </div>
      )}
    </div>
  );
}
