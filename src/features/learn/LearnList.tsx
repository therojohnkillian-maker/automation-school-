import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { catalog, lessonById } from '../../content';
import { useSession } from '../../app/session';
import { Card, StatusChip, type Status } from '../../components/ui';
import { allProgress, lessonStatus, firstOpenStep, type LessonProgress, type LessonStatus } from '../../data/progress';

export const STATUS_CHIP: Record<LessonStatus, { status: Status; label: string }> = {
  locked: { status: 'locked', label: 'Locked' },
  new: { status: 'open', label: 'Not started' },
  progress: { status: 'progress', label: 'In progress' },
  awaiting: { status: 'awaiting', label: 'Awaiting sign-off' },
  redo: { status: 'failed', label: 'Trainer asked for redo' },
  signed: { status: 'signed', label: 'Signed off' },
};

export function LearnList() {
  const profile = useSession((s) => s.profile)!;
  const [all, setAll] = useState<LessonProgress[] | null>(null);
  useEffect(() => void allProgress(profile.id).then(setAll), [profile.id]);
  if (!all) return <main><p>Loading…</p></main>;

  return (
    <main>
      <h1>Learn</h1>
      {catalog.modules.map((m) => (
        <Card key={m.id} title={`${m.code} · ${m.title}`}>
          {m.required && <p><span className="tag">Required before any lab</span></p>}
          <p className="hint">{m.summary}</p>
          {m.lessons.length === 0 ? (
            <p><StatusChip status="planned" label={`Being built: Phase ${m.plannedPhase}`} /></p>
          ) : (
            <ul className="lesson-list">
              {m.lessons.map((id) => {
                const l = lessonById(id)!;
                const st = lessonStatus(id, all);
                const p = all.find((x) => x.lessonId === id);
                const chip = STATUS_CHIP[st];
                return (
                  <li key={id}>
                    <div>
                      <strong>{l.title}</strong>
                      <p className="hint">{l.summary} About {l.minutes} min.</p>
                      <StatusChip status={chip.status} label={st === 'progress' && p ? `In progress: ${firstOpenStep(p.steps)}` : chip.label} />
                    </div>
                    {st === 'locked' ? (
                      <span className="hint">Pass {l.requires.map((r) => lessonById(r)?.title).join(', ')} first</span>
                    ) : (
                      <Link className="button primary" to={`/learn/${id}`}>{st === 'new' ? 'Start' : st === 'signed' ? 'Review' : 'Continue'}</Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {m.note && <p className="hint">{m.note}</p>}
        </Card>
      ))}
    </main>
  );
}
