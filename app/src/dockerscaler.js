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
            ports: [],
            restart: true
        };

        this.config = Object.assign(this.defaultConfig, config);
        this.plugins = {};
        this.hooks = {
            beforeCreate : [],
            beforeCreateLate : []
        };

        logger.level = this.config.logLevel;
        cleanup.Cleanup(this.cleanup);
    }

    init() {
        var self = this;

        async(function() {
            // Spawning the first time;

            for (var i in self.config.containers) {
                var defaultConfig = JSON.parse(JSON.stringify(self.defaultContainerConfig)), // copy the variables, otherwise they are referenced
                    container = JSON.parse(JSON.stringify(self.config.containers[i]));
                container = Object.assign(defaultConfig, container); // merge default config with

                await(self.spawnContainer(container));
            }
        })();
    }

    spawnContainer(container) {
        var self = this;

        return new Promise(function(resolve, reject) {
            var runningContainers = await(self.getContainersByImage(container.image));

            if(container.name != undefined) {
                var runningContainer = await(self.getContainerByName(container.name));
                if(runningContainer != undefined) {
                    await(self.stopContainer(runningContainer.Id));
                    await(self.removeContainer(runningContainer.Id));
                }

                container.instances = 1; //only allow 1 container.
            } else {
                logger.debug('Found %j %s containers.', runningContainers.length, container.image);
            }

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

            if(container.restart) {
                helper.Timer.add(async(function () {
                    await(self.spawnContainer(container));
                }), self.config.scaleInterval * 1000);
            }

            resolve();
        });
    }

    runContainer(container) {
        var self = this;
        container = JSON.parse(JSON.stringify(container)); // copy variable to stop referencing

        logger.info('Starting instance of %s.', container.image);
        if(container.pull) {
            await(pullContainer());
        }
        var newContainer = await(createContainer());
        await(startContainer(newContainer));

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
                name: container.name || 'container-' + self.generateId(8),
                Labels: {'auto-deployed': 'true'},
                Binds: container.volumes,
                Env: container.env,
                PortBindings: {},
                Privileged: container.privileged || false,
                VolumesFrom: []
            };

            return new Promise(function(resolve, reject) {
                self.runHook('beforeCreate', container, containerConfig);
                self.runHook('beforeCreateLate', container, containerConfig);

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
            all: 1,
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

    getContainersByImage(image) {
        logger.debug('Searching instances of %s.', image);

        // Only search for auto-deployed containers
        var listOpts = {
            filters: {
                status: ['running'],
                label: ['auto-deployed']
            }
        };

        return new Promise(function(resolve, reject) {
            docker.listContainers(listOpts, function (err, containers) {
                if(err) {
                    return reject(err);
                }

                var containerList = [];
                for (var i in containers) {
                    var container = containers[i];

                    if (container.Image == image) {
                        containerList.push(container);
                    }
                }

                resolve(containerList);
            });
        });
    }

    getContainerByName(name) {
        var listOpts = {
            all: true,
            filters: {
                name: [ name ],
                label: ['auto-deployed']
            }
        };

        return new Promise(function(resolve, reject) {
            docker.listContainers(listOpts, function(err, containers) {
                if(err) {
                    return reject(err);
                }

                // Workaround for old docker. They don't support filter by name.
                for(var i in containers) {
                    var container = containers[i];

                    if(container.Names.indexOf("/" + name) != -1) {
                        return resolve(container);
                    }
                }

                resolve(null);
            })
        });
    }

    getDockerInfo() {
        return new Promise(function(resolve, reject) {
            docker.info(function(err, data) {
                if(err) {
                    return reject(err);
                }

                resolve(data);
            });
        });
    }

    stopContainer(id) {
        return new Promise(function(resolve, reject) {
            var container = docker.getContainer(id);

            container.stop(function(err) {
                if(err && err.statusCode != 304) {
                    return reject(err);
                }

                resolve();
            })
        });
    }

    killContainer(id) {
        return new Promise(function(resolve, reject) {
            var container = docker.getContainer(id);

            container.kill(function(err) {
                if(err && err.statusCode != 304) {
                    return reject(err);
                }

                resolve();
            })
        });
    }

    removeContainer(id) {
        return new Promise(function(resolve, reject) {
            var container = docker.getContainer(id);

            container.remove(function(err) {
                if(err) {
                    return reject(err);
                }

                resolve();
            })
        });
    }

    loadPlugin(plugin) {
        logger.info("Found " + plugin.pluginName + " plugin...");
        this.plugins[plugin.pluginName] = plugin(this);
    }

    runHook(hook) {
        var args = Array.prototype.slice.call(arguments);

        for(var i in this.hooks[hook]) {
            this.hooks[hook][i](this.config, args);
        }
    }

    generateId(len) {
        return crypto.randomBytes(len).toString('hex').substr(len);
    }
}

exports.DockerScaler = DockerScaler;
