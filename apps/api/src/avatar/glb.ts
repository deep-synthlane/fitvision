/** Minimal glTF 2.0 binary (GLB) writer for a single indexed triangle mesh. */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const pad4 = (n: number) => (4 - (n % 4)) % 4;

export interface GlbMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  name?: string;
  color?: [number, number, number, number];
}

export function writeGlb(mesh: GlbMesh, generator: string): Buffer {
  const posBytes = Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  const nrmBytes = Buffer.from(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.byteLength);
  const idxBytes = Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
  const bin = Buffer.concat([posBytes, nrmBytes, idxBytes]);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, mesh.positions[i + k]!);
      max[k] = Math.max(max[k]!, mesh.positions[i + k]!);
    }
  }
  const vertexCount = mesh.positions.length / 3;

  const gltf = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: mesh.name ?? 'mesh' }],
    meshes: [{ name: mesh.name ?? 'mesh', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        name: 'mannequin',
        pbrMetallicRoughness: { baseColorFactor: mesh.color ?? [0.8, 0.81, 0.83, 1], metallicFactor: 0, roughnessFactor: 0.75 },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: nrmBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length + nrmBytes.length, byteLength: idxBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonChunk = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(pad4(bin.length), 0)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunkHeader = (length: number, type: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([header, chunkHeader(jsonChunk.length, CHUNK_JSON), jsonChunk, chunkHeader(binChunk.length, CHUNK_BIN), binChunk]);
}

/** Parses a GLB's JSON chunk (used by tests and sanity checks). */
export function readGlbJson(glb: Buffer): { json: Record<string, unknown>; binLength: number } {
  if (glb.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Not a GLB file');
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trimEnd()) as Record<string, unknown>;
  const binLength = glb.readUInt32LE(20 + jsonLength);
  return { json, binLength };
}
