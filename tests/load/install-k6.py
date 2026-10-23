#!/usr/bin/env python3
"""Install reviewed k6 1.3.0 archives, verifying pinned release SHA-256."""
import hashlib, io, platform, subprocess, tarfile, tempfile, zipfile
from pathlib import Path
ARCHIVES={
 ('Linux','x86_64'):('linux-amd64.tar.gz','84d26fc1f7bc03e02f2e016b3b1b20c032e05dfe461fca82de4e3a6ebe72ddbd'),
 ('Linux','aarch64'):('linux-arm64.tar.gz','df35a88b5ef534b39f4ab74b22a0d60362138af219228253f042650a36af7920'),
 ('Darwin','arm64'):('macos-arm64.zip','eb06b22418e26f7394023e53aaaddf0bec739f669acf718cc9b0e2d7f12bd7be'),
 ('Darwin','x86_64'):('macos-amd64.zip','43d1ba79139856a3be056bf19b748ae68096fd67575df5afdc27514ec7adb8dc')}
def main():
 name,digest=ARCHIVES[(platform.system(),platform.machine())]
 with tempfile.TemporaryDirectory() as folder:
  archive=Path(folder)/name
  subprocess.run(['curl','--fail','--silent','--show-error','--location','--proto','=https','https://github.com/grafana/k6/releases/download/v1.3.0/k6-v1.3.0-'+name,'-o',str(archive)],check=True)
  raw=archive.read_bytes()
  if hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('k6 checksum mismatch')
  if name.endswith('.zip'):
   with zipfile.ZipFile(io.BytesIO(raw)) as z:binary=z.read(next(n for n in z.namelist() if n.endswith('/k6')))
  else:
   with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:binary=t.extractfile(next(m for m in t.getmembers() if m.isfile() and m.name.endswith('/k6'))).read()
  target=Path(__file__).parent/'.tools/k6';target.parent.mkdir(exist_ok=True);target.write_bytes(binary);target.chmod(0o755)
  print(target)
if __name__=='__main__':main()
