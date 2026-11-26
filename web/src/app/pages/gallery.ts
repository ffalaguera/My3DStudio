import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../ui/icon';
import { PaintingViewer } from '../features/showcase/painting-viewer';
import { SHOWCASE } from '../data/showcase';

/**
 * S09 galería: los modelos reales que ya hemos generado con My3DStudio, cada uno en su visor 3D.
 * Cada visor deja de dibujar cuando sale de la pantalla: tenerlos todos en la página no gasta de más.
 */
@Component({
  selector: 'app-gallery',
  imports: [RouterLink, Icon, PaintingViewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-[80rem] mx-auto px-4 sm:px-8 py-10 sm:py-16 flex flex-col gap-10">
      <header class="flex flex-col gap-3 max-w-[60ch]">
        <h1 class="text-[2.75rem] sm:text-[3.75rem] leading-[1.05]">Galería</h1>
        <p class="text-text-muted">Modelos reales que hemos creado con My3DStudio a partir de una frase. Gíralos para verlos por todos lados.</p>
      </header>

      <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        @for (m of models; track m.slug) {
          <li class="flex flex-col gap-3">
            <app-painting-viewer class="h-72 sm:h-80 rounded-xl bg-surface-2"
              [url]="'/showcase/' + m.slug + '.glb'" [name]="m.name" [source]="m.prompt" step="textura" />
            <h2 class="text-[1.125rem] font-semibold">{{ m.name }}</h2>
            <p class="text-sm text-text-muted">«{{ m.prompt }}»</p>
          </li>
        }
      </ul>

      <a routerLink="/crear" class="btn btn-primary btn-lg self-start">Crear mi figura <ui-icon name="arrow-right" /></a>
    </div>
  `,
})
export class Gallery {
  protected readonly models = SHOWCASE;
}
