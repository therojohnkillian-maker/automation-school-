/**
 * M3 module gate, automated: the nameplate/insulation lesson through all seven steps, the star-delta lesson, templates T1 and T3, and the M3 placement test.
 */
import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:4173/automation-school-/';
const executablePath = process.env.CHROME_PATH || undefined;
const load = (f: string) => JSON.parse(readFileSync(new URL(`../../content/${f}`, import.meta.url), 'utf8'));
const l2 = load('modules/m3-motors/m3-l2-links-insulation.json');
const l4 = load('modules/m3-motors/m3-l4-star-delta.json');
const t1 = load('templates/t1-dol.json');
const t3 = load('templates/t3-star-delta.json');
test.setTimeout(240_000);

const term = (p: Page, ref: string) => p.locator(`[data-term="${ref}"]`).click();
const ctl = (p: Page, id: string, times = 1) => (async () => { for (let i = 0; i < times; i++) await p.locator(`[data-control="${id}"]`).click(); })();
const MODE: Record<string, string> = { VAC: 'AC volts', VDC: 'DC volts', OHM: 'Resistance', IR: 'Insulation test 500 volts' };

async function setup(p: Page, passed: string[] = ['m3-l1']) {
  await p.goto(BASE);
  await p.getByText('I understand this app is for training only').click();
  await p.getByRole('button', { name: 'Create trainer profile' }).click();
  await p.goto(`${BASE}#/learn/m0-l1/why`);
  await expect(p.getByRole('button', { name: /Next: Learn/ })).toBeVisible();
  await p.evaluate(async (ids: string[]) => {
    const req = indexedDB.open('automation-school');
    await new Promise((r) => (req.onsuccess = r));
    const tx = req.result.transaction('lessonProgress', 'readwrite');
    const st = tx.objectStore('lessonProgress');
    const all: Record<string, unknown>[] = await new Promise((r) => {
      const q = st.getAll();
      q.onsuccess = () => r(q.result);
    });
    const steps = { why: true, learn: true, show: true, buildGuided: true, build: true, break: { passed: true, bestScore: 90 }, prove: { passed: true, bestScore: 90 } };
    st.put({ ...all[0], steps });
    for (const id of ids) st.put({ ...all[0], id: `e2e-${id}`, lessonId: id, steps });
    await new Promise((r) => (tx.oncomplete = r));
  }, passed);
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


async function open(passed?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 900 }, executablePath });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await setup(p, passed);
  return { p, errors, close: async () => { await ctx.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const taskDone = (p: Page, i: number) => expect(p.locator('.tasks li').nth(i)).toContainText('Done', { timeout: 15_000 });

test('M3 L2: nameplate, links and insulation testing, all seven steps', async () => {
  const { p, errors, close } = await open();
  await p.goto(`${BASE}#/learn`);
  await p.locator('.lesson-list li', { hasText: l2.title }).getByRole('link', { name: 'Start' }).click();
  await readLearn(p, l2.learn.cards.length);
  // Show
  await ctl(p, 'Q1:toggle');
  await taskDone(p, 0);
  await probe(p, 'M1:U1', 'M1:U2', 'VAC');
  await expect(p.getByTestId('meter-reading')).toHaveText('231 V~');
  await probe(p, 'M1:U1', 'M1:V1', 'VAC');
  await expect(p.getByTestId('meter-reading')).toHaveText('400 V~');
  await ctl(p, 'Q1:toggle');
  await ctl(p, 'Q0:toggle');
  await ctl(p, 'Q0:lock');
  await taskDone(p, 3);
  await probe(p, 'M1:U1', 'M1:PE', 'IR');
  await expect(p.getByTestId('meter-reading')).toHaveText(/MΩ @500 V/);
  await probe(p, 'M1:U1', 'M1:V1', 'OHM');
  await expect(p.getByTestId('meter-reading')).toHaveText('24.0 Ω');
  await taskDone(p, 5);
  await p.getByRole('button', { name: /Next: Build/ }).click();
  // Build, guided: delta first (wrong for this motor), then star.
  await wire(p, [['M1:U1', 'M1:W2'], ['M1:V1', 'M1:U2'], ['M1:W1', 'M1:V2']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByRole('alert')).toContainText('STAR');
  await p.getByRole('button', { name: 'Start again' }).click();
  await wire(p, [['M1:W2', 'M1:U2'], ['M1:U2', 'M1:V2']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /wire it on your own/ }).click();
  await wire(p, [['Q1:2', 'M1:U1'], ['Q1:4', 'M1:V1'], ['Q1:6', 'M1:W1'], ['M1:W2', 'M1:U2'], ['M1:U2', 'M1:V2']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /Next: Break/ }).click();
  await guessFault(p, l2.break.faults[0].report);
  await finishLesson(p, l2.prove.questions);
  expect(errors).toEqual([]);
  await close();
});

test('M3 L4: star-delta show and guided build with interlocks', async () => {
  const { p, errors, close } = await open(['m3-l1', 'm3-l2', 'm3-l3']);
  await p.goto(`${BASE}#/learn`);
  await p.locator('.lesson-list li', { hasText: l4.title }).getByRole('link', { name: 'Start' }).click();
  await readLearn(p, l4.learn.cards.length);
  await ctl(p, 'S1:press');
  await taskDone(p, 0);
  await probe(p, 'M1:U1', 'M1:U2', 'VAC');
  await expect(p.getByTestId('meter-reading')).toHaveText('231 V~');
  await taskDone(p, 1);
  await taskDone(p, 3);
  await expect(p.getByTestId('meter-reading')).toHaveText('400 V~');
  await ctl(p, 'S0:press');
  await taskDone(p, 4);
  await p.getByRole('button', { name: /Next: Build/ }).click();
  // Without the interlocks: star and delta overlap at changeover and the checker says so.
  const common = [['S1:14', 'KM1:A1'], ['S1:14', 'KT:A1'], ['S1:14', 'KT:15'], ['S1:14', 'KT:17'], ['KM1:A2', 'G1:M'], ['KT:A2', 'G1:M'], ['KM2:A2', 'G1:M'], ['KM3:A2', 'G1:M']];
  await wire(p, [...common, ['KT:16', 'KM2:A1'], ['KT:18', 'KM3:A1']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByRole('alert')).toContainText('at the same time');
  await p.getByRole('button', { name: 'Start again' }).click();
  await wire(p, [...common, ['KT:16', 'KM3:21'], ['KM3:22', 'KM2:A1'], ['KT:18', 'KM2:21'], ['KM2:22', 'KM3:A1']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  expect(errors).toEqual([]);
  await close();
});

test('Templates T1 and T3, and the M3 placement test', async () => {
  const { p, errors, close } = await open();
  await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Templates' }).click();
  await p.locator('.lesson-list li', { hasText: 'T1 ·' }).getByRole('link', { name: 'Open' }).click();
  await expect(p.getByText(/crate conveyor/)).toBeVisible();
  await p.getByRole('tab', { name: 'Test sheet' }).click();
  const rec = async (id: string, value: string) => {
    const row = p.locator('.readings li', { has: p.locator(`#ts-${id}`) });
    if (value === 'yes' || value === 'no') await p.locator(`#ts-${id}`).selectOption(value);
    else await p.locator(`#ts-${id}`).fill(value);
    await row.getByRole('button', { name: 'Check' }).click();
    await expect(row).toContainText('Pass');
  };
  await ctl(p, 'S2:press');
  await expect(p.locator('[data-part="M1"]')).toContainText('RUNNING', { timeout: 10_000 });
  await rec('r1', 'yes');
  await rec('r2', '4.6');
  await rec('r3', '1430');
  await probe(p, 'M1:U1', 'M1:V1', 'VAC');
  await expect(p.getByTestId('meter-reading')).toHaveText('400 V~');
  await rec('r4', '400');
  await ctl(p, 'F2:test');
  await expect(p.locator('[data-part="H2"]')).toContainText('LIT');
  await rec('r5', 'yes');
  await ctl(p, 'F2:reset');
  await rec('r6', 'no');
  await expect(p.getByText('Test sheet complete')).toBeVisible();
  await p.getByRole('tab', { name: 'Break it' }).click();
  await guessFault(p, t1.faults[1].report, 'Found it.', 'Not the fault.');

  await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Templates' }).click();
  await p.locator('.lesson-list li', { hasText: 'T3 ·' }).getByRole('link', { name: 'Open' }).click();
  for (const tab of ['I/O list', 'Logic', 'Schedule']) {
    await p.getByRole('tab', { name: tab }).click();
    await expect(p.locator('table.matrix')).toBeVisible();
  }
  await p.getByRole('tab', { name: 'Model answer' }).click();
  await p.getByRole('button', { name: 'Show the model answer' }).click();
  await expect(p.locator('table.matrix')).toContainText('231 V');
  void t3;

  await p.goto(`${BASE}#/placement/m3`);
  await expect(p.locator('.quiz > li').first()).toBeVisible();
  expect(await p.locator('.quiz > li').count()).toBeGreaterThanOrEqual(16);
  expect(errors).toEqual([]);
  await close();
});
