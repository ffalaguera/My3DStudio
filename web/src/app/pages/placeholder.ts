import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Icon } from '../ui/icon';

/** Pantallas "could" aún sin construir (S07 ficha pública, S09 galería) y la página 404. */
@Component({
  selector: 'app-placeholder',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-xl mx-auto px-4 py-20 flex flex-col items-center gap-4 text-center">
      <ui-icon [name]="data['icon'] ?? 'construction'" [size]="32" class="text-text-muted" />
      <h1 class="text-xl">{{ data['title'] }}</h1>
      <p class="text-text-muted">{{ data['text'] }}</p>
      <a routerLink="/crear" class="btn btn-primary">Crear un modelo</a>
    </div>
  `,
})
export class Placeholder {
  protected readonly data = inject(ActivatedRoute).snapshot.data;
}
