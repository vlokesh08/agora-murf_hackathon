/** Small touches so the assistant's voice doesn't sound identical at 3am and
 *  during a rushed 8am commute — quieter/slower at night, a bit snappier
 *  during typical rush hours. Murf's `rate`/`pitch` are ints in [-50, 50]. */
export function voiceParamsForNow(now: Date = new Date()): { rate: number; pitch: number } {
  const hour = now.getHours();
  if (hour >= 22 || hour < 6) return { rate: -20, pitch: -10 };
  if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19)) return { rate: 10, pitch: 5 };
  return { rate: 0, pitch: 0 };
}
