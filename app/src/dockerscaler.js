'use strict';

const crypto = require('crypto'),
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
            autoPullInterval: 0, // Auto-pull for new images all seconds, set 0 to disable.
            containers: [],
            logLevel: 'info',
            minPort: 40000, //settings for random ports
            maxPort: 50000
        };

        this.defaultContainerConfig = {
            image: null,
            instances: 0,
            volumes: []
        };

        this.config = Object.assign(this.defaultConfig, config);
        this.runningPulls = [];
        logger.level = this.config.logLevel;
        cleanup.Cleanup(this.cleanup);
        this.init();
    }

    init() {
        var _this = this;

        // Spawning the first time;
        for (var i in this.config.containers) {
            _this.spawnContainer(this.config.containers[i]);
        }

        if (this.config.maxAge > 0) {
            this.watchContainerAge();
        }

        if (this.config.autoPullInterval > 0) {
            helper.Timer.add(function () {
                _this.autoPull();
            }, this.config.autoPullInterval * 1000);
        }
    }

    runContainer(container) {
        var _this = this;

        var containerConfig = {
            Image: container.image,
            Name: 'container-' + this.generateId(8),
            Labels: {'auto-deployed': 'true'},
            Binds: container.volumes
        };

        docker.createContainer(containerConfig, function(err, createdContainer) {
            if(err) {
                logger.error("Error creating instance of %s: %s", containerConfig.Image, err);
                if(err.statusCode == 404) {
                    if(!_this.runningPulls.includes(container.image)) {
                        _this.runningPulls.push(container.image);
                        docker.pull(container.image, function (err, stream) {
                            docker.modem.followProgress(stream, onFinished, onProgress);

                            function onFinished(err, output) {
                                if(err) {
                                    logger.error("Error pulling %s: %s", container.image, err);
                                    return;
                                }
                                _this.runningPulls.splice(_this.runningPulls.indexOf(container.image),1);
                            }

                            function onProgress(event) {
                                if(event.progressDetail != undefined) {
                                    logger.debug('%s: %s (%d/%d)',event.id, event.status, event.progressDetail.current, event.progressDetail.total);
                                } else {
                                    logger.debug('%s: %s',event.id, event.status);
                                }
                            }
                        })
                    }
                }
                return;
            }

            createdContainer.start(function (err, data) {
                if(err) {
                    logger.error("Error starting instance of %s: %s", containerConfig.Image, err);
                    return;
                }
            });
        })
    }

    spawnContainer(container, onFinish) {
        var _this = this;

        container = Object.assign(this.defaultContainerConfig, container);

        this.getContainersByImage(container.image, function (runningContainers) {
            logger.debug('Found %j %s containers.', runningContainers.length, container.image);
            if (runningContainers.length < container.instances) {
                var neededContainers = container.instances - runningContainers.length;

                for (var i = 0; i < neededContainers; i++) {
                    logger.debug("Scaling up %s.", container.image);

                    _this.runContainer(container);

                    /*docker.run(container.image, null, null, containerConfig, null, function (err, data, newContainer) {
                        if (err) {
                            logger.error("Error starting instance of %s: %s", container.image, err);
                        } else {
                            logger.info("Started container %s (%s)", newContainer.id, container.image);
                        }
                    });*/
                }
            } else if (runningContainers.length > container.instances) {
                var overContainers = runningContainers.length - container.instances;

                for (var i = 0; i < overContainers; i++) {
                    logger.debug("Scaling down %s.", container.image);
                    helper.removeContainer(runningContainers.pop().Id);
                }
            }

            helper.Timer.add(function () {
                _this.spawnContainer(container);
            }, _this.config.scaleInterval * 1000);
        });
    }

    watchContainerAge() {
        var _this = this;

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

                if (containerAge > _this.config.maxAge) {
                    logger.info("Container %s is to old (%j seconds). Removing...", container.Names[0], containerAge);
                    helper.removeContainer(container.Id);
                    containersKilled++;
                }

                if(_this.config.slowKill > 0 && containersKilled >= _this.config.slowKill) {
                    logger.debug("Slow kill limit reached, sleeping %j seconds.", _this.config.slowKillWait);

                    helper.Timer.add(function () {
                        _this.watchContainerAge();
                    }, _this.config.slowKillWait * 1000);
                    return; // stop processing
                }
            }

            helper.Timer.add(function () {
                _this.watchContainerAge();
            }, _this.config.ageCheckInterval * 1000);
        });
    }

    autoPull() {
        var _this = this;

        for (var i in this.config.containers) {
            this.pullContainer(this.config.containers[i], null);
        }

        helper.Timer.add(function () {
            _this.autoPull();
        }, this.config.autoPullInterval * 1000)
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

    getRandomOpenPort(port) {

    }
}

exports.DockerScaler = DockerScaler;
