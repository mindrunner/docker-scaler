'use strict';

const fs = require('fs'),
    Docker = require('dockerode'),
    winston = require('winston');

exports.Logger = (function () {
    var instance;

    function createLogger() {
        var logger = new (winston.Logger)({
            transports: [
                new (winston.transports.Console)()
            ]
        });
        return logger;
    }

    return {
        getInstance: function () {
            if (!instance) {
                instance = createLogger();
            }
            return instance;
        }
    };
})();

exports.Docker = (function () {
    var instance;

    function createDocker() {
        var socket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
        if (!fs.existsSync(socket)) {
            throw new Error("You have to connect the docker socket (e.g. -v /var/run/docker.sock:/var/run/docker.sock).");
        }

        var stats = fs.statSync(socket);

        if (!stats.isSocket()) {
            throw new Error('Are you sure docker is running?');
        }

        return new Docker({socketPath: socket});
    }

    return {
        getInstance: function () {
            if (!instance) {
                instance = createDocker();
            }
            return instance;
        }
    };
})();

exports.Timer = (function () {
    var timers = [],
        run = true;

    return {
        add: function (cb, time) {
            timers.push(setTimeout(function () {
                if (run) {
                    cb();
                }
            }, time));
        },
        clearAll: function () {
            run = false;
            for (var i in timers) {
                clearTimeout(timers[i]);
            }
        }
    };
})();

exports.removeContainer = function (containerId) {
    var docker = exports.Docker.getInstance(),
        logger = exports.Logger.getInstance(),
        container = docker.getContainer(containerId);

    container.stop(function (err, data) {
        if (err) {
            logger.error("Error stopping %s.", containerId);
        } else {
            container.remove(function (err, data) {
                if (err) {
                    logger.error("Error removing %s.", containerId);
                }
                logger.info("Removed container %s.", containerId);
            });
        }
    });
}
