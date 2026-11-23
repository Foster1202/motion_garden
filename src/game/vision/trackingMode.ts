export type TrackingMode = 'full' | 'partial' | 'lost';

export const TRACKING_MODE_LABEL: Record<TrackingMode, string> = {
  full: 'Full Tracking',
  partial: 'Partial Tracking',
  lost: 'Tracking Lost',
};
