FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
 && chmod +x /usr/sbin/policy-rc.d \
 && apt-get update && apt-get install -y --no-install-recommends postfix opendkim ca-certificates supervisor openssl \
 && rm -rf /var/lib/apt/lists/*
COPY main.cf /etc/postfix/main.cf
COPY opendkim.conf /etc/opendkim.conf
COPY supervisord.conf /etc/supervisor/conf.d/mail.conf
COPY entrypoint.sh /usr/local/bin/start-mail
RUN chmod +x /usr/local/bin/start-mail
EXPOSE 587
ENTRYPOINT ["/usr/local/bin/start-mail"]
