import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api, LedgerEntry } from '../data/api';
import { Gates } from '../shell/gates';
import { Icon } from '../ui/icon';
import { Modal } from '../ui/modal';
import { Toasts } from '../ui/toast';

const REASON: Record<LedgerEntry['reason'], string> = {
  grant: 'Créditos del plan', purchase: 'Compra', freeze: 'Reservado', consume: 'Gastado', release: 'Devuelto',
  expire: 'Caducado', adjust: 'Ajuste',
};

/** S12: plan, créditos (disponibles y reservados), historial, cerrar sesión y borrar cuenta. */
@Component({
  selector: 'app-account',
  imports: [RouterLink, DatePipe, DecimalPipe, Icon, Modal, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <h1 class="text-xl">Tu cuenta</h1>
      @if (gates.me(); as me) {
        <section class="card p-6 grid sm:grid-cols-3 gap-6" aria-label="Plan y créditos">
          <div><p class="hint">Plan</p><p class="text-lg">{{ me.plan.name }}</p>
            @if (me.plan.priceMonthCents > 0 && billing() === 'stripe') {
              <button type="button" class="text-sm underline text-text-muted" (click)="portal()">Gestionar o cancelar suscripción</button>
            } @else {
              <a routerLink="/precios" class="text-sm underline text-text-muted">Cambiar plan</a>
            }</div>
          <div><p class="hint">Créditos disponibles</p><p class="text-lg flex items-center gap-1"><ui-icon name="zap" />{{ me.credits.available | number: '1.0-0' : 'es' }}</p>
            <p class="hint">{{ me.credits.monthly | number: '1.0-0' : 'es' }} del mes · {{ me.credits.permanent | number: '1.0-0' : 'es' }} sin caducidad</p></div>
          <div><p class="hint">Reservados en tareas</p><p class="text-lg">{{ me.credits.frozen | number: '1.0-0' : 'es' }}</p>
            <p class="hint">Se renuevan el {{ me.credits.cycleEndsAt | date: 'd MMM' : undefined : 'es' }}</p></div>
        </section>

        <section class="card p-6 flex flex-col gap-3" aria-labelledby="ledger-title">
          <h2 id="ledger-title" class="text-lg">Movimientos de créditos</h2>
          @if (!ledger()) { <div class="skeleton h-24"></div> }
          @else if (!ledger()!.length) { <p class="text-sm text-text-muted">Todavía no hay movimientos.</p> }
          @else {
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="text-left text-text-muted"><tr>
                  <th scope="col" class="py-2 font-normal">Fecha</th><th scope="col" class="py-2 font-normal">Concepto</th>
                  <th scope="col" class="py-2 font-normal">Tipo</th><th scope="col" class="py-2 font-normal text-right">Créditos</th></tr></thead>
                <tbody>
                  @for (e of ledger()!.slice(0, 30); track e.id) {
                    <tr class="border-t border-border">
                      <td class="py-2 whitespace-nowrap">{{ e.createdAt | date: 'd MMM HH:mm' : undefined : 'es' }}</td>
                      <td class="py-2">{{ e.note }}</td>
                      <td class="py-2 text-text-muted">{{ reason[e.reason] }}</td>
                      @if (e.reason === 'consume') {
                        <!-- consumir no cambia el saldo: confirma lo que ya se había reservado -->
                        <td class="py-2 text-right tabular-nums text-text-muted">{{ -e.delta | number: '1.0-0' : 'es' }} confirmados</td>
                      } @else {
                        <td class="py-2 text-right tabular-nums" [class.text-success]="e.delta > 0">{{ e.delta > 0 ? '+' : '' }}{{ e.delta | number: '1.0-0' : 'es' }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="card p-6 flex flex-wrap items-center gap-3" aria-label="Sesión">
          <p class="text-sm flex-1">Has entrado como <strong>{{ me.profile.email }}</strong></p>
          <button type="button" class="btn btn-secondary" (click)="signOut()">Cerrar sesión</button>
          <button type="button" class="btn btn-danger" (click)="confirmDelete.set(true)">Borrar cuenta</button>
        </section>
      } @else {
        <div class="card p-10 flex flex-col items-center gap-3 text-center">
          <p class="text-lg">No has entrado</p>
          <button type="button" class="btn btn-primary" (click)="gates.ensureSignedIn()">Entrar</button>
        </div>
      }
    </div>

    <ui-modal [open]="confirmDelete()" heading="¿Borrar tu cuenta?" (closed)="confirmDelete.set(false)">
      <p class="text-sm text-text-muted">Se borrarán tu cuenta, tus modelos y tus créditos. No se puede deshacer.</p>
      <label class="label">Escribe BORRAR para confirmar
        <input class="field h-10 px-3" [ngModel]="typed()" (ngModelChange)="typed.set($event)" autocomplete="off" /></label>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-secondary" (click)="confirmDelete.set(false)">Cancelar</button>
        <button type="button" class="btn btn-danger" [disabled]="typed() !== 'BORRAR'" (click)="deleteAccount()">Borrar cuenta</button>
      </div>
    </ui-modal>
  `,
})
export class Account {
  private readonly api = inject(Api);
  protected readonly gates = inject(Gates);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly reason = REASON;
  protected readonly ledger = signal<LedgerEntry[] | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly typed = signal('');
  protected readonly billing = signal<'simulated' | 'stripe' | 'off'>('off');

  constructor() {
    void this.api.capabilities().then((c) => this.billing.set(c.billing));
    if (new URLSearchParams(location.search).get('pago') === 'ok') {
      this.toasts.show('success', 'Pago recibido. Tu plan se activa en unos segundos');
    }
    effect(() => {
      const me = this.gates.me();
      if (me) void this.api.ledger().then((l) => this.ledger.set(l));
    });
  }

  protected async portal(): Promise<void> {
    try {
      await this.api.billingPortal();
    } catch {
      this.toasts.show('error', 'No se ha podido abrir la gestión de la suscripción');
    }
  }

  protected async signOut(): Promise<void> {
    await this.api.signOut();
    void this.router.navigateByUrl('/');
  }

  protected async deleteAccount(): Promise<void> {
    await this.api.deleteAccount();
    this.confirmDelete.set(false);
    this.toasts.show('info', 'Tu cuenta y tus datos se han borrado');
    void this.router.navigateByUrl('/');
  }
}
