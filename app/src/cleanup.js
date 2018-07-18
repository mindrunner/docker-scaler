'use strict';

const helper = require('./helper'),
    docker = helper.Docker.getInstance(),
    logger = helper.Logger.getInstance();

exports.Cleanup = function Cleanup(config) {
    logger.debug("Inititalizing Cleanup hooks");
    process.on('cleanup', function () {
        logger.info('%s: Cleaning up...', "cleanup");
        helper.Timer.clearAll();
        logger.info('%s: Waiting all processes to finish...', "cleanup");

        if ((process.env.CLEANUP && process.env.CLEANUP === "true") || config.cleanup === true) {
            logger.info("Stopping running containers...");

            for (const i in config.containers) {
                const containerset = config.containers[i]

                logger.info("Stopping containers with id %s", containerset.id);
                const listOpts = {
                    all: true,
                    filters: {
                        label: ['auto-deployed=true',
                            'group-id=' + containerset.id]
                    }
                };
                docker.listContainers(listOpts, function (err, containers) {
                    for (const i in containers) {
                        const container = containers[i];
                        helper.removeContainer(container.Id);
                    }
                });
            }
            logger.info("... done stopping running containers!");
        } else {
            logger.info("Not stopping any containers, cleanup=false!");
        }
    });

    // do app specific cleaning before exiting
    process.on('exit', function () {
        logger.debug("Received EXIT Signal");
        process.emit('cleanup');
    });

    // catch ctrl+c event and exit normally
    process.on('SIGINT', function () {
        logger.debug("Received SIGINT Signal");
        process.emit('cleanup');
    });

    process.on('SIGTERM', function () {
        logger.debug("Received SIGTERM Signal");
        process.emit('cleanup');
    });

    //catch uncaught exceptions, trace, then exit normally
    process.on('uncaughtException', function (e) {
        console.log('Uncaught Exception...');
        console.log(e.stack);
        process.exit(99);
    });
};
