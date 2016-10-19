'use strict';

const async = require('asyncawait/async'),
    await = require('asyncawait/await'),

    helper = require('../src/helper'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

var imagePull = async(function (scaler) {

    for(var i in scaler.config.containers) {
        var containerConfig = scaler.config.containers[i];

        if(containerConfig.pull) {
            pullImage(containerConfig.image);
        }
    }

    function pullImage(image) {
        return new Promise(function(resolve, reject) {
            var pullOpts = {};

            if(scaler.config.auth != {}) {
                pullOpts.authconfig = scaler.config.auth;
            }
            logger.info("Pulling image: %s", image);

            docker.pull(image, pullOpts, function (err, stream) {
                docker.modem.followProgress(stream, onFinished, onProgress);

                function onFinished(err, output) {
                    if(err) {
                        logger.error("Error pulling %s: %s", image, err);
                        return reject(err);
                    }
                    logger.info("Successfully pulled %s.", image);
                    resolve();
                }

                function onProgress(event) {
                    if(event.progressDetail != undefined
                        && event.progressDetail.current != undefined
                        && event.progressDetail.total != undefined) {
                        var percent = Math.round(100 / event.progressDetail.total * event.progressDetail.current);
                        logger.debug('%s: %s (%d%)', event.id, event.status, percent);
                    } else if(event.id != undefined) {
                        logger.debug('%s: %s', event.id, event.status);
                    } else {
                        logger.debug('%s', event.status);
                    }
                }
            });

            helper.Timer.add(async(function () {
                await(pullImage(image));
            }), self.config.pullInterval * 1000);
        });
    }
});

imagePull.pluginName = "imagePull";

module.exports = imagePull;