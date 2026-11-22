/**
 * Fault-finding score, shown to the learner and trainer:
 * 60 for finding the fault safely, up to 20 for few measurements, up to 20 for speed.
 * Passing Break needs the right answer and no critical safety error. The score shows how efficiently it was done.
 */
export function breakScore(measurements: number, parMeasurements: number, seconds: number, parSeconds: number): number {
  const eff = measurements <= parMeasurements ? 1 : parMeasurements / measurements;
  const time = seconds <= parSeconds ? 1 : parSeconds / seconds;
  return Math.round(60 + 20 * eff + 20 * time);
}

/** Quiz: pass at or above the pass mark, and any wrong critical question fails. */
export function quizResult(correct: boolean[], critical: boolean[], passMark: number) {
  const score = correct.length ? correct.filter(Boolean).length / correct.length : 0;
  const criticalFail = correct.some((c, i) => !c && critical[i]);
  return { score, criticalFail, passed: score >= passMark && !criticalFail };
}
