import catalogJson from '../../content/catalog/modules.json';
import glossaryJson from '../../content/reference/glossary.json';
import dolCircuit from '../../content/circuits/dol-starter.json';
import isoCircuit from '../../content/circuits/m0-isolation.json';
import m0l1 from '../../content/modules/m0-safety/m0-l1-safe-isolation.json';
import m3l1 from '../../content/modules/m3-motors/m3-l1-dol-starter.json';
import type { CircuitJson } from '../engines/wiring/types';
import { lessonSchema, type Lesson } from './types';

export interface ModuleInfo {
  id: string;
  code: string;
  title: string;
  summary: string;
  required: boolean;
  plannedPhase: number;
  note?: string;
  lessons: string[];
}

export const catalog = catalogJson as { contentVersion: string; modules: ModuleInfo[] };
export const glossary = glossaryJson as Record<string, string>;

export const circuits: Record<string, CircuitJson> = {
  'dol-starter': dolCircuit as unknown as CircuitJson,
  'm0-isolation': isoCircuit as unknown as CircuitJson,
};

const rawLessons: unknown[] = [m0l1, m3l1];
export const lessons: Lesson[] = rawLessons.map((l) => lessonSchema.parse(l));
export const lessonById = (id: string) => lessons.find((l) => l.id === id);
export const moduleById = (id: string) => catalog.modules.find((m) => m.id === id);

export function circuit(id: string): CircuitJson {
  const c = circuits[id];
  if (!c) throw new Error(`Unknown circuit ${id}`);
  return c;
}

/** All lessons in course order. */
export function lessonsInOrder(): Lesson[] {
  return catalog.modules.flatMap((m) => m.lessons.map((id) => lessonById(id)).filter((l): l is Lesson => !!l));
}
