import { useState } from 'react';
import { createProfile } from '../../data/profiles';
import { requestPersistence } from '../../data/storage';
import { useSession } from '../../app/session';
import { Field, Notice, useAction } from '../../components/ui';
import { SafetyNotice } from '../settings/SafetyNotice';

/** Shown once, when the device has no profiles yet. Creates the first trainer. */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('SD');
  const [pin, setPin] = useState('');
  const [agreed, setAgreed] = useState(false);
  const { busy, error, run } = useAction();
  const setProfile = useSession((s) => s.setProfile);

  return (
    <main className="narrow">
      <h1>Welcome to Automation School</h1>
      <p>Set up the trainer profile for this device. You can add apprentices next.</p>
      <SafetyNotice />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const p = await createProfile({ name, role: 'trainer', pin: pin || undefined });
            await requestPersistence();
            setProfile(p);
            onDone();
          });
        }}
      >
        <Field label="Trainer name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="off" />}</Field>
        <Field label="PIN (optional, 4 to 8 digits)" hint="A PIN stops people opening your profile by accident. It is not security.">
          {(id) => <input id={id} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" maxLength={8} autoComplete="new-password" />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I understand this app is for training only and does not make anyone competent or authorised.</span>
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="primary" disabled={busy || !agreed}>Create trainer profile</button>
      </form>
    </main>
  );
}
