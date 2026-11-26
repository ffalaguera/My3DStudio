import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { NavigationError, provideRouter, TitleStrategy, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { routes } from './app.routes';
import { Api } from './data/api';
import { FakeApi } from './data/fake-api';
import { HttpApi } from './data/http-api';
import { RUNTIME_CONFIG, type RuntimeConfig } from './data/runtime-config';
import { AppTitle } from './shell/title';

registerLocaleData(localeEs);

/**
 * Una pestaña abierta desde antes de publicar (o de recompilar en local) pide trozos de código con nombres
 * que ya no existen: el enlace no hacía nada. Si falla la descarga de una página, se carga entera en esa dirección.
 * Como mucho una vez cada 30 s por dirección, para no entrar en bucle si el servidor de verdad no responde.
 */
function reloadOnStaleChunk(e: NavigationError): void {
  const msg = String((e.error as Error | undefined)?.message ?? e.error);
  if (!/dynamically imported module|Importing a module script failed/i.test(msg)) return;
  const key = `reload:${e.url}`;
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 30_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* sin almacenamiento: se recarga igual */ }
  location.assign(e.url);
}

export function appConfig(runtime: RuntimeConfig): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
        withNavigationErrorHandler(reloadOnStaleChunk)),
      { provide: LOCALE_ID, useValue: 'es' },
      { provide: TitleStrategy, useClass: AppTitle },
      { provide: RUNTIME_CONFIG, useValue: runtime },
      // public/config.json decide: API real (server/) o demostración en el navegador. Las pantallas no cambian.
      { provide: Api, useClass: runtime.api === 'http' && runtime.apiUrl ? HttpApi : FakeApi },
    ],
  };
}
