import catalogJson from '../../content/catalog/modules.json';
import glossaryJson from '../../content/reference/glossary.json';
import dolCircuit from '../../content/circuits/dol-starter.json';
import isoCircuit from '../../content/circuits/m0-isolation.json';
import m1Measure from '../../content/circuits/m1-measure.json';
import m1Terminals from '../../content/circuits/m1-terminals.json';
import m1Symbols from '../../content/circuits/m1-symbols.json';
import m2Sensors from '../../content/circuits/m2-sensors.json';
import m2Loop from '../../content/circuits/m2-loop.json';
import t4Tank from '../../content/circuits/t4-tank.json';
import m3Links from '../../content/circuits/m3-links.json';
import m3FwdRev from '../../content/circuits/m3-fwd-rev.json';
import m3StarDelta from '../../content/circuits/m3-star-delta.json';
import m3SoftStarter from '../../content/circuits/m3-soft-starter.json';
import m0l1 from '../../content/modules/m0-safety/m0-l1-safe-isolation.json';
import m3l1 from '../../content/modules/m3-motors/m3-l1-dol-starter.json';
import m3l2 from '../../content/modules/m3-motors/m3-l2-links-insulation.json';
import m3l3 from '../../content/modules/m3-motors/m3-l3-forward-reverse.json';
import m3l4 from '../../content/modules/m3-motors/m3-l4-star-delta.json';
import m3l5 from '../../content/modules/m3-motors/m3-l5-soft-starter.json';
import m1l1 from '../../content/modules/m1-fundamentals/m1-l1-measurement.json';
import m1l2 from '../../content/modules/m1-fundamentals/m1-l2-drawings.json';
import m2l1 from '../../content/modules/m2-instruments/m2-l1-sensors.json';
import m2l2 from '../../content/modules/m2-instruments/m2-l2-loops.json';
import type { CircuitJson } from '../engines/wiring/types';
import { lessonSchema, templateSchema, type Lesson, type Template } from './types';
import templateCatalogJson from '../../content/catalog/templates.json';
import t4 from '../../content/templates/t4-tank.json';
import t1 from '../../content/templates/t1-dol.json';
import t2 from '../../content/templates/t2-fwd-rev.json';
import t3 from '../../content/templates/t3-star-delta.json';

export interface ModuleInfo {
  id: string;
  code: string;
  title: string;
  summary: string;
  required: boolean;
  plannedPhase: number;
  note?: string;
  lessons: string[];
  /** Modules with a placement test can be skipped by passing it. M0 has none. */
  placement?: boolean;
}

export const catalog = catalogJson as { contentVersion: string; modules: ModuleInfo[] };
export const glossary = glossaryJson as Record<string, string>;

export const circuits: Record<string, CircuitJson> = {
  'dol-starter': dolCircuit as unknown as CircuitJson,
  'm0-isolation': isoCircuit as unknown as CircuitJson,
  'm1-measure': m1Measure as unknown as CircuitJson,
  'm1-terminals': m1Terminals as unknown as CircuitJson,
  'm1-symbols': m1Symbols as unknown as CircuitJson,
  'm2-sensors': m2Sensors as unknown as CircuitJson,
  'm2-loop': m2Loop as unknown as CircuitJson,
  't4-tank': t4Tank as unknown as CircuitJson,
  'm3-links': m3Links as unknown as CircuitJson,
  'm3-fwd-rev': m3FwdRev as unknown as CircuitJson,
  'm3-star-delta': m3StarDelta as unknown as CircuitJson,
  'm3-soft-starter': m3SoftStarter as unknown as CircuitJson,
};

const rawLessons: unknown[] = [m0l1, m1l1, m1l2, m2l1, m2l2, m3l1, m3l2, m3l3, m3l4, m3l5];
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

export const templateCatalog = templateCatalogJson as { templates: { number: number; title: string; moduleId: string; id: string | null }[] };
export const templates: Template[] = [t1, t2, t3, t4].map((t) => templateSchema.parse(t));
export const templateById = (id: string) => templates.find((t) => t.id === id);
