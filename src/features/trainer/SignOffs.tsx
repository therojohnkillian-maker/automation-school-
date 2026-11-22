import { useCallback, useEffect, useState } from 'react';
import { lessonById, lessonsInOrder } from '../../content';
import type { Profile } from '../../data/db';
import { db } from '../../data/db';
import { checkPin } from '../../data/pin';
import { allProgress, awaitingSignOff, lessonStatus, signOff, type LessonProgress } from '../../data/progress';
import { useSession } from '../../app/session';
import { Card, Field, Modal, Notice, StatusChip, useAction } from '../../components/ui';
import { STATUS_CHIP } from '../learn/LearnList';

interface Attempt {
  id: string;
  kind: string;
  lessonId: string;
  createdAt: string;
  passed?: boolean;
  score?: number;
  critical?: boolean;
  criticalFail?: boolean;
  faultId?: string;
  measurements?: number;
  seconds?: number;
  mode?: string;
}

/** Sign-off queue, skills matrix and attempt review. Trainer only (the route is only added for trainers). */
export function SignOffs({ people, refreshKey }: { people: Profile[]; refreshKey: number }) {
  const me = useSession((s) => s.profile)!;
  const [queue, setQueue] = useState<LessonProgress[]>([]);
  const [matrix, setMatrix] = useState<Record<string, LessonProgress[]>>({});
  const [open, setOpen] = useState<LessonProgress | null>(null);
  const [review, setReview] = useState<Profile | null>(null);

  const refresh = useCallback(async () => {
    setQueue(await awaitingSignOff());
    const m: Record<string, LessonProgress[]> = {};
    for (const p of people) m[p.id] = await allProgress(p.id);
    setMatrix(m);
  }, [people]);
  useEffect(() => void refresh(), [refresh, refreshKey]);

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unknown (removed)';
  const lessons = lessonsInOrder();

  return (
    <>
      <Card title={`Practical sign-offs waiting (${queue.length})`}>
        {queue.length === 0 ? (
          <p>Nobody is waiting for a sign-off.</p>
        ) : (
          <ul className="people">
            {queue.map((q) => (
              <li key={q.id}>
                <div>
                  <strong>{nameOf(q.profileId)}</strong> · {lessonById(q.lessonId)?.title}
                  <span className="hint"> · asked {new Date(q.steps.apply!.requestedAt!).toLocaleDateString('en-GB')} · Break {q.steps.break?.bestScore}% · Prove {q.steps.prove?.bestScore}%</span>
                </div>
                <button className="primary" onClick={() => setOpen(q)}>Observe and sign</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Skills matrix">
        <div className="table-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col">Person</th>
                {lessons.map((l) => <th key={l.id} scope="col">{l.title}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <th scope="row"><button className="linkish" onClick={() => setReview(p)}>{p.name}</button></th>
                  {lessons.map((l) => {
                    const c = STATUS_CHIP[lessonStatus(l.id, matrix[p.id] ?? [])];
                    return <td key={l.id}><StatusChip status={c.status} label={c.label} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Tap a name to review their attempts and fault-finding.</p>
      </Card>

      {open && <SignOffDialog progress={open} learner={nameOf(open.profileId)} trainer={me} onClose={() => setOpen(null)} onDone={async () => { setOpen(null); await refresh(); }} />}
      {review && <ReviewDialog person={review} onClose={() => setReview(null)} />}
    </>
  );
}

function SignOffDialog({ progress, learner, trainer, onClose, onDone }: { progress: LessonProgress; learner: string; trainer: Profile; onClose: () => void; onDone: () => Promise<void> }) {
  const lesson = lessonById(progress.lessonId)!;
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, run, setError } = useAction();
  const allTicked = lesson.apply.items.every((i) => ticked[i.id]);

  const submit = (outcome: 'signed' | 'redo') =>
    run(async () => {
      if (trainer.pinHash && !(await checkPin(pin, trainer.pinSalt!, trainer.pinHash))) {
        setError('Your trainer PIN is not right.');
        return;
      }
      if (outcome === 'redo' && !note.trim()) {
        setError('Add a short note saying what to practise.');
        return;
      }
      await signOff({ learnerId: progress.profileId, lessonId: lesson.id, trainerId: trainer.id, trainerName: trainer.name, items: lesson.apply.items.map((i) => ({ id: i.id, observed: !!ticked[i.id] })), note: note.trim(), outcome });
      await onDone();
    });

  return (
    <Modal title={`Sign-off: ${learner}`} onClose={onClose}>
      <p><strong>{lesson.title}</strong></p>
      <p className="hint">Tick only what you watched {learner} do on the bench.</p>
      {lesson.apply.items.map((i) => (
        <label key={i.id} className="check">
          <input type="checkbox" checked={!!ticked[i.id]} onChange={(e) => setTicked({ ...ticked, [i.id]: e.target.checked })} />
          <span>{i.text}</span>
        </label>
      ))}
      <Field label="Note (required for redo)">{(id) => <input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}</Field>
      {trainer.pinHash && (
        <Field label="Your trainer PIN">{(id) => <input id={id} type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={8} />}</Field>
      )}
      <Notice kind="info">Sign-off records what you observed. It does not authorise anyone to work.</Notice>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button onClick={() => submit('redo')} disabled={busy}>Needs redo</button>
        <button className="primary" onClick={() => submit('signed')} disabled={busy || !allTicked}>{allTicked ? 'Sign off' : 'Tick every item to sign'}</button>
      </div>
    </Modal>
  );
}

function ReviewDialog({ person, onClose }: { person: Profile; onClose: () => void }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [signs, setSigns] = useState<{ id: string; lessonId: string; outcome: string; trainerName: string; createdAt: string; note: string }[]>([]);
  useEffect(() => {
    void db.attempts.where('profileId').equals(person.id).toArray().then((a) => setAttempts((a as unknown as Attempt[]).sort((x, y) => y.createdAt.localeCompare(x.createdAt))));
    void db.signOffs.where('profileId').equals(person.id).toArray().then((s) => setSigns(s as unknown as typeof signs));
  }, [person.id]);
  const describe = (a: Attempt) => {
    const l = lessonById(a.lessonId)?.title ?? a.lessonId;
    const res = a.passed ? '✔ passed' : '✖ not passed';
    if (a.kind === 'quiz') return `${l} · Prove test ${a.score}% ${res}${a.criticalFail ? ' (critical question wrong)' : ''}`;
    if (a.kind === 'break') return `${l} · Fault-finding (${a.faultId}) ${res}, score ${a.score}%, ${a.measurements} measurements, ${a.seconds}s${a.critical ? ' ⚠ safety error' : ''}`;
    return `${l} · Build (${a.mode}) ${res}`;
  };
  return (
    <Modal title={`${person.name}: attempts`} onClose={onClose}>
      {signs.length > 0 && (
        <>
          <h3>Sign-offs</h3>
          <ul className="plain">{signs.map((s) => <li key={s.id}>{new Date(s.createdAt).toLocaleDateString('en-GB')} · {lessonById(s.lessonId)?.title} · {s.outcome === 'signed' ? '✔ signed' : '↺ redo'} by {s.trainerName}{s.note ? `: ${s.note}` : ''}</li>)}</ul>
        </>
      )}
      <h3>Attempts</h3>
      {attempts === null ? <p>Loading…</p> : attempts.length === 0 ? <p>No attempts yet.</p> : (
        <ul className="plain attempts">{attempts.slice(0, 40).map((a) => <li key={a.id}>{new Date(a.createdAt).toLocaleString('en-GB')} · {describe(a)}</li>)}</ul>
      )}
      <div className="actions"><button onClick={onClose}>Close</button></div>
    </Modal>
  );
}
