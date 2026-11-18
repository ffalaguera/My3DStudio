import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { routes } from './app.routes';
import { Api } from './data/api';
import { FakeApi } from './data/fake-api';
import { AppTitle } from './shell/title';

registerLocaleData(localeEs);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: LOCALE_ID, useValue: 'es' },
    { provide: TitleStrategy, useClass: AppTitle },
    // /replica-backend sustituye FakeApi por HttpApi. Ninguna pantalla cambia.
    { provide: Api, useClass: FakeApi },
  ],
};
