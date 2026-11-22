import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, ImportRow } from '../../data/db';
import { db } from '../../data/db';
import { createProfile, listProfiles, removeProfile, updateProfile } from '../../data/profiles';
import { buildProgress, importProgress, progressFileName, type ImportResult } from '../../data/files';
import { useSession } from '../../app/session';
import { Card, Field, Modal, Notice, downloadText, useAction } from '../../components/ui';
import { SignOffs } from './SignOffs';

export function Trainer() {
  const me = useSession((s) => s.profile)!;
  const setMe = useSession((s) => s.setProfile);
  const [people, setPeople] = useState<Profile[]>([]);
  const [history, setHistory] = useState<ImportRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [removing, setRemoving] = useState<Profile | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const importAction = useAction();
  const rowAction = useAction();

  const refresh = useCallback(async () => {
    setPeople(await listProfiles());
    setHistory(await db.imports.orderBy('importedAt').reverse().limit(10).toArray());
    setRefreshKey((k) => k + 1);
  }, []);
  useEffect(() => void refresh(), [refresh]);

  return (
    <main>
      <h1>Trainer</h1>

      <SignOffs people={people} refreshKey={refreshKey} />

      <Card title="People" actions={<button className="primary" onClick={() => setAdding(true)}>+ Add apprentice</button>}>
        {rowAction.error && <Notice kind="error">{rowAction.error}</Notice>}
        <ul className="people">
          {people.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <span className="hint"> · {p.role === 'trainer' ? 'Trainer' : 'Apprentice'}{p.pinHash ? ' · PIN set' : ' · no PIN'}{p.id === me.id ? ' · you' : ''}</span>
              </div>
              <div className="row-actions">
                <button onClick={() => setEditing(p)}>Edit</button>
                <button
                  onClick={() =>
                    rowAction.run(async () => {
                      downloadText(progressFileName(p.name), JSON.stringify(await buildProgress(p.id), null, 1));
                    })
                  }
                >
                  Export progress
                </button>
                {p.id !== me.id && <button className="danger" onClick={() => setRemoving(p)}>Remove</button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Import progress">
        <p>Bring in an apprentice's progress file from another device. Records already here are never duplicated.</p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          id="import-progress"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setResult(null);
            void importAction.run(async () => {
              setResult(await importProgress(await f.text()));
              await refresh();
            });
          }}
        />
        <label htmlFor="import-progress" className="button">Choose progress file…</label>
        {importAction.busy && <p>Checking file…</p>}
        {importAction.error && <Notice kind="error">{importAction.error}</Notice>}
        {result && (
          <Notice kind={result.status === 'imported' ? 'ok' : 'info'}>
            {result.status === 'already-imported' ? (
              <p>This file for <strong>{result.learner}</strong> was already imported. Nothing changed.</p>
            ) : (
              <p>Imported <strong>{result.learner}</strong>: {result.added} added, {result.updated} updated, {result.unchanged} already up to date.</p>
            )}
            {result.notes.map((n) => <p key={n}>{n}</p>)}
          </Notice>
        )}
        {history.length > 0 && (
          <details>
            <summary>Recent imports</summary>
            <ul className="plain">
              {history.map((h) => <li key={h.fileHash}>{new Date(h.importedAt).toLocaleString('en-GB')} · {h.summary}</li>)}
            </ul>
          </details>
        )}
      </Card>

      {adding && <ProfileForm title="Add apprentice" onClose={() => setAdding(false)} onSaved={refresh} />}
      {editing && (
        <ProfileForm
          title={`Edit ${editing.name}`}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={async (p) => {
            if (p && p.id === me.id) setMe(p);
            await refresh();
          }}
        />
      )}
      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <p>{removing.name} will disappear from the profile list on this device. Their records stay in backups. Export their progress first if you may need it.</p>
          {rowAction.error && <Notice kind="error">{rowAction.error}</Notice>}
          <div className="actions">
            <button onClick={() => setRemoving(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() =>
                rowAction.run(async () => {
                  await removeProfile(removing.id);
                  setRemoving(null);
                  await refresh();
                })
              }
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function ProfileForm({ title, existing, onClose, onSaved }: { title: string; existing?: Profile; onClose: () => void; onSaved: (p?: Profile) => Promise<void> | void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [pin, setPin] = useState('');
  const [clearPin, setClearPin] = useState(false);
  const { busy, error, run } = useAction();

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            let saved: Profile;
            if (existing) saved = await updateProfile(existing.id, { name, pin: clearPin ? null : pin || undefined });
            else saved = await createProfile({ name, role: 'technician', pin: pin || undefined });
            await onSaved(saved);
            onClose();
          });
        }}
      >
        <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus autoComplete="off" />}</Field>
        <Field label={existing?.pinHash ? 'New PIN (leave blank to keep)' : 'PIN (optional, 4 to 8 digits)'} hint="Separates users. Not security.">
          {(id) => <input id={id} value={pin} disabled={clearPin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" maxLength={8} autoComplete="new-password" />}
        </Field>
        {existing?.pinHash && (
          <label className="check">
            <input type="checkbox" checked={clearPin} onChange={(e) => setClearPin(e.target.checked)} />
            <span>Remove the PIN</span>
          </label>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
