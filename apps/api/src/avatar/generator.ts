import type { AvatarInputs, BodyParameters } from '@fitvision/shared';
import { writeGlb } from './glb.js';
import { buildBody, buildMesh, computeNormals, sliceGirth, verticalExtent, widthAt } from './mesh.js';
import { mapMeasurementsToParameters } from './parameters.js';
import { renderFrontPreview } from './preview.js';

export interface GeneratedAvatar {
  parameters: BodyParameters;
  /** 3D model (GLB). */
  asset: { data: Buffer; ext: 'glb' };
  preview: { data: Buffer; ext: 'svg' };
}

/**
 * Avatar-generation abstraction. The parametric mannequin below can be replaced by a 3D
 * reconstruction engine or an external avatar provider that returns a GLB.
 */
export interface AvatarGenerator {
  readonly avatarType: string;
  readonly modelVersion: string;
  generate(inputs: AvatarInputs): Promise<GeneratedAvatar>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Measurement snapshot → body parameters → base model + morph → GLB + preview, then a self-check. */
export class ParametricAvatarGenerator implements AvatarGenerator {
  readonly avatarType = 'parametric_mannequin';
  readonly modelVersion = 'parametric-mannequin-0.1';

  async generate(inputs: AvatarInputs): Promise<GeneratedAvatar> {
    const params = mapMeasurementsToParameters(inputs);
    const { parts, levels } = buildBody(params);
    const mesh = buildMesh(parts);

    // Self-check: re-measure the generated mesh against the parameters it was built from.
    const { minY, maxY } = verticalExtent(mesh);
    const eps = 1e-4;
    const girthError = (y: number, target: number) => round2((100 * (sliceGirth(mesh, 'torso', y + eps) - target)) / target);
    const fidelity: BodyParameters['fidelity'] = {
      heightErrorCm: round2(maxY - minY - params.resolved.heightCm.valueCm),
      shoulderErrorCm: round2(widthAt(mesh, 'torso', levels.shoulderY) - params.resolved.shoulderCm.valueCm),
      // Crotch height measured from the generated torso, not from the planned level.
      inseamErrorCm: round2(verticalExtent(mesh, 'torso').minY - minY - params.resolved.inseamCm.valueCm),
      chestErrorPct: girthError(levels.chestY, params.resolved.chestCm.valueCm),
      waistErrorPct: girthError(levels.waistY, params.resolved.waistCm.valueCm),
      hipsErrorPct: girthError(levels.hipY, params.resolved.hipsCm.valueCm),
    };

    // glTF uses metres.
    const positions = new Float32Array(mesh.positions.map((v) => v / 100));
    const normals = new Float32Array(computeNormals(mesh.positions, mesh.indices));
    const glb = writeGlb({ positions, normals, indices: new Uint32Array(mesh.indices), name: 'avatar' }, `FitVision ${this.modelVersion}`);

    return {
      parameters: { ...params, fidelity },
      asset: { data: glb, ext: 'glb' },
      preview: { data: renderFrontPreview(parts, params.resolved.heightCm.valueCm), ext: 'svg' },
    };
  }
}
