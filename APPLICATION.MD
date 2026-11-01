# get roboshop super admin username password

kubectl --context roboshop-demo -n roboshop-ai get secret roboshop-secrets -o jsonpath='{.data.SUPERADMIN_EMAIL}' | base64 -d; echo
kubectl --context roboshop-demo -n roboshop-ai get secret roboshop-secrets -o jsonpath='{.data.SUPERADMIN_PASSWORD}' | base64 -d; echo
