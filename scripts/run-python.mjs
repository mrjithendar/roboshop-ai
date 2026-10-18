import { spawn } from 'node:child_process';
const child = spawn(process.env.PYTHON || 'python3', process.argv.slice(2), { stdio: 'inherit', env: process.env });
child.on('error', () => { console.error('Python could not start. Configure PYTHON and install service requirements.'); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
