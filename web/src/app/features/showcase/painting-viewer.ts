import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let viewerSeq = 0;

/** Los botes de la guía: cada uno repinta el mismo modelo. */
export type PaintStep = 'malla' | 'textura' | 'archivo';

interface Facts { faces: number; w: number; h: number; d: number }

/**
 * Visor de la portada: un modelo real sobre una peana redonda que gira con inercia.
 * Cada paso de la guía lo repinta: imprimación gris, textura y archivo con medidas.
 */
@Component({
  selector: 'app-painting-viewer',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block select-none' },
  template: `
    <!-- Un visor que se maneja no es una imagen: grupo con nombre, descripción del modelo y controles visibles -->
    <div #mount class="absolute inset-0 cursor-grab active:cursor-grabbing" tabindex="0" role="group"
      aria-roledescription="visor 3D" [attr.aria-label]="'Modelo de ejemplo: ' + name()" [attr.aria-describedby]="descId"
      (keydown)="keys($event)"></div>
    <p [id]="descId" class="sr-only">{{ description() }}</p>

    @if (state() === 'loading') {
      <div class="absolute inset-0 grid place-items-center pointer-events-none">
        <span class="w-40 h-40 rounded-full bg-primer-deep/60 animate-pulse"></span>
      </div>
    }
    @if (state() === 'no-webgl') {
      <p class="absolute inset-0 grid place-items-center text-sm text-ink p-8 text-center">Tu navegador no muestra 3D, pero el modelo se descarga igual.</p>
    }
    @if (state() === 'error') {
      <div class="absolute inset-0 grid place-content-center justify-items-center gap-3 text-sm text-ink p-8 text-center">
        <p>No se ha podido cargar el modelo.</p>
        <button type="button" class="btn bg-ink text-bone hover:bg-ink-soft" (click)="retry()">Reintentar</button>
      </div>
    }

    <!-- Paso «Archivo»: etiquetas con línea guía, cifras tabulares -->
    <svg #leaders class="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-slow"
      [style.opacity]="step() === 'archivo' && facts() ? 1 : 0" aria-hidden="true">
      @for (i of [0, 1, 2]; track i) {
        <polyline fill="none" stroke="currentColor" stroke-width="1.25" class="text-ink" />
        <circle r="3.5" class="fill-ink" />
      }
    </svg>
    @if (facts(); as f) {
      <dl class="absolute right-0 top-0 bottom-0 w-32 sm:w-44 flex flex-col justify-center gap-6 pr-2 figures text-ink transition-opacity duration-slow"
        [style.opacity]="step() === 'archivo' ? 1 : 0" [attr.aria-hidden]="step() !== 'archivo'">
        <div #label class="border-t-2 keyline pt-1 px-2 pb-1 bg-bone/90"><dt class="text-xs">Alto, a escala de figura</dt><dd class="font-display text-[1.125rem] sm:text-[1.5rem] font-medium">{{ heightMm() }} mm</dd></div>
        <div #label class="border-t-2 keyline pt-1 px-2 pb-1 bg-bone/90"><dt class="text-xs">Ancho × fondo</dt><dd class="font-display text-[1.125rem] sm:text-[1.5rem] font-medium">{{ f.w | number: '1.0-0' : 'es' }} × {{ f.d | number: '1.0-0' : 'es' }} mm</dd></div>
        <div #label class="border-t-2 keyline pt-1 px-2 pb-1 bg-bone/90"><dt class="text-xs">Polígonos</dt><dd class="font-display text-[1.125rem] sm:text-[1.5rem] font-medium">{{ f.faces | number: '1.0-0' : 'es' }}</dd></div>
      </dl>
    }
  `,
})
export class PaintingViewer implements AfterViewInit, OnDestroy {
  readonly url = input.required<string>();
  readonly name = input('');
  readonly step = input<PaintStep>('textura');
  /** Frase o descripción de origen, para la descripción accesible del visor. */
  readonly source = input('');
  /** Altura a la que se imprimiría la figura: convierte la caja del modelo a milímetros. */
  readonly heightMm = input(60);

  protected readonly state = signal<'loading' | 'ready' | 'error' | 'no-webgl'>('loading');
  protected readonly facts = signal<Facts | null>(null);
  protected readonly descId = `painting-viewer-desc-${++viewerSeq}`;
  /** Giro automático: contenido en movimiento más de 5 s, así que se puede pausar (WCAG 2.2.2). */
  protected readonly spinning = signal(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  /** Texto alternativo del modelo para quien no puede verlo ni manejarlo. */
  protected readonly description = computed(() => {
    const f = this.facts();
    const from = this.source() ? `Generado a partir de la frase «${this.source()}». ` : '';
    const size = f ? `Impreso mide ${Math.round(f.h)} mm de alto, ${Math.round(f.w)} × ${Math.round(f.d)} mm de base y tiene ${f.faces.toLocaleString('es')} polígonos. ` : '';
    return `${from}${size}Gíralo con las flechas izquierda y derecha; la barra espaciadora pausa o reanuda el giro automático.`;
  });

  private readonly zone = inject(NgZone);
  private readonly mount = viewChild.required<ElementRef<HTMLDivElement>>('mount');
  private readonly leaders = viewChild<ElementRef<SVGSVGElement>>('leaders');
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private controls?: OrbitControls;
  private readonly stage = new THREE.Group();
  private model?: THREE.Object3D;
  private base?: THREE.Mesh;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly primer = new THREE.MeshStandardMaterial({ color: 0xa9abad, roughness: 0.96, metalness: 0 });
  private anchors: THREE.Vector3[] = [];
  private resize?: ResizeObserver;
  private visibility?: IntersectionObserver;
  private env?: THREE.Texture;
  /** La escena cambió sin mover la cámara (modelo, pintura, tamaño): hay que redibujar. */
  private dirty = true;
  private raf = 0;
  private idleTimer = 0;
  private seq = 0;

  constructor() {
    effect(() => {
      const url = this.url();
      if (this.renderer) void this.load(url);
    });
    effect(() => this.paint(this.step()));
  }

  ngAfterViewInit(): void {
    const el = this.mount().nativeElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      this.state.set('no-webgl');
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);
    // Entorno de estudio: los materiales PBR metálicos del motor 3D necesitan algo que reflejar; sin esto se ven casi negros.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.env;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff6e6, 2.6);
    key.position.set(2.5, 5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    this.scene.add(new THREE.HemisphereLight(0xf2efe8, 0x3a3936, 1.25), key, this.stage);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.06, enableZoom: false, enablePan: false, rotateSpeed: 0.7,
      minPolarAngle: Math.PI * 0.18, maxPolarAngle: Math.PI * 0.52, autoRotate: this.spinning(), autoRotateSpeed: 1.1,
    });
    // al soltarlo sigue girando con su inercia; a los 3 s vuelve el giro lento
    this.controls.addEventListener('start', () => {
      this.controls!.autoRotate = false;
      clearTimeout(this.idleTimer);
    });
    this.controls.addEventListener('end', () => {
      if (this.spinning()) this.idleTimer = window.setTimeout(() => (this.controls!.autoRotate = true), 3000);
    });

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(el);
    this.fit();
    // Dibuja solo cuando algo cambia (giro, arrastre, inercia o escena marcada) y solo mientras se ve en pantalla.
    this.zone.runOutsideAngular(() => {
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        const moved = this.controls?.update() ?? false;
        if (!moved && !this.dirty) return;
        this.dirty = false;
        this.renderer?.render(this.scene, this.camera);
        this.drawLeaders();
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
    clearTimeout(this.idleTimer);
    this.resize?.disconnect();
    this.controls?.dispose();
    this.clear();
    this.primer.dispose();
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
    for (const o of [...this.stage.children]) {
      this.stage.remove(o);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const own = this.originals.get(m) ?? m.material;
        (Array.isArray(own) ? own : [own]).forEach((mat) => mat !== this.primer && mat.dispose());
      });
    }
    this.originals.clear();
    this.model = undefined;
    this.base = undefined;
  }

  private async load(url: string): Promise<void> {
    const seq = ++this.seq;
    this.state.set('loading');
    try {
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
      if (seq !== this.seq) return;
      this.clear();
      const model = gltf.scene;
      // normaliza: 1 unidad de alto, apoyado en y = 0 y centrado
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = 1 / (size.y || 1);
      model.scale.setScalar(s);
      const b2 = new THREE.Box3().setFromObject(model);
      const c = b2.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -b2.min.y, -c.z);
      let faces = 0;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        this.originals.set(m, m.material);
        const idx = m.geometry.index;
        faces += (idx ? idx.count : m.geometry.attributes['position'].count) / 3;
      });
      const w = size.x * s, d = size.z * s;
      // peana de tinta, como la de una miniatura impresa
      const r = Math.max(w, d) * 0.62 + 0.06;
      this.base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.07, 64),
        new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.55 }));
      this.base.position.y = -0.035;
      this.base.receiveShadow = true;
      this.stage.add(this.base, model);
      this.model = model;
      const mm = this.heightMm();
      this.facts.set({ faces: Math.round(faces), w: w * mm, h: mm, d: d * mm });
      // anclas de las líneas guía: cima, costado y peana
      this.anchors = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(w / 2, 0.45, 0), new THREE.Vector3(0, 0.25, d / 2)];
      this.frame();
      // sale directamente en su paso, sin pasar antes por gris
      this.paint(this.step());
      this.state.set('ready');
    } catch (err) {
      if (seq !== this.seq) return;
      console.error('No se pudo cargar el modelo de la portada', err);
      this.state.set('error');
    }
  }

  protected retry(): void {
    void this.load(this.url());
  }

  private frame(): void {
    // en pantallas apaisadas y bajas (móvil) el modelo se acerca para no quedar diminuto
    const narrow = this.camera.aspect > 1.3 && this.mount().nativeElement.clientHeight < 320;
    const dist = narrow ? 3.35 : 3.5;
    this.camera.position.set(dist * 0.62, 0.95 + dist * 0.28, dist * 0.78);
    // en el visor bajo de móvil se apunta un poco más arriba para que la peana entera quede dentro
    this.controls?.target.set(0, narrow ? 0.42 : 0.4, 0);
    this.camera.near = 0.05;
    this.camera.far = 50;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Repinta el modelo según el bote elegido. */
  private paint(step: PaintStep): void {
    for (const [mesh, original] of this.originals) {
      mesh.material = step === 'malla' ? this.primer : original;
    }
    this.dirty = true;
  }

  /** Líneas guía del paso «Archivo»: del punto del modelo a su etiqueta, recalculadas en cada fotograma. */
  private drawLeaders(): void {
    const svg = this.leaders()?.nativeElement;
    if (!svg || !this.model || this.step() !== 'archivo') return;
    const labels = svg.parentElement?.querySelectorAll<HTMLElement>('dl > div');
    if (!labels?.length) return;
    const host = svg.getBoundingClientRect();
    const lines = svg.querySelectorAll('polyline');
    const dots = svg.querySelectorAll('circle');
    this.anchors.forEach((a, i) => {
      const p = a.clone().project(this.camera);
      const x = (p.x * 0.5 + 0.5) * host.width;
      const y = (-p.y * 0.5 + 0.5) * host.height;
      const lr = labels[i]?.getBoundingClientRect();
      if (!lr) return;
      const lx = lr.left - host.left - 8, ly = lr.top - host.top;
      lines[i]?.setAttribute('points', `${x},${y} ${lx - 24},${ly} ${lx},${ly}`);
      dots[i]?.setAttribute('cx', String(x));
      dots[i]?.setAttribute('cy', String(y));
    });
  }

  protected keys(e: KeyboardEvent): void {
    if (e.key === ' ') {
      e.preventDefault();
      this.setSpin(!this.spinning());
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    this.rotate(e.key === 'ArrowLeft' ? -1 : 1);
  }

  /** Gira un dieciseisavo de vuelta. Pausa el giro automático: quien gira a mano quiere mirar un punto. */
  private rotate(dir: -1 | 1): void {
    if (!this.controls) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dir * (Math.PI / 16));
    this.camera.position.copy(this.controls.target).add(offset);
    this.setSpin(false);
  }

  private setSpin(on: boolean): void {
    this.spinning.set(on);
    clearTimeout(this.idleTimer);
    if (this.controls) this.controls.autoRotate = on;
  }
}
