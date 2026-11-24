/**
 * M2 module gate, automated: both lessons through all seven steps, and template T4.
 */
import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:4173/automation-school-/';
const executablePath = process.env.CHROME_PATH || undefined;
const load = (f: string) => JSON.parse(readFileSync(new URL(`../../content/${f}`, import.meta.url), 'utf8'));
const l1 = load('modules/m2-instruments/m2-l1-sensors.json');
const l2 = load('modules/m2-instruments/m2-l2-loops.json');
const t4 = load('templates/t4-tank.json');
test.setTimeout(240_000);

const term = (p: Page, ref: string) => p.locator(`[data-term="${ref}"]`).click();
const ctl = (p: Page, id: string, times = 1) => (async () => { for (let i = 0; i < times; i++) await p.locator(`[data-control="${id}"]`).click(); })();
const MODE: Record<string, string> = { VAC: 'AC volts', VDC: 'DC volts', OHM: 'Resistance' };

async function setup(p: Page) {
  await p.goto(BASE);
  await p.getByText('I understand this app is for training only').click();
  await p.getByRole('button', { name: 'Create trainer profile' }).click();
  await p.goto(`${BASE}#/learn/m0-l1/why`);
  await expect(p.getByRole('button', { name: /Next: Learn/ })).toBeVisible();
  await p.evaluate(async () => {
    const req = indexedDB.open('automation-school');
    await new Promise((r) => (req.onsuccess = r));
    const tx = req.result.transaction('lessonProgress', 'readwrite');
    const st = tx.objectStore('lessonProgress');
    const all: Record<string, unknown>[] = await new Promise((r) => {
      const q = st.getAll();
      q.onsuccess = () => r(q.result);
    });
    st.put({ ...all[0], steps: { why: true, learn: true, show: true, buildGuided: true, build: true, break: { passed: true, bestScore: 90 }, prove: { passed: true, bestScore: 90 } } });
    await new Promise((r) => (tx.oncomplete = r));
  });
  await p.reload();
  await p.getByRole('button', { name: /^SD Trainer/ }).click();
}
async function probe(p: Page, a: string, b: string, mode: string) {
  await p.getByRole('button', { name: MODE[mode] }).click();
  await term(p, a);
  await term(p, b);
}
async function wire(p: Page, pairs: string[][]) {
  for (const [a, b] of pairs) {
    await term(p, a);
    await term(p, b);
  }
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
async function readLearn(p: Page, cards: number) {
  await p.getByRole('button', { name: /Next: Learn/ }).click();
  for (let i = 1; i < cards; i++) await p.getByRole('button', { name: /Next card/ }).click();
  await p.getByRole('button', { name: /Next: Show/ }).click();
}
async function guessFault(p: Page, guess: string, found = 'Found it.', notFound = 'Not the fault.') {
  for (let i = 0; i < 40; i++) {
    await p.getByRole('button', { name: 'I found the fault…' }).click();
    await p.getByRole('dialog').getByRole('button', { name: guess }).click();
    await expect(p.getByText(new RegExp(`^(${found.replace('.', '\\.')}|${notFound.replace('.', '\\.')})`))).toBeVisible();
    if (await p.getByText(new RegExp(`^${found.replace('.', '\\.')}`)).isVisible()) return;
    await p.getByRole('button', { name: /Try another fault/ }).click();
  }
  throw new Error('never found');
}
async function finishLesson(p: Page, questions: { text: string; options: string[]; answer: number }[]) {
  await p.getByRole('button', { name: /Next: Prove/ }).click();
  await answerQuiz(p, questions);
  await p.getByRole('button', { name: /Next: Apply/ }).click();
  await p.getByRole('button', { name: /ask my trainer for sign-off/ }).click();
  await expect(p.getByText(/will watch you do this on the bench/)).toBeVisible();
}

test('M2: sensors and 4-20 mA loop lessons, all seven steps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 900 }, executablePath });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await setup(p);

  // ---------------- L1 sensors ----------------
  await p.goto(`${BASE}#/learn`);
  await p.locator('.lesson-list li', { hasText: l1.title }).getByRole('link', { name: 'Start' }).click();
  await readLearn(p, l1.learn.cards.length);
  await ctl(p, 'B1:target');
  await probe(p, 'B1:BK', 'B1:BU', 'VDC');
  await expect(p.getByTestId('meter-reading')).toHaveText('24.0 V=');
  await ctl(p, 'B2:target');
  await probe(p, 'B2:BK', 'B2:BU', 'VDC');
  await expect(p.getByTestId('meter-reading')).toHaveText('0.0 V=');
  await p.getByRole('button', { name: /Next: Build/ }).click();
  await wire(p, [['G1:P', 'B1:BN'], ['B1:BU', 'G1:M'], ['B1:BK', 'DI1:I0']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /wire it on your own/ }).click();
  // Common wired to 0 V, as for PNP: the checker explains why the NPN input stays off.
  await wire(p, [['G1:P', 'B2:BN'], ['B2:BU', 'G1:M'], ['B2:BK', 'DI2:I0'], ['DI2:M', 'G1:M']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByRole('alert')).toContainText('DI2 M must go to +24 V');
  await p.getByRole('button', { name: 'Start again' }).click();
  await wire(p, [['G1:P', 'B2:BN'], ['B2:BU', 'G1:M'], ['B2:BK', 'DI2:I0'], ['DI2:M', 'G1:P']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /Next: Break/ }).click();
  await guessFault(p, l1.break.faults[1].report);
  await finishLesson(p, l1.prove.questions);

  // ---------------- L2 loops ----------------
  await p.goto(`${BASE}#/learn`);
  await p.locator('.lesson-list li', { hasText: l2.title }).getByRole('link', { name: 'Start' }).click();
  await readLearn(p, l2.learn.cards.length);
  await expect(p.locator('.tasks li').nth(0)).toContainText('Done');
  await probe(p, 'AI1:+', 'AI1:-', 'VDC');
  await expect(p.getByTestId('meter-reading')).toHaveText('3.0 V=');
  await probe(p, 'PT1:+', 'PT1:-', 'VDC');
  await ctl(p, 'PT1:up', 10);
  await expect(p.locator('.tasks li').nth(3)).toContainText('Done');
  await ctl(p, 'PT1:down', 20);
  await expect(p.getByRole('button', { name: /Next: Build/ })).toBeEnabled();
  await p.getByRole('button', { name: /Next: Build/ }).click();
  await wire(p, [['X1:1', 'PT1:+'], ['PT1:-', 'X1:2']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /wire it on your own/ }).click();
  await wire(p, [['G1:P', 'X1:1'], ['X1:2', 'AI1:+'], ['AI1:-', 'G1:M'], ['X1:1', 'PT1:+'], ['PT1:-', 'X1:2']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByRole('alert')).toContainText('scaling');
  await p.getByLabel('4 mA =').fill('0');
  await p.getByLabel('20 mA =').fill('10');
  await p.getByRole('button', { name: 'Apply scaling' }).click();
  await expect(p.locator('[data-part="AI1"]')).toContainText('scaled 0–10');
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /Next: Break/ }).click();
  await guessFault(p, l2.break.faults[4].report);
  await finishLesson(p, l2.prove.questions);
  expect(errors).toEqual([]);
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Template T4: run, test sheet, break it, model answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 900 }, executablePath });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await setup(p);
  await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Templates' }).click();
  await expect(p.locator('.lesson-list li')).toHaveCount(8);
  await expect(p.locator('.lesson-list li', { hasText: 'T5 ·' })).toContainText('Arrives with M5');
  await p.locator('.lesson-list li', { hasText: 'T4 ·' }).getByRole('link', { name: 'Open' }).click();
  await expect(p.getByText(/syrup tank/)).toBeVisible();
  for (const tab of ['I/O list', 'Logic', 'Schedule']) {
    await p.getByRole('tab', { name: tab }).click();
    await expect(p.locator('table.matrix')).toBeVisible();
  }
  await expect(p.getByText('Total: 7 hours.')).toBeVisible();

  // Test sheet: set the level with LT1's buttons (0.2 m steps from 2 m), read and record.
  await p.getByRole('tab', { name: 'Test sheet' }).click();
  const rec = async (id: string, value: string) => {
    const row = p.locator('.readings li', { has: p.locator(`#ts-${id}`) });
    if (value === 'yes' || value === 'no') await p.locator(`#ts-${id}`).selectOption(value);
    else await p.locator(`#ts-${id}`).fill(value);
    await row.getByRole('button', { name: 'Check' }).click();
    await expect(row).toContainText('Pass');
  };
  await ctl(p, 'LT1:down', 10);
  await expect(p.locator('[data-part="AI1"]')).toContainText('4 mA');
  await rec('r0', '4');
  await ctl(p, 'LT1:up', 5);
  await rec('r1', '8');
  await ctl(p, 'LT1:up', 5);
  await rec('r2', '2');
  await ctl(p, 'LT1:up', 5);
  await rec('r3', '16');
  await ctl(p, 'LT1:up', 5);
  await rec('r4', '20');
  await ctl(p, 'LT1:down', 2);
  await expect(p.locator('[data-part="H1"]')).toContainText('LIT');
  await rec('a1', 'yes');
  await ctl(p, 'LT1:down', 2);
  await rec('a2', 'no');
  await ctl(p, 'LT1:down', 14);
  await expect(p.locator('[data-part="H2"]')).toContainText('LIT');
  await rec('a3', 'yes');
  await ctl(p, 'LT1:up', 3);
  await rec('a4', 'no');
  await expect(p.getByText('Test sheet complete')).toBeVisible();

  await p.getByRole('tab', { name: 'Break it' }).click();
  await guessFault(p, t4.faults[2].report, 'Found it.', 'Not the fault.');
  await p.getByRole('tab', { name: 'Model answer' }).click();
  await p.getByRole('button', { name: 'Show the model answer' }).click();
  await expect(p.locator('table.matrix')).toContainText('20 mA');
  expect(errors).toEqual([]);
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});
