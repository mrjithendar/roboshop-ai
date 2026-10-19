VULTR_HOST=root@jithendar.com
CONFIG="$HOME/.kube/vultr-minikube.json"

mkdir -p "$HOME/.kube"
umask 077

ssh "$VULTR_HOST" \
  'kubectl config view --minify --raw --flatten -o json' > "$CONFIG"