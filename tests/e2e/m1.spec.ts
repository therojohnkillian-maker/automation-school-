/**
 * M1 module gate, automated: both lessons through all seven steps, and the placement test.
 */
import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:4173/automation-school-/';
const executablePath = process.env.CHROME_PATH || undefined;
const load = (f: string) => JSON.parse(readFileSync(new URL(`../../content/modules/${f}`, import.meta.url), 'utf8'));
const l1 = load('m1-fundamentals/m1-l1-measurement.json');
const l2 = load('m1-fundamentals/m1-l2-drawings.json');
test.setTimeout(240_000);

const term = (p: Page, ref: string) => p.locator(`[data-term="${ref}"]`).click();
const ctl = (p: Page, id: string) => p.locator(`[data-control="${id}"]`).click();
const MODE: Record<string, string> = { VAC: 'AC volts', VDC: 'DC volts', OHM: 'Resistance' };

async function setup(p: Page, name: string) {
  await p.goto(BASE);
  await p.getByText('I understand this app is for training only').click();
  await p.getByLabel('Trainer name').fill(name);
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
  await p.getByRole('button', { name: new RegExp(`^${name} Trainer`) }).click();
}

async function probe(p: Page, a: string, b: string, mode: string) {
  await p.getByRole('button', { name: MODE[mode] }).click();
  await term(p, a);
  await term(p, b);
  const text = await p.getByTestId('meter-reading').innerText();
  return Number(text.replace(/[^\d.-]/g, ''));
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

async function breakByGuessing(p: Page, guess: string) {
  for (let i = 0; i < 40; i++) {
    await p.getByRole('button', { name: 'I found the fault…' }).click();
    await p.getByRole('dialog').getByRole('button', { name: guess }).click();
    await expect(p.getByText(/^(Found it\.|Not the fault\.)$/)).toBeVisible();
    if (await p.getByText('Found it.').isVisible()) return;
    await p.getByRole('button', { name: 'Try another fault' }).click();
  }
  throw new Error('never found');
}

test('M1: both lessons through all seven steps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 900 }, executablePath });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await setup(p, 'SD');

  // ---------------- Lesson 1 ----------------
  await p.goto(`${BASE}#/learn`);
  await p.locator('.lesson-list li', { hasText: l1.title }).getByRole('link', { name: 'Start' }).click();
  await readLearn(p, l1.learn.cards.length);
  await ctl(p, 'S1:toggle');
  for (const [a, b, m] of [['SUP:L1', 'SUP:L2', 'VAC'], ['SUP:L1', 'SUP:N', 'VAC'], ['G1:P', 'G1:M', 'VDC'], ['G1:P', 'G1:M', 'VAC']]) await probe(p, a, b, m);
  await expect(p.getByRole('button', { name: /Next: Build/ })).toBeEnabled();
  await p.getByRole('button', { name: /Next: Build/ }).click();

  // Build: measure, read the meter, type the value.
  let s1On = false;
  let f1On = true;
  const setTo = async (part: 'S1' | 'F1', on: boolean) => {
    if ((part === 'S1' ? s1On : f1On) === on) return;
    await ctl(p, `${part}:toggle`);
    if (part === 'S1') s1On = on;
    else f1On = on;
  };
  for (const part of ['guided', 'unguided'] as const) {
    for (const t of l1.build[part].tasks) {
      for (const c of t.setup ?? []) await setTo(c.part, c.on);
      const v = await probe(p, t.a, t.b, t.mode);
      await p.locator(`#r-${t.id}`).fill(String(v));
      await p.locator('.readings li', { has: p.locator(`#r-${t.id}`) }).getByRole('button', { name: 'Check' }).click();
      await expect(p.locator('.readings li', { has: p.locator(`#r-${t.id}`) })).toContainText('Correct');
    }
    if (part === 'guided') {
      await p.getByRole('button', { name: /measure on your own/ }).click();
      s1On = false;
      f1On = true;
    }
  }
  await p.getByRole('button', { name: /Next: Break/ }).click();
  await breakByGuessing(p, l1.break.faults[0].report);
  await p.getByRole('button', { name: /Next: Prove/ }).click();
  await answerQuiz(p, l1.prove.questions);
  await p.getByRole('button', { name: /Next: Apply/ }).click();
  await p.getByRole('button', { name: /ask my trainer for sign-off/ }).click();
  await expect(p.getByText(/will watch you do this on the bench/)).toBeVisible();

  // ---------------- Lesson 2 ----------------
  await p.goto(`${BASE}#/learn`);
  await p.locator('.lesson-list li', { hasText: l2.title }).getByRole('link', { name: 'Start' }).click();
  await readLearn(p, l2.learn.cards.length);
  await ctl(p, 'S1:toggle');
  await probe(p, 'X1:2', 'X1:4', 'VDC');
  await ctl(p, 'S1:toggle');
  await probe(p, 'X1:1', 'X1:2', 'VDC');
  await p.getByRole('button', { name: /Next: Build/ }).click();
  const wire = async (pairs: string[][]) => {
    for (const [a, b] of pairs) {
      await term(p, a);
      await term(p, b);
    }
  };
  const field = [['X1:1', 'S1:13'], ['X1:2', 'S1:14'], ['X1:3', 'H1:X1'], ['X1:4', 'H1:X2']];
  // A field core on the wrong terminal is caught by the terminal plan check.
  await wire([['X1:1', 'S1:13'], ['X1:2', 'S1:14'], ['X1:5', 'H1:X1'], ['X1:4', 'H1:X2']]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByRole('alert')).toContainText('H1 X1 is not on X1:3');
  await p.getByRole('button', { name: 'Start again' }).click();
  await wire(field);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /wire it on your own/ }).click();
  await wire([['G1:P', 'X1:1'], ['K1:A1', 'X1:2'], ['K1:14', 'X1:3'], ['G1:M', 'X1:4'], ['K1:A2', 'G1:M'], ...field]);
  await p.getByRole('button', { name: 'Check my wiring' }).click();
  await expect(p.getByText(/checks passed/)).toBeVisible();
  await p.getByRole('button', { name: /Next: Break/ }).click();
  await breakByGuessing(p, l2.break.faults[1].report);
  await p.getByRole('button', { name: /Next: Prove/ }).click();
  await answerQuiz(p, l2.prove.questions);
  await p.getByRole('button', { name: /Next: Apply/ }).click();
  await p.getByRole('button', { name: /ask my trainer for sign-off/ }).click();
  await expect(p.getByText(/will watch you do this on the bench/)).toBeVisible();

  await p.goto(`${BASE}#/learn`);
  const m1Card = p.locator('.card', { hasText: 'M1 · Electrical fundamentals' });
  await expect(m1Card.locator('.lesson-list li')).toHaveCount(2);
  await expect(m1Card.locator('.lesson-list li').nth(0)).toContainText('Awaiting sign-off');
  await expect(m1Card.locator('.lesson-list li').nth(1)).toContainText('Awaiting sign-off');
  await expect(m1Card.getByRole('link', { name: 'Take the placement test' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

test('M1 placement test: pass it and the lessons are placed out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 900 }, executablePath });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await setup(p, 'Kabo');
  await p.goto(`${BASE}#/learn`);
  await p.locator('.card', { hasText: 'M1 · Electrical fundamentals' }).getByRole('link', { name: 'Take the placement test' }).click();
  await expect(p.getByRole('heading', { name: 'M1 placement test' })).toBeVisible();
  await answerQuiz(p, [...l1.prove.questions, ...l2.prove.questions]);
  await expect(p.getByText(/marked as placed out/)).toBeVisible();
  await p.getByRole('link', { name: 'Back to lessons' }).click();
  const m1Card = p.locator('.card', { hasText: 'M1 · Electrical fundamentals' });
  await expect(m1Card.locator('.lesson-list li').nth(0)).toContainText('Placed out by test');
  await expect(m1Card.locator('.lesson-list li').nth(1)).toContainText('Placed out by test');
  // A placed-out lesson can still be opened at any step, including Apply for the practical sign-off.
  await m1Card.locator('.lesson-list li').nth(0).getByRole('link').click();
  await p.getByRole('link', { name: 'Apply: open' }).click();
  await p.getByRole('button', { name: /ask my trainer for sign-off/ }).click();
  await expect(p.getByText(/will watch you do this on the bench/)).toBeVisible();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});
