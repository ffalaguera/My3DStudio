// API de demostración para los e2e: el mismo `npm run dev`, pero con el motor falso (sin coste).
// Las variables del entorno tienen prioridad sobre .env.local; así no depende del orden de --env-file,
// que `node --watch` reordena al relanzar el proceso hijo.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['--watch', '--env-file-if-exists=.env.local', '--import', 'tsx', 'src/main.ts'], {
  stdio: 'inherit',
  // el motor de demostración no cuesta nada: sin tope diario de generaciones
  // (ni tope de tareas simultáneas: unas tareas huérfanas de una pasada cortada no deben bloquear la cola)
  // tienda: sin tope de modelos gratis (los e2e crean muchos) y un email de taller para probar el panel
  env: {
    ...process.env, GENERATION_PROVIDER: 'fake', GENERATION_DAILY_LIMIT: '0', PROVIDER_MAX_CONCURRENCY: '50',
    GENERATION_FREE_PER_DAY: process.env.GENERATION_FREE_PER_DAY ?? '0', ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? 'taller@example.com',
  },
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (code) => process.exit(code ?? 0));
