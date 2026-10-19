# Sample Microservice Application

Stan's Robot Shop is a sample microservice application you can use as a sandbox to test and learn containerised application orchestration and monitoring techniques. It is not intended to be a comprehensive reference example of how to write a microservices application, although you will better understand some of those concepts by playing with Stan's Robot Shop. To be clear, the error handling is patchy and there is not any security built into the application.

You can get more detailed information from my [blog post](https://www.instana.com/blog/stans-robot-shop-sample-microservice-application/) about this sample microservice application.

This sample microservice application has been built using these technologies:
- NodeJS ([Express](http://expressjs.com/))
- Java ([Spring Boot](https://spring.io/))
- Python ([Flask](http://flask.pocoo.org))
- Golang
- PHP (Apache)
- MongoDB
- Redis
- MySQL ([Maxmind](http://www.maxmind.com) data)
- RabbitMQ
- Nginx
- AngularJS (1.x)

The various services in the sample application already include all required Instana components installed and configured. The Instana components provide automatic instrumentation for complete end to end [tracing](https://docs.instana.io/core_concepts/tracing/), as well as complete visibility into time series metrics for all the technologies.

To see the application performance results in the Instana dashboard, you will first need an Instana account. Don't worry a [trial account](https://instana.com/trial?utm_source=github&utm_medium=robot_shop) is free.

To download the tracing module for Nginx, it needs a valid Instana agent key. Set this in the environment before starting the build.

```shell
$ export INSTANA_AGENT_KEY="<your agent key>"
```

Now build all the images.

If you modified the `.env` file and changed the image registry, you need to push the images to that registry

## Run Locally
You can run it locally for testing.

If you did not build from source, don't worry all the images are on Docker Hub. Just pull down those images first using:

Fire up Stan's Robot Shop with:

If you want to fire up some load as well:

If you are running it locally on a Linux host you can also run the Instana [agent](https://docs.instana.io/quick_start/agent_setup/container/docker/) locally, unfortunately the agent is currently not supported on Mac.

There is also only limited support on ARM architectures at the moment.

## Marathon / DCOS

The manifests for robotshop are in the *DCOS/* directory. These manifests were built using a fresh install of DCOS 1.11.0. They should work on a vanilla HA or single instance install.

You may install Instana via the DCOS package manager, instructions are here: https://github.com/dcos/examples/tree/master/instana-agent/1.9

## Kubernetes
You can run Kubernetes locally using [minikube](https://github.com/kubernetes/minikube) or on one of the many cloud providers.

The Docker container images are all available on [Docker Hub](https://hub.docker.com/u/robotshop/).

Install Stan's Robot Shop to your Kubernetes cluster using the [Helm](K8s/helm/README.md) chart.

To deploy the Instana agent to Kubernetes, just use the [helm](https://github.com/instana/helm-charts) chart.

If you are running the store on Kubernetes via minikube then, find the IP address of Minikube and the Node Port of the web service.

```shell
$ minikube ip
$ kubectl get svc web
shell
$ curl http://<host>:8080/api/cart/metrics
$ curl http://<host>:8080/api/payment/metrics
```
