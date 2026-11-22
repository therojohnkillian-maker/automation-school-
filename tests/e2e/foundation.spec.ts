/**
 * Phase 2 gate, automated: install, go offline, save, restart, restore.
 * Runs once at laptop size and once as an Android phone.
 */
import { test, expect, chromium, devices, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:4173/automation-school-/';
const executablePath = process.env.CHROME_PATH || undefined;

const targets = [
  { name: 'laptop', options: { viewport: { width: 1280, height: 800 } } },
  { name: 'android phone', options: { ...devices['Pixel 7'] } },
];

for (const target of targets) {
  test.describe(target.name, () => {
    let dir: string;
    test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'as-e2e-')); });
    test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const launch = async (): Promise<BrowserContext> => {
      const { defaultBrowserType: _ignored, ...opts } = target.options as Record<string, unknown>;
      return chromium.launchPersistentContext(dir, { ...opts, executablePath, acceptDownloads: true, serviceWorkers: 'allow' });
    };

    const pick = async (page: Page, name: string) => {
      await page.getByRole('button', { name: new RegExp(`^${name} (Trainer|Apprentice)`) }).click();
    };

    test('install, go offline, save, restart, restore', async () => {
      // ---- First visit online: set up the trainer and an apprentice ----
      let ctx = await launch();
      let page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(BASE);
      await expect(page.getByRole('heading', { name: 'Welcome to Automation School' })).toBeVisible();
      await expect(page.getByLabel('Trainer name')).toHaveValue('SD');
      const create = page.getByRole('button', { name: 'Create trainer profile' });
      await expect(create).toBeDisabled(); // must accept the training-only notice
      await page.getByText('I understand this app is for training only').click();
      await create.click();
      await expect(page.getByRole('heading', { name: 'Hi SD' })).toBeVisible();

      await page.getByRole('link', { name: /Trainer/ }).click();
      await page.getByRole('button', { name: '+ Add apprentice' }).click();
      await page.getByLabel('Name').fill('Thandi');
      await page.getByLabel(/PIN/).fill('2468');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('.people')).toContainText('Thandi');

      // App is cached for offline once the service worker controls the page.
      await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null);
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

      // ---- Go offline and save something ----
      await ctx.setOffline(true);
      await page.reload();
      await expect(page.getByText(/Offline\. Everything still works/)).toBeVisible();
      await pick(page, 'SD');
      await page.getByRole('link', { name: /Trainer/ }).click();
      await page.getByRole('button', { name: '+ Add apprentice' }).click();
      await page.getByLabel('Name').fill('Kabo');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('.people')).toContainText('Kabo');

      // Back up while offline.
      await page.getByRole('link', { name: /Settings/ }).click();
      await expect(page.getByText('Ready to use offline')).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up now' }).click()]);
      expect(download.suggestedFilename()).toMatch(/\.asbackup\.json$/);
      const backupPath = join(dir, '..', `${target.name.replace(/\W/g, '')}-backup.json`);
      await download.saveAs(backupPath);
      await ctx.close();

      // ---- Restart the browser, still offline ----
      ctx = await launch();
      await ctx.setOffline(true);
      page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(BASE);
      for (const n of ['SD', 'Thandi', 'Kabo']) await expect(page.getByRole('button', { name: new RegExp(`^${n} (Trainer|Apprentice)`) })).toBeVisible();

      // PIN check for Thandi.
      await pick(page, 'Thandi');
      await page.locator('#pin-entry').fill('1111');
      await page.getByRole('button', { name: 'Open profile' }).click();
      await expect(page.getByText('That PIN is not right')).toBeVisible();
      await page.locator('#pin-entry').fill('2468');
      await page.getByRole('button', { name: 'Open profile' }).click();
      await expect(page.getByRole('heading', { name: 'Hi Thandi' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Trainer/ })).toHaveCount(0); // apprentices have no trainer area
      await page.getByRole('button', { name: 'Switch user' }).click();

      // ---- Lose data, then restore from the backup ----
      await pick(page, 'SD');
      await page.getByRole('link', { name: /Trainer/ }).click();
      for (const n of ['Kabo', 'Thandi']) {
        await page.locator('.people li', { hasText: n }).getByRole('button', { name: 'Remove' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
        await expect(page.locator('.people')).not.toContainText(n);
      }
      await page.getByRole('link', { name: /Settings/ }).click();
      await page.locator('#restore-file').setInputFiles(backupPath);
      await expect(page.getByRole('dialog')).toContainText('3 profile(s)');
      await page.getByRole('button', { name: 'Replace and restore' }).click();
      await expect(page.getByText('Backup restored. Choose your profile.')).toBeVisible();
      for (const n of ['SD', 'Thandi', 'Kabo']) await expect(page.getByRole('button', { name: new RegExp(`^${n} (Trainer|Apprentice)`) })).toBeVisible();

      // A damaged file changes nothing.
      await pick(page, 'SD');
      await page.getByRole('link', { name: /Settings/ }).click();
      await page.locator('#restore-file').setInputFiles({ name: 'bad.asbackup.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nope"}') });
      await expect(page.getByRole('alert')).toContainText('failed its checks');

      await ctx.close();
      rmSync(backupPath, { force: true });
    });
  });
}
