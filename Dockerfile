FROM node:alpine
MAINTAINER Lukas Elsner <lukas.elsner@sbb.ch>

RUN apk add --update \
  && rm -rf /var/cache/apk/*

COPY app /opt/docker-autoscale
RUN cd /opt/docker-autoscale && npm install

VOLUME ["/opt/docker-autoscale/config"]

COPY run.sh /opt/docker-autoscale/run.sh
RUN chmod +x /opt/docker-autoscale/run.sh

WORKDIR "/opt/docker-autoscale"

CMD ["/opt/docker-autoscale/scaler.js"]
