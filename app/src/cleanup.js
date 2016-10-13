'use strict';

const helper = require('./helper'),
    docker = helper.Docker.getInstance(),
    logger = helper.Logger.getInstance();
var config = undefined;

exports.Cleanup = function Cleanup(conf) {
    config = conf;
    process.on('cleanup', function () {
        logger.info('Cleaning up...');
        helper.Timer.clearAll();
        if ((process.env.CLEANUP && process.env.CLEANUP == "true") || config.cleanup == true) {
            var listOpts = {
                all: true,
                filters: {
                    label: ['auto-deployed']
                }
            };
            docker.listContainers(listOpts, function (err, containers) {
                for (var i in containers) {
                    var container = containers[i];

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
