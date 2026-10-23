#!/usr/bin/env python3
"""Profile-based host preparation. No application or cloud operations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

# Resolve resources from this module, so invocation from another directory is safe.
ROOT = Path(__file__).resolve().parents[2]
VERSIONS = json.loads(Path(__file__).with_name('versions.json').read_text())
BIN = Path.home()/'.local/bin'
DATA = Path.home()/'.local/share/roboshop-tools'


# Explicit release matrix; package managers alone do not identify supported hosts.
def host(system=None, machine=None, release=None):
    system = system or platform.system()
    machine = machine or platform.machine()
    arch = {'x86_64':'amd64','arm64':'arm64','aarch64':'arm64'}.get(machine)
    if not arch:raise ValueError('Supported architectures: x86_64 and ARM64')
    if system == 'Darwin':return 'macos','darwin',arch,'brew'
    if system != 'Linux':raise ValueError('Unsupported operating system: '+system)
    if release is None:
        release = {}
        for line in Path('/etc/os-release').read_text().splitlines():
            if '=' in line:
                key,value=line.split('=',1);release[key]=value.strip('"')
    distro, version = release.get('ID'), release.get('VERSION_ID')
    if distro == 'centos' and version in ('9','10') and 'Stream' in release.get('NAME',''):return 'centos','linux',arch,'dnf'
    if distro == 'amzn' and version == '2023':return 'amzn','linux',arch,'dnf'
    if distro == 'ubuntu' and version in ('22.04','24.04'):return 'ubuntu','linux',arch,'apt-get'
    raise ValueError(f'Unsupported Linux release: {distro} {version}')


# Argument lists avoid shell interpolation; a failed command must stop initialization.
def run(args, capture=False):
    return subprocess.run([str(a) for a in args],check=True,text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None,timeout=900)


# Probe commands locally; no credentials, cloud API calls or daemon mutations here.
def version(tool):
    commands={'openssl':['version'],'kubectl':['version','--client','-o','json'],'helm':['version','--short'],
              'java':['-version'],'minikube':['version','--short'],'terraform':['version','-json']}
    try:
        r=run([tool,*commands.get(tool,['--version'])],True)
        return (r.stdout or r.stderr).strip()
    except (OSError,subprocess.SubprocessError):return ''


# Compatibility ranges permit reuse; pinned versions apply only to missing tools.
def compatible(tool, output):
    if tool=='openssl':return bool(re.match(r'OpenSSL (?:1\.1\.1|3\.)',output))
    if tool=='aws':return output.startswith('aws-cli/2.')
    if tool=='helm':return bool(re.match(r'v[34]\.',output))
    if tool=='kubectl':return bool(re.search(r'"gitVersion"\s*:\s*"v1\.',output))
    if tool=='terraform':
        try:v=json.loads(output)['terraform_version'];return (1,10)<=tuple(map(int,v.split('.')[:2]))<(2,0)
        except (ValueError,KeyError,TypeError):return False
    if tool=='node':return bool(re.match(r'v(?:24|25|26)\.',output))
    if tool=='docker':return bool(re.match(r'Docker version (?:2[4-9]|[3-9][0-9])\.',output))
    return bool(output)


class Installer:
    def __init__(self, mode, platform_info):
        self.mode=mode;self.distro,self.os,self.arch,self.manager=platform_info
        self.missing=[]
    # The only execution gate for planned installation actions: dry-run never calls fn.
    def action(self,description,fn):
        print(('PLAN: ' if self.mode=='dry-run' else '')+description)
        if self.mode=='install':fn()
    # Escalate only package-manager work; downloads/private installs stay with the user.
    def packages(self, packages):
        def install():
            if not shutil.which(self.manager):raise ValueError(f'Install {self.manager} first; no bootstrap shell downloads are executed')
            sudo=[] if os.geteuid()==0 or self.manager=='brew' else ['sudo']
            if self.manager=='apt-get':run(sudo+['apt-get','update'])
            run(sudo+[self.manager,'install']+([] if self.manager=='brew' else ['-y'])+packages)
        self.action('Install signed OS packages: '+', '.join(packages),install)
    # Presence alone is insufficient (e.g. the unrelated PyPI aws/helm commands).
    def need(self, tool, install):
        existing=shutil.which(tool)
        if existing:
            output=version(tool)
            if not compatible(tool,output):raise ValueError(f'Incompatible {tool} at {existing}. Select a compatible installation in PATH; init will not replace it.')
            display=output.splitlines()[0]
            if tool=='terraform':display=json.loads(output).get('terraform_version',display)
            if tool=='kubectl':display=json.loads(output).get('clientVersion',{}).get('gitVersion',display)
            print(f'REUSE {tool}: {display[:150]}');return
        self.missing.append(tool)
        if self.mode=='check':print('MISSING '+tool);return
        install()
        if self.mode=='install' and not compatible(tool,version(tool)):raise ValueError(f'{tool} installation did not produce a compatible command')
    # Ignore user curl configuration and bound retries/timeouts for reproducible downloads.
    def fetch(self,url,path):
        run(['curl','--disable','-fsSL','--retry','3','--connect-timeout','15','--max-time','300',url,'-o',path])
    # Verify bytes before extracting/publishing; temporary downloads are always cleaned up.
    def artifact(self,tool,url,checksum_url,member=None,archive=False):
        def install():
            with tempfile.TemporaryDirectory(prefix='roboshop-init-') as temp:
                work=Path(temp);payload=work/'payload';sums=work/'checksums'
                self.fetch(url,payload);self.fetch(checksum_url,sums)
                lines=sums.read_text().splitlines();filename=url.rsplit('/',1)[1]
                entries=[line.split()[0] for line in lines if filename in line or len(lines)==1]
                digest=hashlib.sha256(payload.read_bytes()).hexdigest()
                if digest not in entries:raise ValueError(f'{tool} checksum verification failed')
                BIN.mkdir(parents=True,exist_ok=True);DATA.mkdir(parents=True,exist_ok=True)
                dest=BIN/tool
                if dest.exists() or dest.is_symlink():raise ValueError(f'Refusing to overwrite {dest}')
                # Node needs its directory layout: npm/npx link into the bundled libraries.
                if archive:
                    for name in ('node','npm','npx'):
                        if (BIN/name).exists() or (BIN/name).is_symlink():raise ValueError(f'Refusing to replace {name}')
                    folder=DATA/(tool+'-'+VERSIONS[tool])
                    if folder.exists():raise ValueError(f'Partial install exists at {folder}; inspect it before retrying')
                    with tarfile.open(payload) as tar:
                        for info in tar.getmembers():
                            if info.name.startswith('/') or '..' in Path(info.name).parts or info.isdev():raise ValueError('Unsafe archive member')
                            if info.issym() or info.islnk():
                                target=(folder/Path(info.name).parent/info.linkname if info.issym() else folder/info.linkname).resolve()
                                if not target.is_relative_to(folder.resolve()):raise ValueError('Unsafe archive link')
                        tar.extractall(folder)
                    base=next(folder.iterdir())/'bin'
                    for name in ('node','npm','npx'):
                        if (BIN/name).exists():raise ValueError(f'Refusing to replace {name}')
                        (BIN/name).symlink_to(base/name)
                elif member:
                    if url.endswith('.zip'):
                        with zipfile.ZipFile(payload) as z:dest.write_bytes(z.read(member))
                    else:
                        with tarfile.open(payload) as tar:dest.write_bytes(tar.extractfile(member).read())
                    dest.chmod(0o755)
                else:shutil.copyfile(payload,dest);dest.chmod(0o755)
        self.action(f'Install {tool} {VERSIONS[tool]} in {BIN}; verify published SHA256',install)
    def binary(self,tool):
        v=VERSIONS[tool];osname=self.os;arch=self.arch
        if tool=='kubectl':
            u=f'https://dl.k8s.io/release/v{v}/bin/{osname}/{arch}/kubectl';self.artifact(tool,u,u+'.sha256')
        elif tool=='minikube':
            u=f'https://storage.googleapis.com/minikube/releases/v{v}/minikube-{osname}-{arch}';self.artifact(tool,u,u+'.sha256')
        elif tool=='helm':
            u=f'https://get.helm.sh/helm-v{v}-{osname}-{arch}.tar.gz';self.artifact(tool,u,u+'.sha256sum',f'{osname}-{arch}/helm')
        elif tool=='terraform':
            u=f'https://releases.hashicorp.com/terraform/{v}/terraform_{v}_{osname}_{arch}.zip';self.artifact(tool,u,f'https://releases.hashicorp.com/terraform/{v}/terraform_{v}_SHA256SUMS','terraform')
        elif tool=='node':
            a='x64' if arch=='amd64' else 'arm64';u=f'https://nodejs.org/dist/v{v}/node-v{v}-{osname}-{a}.tar.gz'
            self.artifact(tool,u,f'https://nodejs.org/dist/v{v}/SHASUMS256.txt',archive=True)
    def python(self):
        # uv verifies its managed Python downloads; never alter the OS interpreter.
        env=ROOT/'.venv'
        if (env/'bin/python').exists():
            output=version(str(env/'bin/python'))
            if not re.match(r'Python 3\.(?:1[1-9])\.',output):raise ValueError('Existing .venv requires Python 3.11+; preserve it and choose a new environment manually')
            print('REUSE isolated .venv: '+output);return
        if env.exists():raise ValueError('Existing .venv is incomplete; inspect it before retrying')
        a='x86_64' if self.arch=='amd64' else 'aarch64'
        target=a+('-apple-darwin' if self.os=='darwin' else '-unknown-linux-gnu')
        u=f'https://github.com/astral-sh/uv/releases/download/{VERSIONS["uv"]}/uv-{target}.tar.gz'
        self.need('uv',lambda:self.artifact('uv',u,u+'.sha256',f'uv-{target}/uv'))
        if self.mode=='check':self.missing.append('.venv');print('MISSING isolated .venv');return
        def install():
            run(['uv','python','install',VERSIONS['python']])
            run(['uv','venv','--seed','--python',VERSIONS['python'],env])
        self.action('Create repository .venv with managed Python '+VERSIONS['python']+' (no app packages installed)',install)
    # Docker is a host service, so package installation and service enablement need privilege.
    # This does not grant users access to the root-equivalent Docker socket.
    def docker(self):
        if self.os=='darwin':
            if self.mode!='install':
                print('MANUAL prerequisite: compatible Docker engine on macOS');return
            raise ValueError('Install/select a Docker-compatible engine manually on macOS; init never installs Docker Desktop')
        if self.distro in ('ubuntu','amzn'):
            self.packages(['docker.io'] if self.distro=='ubuntu' else ['docker'])
            self.action('Enable Docker service (no socket permission changes)',lambda:run(([] if os.geteuid()==0 else ['sudo'])+['systemctl','enable','--now','docker']))
            return
        def repo():
            run(([] if os.geteuid()==0 else ['sudo'])+['dnf','config-manager','--add-repo','https://download.docker.com/linux/centos/docker-ce.repo'])
        self.packages(['dnf-plugins-core'])
        self.action('Add official Docker CentOS repository',repo)
        self.packages(['docker-ce','docker-ce-cli','containerd.io','docker-buildx-plugin'])
        self.action('Enable Docker service (no group or socket permission changes)',lambda:run(([] if os.geteuid()==0 else ['sudo'])+['systemctl','enable','--now','docker']))
    # Verify with an isolated GPG keyring, not the operator's personal trust/key configuration.
    def aws(self):
        if self.os=='darwin':
            # Reuse existing AWS v2; missing CLI is an explicit operator prerequisite.
            if self.mode!='install':
                print('MANUAL prerequisite: AWS CLI v2 on macOS');return
            raise ValueError('Install AWS CLI v2 manually on macOS, then rerun; no system-wide installer is run by init')
        self.need('gpg',lambda:self.packages(['gnupg2']))
        def install():
            with tempfile.TemporaryDirectory(prefix='roboshop-aws-') as temp:
                work=Path(temp);archive=work/'aws.zip';signature=work/'aws.sig'
                a='x86_64' if self.arch=='amd64' else 'aarch64'
                url=f'https://awscli.amazonaws.com/awscli-exe-linux-{a}-{VERSIONS["aws"]}.zip'
                self.fetch(url,archive);self.fetch(url+'.sig',signature)
                keyring=work/'gpg';keyring.mkdir(mode=0o700)
                run(['gpg','--homedir',keyring,'--batch','--import',Path(__file__).with_name('aws-cli.asc')])
                run(['gpg','--homedir',keyring,'--batch','--verify',signature,archive])
                with zipfile.ZipFile(archive) as z:
                    for info in z.infolist():
                        if info.filename.startswith('/') or '..' in Path(info.filename).parts:raise ValueError('Unsafe AWS archive')
                    z.extractall(work)
                    for info in z.infolist():
                        mode=(info.external_attr >> 16)&0o777
                        if mode:(work/info.filename).chmod(mode)
                run([work/'aws/install','--install-dir',DATA/'aws-cli','--bin-dir',BIN])
        self.action('Install AWS CLI v2 using pinned AWS signing key and detached signature',install)


# Profiles intentionally avoid installing every language runtime on deployment hosts.
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile',choices=['dev','docker','minikube','aws'],default='dev')
    group=parser.add_mutually_exclusive_group();group.add_argument('--check',action='store_true');group.add_argument('--dry-run',action='store_true')
    args=parser.parse_args();mode='check' if args.check else 'dry-run' if args.dry_run else 'install'
    info=host();print('Host: '+' / '.join(info)+'; profile='+args.profile+'; mode='+mode)
    # Reuse the caller's selected command first; private installs are a fallback.
    os.environ['PATH']=os.environ['PATH']+os.pathsep+str(BIN)
    # Preflight macOS prerequisites before any other install actions.
    if mode=='install' and info[1]=='darwin':
        required={'docker':['docker'],'minikube':['docker'],'aws':['aws']}.get(args.profile,[])
        for tool in required:
            if not shutil.which(tool) or not compatible(tool,version(tool)):
                raise ValueError(f'Select a compatible {tool} manually on macOS before init; no changes made')
        if any(not shutil.which(t) for t in ('git','curl','jq')) and not shutil.which('brew'):
            raise ValueError('Missing base tools require existing Homebrew; init never installs Homebrew')
    i=Installer(mode,info)
    for tool in ('git','curl','jq'):i.need(tool,lambda tool=tool:i.packages([tool]))
    if args.profile=='dev':
        i.need('node',lambda:i.binary('node'));i.python()
    if args.profile in ('docker','minikube'):
        i.need('docker',i.docker)
        print('Docker access: run docker info. If denied, ask your administrator about the root-equivalent docker group and log in again; never chmod the socket.')
    if args.profile=='minikube':
        i.need('openssl',lambda:i.packages(['openssl']))
        for tool in ('kubectl','helm','minikube'):i.need(tool,lambda tool=tool:i.binary(tool))
    if args.profile=='aws':
        i.need('aws',i.aws);i.need('terraform',lambda:i.binary('terraform'))
    print('Scope: tool versions only; application packages, credentials, Docker access and deployment readiness are not verified.')
    print('PATH for new shells: export PATH="$HOME/.local/bin:$PATH"')
    print('Next: '+{'dev':'npm ci; install service requirements in .venv as needed; see scripts index for Java/Go builds', 'docker':'docker info; ./init.sh --profile aws for ECR publishing', 'minikube':'bash minikube/install.sh start (explicit cluster creation)', 'aws':'aws sts get-caller-identity (after separately configuring credentials); terraform -chdir=infrastructure init'}[args.profile])
    return 1 if mode=='check' and i.missing else 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,subprocess.SubprocessError) as error:
        print('ERROR: '+str(error),file=sys.stderr);raise SystemExit(1)
