# Check prerequisites and create credentials
python3 scripts/observability/elk.py preflight --context mk4
python3 scripts/observability/elk.py credentials --context mk4 --apply

kubectl --context=mk4 apply -f argocd/project-elk.yaml

# Skip this block if ECK is already installed.
kubectl --context=mk4 apply -f argocd/elk-operator.yaml
argocd app sync elk-operator
argocd app wait elk-operator --health --timeout 600

# Elasticsearch and Kibana
kubectl --context=mk4 apply -f argocd/elk-core.yaml
argocd app sync elk-core
kubectl --context=mk4 -n elk rollout status deployment/logs-kb --timeout=600s

# Logstash and Filebeat
kubectl --context=mk4 apply -f argocd/elk-pipeline.yaml
argocd app sync elk-pipeline
argocd app wait elk-pipeline --health --timeout 600

# Import dashboards
python3 scripts/observability/elk.py dashboards --context mk4 --apply