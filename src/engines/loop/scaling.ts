/** 4-20 mA loop scaling. Siemens-style nominal range: 4 mA → 0, 20 mA → 27648. */
export const RAW_AT_20MA = 27648;

export function mAToValue(mA: number, lo: number, hi: number): number {
  return lo + ((mA - 4) / 16) * (hi - lo);
}

export function valueToMA(value: number, lo: number, hi: number): number {
  return 4 + ((value - lo) / (hi - lo)) * 16;
}

/** Nominal raw count for a current. Over/under-range limits: VERIFY against the module manual (Phase 5). */
export function mAToRaw(mA: number): number {
  return Math.round(((mA - 4) / 16) * RAW_AT_20MA);
}

export function rawToValue(raw: number, lo: number, hi: number): number {
  return lo + (raw / RAW_AT_20MA) * (hi - lo);
}
