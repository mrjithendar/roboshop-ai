import { spawn } from 'node:child_process';
const child = spawn('java', ['-jar', 'services/shipping-service/build/libs/shipping-service.jar', '--migrate'], { stdio: 'inherit' });
child.on('error', () => { console.error('Java 21+ and a built shipping JAR are required. Run npm run shipping:build.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
