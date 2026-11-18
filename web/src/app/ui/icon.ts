import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ICONS } from './icons';

type IconNode = [string, Record<string, string | number>, IconNode[]?];

function render(node: IconNode): string {
  const [tag, attrs, children] = node;
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<${tag} ${a}>${(children ?? []).map(render).join('')}</${tag}>`;
}

/** Icono Lucide (ISC). Decorativo por defecto; pasa `label` si transmite información. */
@Component({
  selector: 'ui-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex shrink-0',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() || null',
    '[innerHTML]': 'svg()',
  },
  template: '',
})
export class Icon {
  private readonly sanitizer = inject(DomSanitizer);
  readonly name = input.required<string>();
  readonly size = input(16);
  readonly label = input<string>('');

  protected readonly svg = computed(() => {
    const node = ICONS[this.name()] as IconNode | undefined;
    if (!node) {
      if (typeof ngDevMode !== 'undefined' && ngDevMode) console.warn(`Icono no registrado en ui/icons.ts: ${this.name()}`);
      return '';
    }
    const [tag, attrs, children] = node;
    const sized: IconNode = [tag, { ...attrs, width: this.size(), height: this.size() }, children];
    // El SVG sale de la librería instalada, nunca de datos del usuario.
    return this.sanitizer.bypassSecurityTrustHtml(render(sized));
  });
}
