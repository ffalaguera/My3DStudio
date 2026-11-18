import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const PRODUCT_NAME = 'Forma'; // nombre provisional hasta /replica-brand

@Injectable()
export class AppTitle extends TitleStrategy {
  private readonly title = inject(Title);
  override updateTitle(state: RouterStateSnapshot): void {
    const t = this.buildTitle(state);
    this.title.setTitle(t ? `${t} · ${PRODUCT_NAME}` : PRODUCT_NAME);
  }
}
