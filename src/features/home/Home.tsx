import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import catalog from '../../../content/catalog/modules.json';
import { useSession } from '../../app/session';
import { db } from '../../data/db';
import { daysSince, getLastBackupAt } from '../../data/storage';
import { Card, Notice, StatusChip } from '../../components/ui';

export function Home() {
  const profile = useSession((s) => s.profile)!;
  const [lastBackup, setLastBackup] = useState<string | null | undefined>(undefined);
  const [assigned, setAssigned] = useState<number>(0);

  useEffect(() => {
    void getLastBackupAt().then(setLastBackup);
    void db.assignments.where('learnerId').equals(profile.id).filter((a) => !a.deleted).count().then(setAssigned);
  }, [profile.id]);

  const days = lastBackup === undefined ? 0 : daysSince(lastBackup ?? null);
  const backupDue = profile.role === 'trainer' && lastBackup !== undefined && (days === null || days >= 7);

  return (
    <main>
      <h1>Hi {profile.name}</h1>

      {backupDue && (
        <Notice kind="warn">
          {days === null ? 'This device has never been backed up.' : `Last backup was ${days} days ago.`}{' '}
          <Link to="/settings#backup">Back up now</Link>
        </Notice>
      )}

      <Card title="Next task">
        <p><strong>M0 · Safety</strong> comes first for everyone. Nobody skips it.</p>
        <StatusChip status="planned" label="Lessons arrive in Phase 3" />
        <p className="hint">This version sets up profiles, offline use and backups. The first lessons and the DOL starter lab are built next.</p>
      </Card>

      <Card title="Assigned work">
        <p>{assigned === 0 ? 'No work assigned yet.' : `${assigned} item(s) assigned.`}</p>
      </Card>

      <Card title="Modules">
        <ol className="module-list">
          {catalog.modules.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.code} · {m.title}</strong>
                {m.required && <span className="tag">Required</span>}
                <p className="hint">{m.summary}</p>
              </div>
              <StatusChip status="planned" label={`Phase ${m.plannedPhase}`} />
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}
