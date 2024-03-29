'use strict';

const
    fs = require('fs'),
    Docker = require('dockerode'),
    winston = require('winston'),
    _name = "helper";

exports.Logger = (function () {
    let instance;

    function createLogger() {
        const { combine, timestamp, label, printf } = winston.format;
        const myFormat = printf(info => {
            return `${info.timestamp} ${info.level}: ${info.message}`;
        });

        return winston.createLogger({
            format: winston.format.combine(
                timestamp(),
                winston.format.colorize(),
                winston.format.splat(),
                myFormat
            ),
            transports: [new winston.transports.Console()]
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
        if(!process.env.DOCKERHOST) {
            const socket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
            if (!fs.existsSync(socket)) {
                throw new Error("You have to connect the docker socket (e.g. -v /var/run/docker.sock:/var/run/docker.sock).");
            }
            const stats = fs.statSync(socket);
            if (!stats.isSocket()) {
                throw new Error('Are you sure docker is running?');
            }
            return new Docker({socketPath: socket});
        }else
        {
            console.log("Connecting to TCP Dockerdaemon at: "+process.env.DOCKERHOST+":"+process.env.DOCKERPORT);
            return new Docker({ host: process.env.DOCKERHOST, port: process.env.DOCKERPORT  })
        }
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

exports.removeContainer = async function (containerId) {
    const
        docker = exports.Docker.getInstance(),
        logger = exports.Logger.getInstance(),
        container = docker.getContainer(containerId);

    try {
        var err;

        const containerInfo = await container.inspect({});
        if (containerInfo.State.Running)
            await exports.stopContainer(containerId);
        await container.remove(err);
        if (err) {
            logger.error("%s: Error removing %s.", _name, containerId);
        } else {
            logger.info("%s: Removed container %s.", _name, containerId);
        }
    } catch (e) {
        throw e;
    }
};

exports.stopContainer = async function (containerId) {
    const
        docker = exports.Docker.getInstance(),
        logger = exports.Logger.getInstance(),
        container = docker.getContainer(containerId);

    try {
        var err;
        await container.stop(err);
        if (err) {
            logger.error("%s: Error stopping %s. Maybe it's not running.", _name, containerId);
        } else {
            logger.info("%s: Stopped container %s.", _name, containerId);
        }
    } catch (e) {
        throw e;
    }
};

/**
 * Gets the newest running container by it's group id.
 * @param id
 * @returns {Promise}
 **/
exports.getNewestContaierByGroupID = async function(id) {
    const listOpts = {
        all: true,
        filters: {
            label: ['auto-deployed=true',
                'group-id=' + id]
        }
    };
    const docker = exports.Docker.getInstance();

    try {
        let containers = await docker.listContainers(listOpts);

        // Workaround for docker. They don't support filter by name.
        let result = null;
        for (const i in containers) {
            const container = containers[i];
            if (result === null) {
                result = container;
            } else if (result.Created < container.Created) {
                result = container;
            }
        }
        return result;
    } catch (e) {
        throw e;
    }
}
