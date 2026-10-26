"""Run the selected OpenClaw release schema against nonsecret test substitutions."""
import json,os,subprocess,sys,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='openclaw-schema-') as tmp:
 env=dict(os.environ, OPENCLAW_CONFIG_PATH=str(root/'minikube/openclaw/base/openclaw.json'), OPENCLAW_STATE_DIR=tmp,
          OPENCLAW_GATEWAY_TOKEN='schema-validation-only-'+'x'*32,OPENAI_API_KEY='schema-validation-only')
 env['OPENCLAW_PLUGINS_DIR']=os.getenv('OPENCLAW_PLUGINS_DIR',str(root/'services/mcp-server/operations/plugins'))
 for agent in ('ORCHESTRATOR','SRE','ARGOCD','GITHUB','AWS','OBSERVABILITY','ROBOSHOP','BLOG'):env['OPS_'+agent+'_TOKEN']='schema-validation-only-'+agent+'x'*32
 # Validate the same plugins CI actually installs, rather than container-only paths.
 config=json.loads((root/'minikube/openclaw/base/openclaw.json').read_text())
 plugin_root=Path(env['OPENCLAW_PLUGINS_DIR']).resolve()
 config['plugins']['load']['paths']=[str(plugin_root/'node_modules/@openclaw'/name)
     for name in ('diagnostics-otel','diagnostics-prometheus')]
 for path in config['plugins']['load']['paths']:
  if not Path(path).is_dir():raise SystemExit(f'Telemetry plugin not installed: {path}')
 local_config=Path(tmp)/'config.json'
 local_config.write_text(json.dumps(config))
 env['OPENCLAW_CONFIG_PATH']=str(local_config)
 # Optional executable permits an isolated local installation without changing PATH.
 binary=os.getenv('OPENCLAW_BIN','openclaw')
 command=[binary]
 if os.getenv('OPENCLAW_NODE'):command=[os.environ['OPENCLAW_NODE'],binary]
 version=subprocess.check_output(command+['--version'],env=env,text=True)
 if '2026.10.7' not in version:raise SystemExit('Install the pinned OpenClaw 2026.10.7 release for schema validation')
 result=subprocess.run(command+['config','validate','--json'],env=env,text=True)
 sys.exit(result.returncode)
