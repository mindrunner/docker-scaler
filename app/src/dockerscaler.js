'use strict';

const fs = require('fs'),
    crypto = require('crypto'),
    portscanner = require('portscanner'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),

    cleanup = require('./cleanup'),
    helper = require('./helper'),

    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

class DockerScaler {
    constructor(config) {
        this.defaultConfig = {
            maxAge: 0, // Max age in seconds after a container should get killed, set 0 to disable
            scaleInterval: 10, // Interval in seconds, to check if enough instances are running
            ageCheckInterval: 30, // Interval in seconds to check if the age of the running instances
            slowKill: 1, // Amount of containers that get killed at once, if they are to old. Set 0 to disable.
            slowKillWait: 10, // Time in seconds to wait after slowKill, limit was reached. (should be shorter than ageCheckInterval)
            containers: [],
            logLevel: 'info',
            minPort: 40000, //settings for random ports
            maxPort: 50000
        };

        this.defaultContainerConfig = {
            pull: true,
            image: null,
            instances: 0,
            volumes: [],
            env: [],
            ports: []
        };

        this.config = Object.assign(this.defaultConfig, config);

        logger.level = this.config.logLevel;
        cleanup.Cleanup(this.cleanup);
        this.init();
    }

    init() {
        var self = this;

        // Spawning the first time;
        for (var i in this.config.containers) {
            this.spawnContainer(this.config.containers[i]);
        }

        if (this.config.maxAge > 0) {
            this.watchContainerAge();
        }
    }

    spawnContainer(container) {
        var self = this;

        container = Object.assign(this.defaultContainerConfig, container);

        this.getContainersByImage(container.image, function (runningContainers) {
            async(function() {
                logger.debug('Found %j %s containers.', runningContainers.length, container.image);
                if (runningContainers.length < container.instances) {
                    var neededContainers = container.instances - runningContainers.length;

                    for (var i = 0; i < neededContainers; i++) {
                        await(self.runContainer(container));
                    }
                } else if (runningContainers.length > container.instances) {
                    var overContainers = runningContainers.length - container.instances;

                    for (var i = 0; i < overContainers; i++) {
                        logger.info("Scaling down %s.", container.image);
                        helper.removeContainer(runningContainers.pop().Id);
                    }
                }

                helper.Timer.add(function () {
                    self.spawnContainer(container);
                }, self.config.scaleInterval * 1000);
            })();
        });
    }

    runContainer(container) {
        var self = this;

        logger.info('Starting instance of %s.', container.image);

        return async(function() {
            if(container.pull) {
                await(pullContainer());
            }
            var newContainer = await(createContainer());
            await(startContainer(newContainer));
        })();

        // subfunctions
        function pullContainer() {
            logger.info("Pulling %s...",container.image);
            return new Promise(function(resolve, reject) {
                docker.pull(container.image, function (err, stream) {
                    docker.modem.followProgress(stream, onFinished, onProgress);

                    function onFinished(err, output) {
                        if(err) {
                            logger.error("Error pulling %s: %s", container.image, err);
                            return reject(err);
                        }
                        logger.info("Successfully pulled %s.",container.image);
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
                })
            });
        }

        function createContainer() {
            var containerConfig = {
                Image: container.image,
                Hostname: 'container-' + self.generateId(8),
                Labels: {'auto-deployed': 'true'},
                Binds: container.volumes,
                Env: container.env,
                PortBindings: container.ports
            };

            return new Promise(function(resolve, reject) {
                docker.createContainer(containerConfig, function(err, newContainer) {
                    if(err) {
                        return reject(err);
                    }

                    resolve(newContainer);
                });
            });
        }

        function startContainer(container) {
            return new Promise(function(resolve, reject) {
                container.start(null, function(err) {
                    if(err) {
                        return reject(err);
                    }
                    logger.info("Container %s was started.", container.id);
                    resolve();
                });
            });
        }
    }

    watchContainerAge() {
        var self = this;

        // Only search for auto-deployed containers
        var listOpts = {
            filters: {
                label: ['auto-deployed']
            }
        };
        docker.listContainers(listOpts, function (err, containers) {
            var time = Math.round(new Date().getTime() / 1000),
                containersKilled = 0;

            for (var i in containers) {
                var container = containers[i];
                var containerAge = time - container.Created;

                if (containerAge > self.config.maxAge) {
                    logger.info("Container %s is to old (%j seconds). Removing...", container.Names[0], containerAge);
                    helper.removeContainer(container.Id);
                    containersKilled++;
                }

                if(self.config.slowKill > 0 && containersKilled >= self.config.slowKill) {
                    logger.debug("Slow kill limit reached, sleeping %j seconds.", self.config.slowKillWait);

                    helper.Timer.add(function () {
                        self.watchContainerAge();
                    }, self.config.slowKillWait * 1000);
                    return; // stop processing
                }
            }

            helper.Timer.add(function () {
                self.watchContainerAge();
            }, self.config.ageCheckInterval * 1000);
        });
    }

    getContainersByImage(image, onFinish) {
        logger.debug('Searching instances of %s.', image);

        // Only search for auto-deployed containers
        var listOpts = {
            filters: {
                label: ['auto-deployed']
            }
        };
        docker.listContainers(listOpts, function (err, containers) {
            var containerList = [];
            for (var i in containers) {
                var container = containers[i];

                if (container.Image == image) {
                    containerList.push(container);
                }
            }

            onFinish(containerList);
        });
    }

    generateId(len) {
        return crypto.randomBytes(len).toString('hex').substr(len);
    }

    getRandomOpenPort(callback) {
        var self = this,
            host = "127.0.0.1";

        if(fs.existsSync('/.dockerenv')) {
            network.get_gateway_ip(function(err, ip) {
                if(err) {
                    throw new Error("Couldn't get gateway ip: " + err);
                }
                portscanner.findAPortNotInUse(self.config.minPort, self.config.maxPort, host, callback);
            })
        } else {
            portscanner.findAPortNotInUse(self.config.minPort, self.config.maxPort, host, callback);
        }
    }
}

exports.DockerScaler = DockerScaler;
