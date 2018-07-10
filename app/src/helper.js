'use strict';

const fs = require('fs'),
    Docker = require('dockerode'),
    winston = require('winston');

exports.Logger = (function () {
    let instance;

    function createLogger() {
        return new (winston.Logger)({
            transports: [
                new (winston.transports.Console)()
            ]
        });
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
    let instance;

    function createDocker() {
        const socket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
        if (!fs.existsSync(socket)) {
            throw new Error("You have to connect the docker socket (e.g. -v /var/run/docker.sock:/var/run/docker.sock).");
        }
        const stats = fs.statSync(socket);
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
    let timers = [],
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
            for (const i in timers) {
                clearTimeout(timers[i]);
            }
        }
    };
})();

exports.removeContainer = function (containerId) {
    const docker = exports.Docker.getInstance(),
        logger = exports.Logger.getInstance(),
        container = docker.getContainer(containerId);

    container.stop(function (err, data) {
        if (err) {
            logger.error("%s: Error stopping %s. Maybe it's not running.", "helper", containerId);
        } else {
            logger.info("%s: Stopped container %s.", "helper", containerId);
        }

        container.remove(function (err, data) {
            if (err) {
                logger.error("%s: Error removing %s.", "helper", containerId);
            }
            logger.info("%s: Removed container %s.", "helper", containerId);
        });
    });
};
