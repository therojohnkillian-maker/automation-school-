import { useState } from 'react';
import type { Profile } from '../../data/db';
import { checkPin } from '../../data/pin';
import { useSession } from '../../app/session';
import { Modal, Notice } from '../../components/ui';

export function ProfilePicker({ profiles }: { profiles: Profile[] }) {
  const setProfile = useSession((s) => s.setProfile);
  const [asking, setAsking] = useState<Profile | null>(null);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  const choose = (p: Profile) => {
    if (p.pinHash) {
      setAsking(p);
      setPin('');
      setWrong(false);
    } else setProfile(p);
  };

  return (
    <main className="narrow">
      <h1>Who is training?</h1>
      <ul className="profile-grid" aria-label="Profiles">
        {profiles.map((p) => (
          <li key={p.id}>
            <button className="profile-tile" onClick={() => choose(p)}>
              <span className="avatar" aria-hidden="true">{p.name.slice(0, 2).toUpperCase()}</span>
              <span className="tile-name">{p.name}</span>
              <span className="tile-role">
                {p.role === 'trainer' ? 'Trainer' : 'Apprentice'}
                {p.pinHash ? ' · PIN' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">New apprentices are added by the trainer, in the Trainer area.</p>
      <p className="hint">PINs separate users. They are not security.</p>

      {asking && (
        <Modal title={`PIN for ${asking.name}`} onClose={() => setAsking(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await checkPin(pin, asking.pinSalt!, asking.pinHash!)) setProfile(asking);
              else setWrong(true);
            }}
          >
            <label htmlFor="pin-entry" className="sr-only">PIN</label>
            <input id="pin-entry" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" maxLength={8} autoComplete="off" className="pin-input" />
            {wrong && <Notice kind="error">That PIN is not right. Try again, or ask your trainer to reset it.</Notice>}
            <div className="actions">
              <button type="button" onClick={() => setAsking(null)}>Cancel</button>
              <button className="primary">Open profile</button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
