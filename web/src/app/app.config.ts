import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { routes } from './app.routes';
import { Api } from './data/api';
import { FakeApi } from './data/fake-api';
import { HttpApi } from './data/http-api';
import { RUNTIME_CONFIG, type RuntimeConfig } from './data/runtime-config';
import { AppTitle } from './shell/title';

registerLocaleData(localeEs);

export function appConfig(runtime: RuntimeConfig): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
      { provide: LOCALE_ID, useValue: 'es' },
      { provide: TitleStrategy, useClass: AppTitle },
      { provide: RUNTIME_CONFIG, useValue: runtime },
      // public/config.json decide: API real (server/) o demostración en el navegador. Las pantallas no cambian.
      { provide: Api, useClass: runtime.api === 'http' && runtime.apiUrl ? HttpApi : FakeApi },
    ],
  };
}
