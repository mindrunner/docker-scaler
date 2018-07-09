'use strict';

const helper = require('./helper'),
    docker = helper.Docker.getInstance(),
    logger = helper.Logger.getInstance();

exports.Cleanup = function Cleanup(config) {
    process.on('cleanup', function () {
        logger.info('%s: Cleaning up...', "cleanup");
        helper.Timer.clearAll();
        logger.info('%s: Waiting all processes to finish...', "cleanup");

        if ((process.env.CLEANUP && process.env.CLEANUP === "true") || config.cleanup === true) {
            const listOpts = {
                all: true,
                filters: {
                    label: ['auto-deployed']
                }
            };
            docker.listContainers(listOpts, function (err, containers) {
                for (const i in containers) {
                    const container = containers[i];
                    helper.removeContainer(container.Id);
                }
            });
        }
    });

    // do app specific cleaning before exiting
    process.on('exit', function () {
        process.emit('cleanup');
    });

    // catch ctrl+c event and exit normally
    process.on('SIGINT', function () {
        process.emit('cleanup');
    });

    process.on('SIGTERM', function () {
        process.emit('cleanup');
    });

    //catch uncaught exceptions, trace, then exit normally
    process.on('uncaughtException', function (e) {
        console.log('Uncaught Exception...');
        console.log(e.stack);
        process.exit(99);
    });
};
