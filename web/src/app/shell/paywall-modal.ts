import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { Modal } from '../ui/modal';
import { Gates } from './gates';

/** S13: créditos insuficientes o función de pago. Siempre dice el número exacto. */
@Component({
  selector: 'app-paywall-modal',
  imports: [Modal, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = gates.paywall();
    <ui-modal [open]="!!p" [heading]="p?.title ?? ''" (closed)="gates.paywall.set(null)">
      <p class="text-sm">{{ p?.detail }}</p>
      @if (gates.me(); as me) {
        <p class="text-sm text-text-muted">Tienes {{ me.credits.available | number: '1.0-0' : 'es' }} créditos · plan {{ me.plan.name }}.</p>
      }
      <div class="flex flex-wrap gap-2 justify-end">
        <button type="button" class="btn btn-secondary" (click)="gates.paywall.set(null)">Ahora no</button>
        <button type="button" class="btn btn-primary" (click)="plans()">Ver planes</button>
      </div>
    </ui-modal>
  `,
})
export class PaywallModal {
  protected readonly gates = inject(Gates);
  private readonly router = inject(Router);

  protected plans(): void {
    this.gates.paywall.set(null);
    void this.router.navigateByUrl('/precios');
  }
}
