"""Keep copied installer tests offline while exercising the real Argo ownership guard."""
from pathlib import Path
import shlex
ROOT=Path(__file__).resolve().parents[1]


def prepare_source(source):
    # Host policy and shared TLS have their own test suites.
    source='\n'.join('roboshop_require_centos() { return 0; }' if line.startswith('source ') and 'require-centos.sh' in line else line for line in source.splitlines())+'\n'
    source=source.replace('"$SCRIPT_DIR/../scripts/lib/check-argocd-ownership.sh"',shlex.quote(str(ROOT/'scripts/lib/check-argocd-ownership.sh')))
    source=source.replace('KUBE_CONTEXT="$KUBE_CONTEXT" bash "$SCRIPT_DIR/setup-shared-tls.sh"','echo "shared-tls reconcile" >> "$TEST_LOG"')
    return source
