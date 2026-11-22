import type { Lesson } from '../../content/types';
import type { LessonProgress, StepStates } from '../../data/progress';

export interface StepProps {
  lesson: Lesson;
  progress: LessonProgress;
  profileId: string;
  /** Saves a change to the step states. goNext (default true) moves to the next step. */
  done: (change: (s: StepStates) => StepStates, goNext?: boolean) => Promise<void>;
  record: (data: Record<string, unknown>) => Promise<{ id: string }>;
  recordSession: (data: Record<string, unknown>) => Promise<{ id: string }>;
  lastFaultId: string | null;
}
