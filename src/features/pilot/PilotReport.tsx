import { useEffect, useState } from 'react';
import type { Profile } from '../../data/db';
import { Card, downloadText, useAction } from '../../components/ui';
import { pilotReport } from './report';

/** Trainer card: Feedback notes on screen, and the full report as a CSV for the developer. */
export function PilotReport({ people, refreshKey }: { people: Profile[]; refreshKey: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof pilotReport>> | null>(null);
  const { error, run } = useAction();
  useEffect(() => void pilotReport(people).then(setData), [people, refreshKey]);
  return (
    <Card title="Pilot report">
      <p>Time per step, attempts, failed checks, hints, safety errors and Feedback notes for everyone on this device. Import progress files from other devices first.</p>
      <div className="actions">
        <button
          className="primary"
          disabled={!data}
          onClick={() =>
            run(async () => {
              const fresh = await pilotReport(people);
              downloadText(`pilot-report-${new Date().toISOString().slice(0, 10)}.csv`, fresh.csv, 'text/csv');
            })
          }
        >
          Download report
        </button>
      </div>
      {error && <p className="hint">{error}</p>}
      {data && (
        <details open={data.notes.length > 0}>
          <summary>Feedback notes ({data.notes.length})</summary>
          {data.notes.length === 0 ? (
            <p className="hint">No notes yet.</p>
          ) : (
            <ul className="plain notes">
              {data.notes.map((n, i) => (
                <li key={i}><strong>{n.learner}</strong> · {n.where} · {new Date(n.at).toLocaleString('en-GB')}<br />{n.text}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </Card>
  );
}
