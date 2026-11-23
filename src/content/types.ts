import { z } from 'zod';

/** Schemas for lesson content. Every content file is validated by a unit test and on load. */

const command = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('press'), part: z.string() }),
  z.object({ kind: z.literal('release'), part: z.string() }),
  z.object({ kind: z.literal('switch'), part: z.string(), on: z.boolean() }),
  z.object({ kind: z.literal('trip-test'), part: z.string() }),
  z.object({ kind: z.literal('reset'), part: z.string() }),
  z.object({ kind: z.literal('lock'), part: z.string() }),
  z.object({ kind: z.literal('unlock'), part: z.string() }),
  z.object({ kind: z.literal('set'), part: z.string(), value: z.number() }),
  z.object({ kind: z.literal('config'), part: z.string(), rangeLo: z.number(), rangeHi: z.number() }),
]);

const expectation = z.union([
  z.object({ part: z.string(), energised: z.boolean() }).strict(),
  z.object({ part: z.string(), tripped: z.boolean() }).strict(),
  z.object({ part: z.string(), lit: z.boolean() }).strict(),
  z.object({ part: z.string(), psuOn: z.boolean() }).strict(),
  z.object({ part: z.string(), pressed: z.boolean() }).strict(),
  z.object({ part: z.string(), motor: z.enum(['running', 'stopped-or-coasting', 'not-powered']), direction: z.enum(['forward', 'reverse']).optional() }).strict(),
  z.object({ part: z.string(), feedsMotor: z.string() }).strict(),
  z.object({ connected: z.tuple([z.string(), z.string()]) }).strict(),
  z.object({ part: z.string(), input: z.string(), on: z.boolean() }).strict(),
  z.object({ part: z.string(), output: z.boolean() }).strict(),
  z.object({ part: z.string(), mA: z.tuple([z.number(), z.number()]) }).strict(),
  z.object({ part: z.string(), value: z.tuple([z.number(), z.number()]) }).strict(),
  z.object({ part: z.string(), relay: z.enum(['hi', 'lo']), on: z.boolean() }).strict(),
  z.object({ noShorts: z.literal(true) }).strict(),
  z.object({ stable: z.literal(true) }).strict(),
]);

const checkStep = z.union([
  z.object({ do: command }).strict(),
  z.object({ wait: z.number().int().positive() }).strict(),
  z.object({ expect: expectation, fail: z.string().min(10) }).strict(),
]);

const fault = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('wire-open'), wire: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('wire-moved'), wire: z.string(), end: z.enum(['a', 'b']), to: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('contact-open'), part: z.string(), a: z.string(), b: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('contact-closed'), part: z.string(), a: z.string(), b: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('coil-open'), part: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('load-open'), part: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('high-resistance'), wire: z.string(), ohms: z.number().positive(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('extra-wire'), a: z.string(), b: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('tx-failed'), part: z.string(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('config'), part: z.string(), rangeLo: z.number(), rangeHi: z.number(), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('labels-swapped'), parts: z.tuple([z.string(), z.string()]), report: z.string() }),
  z.object({ id: z.string(), kind: z.literal('tester-faulty'), report: z.string() }),
]);

const scenario = z.object({ circuit: z.string(), target: z.string(), jobTag: z.string(), points: z.array(z.string()).min(2) });

const demoAction = z.union([
  z.object({ switch: z.object({ part: z.string(), on: z.boolean() }) }).strict(),
  z.object({ lock: z.string() }).strict(),
  z.object({ prove: z.literal(true) }).strict(),
  z.object({ test: z.tuple([z.string(), z.string()]) }).strict(),
  z.object({ declare: z.literal(true) }).strict(),
]);

const question = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(z.string()).min(2).max(5),
  answer: z.number().int().min(0),
  explain: z.string().min(10),
  critical: z.boolean().optional(),
});

/** A measurement the learner makes and types in. The expected value is calculated by the simulator after `setup`. */
const measureTask = z.object({
  id: z.string(),
  text: z.string(),
  a: z.string(),
  b: z.string(),
  mode: z.enum(['VAC', 'VDC', 'OHM']),
  setup: z.array(command).default([]),
  unit: z.string(),
  tolerancePct: z.number().positive().default(5),
});

const breakCommon = {
  intro: z.string(),
  /** Functional checks used to prove every fault has a symptom (defaults to the build checks). */
  symptomChecks: z.array(checkStep).optional(),
  faults: z.array(fault).min(3),
  parMeasurements: z.number().int().positive(),
  parSeconds: z.number().int().positive(),
  extraReports: z.array(z.string()).default([]),
};

export const lessonSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  version: z.string(),
  title: z.string(),
  minutes: z.number().int().positive(),
  summary: z.string(),
  requires: z.array(z.string()).default([]),
  why: z.object({ text: z.string() }),
  learn: z.object({ cards: z.array(z.object({ title: z.string(), text: z.string(), circuit: z.string().optional() })).min(1) }),
  show: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('circuit'),
      circuit: z.string(),
      intro: z.string(),
      tasks: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          when: z.array(expectation).optional(),
          measure: z.object({ a: z.string(), b: z.string(), mode: z.enum(['VAC', 'VDC', 'OHM']) }).optional(),
        }),
      ).min(1),
    }),
    z.object({ kind: z.literal('isolation'), scenario, intro: z.string(), demo: z.array(z.object({ say: z.string(), action: demoAction })).min(1) }),
  ]),
  build: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('circuit'),
      circuit: z.string(),
      checks: z.array(checkStep).min(1),
      guided: z.object({ intro: z.string(), removeWires: z.array(z.string()).min(1), hints: z.array(z.string()).min(1), configure: z.array(z.string()).default([]) }),
      unguided: z.object({ intro: z.string(), removeWires: z.array(z.string()).min(1), configure: z.array(z.string()).default([]) }),
      /** Settings the learner starts from in the unguided part (e.g. an analog input left unscaled). */
      unguidedStart: z.array(command).default([]),
    }),
    z.object({ kind: z.literal('isolation'), scenario, guided: z.object({ intro: z.string() }), unguided: z.object({ intro: z.string() }) }),
    z.object({
      kind: z.literal('measure'),
      circuit: z.string(),
      guided: z.object({ intro: z.string(), tasks: z.array(measureTask).min(3) }),
      unguided: z.object({ intro: z.string(), tasks: z.array(measureTask).min(3) }),
    }),
  ]),
  break: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('circuit'), circuit: z.string(), ...breakCommon }),
    z.object({ kind: z.literal('isolation'), scenario, ...breakCommon }),
  ]),
  prove: z.object({ passMark: z.number().min(0).max(1), questions: z.array(question).min(5) }),
  apply: z.object({ intro: z.string(), items: z.array(z.object({ id: z.string(), text: z.string() })).min(3) }),
});

export type Lesson = z.infer<typeof lessonSchema>;
export type Question = z.infer<typeof question>;
export type MeasureTask = z.infer<typeof measureTask>;
export type ShowTask = Extract<Lesson['show'], { kind: 'circuit' }>['tasks'][number];
export type StepId = 'why' | 'learn' | 'show' | 'build' | 'break' | 'prove' | 'apply';
export const STEPS: { id: StepId; label: string; short: string }[] = [
  { id: 'why', label: 'Why', short: 'Why' },
  { id: 'learn', label: 'Learn', short: 'Learn' },
  { id: 'show', label: 'Show', short: 'Show' },
  { id: 'build', label: 'Build', short: 'Build' },
  { id: 'break', label: 'Break', short: 'Break' },
  { id: 'prove', label: 'Prove', short: 'Prove' },
  { id: 'apply', label: 'Apply', short: 'Apply' },
];

export const glossarySchema = z.record(z.string(), z.string());

// ---------------- Templates ----------------

export const templateSchema = z.object({
  id: z.string(),
  number: z.number().int().min(1).max(8),
  moduleId: z.string(),
  version: z.string(),
  title: z.string(),
  summary: z.string(),
  circuit: z.string(),
  brief: z.string(),
  ioList: z.array(z.object({ tag: z.string(), description: z.string(), type: z.string(), range: z.string(), connection: z.string() })).min(1),
  logic: z.array(z.object({ function: z.string(), condition: z.string(), action: z.string() })).min(1),
  logicNote: z.string().optional(),
  schedule: z.array(z.object({ step: z.string(), who: z.string(), hours: z.number().positive() })).min(1),
  testSheet: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        setup: z.array(command).default([]),
        part: z.string(),
        field: z.enum(['mA', 'eng', 'lit', 'energised']),
        unit: z.string(),
      }),
    )
    .min(3),
  faults: z.array(fault).min(3),
  faultChecks: z.array(checkStep).min(1),
  extraReports: z.array(z.string()).default([]),
  modelAnswer: z.string(),
});

export type Template = z.infer<typeof templateSchema>;
export type TestRow = Template['testSheet'][number];
