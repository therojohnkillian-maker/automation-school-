import { useState } from 'react';
import { db } from '../../data/db';
import { baseFields } from '../../data/ids';
import { Field, Modal, Notice, useAction } from '../../components/ui';

/** "Feedback" button: the learner writes what was unclear. Saved on the device and included in progress files. */
export function FeedbackButton({ profileId, lessonId, step }: { profileId: string; lessonId?: string; step?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <>
      <button type="button" className="feedback-btn" onClick={() => { setOpen(true); setSaved(false); }}>
        <span aria-hidden="true">✎</span> Feedback
      </button>
      {open && (
        <Modal title="Feedback" onClose={() => setOpen(false)}>
          {saved ? (
            <>
              <Notice kind="ok">Thank you. Your note is saved and your trainer will see it.</Notice>
              <div className="actions"><button className="primary" onClick={() => setOpen(false)}>Close</button></div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const t = text.trim();
                  if (!t) throw new Error('Write a short note first.');
                  await db.feedback.add({ ...(await baseFields(profileId)), lessonId: lessonId ?? null, step: step ?? null, text: t.slice(0, 1000), page: window.location.hash });
                  setText('');
                  setSaved(true);
                });
              }}
            >
              <p className="hint">What was unclear, slow or wrong on this screen? Your trainer and the app's developer will read it.</p>
              <Field label="Your note">{(id) => <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} autoFocus />}</Field>
              {error && <Notice kind="error">{error}</Notice>}
              <div className="actions">
                <button type="button" onClick={() => setOpen(false)}>Cancel</button>
                <button className="primary" disabled={busy}>Save note</button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
