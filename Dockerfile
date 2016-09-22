FROM alpine:3.4
MAINTAINER Simon Erhardt <simon.erhardt@sbb.ch>

RUN apk add --update \
  nodejs-lts \
  && rm -rf /var/cache/apk/*

COPY app /opt/docker-autoscale
RUN cd /opt/docker-autoscale && npm install

VOLUME ["/opt/docker-autoscale/config"]

COPY run.sh /opt/docker-autoscale/run.sh
RUN chmod +x /opt/docker-autoscale/run.sh

CMD ["/opt/docker-autoscale/run.sh"]