/** Progress (0..1) to road curve parameter: units start past HQ and stop before the flag. */
export const roadS = (progress: number) => 0.05 + progress * 0.86;

/** Side-by-side lanes so several units on one road don't overlap. */
export const laneFor = (index: number, count: number) =>
  Math.max(-2.2, Math.min(2.2, (index - (count - 1) / 2) * 1.7));
