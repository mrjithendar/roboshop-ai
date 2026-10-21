# FastAPI presentation demo

An optional, independent Python service for showing FastAPI. It uses two clearly
labelled sample products. It does not connect to MongoDB, modify carts, create
orders, charge money, or call external APIs. Stopping it has no effect on RoboShop.
The currency service remains Go.

## Run locally

From the repository root:

```sh
cd services/fastapi-demo
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 4112
```

Open **http://localhost:4112/docs** for interactive Swagger UI, or
**http://localhost:4112/redoc** for reference documentation. The generated schema is
at `/openapi.json`. These documentation pages load UI assets from a CDN, so the
presenter's browser needs Internet access.

## Five-minute demo

1. Open `/docs` and explain that FastAPI generates documentation from Python type
   hints and Pydantic models.
2. Expand `GET /products`, click **Try it out**, enter `rover` for `q`, and execute.
3. Call `GET /products/SAMPLE-ROVER`; then use an unknown SKU to demonstrate a 404.
4. Execute `POST /estimates` with `{"sku":"SAMPLE-ROVER","quantity":2}`.
   The response is 99800 paise (INR 998.00), a sample subtotal only.
5. Change quantity to `0`, `21`, or a string to demonstrate automatic 422 validation.
   An injected price field is also rejected; pricing comes from the sample fixture.
6. Show `Catalogue = Annotated[..., Depends(get_products)]` in `app.py`, and the
   test overriding that dependency. Show the async health endpoint and response models.

## Container and Minikube

CI `ci-fastapi-demo.yml` tests and publishes `roboshop-fastapi-demo:latest` using
our existing ECR publisher. Its repository is included in the Terraform list;
apply the infrastructure workflow before the first publish. The regular store
workflow does not automatically deploy this presentation-only service.

After publishing, on a machine with the existing cluster kubeconfig selected:

```sh
kubectl apply -f services/fastapi-demo/fastapi-demo-minikube.yaml
kubectl -n roboshop-ai rollout restart deployment/fastapi-demo
kubectl -n roboshop-ai port-forward service/fastapi-demo 4112:4112
```

Open http://localhost:4112/docs. Wait for the pod to start before port-forwarding;
image-pull or startup failures can be inspected with `kubectl -n roboshop-ai describe
pod -l app=fastapi-demo`. The manifest requires the existing `ecr-pull` secret.
Port-forward is local-only; no public ingress, production API routing or additional
credentials are configured. To remove only this demo:

```sh
kubectl delete -f services/fastapi-demo/fastapi-demo-minikube.yaml
```

Local image build: `docker build -t roboshop-fastapi-demo:local services/fastapi-demo`.
For tests, install `requirements-test.txt` and run `python -m unittest -v` from this
service directory. Tests use FastAPI TestClient and no external services.

Official documentation: [FastAPI tutorial](https://fastapi.tiangolo.com/tutorial/),
[request models](https://fastapi.tiangolo.com/tutorial/body/),
[dependency injection](https://fastapi.tiangolo.com/tutorial/dependencies/).

CI runs tests using the Dockerfile's `test` target with Python 3.14, rather than
`actions/setup-python`. This supports CentOS 10 self-hosted runners without a
host Python installation; Docker must be accessible to the runner user.
Reproduce the CI test from the repository root:

```sh
docker build --progress=plain --target test -f services/fastapi-demo/Dockerfile services/fastapi-demo
```

The default Docker build still produces the `runtime` image without test dependencies.
