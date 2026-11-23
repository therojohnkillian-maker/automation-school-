import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { moduleById, templateById, templateCatalog } from '../../content';
import { useSession } from '../../app/session';
import { Card, Notice, StatusChip } from '../../components/ui';
import { allProgress, appPassed } from '../../data/progress';

/** Working examples to open, run, break and repair. Each arrives with the module it belongs to. */
export function TemplateList() {
  const profile = useSession((s) => s.profile)!;
  const [safe, setSafe] = useState<boolean | null>(null);
  useEffect(() => void allProgress(profile.id).then((all) => setSafe(appPassed(all.find((p) => p.lessonId === 'm0-l1')?.steps))), [profile.id]);
  return (
    <main>
      <h1>Templates</h1>
      <p>Working examples, from easy to hard. Open one, run it, break it, repair it, and check it against the model answer.</p>
      {safe === false && <Notice kind="info">🔒 Templates are labs. Pass M0 Safety (Break and Prove) first.</Notice>}
      <Card>
        <ol className="lesson-list">
          {templateCatalog.templates.map((t) => {
            const ready = t.id ? templateById(t.id) : undefined;
            const mod = moduleById(t.moduleId);
            return (
              <li key={t.number}>
                <div>
                  <strong>T{t.number} · {t.title}</strong>
                  <p className="hint">{ready ? ready.summary : `Belongs to ${mod?.code} ${mod?.title}.`}</p>
                  {!ready && <StatusChip status="planned" label={`Arrives with ${mod?.code}`} />}
                </div>
                {ready && safe && <Link className="button primary" to={`/templates/${ready.id}`}>Open</Link>}
              </li>
            );
          })}
        </ol>
      </Card>
      <p className="hint">Copying a template into your own project comes with the project builder (Phase 6).</p>
    </main>
  );
}
