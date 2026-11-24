// Pilot-only presentation policy. No emergency gates or backend settings.
export const NETWORK_PILOT = Object.freeze({
  maxLoadedReports: 100,
  minimumAggregateCount: 3,
  lowActivityMaximum: 4,
  mediumActivityMaximum: 9,
  periods: [7, 30, 90, 0] as const,
});
