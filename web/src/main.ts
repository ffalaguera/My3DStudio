import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadRuntimeConfig } from './app/data/runtime-config';

loadRuntimeConfig()
  .then((cfg) => bootstrapApplication(App, appConfig(cfg)))
  .catch((err) => console.error(err));
