import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { catalog } from '../../content';
import { useSession } from '../../app/session';
import { db } from '../../data/db';
import { daysSince, getLastBackupAt } from '../../data/storage';
import { allProgress, awaitingSignOff, lessonStatus, nextTask, type LessonProgress } from '../../data/progress';
import { Card, Notice, StatusChip } from '../../components/ui';
import { STATUS_CHIP } from '../learn/LearnList';
import { STEPS } from '../../content/types';

export function Home() {
  const profile = useSession((s) => s.profile)!;
  const [lastBackup, setLastBackup] = useState<string | null | undefined>(undefined);
  const [assigned, setAssigned] = useState(0);
  const [next, setNext] = useState<Awaited<ReturnType<typeof nextTask>> | undefined>(undefined);
  const [all, setAll] = useState<LessonProgress[]>([]);
  const [queue, setQueue] = useState(0);

  useEffect(() => {
    void getLastBackupAt().then(setLastBackup);
    void db.assignments.where('learnerId').equals(profile.id).filter((a) => !a.deleted).count().then(setAssigned);
    void nextTask(profile.id).then(setNext);
    void allProgress(profile.id).then(setAll);
    if (profile.role === 'trainer') void awaitingSignOff().then((q) => setQueue(q.length));
  }, [profile.id, profile.role]);

  const days = lastBackup === undefined ? 0 : daysSince(lastBackup ?? null);
  const backupDue = profile.role === 'trainer' && lastBackup !== undefined && (days === null || days >= 7);

  return (
    <main>
      <h1>Hi {profile.name}</h1>

      {backupDue && (
        <Notice kind="warn">
          {days === null ? 'This device has never been backed up.' : `Last backup was ${days} days ago.`} <Link to="/settings">Back up now</Link>
        </Notice>
      )}
      {queue > 0 && (
        <Notice kind="info">
          {queue} practical sign-off{queue > 1 ? 's are' : ' is'} waiting. <Link to="/trainer">Open the Trainer area</Link>
        </Notice>
      )}

      <Card title="Next task">
        {next === undefined ? (
          <p>Loading…</p>
        ) : next ? (
          <>
            <p><strong>{catalog.modules.find((m) => m.id === next.lesson.moduleId)?.code} · {next.lesson.title}</strong></p>
            <p className="hint">Step: {STEPS.find((s) => s.id === next.step)?.label}{next.status === 'redo' ? '. Your trainer asked for more practice.' : ''}</p>
            <Link className="button primary" to={`/learn/${next.lesson.id}/${next.step}`}>Continue ▶</Link>
          </>
        ) : (
          <p>You have finished every lesson available so far. Check sign-offs with your trainer. More modules arrive in later phases.</p>
        )}
      </Card>

      <Card title="Assigned work">
        <p>{assigned === 0 ? 'No work assigned yet.' : `${assigned} item(s) assigned.`}</p>
      </Card>

      <Card title="Progress">
        <ol className="module-list">
          {catalog.modules.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.code} · {m.title}</strong>
                {m.required && <span className="tag">Required</span>}
              </div>
              <div className="chips">
                {m.lessons.length === 0 ? (
                  <StatusChip status="planned" label={`Phase ${m.plannedPhase}`} />
                ) : (
                  m.lessons.map((id) => {
                    const c = STATUS_CHIP[lessonStatus(id, all)];
                    return <StatusChip key={id} status={c.status} label={c.label} />;
                  })
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}
