#!/usr/bin/env bash
# A. Prerequisite checks. Read-only: prints what is missing; creates nothing.
#   deploy/eks/scripts/preflight.sh deploy/eks/env/<cluster>.env
. "$(dirname "$0")/lib.sh" "$1"

fail=0
check() { if "$@" >/dev/null 2>&1; then echo "ok   $*"; else echo "FAIL $*"; fail=1; fi; }

for t in aws terraform kubectl helm envsubst jq curl git; do check command -v "$t"; done
echo "terraform $(terraform version -json | jq -r .terraform_version) (need >= 1.10)"
echo "kubectl   $(kubectl version --client -o json | jq -r .clientVersion.gitVersion) (within one minor of 1.36)"
echo "helm      $(helm version --short) (v3.8+ for OCI charts)"

echo "AWS identity: $(aws sts get-caller-identity --query Arn --output text)"
check aws ec2 describe-availability-zones --region "$AWS_REGION"

grep -q '<' "$1" && { echo "FAIL $1 still contains <placeholders>"; fail=1; }

# Quotas that commonly block a first apply (values are account-specific; compare with needs).
for q in "ec2 L-1216C47A Running On-Demand Standard vCPUs (need >= 16)" \
         "ec2 L-34B43A08 All Standard Spot Instance Requests vCPUs" \
         "vpc L-FE5A380F NAT gateways per AZ" \
         "elasticloadbalancing L-69A177A2 Network Load Balancers per Region" \
         "ec2 L-0263D0A3 EC2-VPC Elastic IPs (one per NAT gateway)"; do
  set -- $q
  v=$(aws service-quotas get-service-quota --region "$AWS_REGION" --service-code "$1" --quota-code "$2" \
        --query Quota.Value --output text 2>/dev/null || echo "unknown")
  shift 2; echo "quota $* = $v"
done
exit $fail
