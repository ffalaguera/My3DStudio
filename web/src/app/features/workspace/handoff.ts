import { Injectable } from '@angular/core';
import type { Series } from '../../data/api';

/** Pasa la imagen elegida en el inicio (S01) al espacio de trabajo (S03) sin volver a subirla. */
@Injectable({ providedIn: 'root' })
export class Handoff {
  pending: { file: File; series: Series } | null = null;

  take(): { file: File; series: Series } | null {
    const p = this.pending;
    this.pending = null;
    return p;
  }
}
