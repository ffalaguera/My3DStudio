import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadRuntimeConfig } from './app/data/runtime-config';

// Popover nativo (menús de la barra): el polyfill solo se descarga donde falta (modern-web-guidance: navbar).
if (!Object.hasOwn(HTMLElement.prototype, 'popover')) {
  void import('@oddbird/popover-polyfill');
}

loadRuntimeConfig()
  .then((cfg) => bootstrapApplication(App, appConfig(cfg)))
  .catch((err) => console.error(err));
