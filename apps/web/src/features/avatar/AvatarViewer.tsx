import { useEffect, useRef } from 'react';
import type { AvatarView } from '@fitvision/shared';

interface AvatarViewerProps {
  assetUrl: string;
  view: AvatarView;
  autoRotate: boolean;
  /** Called when 3D can't be shown (no WebGL, or the model failed to load). */
  onError: (reason: 'webgl' | 'load') => void;
}

interface ViewerApi {
  setView: (view: AvatarView) => void;
  setAutoRotate: (on: boolean) => void;
  /** Keyboard rotation (radians around the body). */
  rotateBy: (radians: number) => void;
}

/** Interactive 3D preview (three.js, loaded on demand). Drag to rotate 360°. The model faces +z. */
export function AvatarViewer({ assetUrl, view, autoRotate, onError }: AvatarViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const initial = useRef({ view, autoRotate, onError });

  useEffect(() => {
    const container = containerRef.current!;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        initial.current.onError('webgl');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', '3D avatar preview. Drag to rotate.');
      renderer.domElement.setAttribute('role', 'img');
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 2.2));
      const key = new THREE.DirectionalLight(0xffffff, 1.8);
      key.position.set(1.5, 3, 2.5);
      const rim = new THREE.DirectionalLight(0xffffff, 0.8);
      rim.position.set(-2, 2, -2.5);
      scene.add(key, rim);

      const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.autoRotateSpeed = 3;
      // Keep the camera near eye level: rotation is mainly around the body.
      controls.minPolarAngle = Math.PI / 2 - 0.6;
      controls.maxPolarAngle = Math.PI / 2 + 0.35;

      let distance = 4;
      const place = (v: AvatarView) => {
        const t = controls.target;
        const pos = v === 'front' ? [0, 0, distance] : v === 'side' ? [distance, 0, 0] : [0, 0, -distance];
        camera.position.set(t.x + pos[0]!, t.y + pos[1]!, t.z + pos[2]!);
        controls.update();
      };
      apiRef.current = {
        setView: place,
        setAutoRotate: (on) => (controls.autoRotate = on),
        rotateBy: (radians) => {
          const t = controls.target;
          const dx = camera.position.x - t.x;
          const dz = camera.position.z - t.z;
          const c = Math.cos(radians);
          const s = Math.sin(radians);
          camera.position.set(t.x + dx * c - dz * s, camera.position.y, t.z + dx * s + dz * c);
          controls.update();
        },
      };

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = container;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();

      let frame = 0;
      const loop = () => {
        controls.update();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(loop);
      };

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        scene.traverse((obj) => {
          const mesh = obj as InstanceType<typeof THREE.Mesh>;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
        apiRef.current = null;
      };

      try {
        const res = await fetch(assetUrl, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Model request failed (${res.status})`);
        const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), '');
        if (disposed) return;
        scene.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        controls.target.set(0, box.min.y + size.y / 2, 0);
        distance = (size.y / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.2;
        controls.minDistance = distance * 0.55;
        controls.maxDistance = distance * 1.6;
        place(initial.current.view);
        controls.autoRotate = initial.current.autoRotate;
        loop();
      } catch (err) {
        console.error(err);
        if (!disposed) initial.current.onError('load');
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [assetUrl]);

  useEffect(() => {
    apiRef.current?.setView(view);
  }, [view]);
  useEffect(() => {
    apiRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  return (
    <div
      ref={containerRef}
      className="fv-avatar-viewer"
      tabIndex={0}
      role="application"
      aria-roledescription="3D viewer"
      aria-label="3D avatar. Use the left and right arrow keys or drag to rotate."
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          apiRef.current?.rotateBy(e.key === 'ArrowLeft' ? -Math.PI / 12 : Math.PI / 12);
        }
      }}
    />
  );
}
