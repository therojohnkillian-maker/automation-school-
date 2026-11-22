/**
 * Phase 3 gate, automated: an apprentice completes M0 and the DOL lesson through all seven steps,
 * the trainer signs off, and the progress file imports on another device.
 */
import { test, expect, chromium, devices, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const m0 = JSON.parse(readFileSync(new URL('../../content/modules/m0-safety/m0-l1-safe-isolation.json', import.meta.url), 'utf8'));
const m3 = JSON.parse(readFileSync(new URL('../../content/modules/m3-motors/m3-l1-dol-starter.json', import.meta.url), 'utf8'));

const BASE = 'http://localhost:4173/automation-school-/';
const executablePath = process.env.CHROME_PATH || undefined;
test.setTimeout(240_000);

const term = (p: Page, ref: string) => p.locator(`[data-term="${ref}"]`).click();
const ctl = (p: Page, id: string) => p.locator(`[data-control="${id}"]`).click();
async function hold(p: Page, id: string, ms = 300) {
  const el = p.locator(`[data-control="${id}"]`);
  await el.dispatchEvent('pointerdown');
  await p.waitForTimeout(ms);
  await el.dispatchEvent('pointerup');
}
async function pick(p: Page, name: string) {
  await p.getByRole('button', { name: new RegExp(`^${name} (Trainer|Apprentice)`) }).click();
}

async function answerQuiz(p: Page, questions: { text: string; options: string[]; answer: number }[]) {
  const items = p.locator('.quiz > li');
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const li = items.nth(i);
    const legend = await li.locator('legend').innerText();
    const q = questions.find((x) => legend.includes(x.text))!;
    await li.getByRole('radio', { name: q.options[q.answer], exact: true }).check();
  }
  await p.getByRole('button', { name: 'Submit answers' }).click();
  await expect(p.getByText(/^Passed:/)).toBeVisible();
}

const PAIRS: [string, string][] = [['U1', 'V1'], ['V1', 'W1'], ['U1', 'W1'], ['U1', 'PE'], ['V1', 'PE'], ['W1', 'PE']];
async function testAllPairs(p: Page) {
  for (const [a, b] of PAIRS) {
    await term(p, `M1:${a}`);
    await term(p, `M1:${b}`);
  }
  const live = await p.locator('.tests li.live').count();
  return live > 0;
}
async function isolate(p: Page, iso: string) {
  await ctl(p, `${iso}:toggle`);
  await ctl(p, `${iso}:lock`);
}

test('apprentice completes M0 and DOL; trainer signs off; progress imports on another device', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 900 }, executablePath, acceptDownloads: true });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // ---- Setup ----
  await p.goto(BASE);
  await p.getByText('I understand this app is for training only').click();
  await p.getByLabel('Trainer name').fill('SD');
  await p.getByLabel(/PIN/).fill('1357');
  await p.getByRole('button', { name: 'Create trainer profile' }).click();
  await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Trainer' }).click();
  await p.getByRole('button', { name: '+ Add apprentice' }).click();
  await p.getByLabel('Name').fill('Thandi');
  await p.getByRole('button', { name: 'Save' }).click();
  await p.getByRole('button', { name: 'Switch user' }).click();
  await pick(p, 'Thandi');

  // ---- M0 ----
  await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Learn' }).click();
  await expect(p.locator('.lesson-list li', { hasText: m3.title })).toContainText('Locked');
  await p.locator('.lesson-list li', { hasText: m0.title }).getByRole('link', { name: 'Start' }).click();
  await p.getByRole('button', { name: /Next: Learn/ }).click();
  for (let i = 1; i < m0.learn.cards.length; i++) await p.getByRole('button', { name: /Next card/ }).click();
  await p.getByRole('button', { name: /Next: Show/ }).click();
  for (let i = 0; i < m0.show.demo.length; i++) await p.getByRole('button', { name: /Do next step/ }).click();
  await p.getByRole('button', { name: /Demonstration complete/ }).click();

  // Build guided: a deliberate mistake first (no prove after testing), then correct.
  await expect(p.getByText(/Find the isolator tagged "P-101 PUMP"/)).toBeVisible();
  await isolate(p, 'Q0A');
  await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
  expect(await testAllPairs(p)).toBe(false);
  await p.getByRole('button', { name: /Declare dead/ }).click();
  await expect(p.getByText(/did not prove the tester again/)).toBeVisible();
  await p.getByRole('button', { name: 'Try again' }).click();
  for (const mode of ['guided', 'unguided']) {
    await isolate(p, 'Q0A');
    await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
    expect(await testAllPairs(p)).toBe(false);
    await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
    await p.getByRole('button', { name: /Declare dead/ }).click();
    await expect(p.getByText('Correct procedure.')).toBeVisible();
    await p.getByRole('button', { name: mode === 'guided' ? /do it with no hints/ : /Next: Break/ }).click();
  }

  // Break: a random hidden fault. Follow the procedure and react to what the tests show.
  const reports: Record<string, string> = Object.fromEntries(m0.break.faults.map((f: { id: string; report: string }) => [f.id, f.report]));
  const labelled = ((await p.locator('[data-part="Q0A"]').textContent()) ?? '').includes('P-101') ? 'Q0A' : 'Q0B';
  const other = labelled === 'Q0A' ? 'Q0B' : 'Q0A';
  await isolate(p, labelled);
  await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
  let report: string;
  if (await p.getByText('This tester is faulty').isVisible()) {
    await p.getByRole('button', { name: 'Get a replacement tester' }).click();
    await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
    expect(await testAllPairs(p)).toBe(false);
    await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
    report = reports['m0-tester'];
    await p.getByRole('button', { name: /Declare dead/ }).click();
  } else if (await testAllPairs(p)) {
    await isolate(p, other);
    await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
    const before = await p.locator('.tests li.live').count();
    for (const [a, b] of PAIRS) { await term(p, `M1:${a}`); await term(p, `M1:${b}`); }
    const stillLive = (await p.locator('.tests li.live').count()) > before;
    if (stillLive) {
      report = reports['m0-welded'];
      await p.getByRole('button', { name: /Stop and report/ }).click();
    } else {
      await p.getByRole('button', { name: 'Prove tester on proving unit' }).click();
      report = reports['m0-labels'];
      await p.getByRole('button', { name: /Declare dead/ }).click();
    }
  } else {
    throw new Error('Expected a fault to show itself');
  }
  await p.getByRole('dialog').getByRole('button', { name: report }).click();
  await expect(p.getByText('You stayed safe and found the problem')).toBeVisible();
  await p.getByRole('button', { name: /Next: Prove/ }).click();
  await answerQuiz(p, m0.prove.questions);
  await p.getByRole('button', { name: /Next: Apply/ }).click();
  await p.getByRole('button', { name: /ask my trainer for sign-off/ }).click();
  await expect(p.getByText(/will watch you do this on the bench/)).toBeVisible();

  // ---- M3 DOL ----
  await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Learn' }).click();
  await p.locator('.lesson-list li', { hasText: m3.title }).getByRole('link', { name: 'Start' }).click();
  await p.getByRole('button', { name: /Next: Learn/ }).click();
  for (let i = 1; i < m3.learn.cards.length; i++) await p.getByRole('button', { name: /Next card/ }).click();
  await p.getByRole('button', { name: /Next: Show/ }).click();
  const S2 = p.locator('[data-control="S2:press"]');
  await S2.dispatchEvent('pointerdown');
  await expect(p.locator('.tasks li').nth(0)).toContainText('Done');
  await S2.dispatchEvent('pointerup');
  await expect(p.locator('.tasks li').nth(1)).toContainText('Done', { timeout: 5000 });
  await term(p, 'KM1:A1');
  await term(p, 'KM1:A2');
  await p.getByRole('button', { name: 'DC volts' }).click();
  await expect(p.getByTestId('meter-reading')).toHaveText('24.0 V=');
  await expect(p.locator('.tasks li').nth(2)).toContainText('Done');
  await hold(p, 'S1:press');
  await expect(p.locator('.tasks li').nth(3)).toContainText('Done');
  await hold(p, 'S2:press');
  await p.waitForTimeout(300);
  await ctl(p, 'F2:test');
  await expect(p.locator('.tasks li').nth(4)).toContainText('Done');
  await ctl(p, 'F2:reset');
  await p.waitForTimeout(300);
  await hold(p, 'S2:press');
  await expect(p.getByRole('button', { name: /Next: Build/ })).toBeEnabled();
  await p.getByRole('button', { name: /Next: Build/ }).click();

  const wire = async (pairs: [string, string][]) => {
    for (const [a, b] of pairs) {
      await term(p, a);
      await term(p, b);
    }
  };
  const control: [string, string][] = [
    ['G1:P', 'S1:11'], ['S1:12', 'S2:13'], ['S2:13', 'KM1:13'], ['S2:14', 'KM1:14'], ['S2:14', 'F2:95'], ['F2:96', 'KM1:A1'], ['KM1:A2', 'G1:M'],
  ];
  // Guided: first leave out the holding contact, the checker must catch it.
  await wire(control.filter(([, b]) => b !== 'KM1:13' && b !== 'KM1:14'));
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByRole('alert')).toContainText('holding contact');
  await wire([['S2:13', 'KM1:13'], ['S2:14', 'KM1:14']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /wire it on your own/ }).click();
  const power: [string, string][] = [
    ['Q1:2', 'KM1:1'], ['Q1:4', 'KM1:3'], ['Q1:6', 'KM1:5'], ['KM1:2', 'F2:1'], ['KM1:4', 'F2:3'], ['KM1:6', 'F2:5'], ['F2:2', 'M1:U1'], ['F2:4', 'M1:V1'], ['F2:6', 'M1:W1'],
  ];
  await wire([...power, ...control]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /Next: Break/ }).click();

  // Break: guess until right (the engine tests prove each fault is diagnosable; this checks the flow and scoring).
  const guess = m3.break.faults[3].report;
  for (let i = 0; i < 40; i++) {
    await term(p, 'G1:P');
    await term(p, 'G1:M');
    await p.getByRole('button', { name: 'I found the fault…' }).click();
    await p.getByRole('dialog').getByRole('button', { name: guess }).click();
    await expect(p.getByText(/^(Found it\.|Not the fault\.)$/)).toBeVisible();
    if (await p.getByText('Found it.').isVisible()) break;
    await p.getByRole('button', { name: 'Try another fault' }).click();
  }
  await expect(p.getByText('Found it.')).toBeVisible();
  await p.getByRole('button', { name: /Next: Prove/ }).click();
  await answerQuiz(p, m3.prove.questions);
  await p.getByRole('button', { name: /Next: Apply/ }).click();
  await p.getByRole('button', { name: /ask my trainer for sign-off/ }).click();

  // ---- Trainer signs off M0, asks for a redo on DOL ----
  await p.getByRole('button', { name: 'Switch user' }).click();
  await pick(p, 'SD');
  await p.locator('#pin-entry').fill('1357');
  await p.getByRole('button', { name: 'Open profile' }).click();
  await expect(p.getByText(/2 practical sign-offs are waiting/)).toBeVisible();
  await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Trainer' }).click();
  const row = (t: string) => p.locator('.people li', { hasText: t });
  await row(m0.title).getByRole('button', { name: 'Observe and sign' }).click();
  const dlg = p.getByRole('dialog');
  await expect(dlg.getByRole('button', { name: 'Tick every item to sign' })).toBeDisabled();
  for (const c of await dlg.getByRole('checkbox').all()) await c.check();
  await dlg.getByLabel('Your trainer PIN').fill('1357');
  await dlg.getByRole('button', { name: 'Sign off' }).click();
  await row(m3.title).getByRole('button', { name: 'Observe and sign' }).click();
  await dlg.getByLabel(/Note/).fill('Tighten terminations on X1 and re-test');
  await dlg.getByLabel('Your trainer PIN').fill('1357');
  await dlg.getByRole('button', { name: 'Needs redo' }).click();
  await expect(p.getByText('Nobody is waiting for a sign-off.')).toBeVisible();
  const thandiRow = p.locator('table.matrix tr', { hasText: 'Thandi' });
  await expect(thandiRow).toContainText('Signed off');
  await expect(thandiRow).toContainText('Trainer asked for redo');

  // ---- Export Thandi's progress and import it on another device ----
  const [dl] = await Promise.all([p.waitForEvent('download'), row('Thandi').getByRole('button', { name: 'Export progress' }).click()]);
  const file = join(dir, '..', 'thandi.asprogress.json');
  await dl.saveAs(file);
  expect(errors).toEqual([]);
  await ctx.close();

  const dir2 = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const ctx2 = await chromium.launchPersistentContext(dir2, { viewport: { width: 1366, height: 900 }, executablePath });
  const q = ctx2.pages()[0] ?? (await ctx2.newPage());
  await q.goto(BASE);
  await q.getByText('I understand this app is for training only').click();
  await q.getByRole('button', { name: 'Create trainer profile' }).click();
  await q.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Trainer' }).click();
  await q.locator('#import-progress').setInputFiles(file);
  await expect(q.getByText(/Imported/)).toContainText('Thandi');
  const r2 = q.locator('table.matrix tr', { hasText: 'Thandi' });
  await expect(r2).toContainText('Signed off');
  await expect(r2).toContainText('Trainer asked for redo');
  await ctx2.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(dir2, { recursive: true, force: true });
  rmSync(file, { force: true });
});

test('phone: tap-to-wire and the meter work on a touch screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const { defaultBrowserType: _d, ...pixel } = devices['Pixel 7'];
  const ctx = await chromium.launchPersistentContext(dir, { ...pixel, executablePath });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.goto(BASE);
  await p.getByText('I understand this app is for training only').click();
  await p.getByRole('button', { name: 'Create trainer profile' }).click();
  await p.goto(`${BASE}#/learn`);
  await p.locator('.lesson-list li', { hasText: m0.title }).getByRole('link', { name: 'Start' }).click();
  await p.getByRole('button', { name: /Next: Learn/ }).tap();
  for (let i = 1; i < m0.learn.cards.length; i++) await p.getByRole('button', { name: /Next card/ }).tap();
  await p.getByRole('button', { name: /Next: Show/ }).tap();
  for (let i = 0; i < m0.show.demo.length; i++) await p.getByRole('button', { name: /Do next step/ }).tap();
  await p.getByRole('button', { name: /Demonstration complete/ }).tap();
  // The drawing scrolls rather than shrinking: terminals stay a usable size.
  const box = await p.locator('[data-term="M1:U1"]').boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(26);
  await p.locator('[data-control="Q0A:toggle"]').tap();
  await p.locator('[data-control="Q0A:lock"]').tap();
  await p.locator('[data-term="M1:U1"]').tap();
  await p.locator('[data-term="M1:PE"]').tap();
  await expect(p.locator('.tests li')).toContainText('U1–PE: no indication');
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

for (const target of [{ name: 'laptop', opts: { viewport: { width: 1366, height: 900 } } }, { name: 'phone', opts: (({ defaultBrowserType: _d, ...rest }) => rest)(devices['Pixel 7']) }]) {
  test(`3D equipment view follows the simulator and its terminals take meter probes (${target.name})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
    const ctx = await chromium.launchPersistentContext(dir, { ...target.opts, executablePath });
    const p = ctx.pages()[0] ?? (await ctx.newPage());
    const errors: string[] = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE);
    await p.getByText('I understand this app is for training only').click();
    await p.getByRole('button', { name: 'Create trainer profile' }).click();
    await p.goto(`${BASE}#/learn/m0-l1/why`);
    await expect(p.getByRole('button', { name: /Next: Learn/ })).toBeVisible();
    // Mark M0 passed and DOL up to Show, as if done earlier.
    await p.evaluate(async () => {
      const req = indexedDB.open('automation-school');
      await new Promise((r) => (req.onsuccess = r));
      const tx = req.result.transaction('lessonProgress', 'readwrite');
      const st = tx.objectStore('lessonProgress');
      const all: Record<string, unknown>[] = await new Promise((r) => {
        const q = st.getAll();
        q.onsuccess = () => r(q.result);
      });
      const m0 = all[0];
      st.put({ ...m0, steps: { why: true, learn: true, show: true, buildGuided: true, build: true, break: { passed: true, bestScore: 90 }, prove: { passed: true, bestScore: 90 } } });
      st.put({ ...m0, id: 'X-m3', lessonId: 'm3-l1', steps: { why: true, learn: true } });
      await new Promise((r) => (tx.oncomplete = r));
    });
    await p.reload();
    await pick(p, 'SD');
    await p.goto(`${BASE}#/learn/m3-l1/show`);
    await p.getByRole('button', { name: '3D equipment' }).click();
    await expect(p.locator('.eq3d-host canvas')).toBeVisible();
    await expect(p.locator('.plate3d', { hasText: /^KM1 / })).toHaveText('KM1 · OPEN (O)');
    const start = p.locator('[data-ctl3d="S2"]');
    await start.dispatchEvent('pointerdown');
    await expect(p.locator('.plate3d', { hasText: /^KM1 / })).toHaveText('KM1 · PULLED IN (I)');
    await start.dispatchEvent('pointerup');
    await expect(p.locator('.plate3d', { hasText: /^M1 / })).toContainText('RUNNING · forward', { timeout: 5000 });
    await expect(p.locator('.tasks li').nth(1)).toContainText('Done');
    // Zoomed out, terminal labels are hidden; zoom to the contactor and probe the coil.
    await expect(p.locator('[data-term3d="KM1:A1"]')).toBeHidden();
    await p.getByRole('button', { name: 'KM1 + F2' }).click();
    await expect(p.locator('[data-term3d="KM1:A1"]')).toBeVisible();
    await p.locator('[data-term3d="KM1:A1"]').click();
    await p.locator('[data-term3d="KM1:A2"]').click();
    await p.getByRole('button', { name: 'DC volts' }).click();
    await expect(p.getByTestId('meter-reading')).toHaveText('24.0 V=');
    await expect(p.locator('.tasks li').nth(2)).toContainText('Done');
    if (target.name === 'laptop') {
      // Press the red TEST button on the 3D overload itself (screen position for this camera view and canvas size).
      const r = (await p.locator('.eq3d-host canvas').boundingBox())!;
      expect(Math.round(r.width)).toBe(771);
      await p.mouse.click(r.x + 401, r.y + 306);
    } else {
      await p.locator('[data-ctl3d="F2-test"]').click();
    }
    await expect(p.locator('.plate3d', { hasText: /^F2 / })).toContainText('TRIPPED');
    await expect(p.locator('.plate3d', { hasText: 'H2 TRIP' })).toContainText('H2 TRIP LIT');
    // Back to the drawing: same circuit, same state.
    await p.getByRole('button', { name: 'Drawing' }).click();
    await expect(p.locator('[data-part="F2"]')).toContainText('TRIPPED');
    expect(errors).toEqual([]);
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });
}
