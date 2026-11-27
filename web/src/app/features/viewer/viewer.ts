import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, effect, inject, input, signal, viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Icon } from '../../ui/icon';
import { frame } from '../../data/fake-model';
import { neutralizeMetalness } from '../../data/materials';

// Raycasting acelerado con BVH: picar sobre una malla de cientos de miles de caras sin que se trabe.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let viewerSeq = 0;
type Nudge = 'left' | 'right' | 'up' | 'down' | 'in' | 'out';
type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'no-webgl';
export type PaintTool = 'brush' | 'wand';
interface Change { i: number; prev: [number, number, number] }

/** Viewer3D de components.md: carga un GLB por URL y permite pintar la figura por zonas (pincel y varita). */
@Component({
  selector: 'app-viewer',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative viewport-bg overflow-hidden' },
  template: `
    <!-- BUG-003: solo se puede enfocar cuando hay un modelo; antes era enfocable estando oculto -->
    <div #mount class="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      [class.cursor-crosshair]="painting()"
      [attr.tabindex]="state() === 'ready' ? 0 : null" [attr.role]="state() === 'ready' ? 'group' : null"
      [attr.aria-roledescription]="state() === 'ready' ? 'visor 3D' : null"
      [attr.aria-label]="state() === 'ready' ? 'Modelo 3D: ' + name() : null" [attr.aria-describedby]="state() === 'ready' ? helpId : null"
      [attr.aria-hidden]="state() === 'ready' ? null : 'true'"
      (keydown)="keys($event)"></div>

    @if (state() === 'loading') {
      <div class="absolute inset-0 grid place-items-center pointer-events-none">
        <div class="flex flex-col items-center gap-2 text-sm text-text-muted"><span class="skeleton w-24 h-24 rounded-full"></span>Cargando modelo…</div>
      </div>
    }
    @if (state() === 'error') {
      <div class="absolute inset-0 grid place-items-center text-center p-4" role="alert">
        <div class="flex flex-col items-center gap-2"><ui-icon name="circle-alert" [size]="28" class="text-danger" />
          <p class="text-sm">No se ha podido cargar el modelo.</p></div>
      </div>
    }
    @if (state() === 'no-webgl') {
      <div class="absolute inset-0 grid place-items-center text-center p-4">
        <p class="text-sm text-text-muted max-w-xs">Tu navegador no puede mostrar 3D (WebGL desactivado). Puedes exportar el modelo igualmente.</p>
      </div>
    }
    @if (busy()) {
      <div class="absolute inset-0 grid place-items-center pointer-events-none" aria-live="polite">
        <span class="flex items-center gap-2 text-sm bg-surface-2/90 px-3 py-1.5 rounded-pill"><ui-icon name="loader-circle" class="animate-spin" [size]="14" /> Preparando la pintura…</span>
      </div>
    }

    @if (state() === 'ready') {
      <div class="absolute right-3 top-3 flex flex-col gap-1 p-1 rounded-pill bg-surface-2/80 backdrop-blur" role="toolbar" aria-label="Controles del visor">
        <button type="button" class="btn btn-icon" [attr.aria-pressed]="bright()" (click)="toggleLight()" aria-label="Cambiar iluminación"><ui-icon name="sun" /></button>
        <button type="button" class="btn btn-icon" [attr.aria-pressed]="wire()" (click)="toggleWire()" aria-label="Ver malla"><ui-icon name="grid-3x3" /></button>
        <button type="button" class="btn btn-icon" [attr.aria-pressed]="grid()" (click)="toggleGrid()" aria-label="Mostrar suelo"><ui-icon name="square-dashed" /></button>
        <button type="button" class="btn btn-icon" (click)="snapshot()" aria-label="Guardar captura PNG"><ui-icon name="camera" /></button>
      </div>
      <p [id]="helpId" class="sr-only">Gíralo con las flechas, acerca con + y aleja con −, 0 vuelve a la vista inicial. También con los botones del visor.@if (painting()) { Al pintar, arrastra con el botón izquierdo para pintar y con el derecho para girar.}</p>
      <!-- Manejar el modelo sin arrastrar: girar, acercar y volver a la vista inicial -->
      <div role="group" aria-label="Mover el modelo" class="absolute right-3 bottom-3 flex gap-1 p-1 rounded-pill bg-surface-2/80 backdrop-blur">
        <button type="button" class="btn btn-icon" (click)="nudge('left')" aria-label="Girar a la izquierda"><ui-icon name="rotate-ccw" /></button>
        <button type="button" class="btn btn-icon" (click)="nudge('right')" aria-label="Girar a la derecha"><ui-icon name="rotate-cw" /></button>
        <button type="button" class="btn btn-icon" (click)="nudge('in')" aria-label="Acercar"><ui-icon name="zoom-in" /></button>
        <button type="button" class="btn btn-icon" (click)="nudge('out')" aria-label="Alejar"><ui-icon name="zoom-out" /></button>
        <button type="button" class="btn btn-icon" (click)="reset()" aria-label="Vista inicial"><ui-icon name="scan" /></button>
      </div>
      @if (statsLine()) { <p class="absolute left-3 bottom-3 text-xs text-text-muted">{{ statsLine() }}</p> }
    }
    <ng-content />
  `,
})
export class Viewer implements AfterViewInit, OnDestroy {
  readonly url = input<string | null>(null);
  readonly name = input('');
  readonly statsLine = input('');
  /** Pintura por zonas (pestaña Color). false = textura original del modelo. */
  readonly paint = input(false);
  readonly tool = input<PaintTool>('brush');
  /** Color activo (hex) con el que se pinta. */
  readonly paintColor = input('#2f5ea8');
  /** Color de fondo con el que arranca la capa de pintura. */
  readonly baseColor = input('#8a8d8f');
  /** Tamaño del pincel, como fracción del radio del modelo. */
  readonly brushSize = input(0.12);
  /** Varita: ángulo máximo entre caras vecinas para seguir extendiéndose, en grados. */
  readonly wandSpread = input(35);

  protected readonly state = signal<LoadState>('idle');
  protected readonly helpId = `viewer-help-${++viewerSeq}`;
  protected readonly wire = signal(false);
  protected readonly grid = signal(false);
  protected readonly bright = signal(false);
  /** Hay capa de pintura activa (pestaña Color abierta con un modelo). */
  readonly painting = signal(false);
  readonly busy = signal(false);
  readonly canUndo = signal(false);

  private readonly zone = inject(NgZone);
  private readonly mount = viewChild.required<ElementRef<HTMLDivElement>>('mount');
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private controls?: OrbitControls;
  private model?: THREE.Object3D;
  private readonly gridHelper = new THREE.GridHelper(4, 16, 0x555555, 0x333333);
  private readonly key = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 1.4);
  private resize?: ResizeObserver;
  private visibility?: IntersectionObserver;
  private env?: THREE.Texture;
  private readonly originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private paintMat?: THREE.MeshStandardMaterial;
  /** Mallas pintables del modelo y sus caras vecinas (3 por cara, −1 si no hay), construidas al vuelo. */
  private meshes: THREE.Mesh[] = [];
  private readonly adjacency = new WeakMap<THREE.Mesh, Int32Array>();
  private worldRadius = 1;
  private readonly raycaster = new THREE.Raycaster();
  /** Trazo en curso: valores de color previos de cada vértice tocado (para deshacer). */
  private strokePrev: Map<string, Change> | null = null;
  private readonly undoStack: { mesh: THREE.Mesh; changes: Change[] }[] = [];
  /** La escena cambió sin mover la cámara: hay que redibujar. */
  private dirty = true;
  private raf = 0;
  private loadSeq = 0;

  constructor() {
    effect(() => {
      const url = this.url();
      if (this.renderer) void this.load(url);
    });
    // abrir o cerrar la pintura por zonas
    effect(() => {
      this.paint();
      if (this.renderer && this.state() === 'ready') this.applyPaint();
    });
    // el pincel pinta con el botón izquierdo; girar pasa al derecho mientras se pinta
    effect(() => {
      this.painting();
      this.tool();
      this.syncControls();
    });
  }

  ngAfterViewInit(): void {
    const el = this.mount().nativeElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      this.state.set('no-webgl');
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(this.renderer.domElement);
    // Entorno de estudio: los materiales PBR que devuelve el motor 3D son metálicos y, sin algo que reflejar,
    // se ven casi negros. Un RoomEnvironment neutro les da reflejo y deja ver su color.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.env;
    pmrem.dispose();
    this.key.position.set(3, 4, 2);
    this.scene.add(this.hemi, this.key);
    this.gridHelper.visible = false;
    this.scene.add(this.gridHelper);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(el);
    this.fit();
    this.zone.runOutsideAngular(() => {
      const dom = this.renderer!.domElement;
      dom.addEventListener('pointerdown', this.onPointerDown);
      dom.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      // Dibuja solo cuando algo cambia (la cámara se mueve o la escena se marca como sucia) y solo mientras se ve.
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        const moved = this.controls?.update() ?? false;
        if (!moved && !this.dirty) return;
        this.dirty = false;
        this.renderer?.render(this.scene, this.camera);
      };
      this.visibility = new IntersectionObserver(([entry]) => {
        cancelAnimationFrame(this.raf);
        if (entry?.isIntersecting) {
          this.dirty = true;
          loop();
        }
      });
      this.visibility.observe(el);
    });
    void this.load(this.url());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.visibility?.disconnect();
    this.resize?.disconnect();
    const dom = this.renderer?.domElement;
    dom?.removeEventListener('pointerdown', this.onPointerDown);
    dom?.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.controls?.dispose();
    this.clear();
    this.paintMat?.dispose();
    this.env?.dispose();
    this.renderer?.dispose();
  }

  private fit(): void {
    const el = this.mount().nativeElement;
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    this.renderer?.setSize(w, h, false);
    if (this.renderer) Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private clear(): void {
    this.painting.set(false);
    this.canUndo.set(false);
    this.undoStack.length = 0;
    this.meshes = [];
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.disposeBoundsTree?.();
      m.geometry.dispose();
      // el material de pintura es compartido: no se desecha aquí, se reutiliza entre modelos
      const mats = new Set<THREE.Material>();
      for (const x of [m.material, this.originals.get(m)].flat()) if (x) mats.add(x as THREE.Material);
      mats.forEach((x) => x !== this.paintMat && x.dispose());
      this.originals.delete(m);
    });
    this.model = undefined;
  }

  private async load(url: string | null): Promise<void> {
    const seq = ++this.loadSeq;
    this.clear();
    if (!url) {
      this.state.set('idle');
      return;
    }
    this.state.set('loading');
    try {
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
      if (seq !== this.loadSeq) return;
      this.model = gltf.scene;
      this.scene.add(this.model);
      neutralizeMetalness(this.model);
      this.meshes = [];
      this.model.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.meshes.push(o as THREE.Mesh); });
      const sphere = new THREE.Box3().setFromObject(this.model).getBoundingSphere(new THREE.Sphere());
      this.worldRadius = sphere.radius || 1;
      this.gridHelper.position.y = new THREE.Box3().setFromObject(this.model).min.y;
      this.applyPaint();
      this.applyWire();
      this.reset();
      this.state.set('ready');
    } catch {
      if (seq === this.loadSeq) this.state.set('error');
    }
  }

  protected reset(): void {
    if (!this.model) return;
    frame(this.camera, this.model);
    const c = new THREE.Box3().setFromObject(this.model).getCenter(new THREE.Vector3());
    this.controls?.target.copy(c);
    this.dirty = true;
  }

  protected toggleWire(): void {
    this.wire.update((v) => !v);
    this.applyWire();
  }

  private applyWire(): void {
    this.model?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => ((x as THREE.MeshStandardMaterial).wireframe = this.wire()));
    });
    this.dirty = true;
  }

  // ------------------------------------------------------------------ pintura por zonas

  /** Entra o sale de la pintura: material de color por vértice (mate, como se imprime) o textura original. */
  private applyPaint(): void {
    const on = this.paint() && !!this.model;
    if (on) {
      this.busy.set(true);
      // el BVH y la capa de color pueden tardar en una malla densa: se hace tras pintar el spinner
      setTimeout(() => {
        this.paintMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.65 });
        const base = new THREE.Color(this.baseColor());
        for (const m of this.meshes) {
          if (!this.originals.has(m)) this.originals.set(m, m.material);
          const g = m.geometry;
          if (!g.getAttribute('color')) {
            const n = g.getAttribute('position').count;
            const arr = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) { arr[i * 3] = base.r; arr[i * 3 + 1] = base.g; arr[i * 3 + 2] = base.b; }
            g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
          }
          if (!g.boundsTree) g.computeBoundsTree();
          m.material = this.paintMat;
        }
        this.applyWire();
        this.painting.set(true);
        this.busy.set(false);
        this.dirty = true;
      }, 30);
    } else {
      for (const m of this.meshes) { const o = this.originals.get(m); if (o) m.material = o; }
      this.applyWire();
      this.painting.set(false);
      this.dirty = true;
    }
  }

  /** Mientras se pinta, el botón izquierdo pinta y el derecho gira; fuera de pintura, el izquierdo gira. */
  private syncControls(): void {
    if (!this.controls) return;
    const paintDrag = this.painting();
    this.controls.mouseButtons.LEFT = paintDrag ? (-1 as unknown as THREE.MOUSE) : THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = paintDrag ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.painting() || e.button !== 0) return;
    this.strokePrev = new Map();
    this.paintAt(e);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    // el pincel pinta de forma continua al arrastrar; la varita solo al soltar el clic inicial
    if (!this.strokePrev || this.tool() !== 'brush') return;
    this.paintAt(e);
  };

  private readonly onPointerUp = (): void => {
    if (!this.strokePrev) return;
    const changes = [...this.strokePrev.values()];
    this.strokePrev = null;
    if (!changes.length) return;
    // agrupa por malla para deshacer
    const byMesh = new Map<THREE.Mesh, Change[]>();
    for (const c of changes) { const m = (c as Change & { mesh: THREE.Mesh }).mesh; (byMesh.get(m) ?? byMesh.set(m, []).get(m)!).push(c); }
    for (const [mesh, ch] of byMesh) this.undoStack.push({ mesh, changes: ch });
    if (this.undoStack.length > 40) this.undoStack.splice(0, this.undoStack.length - 40);
    this.zone.run(() => this.canUndo.set(true));
  };

  /** Pica la malla bajo el puntero y pinta las caras alrededor (pincel) o la zona conectada (varita). */
  private paintAt(e: PointerEvent): void {
    if (!this.model || !this.meshes.length) return;
    const dom = this.renderer!.domElement;
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit || hit.faceIndex == null) return;
    const mesh = hit.object as THREE.Mesh;
    const faces = this.tool() === 'wand'
      ? this.wandFaces(mesh, hit.faceIndex)
      : this.brushFaces(mesh, hit.faceIndex, hit.point);
    this.paintFaces(mesh, faces);
  }

  /** Caras dentro del radio del pincel, creciendo por vecindad desde la cara picada. */
  private brushFaces(mesh: THREE.Mesh, start: number, pointWorld: THREE.Vector3): Set<number> {
    const adj = this.adjacencyFor(mesh);
    const g = mesh.geometry;
    const index = g.index!;
    const pos = g.getAttribute('position');
    const radius = this.brushSize() * this.worldRadius;
    const r2 = radius * radius;
    const local = mesh.worldToLocal(pointWorld.clone());
    const centroid = new THREE.Vector3();
    const near = (f: number) => {
      centroid.set(0, 0, 0);
      for (let k = 0; k < 3; k++) centroid.x += pos.getX(index.getX(f * 3 + k));
      for (let k = 0; k < 3; k++) centroid.y += pos.getY(index.getX(f * 3 + k));
      for (let k = 0; k < 3; k++) centroid.z += pos.getZ(index.getX(f * 3 + k));
      return centroid.multiplyScalar(1 / 3).distanceToSquared(local) <= r2;
    };
    const out = new Set<number>();
    const stack = [start];
    const seen = new Set<number>([start]);
    while (stack.length) {
      const f = stack.pop()!;
      if (!near(f)) continue;
      out.add(f);
      for (let k = 0; k < 3; k++) { const nb = adj[f * 3 + k]; if (nb >= 0 && !seen.has(nb)) { seen.add(nb); stack.push(nb); } }
    }
    return out;
  }

  /** Zona conectada de orientación parecida (hasta una arista marcada): relleno tipo varita mágica. */
  private wandFaces(mesh: THREE.Mesh, start: number): Set<number> {
    const adj = this.adjacencyFor(mesh);
    const cosMax = Math.cos((this.wandSpread() * Math.PI) / 180);
    const g = mesh.geometry;
    const index = g.index!;
    const pos = g.getAttribute('position');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), nb = new THREE.Vector3();
    const normal = (f: number, out: THREE.Vector3) => {
      a.fromBufferAttribute(pos, index.getX(f * 3)); b.fromBufferAttribute(pos, index.getX(f * 3 + 1)); c.fromBufferAttribute(pos, index.getX(f * 3 + 2));
      return out.copy(c).sub(b).cross(a.clone().sub(b)).normalize();
    };
    const out = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      const f = stack.pop()!;
      normal(f, n);
      for (let k = 0; k < 3; k++) {
        const m = adj[f * 3 + k];
        if (m < 0 || out.has(m)) continue;
        if (normal(m, nb).dot(n) >= cosMax) { out.add(m); stack.push(m); }
      }
    }
    return out;
  }

  /** Aplica el color activo a las caras dadas, guardando los valores previos para deshacer. */
  private paintFaces(mesh: THREE.Mesh, faces: Set<number>): void {
    if (!faces.size) return;
    const g = mesh.geometry;
    const index = g.index!;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color(this.paintColor());
    const key = (mesh.id << 24) ^ 0;
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const vi = index.getX(f * 3 + k);
        if (this.strokePrev) {
          const id = `${key}:${vi}`;
          if (!this.strokePrev.has(id)) {
            this.strokePrev.set(id, Object.assign(
              { i: vi, prev: [col.getX(vi), col.getY(vi), col.getZ(vi)] as [number, number, number] }, { mesh }));
          }
        }
        col.setXYZ(vi, c.r, c.g, c.b);
      }
    }
    col.needsUpdate = true;
    this.dirty = true;
  }

  /** Vecindad de caras (3 por cara, −1 si no hay): se construye una vez por malla. */
  private adjacencyFor(mesh: THREE.Mesh): Int32Array {
    const cached = this.adjacency.get(mesh);
    if (cached) return cached;
    const g = mesh.geometry;
    const index = g.index!;
    const faceCount = index.count / 3;
    const vCount = g.getAttribute('position').count;
    const nbr = new Int32Array(faceCount * 3).fill(-1);
    const count = new Uint8Array(faceCount);
    const edge = new Map<number, number>();
    const link = (fa: number, fb: number) => {
      if (count[fa] < 3) nbr[fa * 3 + count[fa]++] = fb;
      if (count[fb] < 3) nbr[fb * 3 + count[fb]++] = fa;
    };
    for (let f = 0; f < faceCount; f++) {
      const v = [index.getX(f * 3), index.getX(f * 3 + 1), index.getX(f * 3 + 2)];
      for (let k = 0; k < 3; k++) {
        const x = v[k], y = v[(k + 1) % 3];
        const kkey = Math.min(x, y) * vCount + Math.max(x, y);
        const prev = edge.get(kkey);
        if (prev === undefined) edge.set(kkey, f);
        else link(prev, f);
      }
    }
    this.adjacency.set(mesh, nbr);
    return nbr;
  }

  /** Pinta todo el modelo del color activo (acción «Rellenar»). */
  fillAll(): void {
    if (!this.painting()) return;
    const c = new THREE.Color(this.paintColor());
    const changes: { mesh: THREE.Mesh; changes: Change[] }[] = [];
    for (const m of this.meshes) {
      const col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
      const ch: Change[] = [];
      for (let i = 0; i < col.count; i++) {
        ch.push({ i, prev: [col.getX(i), col.getY(i), col.getZ(i)] });
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
      changes.push({ mesh: m, changes: ch });
    }
    this.undoStack.push(...changes);
    this.canUndo.set(true);
    this.dirty = true;
  }

  /** Deshace el último trazo o relleno. */
  undo(): void {
    const last = this.undoStack.pop();
    if (!last) return;
    const col = last.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (const c of last.changes) col.setXYZ(c.i, c.prev[0], c.prev[1], c.prev[2]);
    col.needsUpdate = true;
    this.canUndo.set(this.undoStack.length > 0);
    this.dirty = true;
  }

  protected toggleGrid(): void {
    this.grid.update((v) => !v);
    this.gridHelper.visible = this.grid();
    this.dirty = true;
  }

  protected toggleLight(): void {
    this.bright.update((v) => !v);
    this.hemi.intensity = this.bright() ? 2.6 : 1.4;
    this.key.intensity = this.bright() ? 3.2 : 2.2;
    this.dirty = true;
  }

  protected snapshot(): void {
    if (!this.renderer) return;
    // sin dibujo continuo el lienzo puede estar vacío: se dibuja justo antes de leerlo
    this.renderer.render(this.scene, this.camera);
    const a = document.createElement('a');
    a.href = this.renderer.domElement.toDataURL('image/png');
    a.download = `${this.name() || 'modelo'}.png`;
    a.click();
  }

  protected keys(e: KeyboardEvent): void {
    const map: Record<string, Nudge> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'in', '=': 'in', '-': 'out' };
    if (e.key === '0') return void (this.reset(), e.preventDefault());
    const n = map[e.key];
    if (!n) return;
    e.preventDefault();
    this.nudge(n);
  }

  /** Un paso de cámara: lo usan el teclado y los botones del visor. */
  protected nudge(n: Nudge): void {
    if (!this.controls || !this.model) return;
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const step = Math.PI / 18;
    if (n === 'left' || n === 'right') offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), n === 'left' ? -step : step);
    else if (n === 'up' || n === 'down') {
      const axis = new THREE.Vector3().crossVectors(offset, this.camera.up).normalize();
      offset.applyAxisAngle(axis, n === 'up' ? step : -step);
    } else offset.multiplyScalar(n === 'in' ? 0.9 : 1.1);
    this.camera.position.copy(target).add(offset);
    this.dirty = true;
  }
}
