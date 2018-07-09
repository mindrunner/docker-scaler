FROM node:alpine
MAINTAINER Lukas Elsner <lukas.elsner@sbb.ch>

RUN apk add --update \
  tini \
  && rm -rf /var/cache/apk/*

COPY app /opt/docker-autoscale
RUN cd /opt/docker-autoscale && npm install

ENTRYPOINT ["/sbin/tini", "--"]

VOLUME ["/opt/docker-autoscale/config"]

COPY run.sh /opt/docker-autoscale/run.sh
RUN chmod +x /opt/docker-autoscale/run.sh

CMD ["/opt/docker-autoscale/run.sh"]
