// API de demostración para los e2e: el mismo `npm run dev`, pero con el motor falso (sin coste).
// Las variables del entorno tienen prioridad sobre .env.local; así no depende del orden de --env-file,
// que `node --watch` reordena al relanzar el proceso hijo.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['--watch', '--env-file-if-exists=.env.local', '--import', 'tsx', 'src/main.ts'], {
  stdio: 'inherit',
  env: { ...process.env, GENERATION_PROVIDER: 'fake' },
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (code) => process.exit(code ?? 0));
