#!/usr/bin/env python3
"""Offline approximation of the Gatekeeper rules (k8s/gatekeeper) over rendered pod templates.

    python3 deploy/eks/scripts/policy-precheck.py deploy/eks/clusters/<cluster>/{apps,jobs}/manifests.yaml

Gatekeeper's own audit (after F2) is authoritative; this only catches regressions before a
cluster exists. It does not see sidecars injected at admission. Standard library only.
"""
import re
import sys

def docs(path):
    return [d for d in open(path).read().split("\n---\n") if d.strip()]

def field(doc, pattern):
    m = re.search(pattern, doc, re.M)
    return m.group(1) if m else None

problems = 0
for path in sys.argv[1:]:
    for d in docs(path):
        kind = field(d, r"^kind: (\w+)")
        if kind not in ("Deployment", "StatefulSet", "Job"):
            continue
        name = field(d, r"^  name: (\S+)")
        found = []
        restricted = "roboshop.dev/policy-exception" not in d
        template = d.split("  template:", 1)[1]
        pod_sc = re.search(r"(?m)^      securityContext:\n((?:        .*\n)*)", template)
        pod_non_root = bool(pod_sc and "runAsNonRoot: true" in pod_sc.group(1))
        for block in re.findall(r"(?ms)^      (?:initContainers|containers):\n(.*?)(?=^      [A-Za-z]|\Z)", template):
            for c in re.split(r"(?m)^      - ", block)[1:]:
                cname = field(c, r"^(?:name|        name): (\S+)") or "?"
                img = field(c, r"image: (\S+)")
                if img and "@sha256:" not in img:
                    found.append(f"{cname}: image not pinned by digest")
                for key in ("requests:\n\\s+cpu", "requests:\n(?:\\s+cpu: \\S+\n)?\\s+memory", "limits:\n(?:\\s+cpu: \\S+\n)?\\s+memory"):
                    if not re.search(key, c):
                        found.append(f"{cname}: missing resources ({key.split(':')[0]} {key.split()[-1]})")
                if restricted:
                    if "allowPrivilegeEscalation: false" not in c:
                        found.append(f"{cname}: allowPrivilegeEscalation not false")
                    if not re.search(r"drop:\n\s+- ALL|drop: \[\"?ALL", c):
                        found.append(f"{cname}: capabilities.drop ALL missing")
                    if "runAsNonRoot: true" not in c and not pod_non_root:
                        found.append(f"{cname}: runAsNonRoot not true")
                    if re.search(r"capabilities:(?:\n.*)*?\n\s+add:", c):
                        found.append(f"{cname}: adds capabilities")
        if restricted and "automountServiceAccountToken: false" not in template:
            found.append("automountServiceAccountToken not false")
        if kind in ("Deployment", "StatefulSet"):
            labels = d.split("spec:", 1)[0]
            for l in ("app.kubernetes.io/part-of", "roboshop.dev/environment", "roboshop.dev/owner"):
                if l not in labels:
                    found.append(f"missing label {l}")
        for f in sorted(set(found)):
            print(f"{kind}/{name}: {f}")
        problems += len(set(found))
print(f"{problems} potential violation(s)")
sys.exit(1 if problems else 0)
