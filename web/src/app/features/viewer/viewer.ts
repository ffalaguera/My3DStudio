import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, effect, inject, input, signal, viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Icon } from '../../ui/icon';
import { frame } from '../../data/fake-model';

type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'no-webgl';

/** Viewer3D de components.md: carga un GLB por URL (igual con la API falsa y la real). */
@Component({
  selector: 'app-viewer',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative viewport-bg overflow-hidden' },
  template: `
    <!-- BUG-003: solo se puede enfocar cuando hay un modelo; antes era enfocable estando oculto -->
    <div #mount class="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      [attr.tabindex]="state() === 'ready' ? 0 : null" [attr.role]="state() === 'ready' ? 'img' : null"
      [attr.aria-label]="state() === 'ready' ? 'Modelo 3D: ' + name() + '. Flechas para girar, + y - para acercar, 0 para reiniciar' : null"
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

    @if (state() === 'ready') {
      <div class="absolute right-3 top-3 flex flex-col gap-1 p-1 rounded-pill bg-surface-2/80 backdrop-blur" role="toolbar" aria-label="Controles del visor">
        <button type="button" class="btn btn-icon" [attr.aria-pressed]="bright()" (click)="toggleLight()" aria-label="Cambiar iluminación"><ui-icon name="sun" /></button>
        <button type="button" class="btn btn-icon" [attr.aria-pressed]="wire()" (click)="toggleWire()" aria-label="Ver malla"><ui-icon name="grid-3x3" /></button>
        <button type="button" class="btn btn-icon" [attr.aria-pressed]="grid()" (click)="toggleGrid()" aria-label="Mostrar suelo"><ui-icon name="square-dashed" /></button>
        <button type="button" class="btn btn-icon" (click)="snapshot()" aria-label="Guardar captura PNG"><ui-icon name="camera" /></button>
        <button type="button" class="btn btn-icon" (click)="reset()" aria-label="Reiniciar vista"><ui-icon name="rotate-ccw" /></button>
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

  protected readonly state = signal<LoadState>('idle');
  protected readonly wire = signal(false);
  protected readonly grid = signal(false);
  protected readonly bright = signal(false);

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
  private raf = 0;
  private loadSeq = 0;

  constructor() {
    effect(() => {
      const url = this.url();
      if (this.renderer) void this.load(url);
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
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        this.controls?.update();
        this.renderer?.render(this.scene, this.camera);
      };
      loop();
    });
    void this.load(this.url());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.resize?.disconnect();
    this.controls?.dispose();
    this.clear();
    this.renderer?.dispose();
  }

  private fit(): void {
    const el = this.mount().nativeElement;
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    this.renderer?.setSize(w, h, false);
    if (this.renderer) Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private clear(): void {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      }
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
      const gltf = await new GLTFLoader().loadAsync(url);
      if (seq !== this.loadSeq) return;
      this.model = gltf.scene;
      this.scene.add(this.model);
      const box = new THREE.Box3().setFromObject(this.model);
      this.gridHelper.position.y = box.min.y;
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
  }

  protected toggleGrid(): void {
    this.grid.update((v) => !v);
    this.gridHelper.visible = this.grid();
  }

  protected toggleLight(): void {
    this.bright.update((v) => !v);
    this.hemi.intensity = this.bright() ? 2.6 : 1.4;
    this.key.intensity = this.bright() ? 3.2 : 2.2;
  }

  protected snapshot(): void {
    if (!this.renderer) return;
    const a = document.createElement('a');
    a.href = this.renderer.domElement.toDataURL('image/png');
    a.download = `${this.name() || 'modelo'}.png`;
    a.click();
  }

  protected keys(e: KeyboardEvent): void {
    if (!this.controls || !this.model) return;
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const step = Math.PI / 18;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), e.key === 'ArrowLeft' ? -step : step);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const axis = new THREE.Vector3().crossVectors(offset, this.camera.up).normalize();
      offset.applyAxisAngle(axis, e.key === 'ArrowUp' ? step : -step);
    } else if (e.key === '+' || e.key === '=') offset.multiplyScalar(0.9);
    else if (e.key === '-') offset.multiplyScalar(1.1);
    else if (e.key === '0') return void (this.reset(), e.preventDefault());
    else return;
    e.preventDefault();
    this.camera.position.copy(target).add(offset);
  }
}
