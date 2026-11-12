import type { TryOnSuitability } from '@fitvision/shared';
import { MediaPipeBodyScanProcessor } from '../scan/engine/mediapipeProcessor';
import { assessTryOnPhoto } from './suitability';

/** Checks a try-on photo in the browser. Implementations are swappable (tests use a fake). */
export interface PersonPhotoAnalyzer {
  analyze(image: HTMLCanvasElement): Promise<TryOnSuitability>;
  close(): void;
}

export function createPersonPhotoAnalyzer(): PersonPhotoAnalyzer {
  const processor = new MediaPipeBodyScanProcessor();
  return {
    async analyze(image) {
      const { frame, qualityChecks } = await processor.detect(image);
      return assessTryOnPhoto(frame, qualityChecks);
    },
    close: () => processor.close(),
  };
}
