import type { ScanView } from '@fitvision/shared';

export const SCAN_TIPS = [
  'Wear fitted clothing so your body outline is clear',
  'Stand in a well-lit area against a plain background',
  'Keep your whole body — head to feet — in the frame',
  'Place the camera at waist height, about 2–3 m away',
];

export const VIEW_INSTRUCTIONS: Record<ScanView, { title: string; how: string }> = {
  front: { title: 'Front', how: 'Face the camera, feet hip-width apart, arms slightly away from your body.' },
  side: { title: 'Side', how: 'Turn 90° to your left, stand straight, arms relaxed by your sides.' },
  back: { title: 'Back', how: 'Turn your back to the camera, arms slightly away from your body. Optional.' },
};
