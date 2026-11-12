import type { AvatarRenderFraming } from '@fitvision/shared';
import { AVATAR_RENDERER_VERSION, renderAvatarFront } from '../../../../apps/api/src/avatar/render.js';

/**
 * Avatar render styles under evaluation. Same body geometry, camera and pose; only the look differs.
 * `avatar-render-1.0-flat` is the renderer the app uses today (`AVATAR_RENDERER_VERSION`).
 * A second style (e.g. `avatar-render-1.1-humanlike`) is added here only if 1.0 performs poorly
 * with a real provider (VALIDATION_TRACKING.md §3b), and becomes the app default only after both
 * are compared on the same garments and provider.
 */
export interface RenderStyle {
  id: string;
  /** Renderer version string stored by the app for this style, if the app uses it. */
  appRendererVersion: string | null;
  render: (glb: Buffer, framing: AvatarRenderFraming) => Promise<Buffer>;
}

export const RENDER_STYLES: RenderStyle[] = [{ id: 'avatar-render-1.0-flat', appRendererVersion: AVATAR_RENDERER_VERSION, render: renderAvatarFront }];
