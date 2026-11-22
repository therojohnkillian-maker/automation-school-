import { useEffect, useState } from 'react';
import { useSession } from '../../app/session';
import { usePwa } from '../../app/pwa';
import { APP_VERSION, backupFileName, buildBackup, buildProgress, parseBackup, progressFileName, restoreBackup } from '../../data/files';
import { formatBytes, getLastBackupAt, getStorageStatus, markBackupDone, requestPersistence, type StorageStatus } from '../../data/storage';
import { Card, Modal, Notice, StatusChip, downloadText, useAction } from '../../components/ui';
import { SafetyNotice } from './SafetyNotice';

export function Settings({ onRestored }: { onRestored: () => void }) {
  const profile = useSession((s) => s.profile)!;
  const isTrainer = profile.role === 'trainer';
  const pwa = usePwa();
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; profiles: number; exportedAt: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const backup = useAction();
  const restore = useAction();

  const refresh = async () => {
    setStorage(await getStorageStatus());
    setLastBackup(await getLastBackupAt());
  };
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <main>
      <h1>Settings</h1>
      {message && <Notice kind="ok">{message}</Notice>}

      {isTrainer ? (
        <Card title="Backup and restore">
          <div id="backup" />
          <p>A backup holds every profile and all progress on this device. Keep it somewhere safe, such as your email or a USB stick.</p>
          <p className="hint">Last backup: {lastBackup ? new Date(lastBackup).toLocaleString('en-GB') : 'never'}</p>
          {backup.error && <Notice kind="error">{backup.error}</Notice>}
          <div className="actions">
            <button
              className="primary"
              disabled={backup.busy}
              onClick={() =>
                backup.run(async () => {
                  downloadText(backupFileName(), JSON.stringify(await buildBackup(), null, 1));
                  await markBackupDone();
                  await refresh();
                  setMessage('Backup file saved to your downloads.');
                })
              }
            >
              Back up now
            </button>
            <input
              type="file"
              accept=".json,application/json"
              id="restore-file"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void restore.run(async () => {
                  const text = await f.text();
                  const parsed = parseBackup(text);
                  setPending({ text, profiles: parsed.data.profiles.filter((p) => !p.deleted).length, exportedAt: parsed.exportedAt });
                });
              }}
            />
            <label htmlFor="restore-file" className="button">Restore from backup…</label>
          </div>
          {restore.error && <Notice kind="error">{restore.error}</Notice>}
        </Card>
      ) : (
        <Card title="My progress">
          <p>Export your progress to give to your trainer when you train on a different device.</p>
          {backup.error && <Notice kind="error">{backup.error}</Notice>}
          <button
            className="primary"
            onClick={() =>
              backup.run(async () => {
                downloadText(progressFileName(profile.name), JSON.stringify(await buildProgress(profile.id), null, 1));
                setMessage('Progress file saved to your downloads.');
              })
            }
          >
            Export my progress
          </button>
        </Card>
      )}

      <Card title="Offline use">
        <p>
          {pwa.offlineReady ? <StatusChip status="passed" label="Ready to use offline" /> : <StatusChip status="progress" label="Preparing for offline use…" />}{' '}
          {pwa.online ? <StatusChip status="open" label="Online" /> : <StatusChip status="locked" label="Offline" />}
        </p>
        {storage && (
          <>
            <p>
              Storage:{' '}
              {storage.persisted ? <StatusChip status="passed" label="Protected" /> : <StatusChip status="failed" label="Not protected" />}{' '}
              <span className="hint">{formatBytes(storage.usageBytes)} used</span>
            </p>
            {!storage.persisted && (
              <>
                <p className="hint">Unprotected storage can be cleared by the browser when the device is low on space. Installing the app usually fixes this. Keep backups either way.</p>
                <button onClick={async () => { await requestPersistence(); await refresh(); }}>Ask to protect storage</button>
              </>
            )}
          </>
        )}
      </Card>

      <Card title="Install the app">
        {pwa.installed ? (
          <p><StatusChip status="passed" label="Installed" /></p>
        ) : pwa.installEvent ? (
          <button className="primary" onClick={() => void pwa.install()}>Install Automation School</button>
        ) : null}
        <details open={!pwa.installed}>
          <summary>How to install</summary>
          <p><strong>Android phone (Chrome):</strong> open the app's web address, tap the ⋮ menu, then <em>Install app</em> or <em>Add to Home screen</em>.</p>
          <p><strong>Laptop (Chrome or Edge):</strong> open the web address and click the install icon at the right of the address bar, or ⋮ menu → <em>Install Automation School</em>.</p>
          <p>Each device needs one visit while online. After that the app opens and works with no internet. Each device keeps its own data: move it with a backup or a progress file.</p>
        </details>
      </Card>

      <Card title="About">
        <SafetyNotice />
        <p className="hint">Automation School version {APP_VERSION}. All plants, people and tags in this app are fictional.</p>
      </Card>

      {pending && (
        <Modal title="Restore this backup?" onClose={() => setPending(null)}>
          <p>The backup is from <strong>{new Date(pending.exportedAt).toLocaleString('en-GB')}</strong> and has <strong>{pending.profiles}</strong> profile(s).</p>
          <Notice kind="warn">Restoring <strong>replaces everything on this device</strong>. Any progress made here since that backup will be lost. Back up first if unsure.</Notice>
          {restore.error && <Notice kind="error">{restore.error}</Notice>}
          <div className="actions">
            <button onClick={() => setPending(null)}>Cancel</button>
            <button
              className="danger"
              disabled={restore.busy}
              onClick={() =>
                restore.run(async () => {
                  await restoreBackup(pending.text);
                  setPending(null);
                  onRestored();
                })
              }
            >
              Replace and restore
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
