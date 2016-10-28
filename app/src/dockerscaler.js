'use strict';

const fs = require('fs'),
    crypto = require('crypto'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),

    cleanup = require('./cleanup'),
    helper = require('./helper'),
    hookException = require('./exceptions/hookException'),

    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

class DockerScaler {

    constructor(config) {
        this.defaultConfig = {
            maxAge: 0, // Max age in seconds after a container should get killed, set 0 to disable
            scaleInterval: 10, // Interval in seconds, to check if enough instances are running
            pullInterval: 10, // Interval between pulls in seconds.
            ageCheckInterval: 30, // Interval in seconds to check if the age of the running instances
            slowKill: 1, // Amount of containers that get killed at once, if they are to old. Set 0 to disable.
            slowKillWait: 10, // Time in seconds to wait after slowKill, limit was reached. (should be shorter than ageCheckInterval)
            containers: {},
            logLevel: 'info',
            minPort: 40000, //settings for random ports
            maxPort: 50000,
            auth: {}
        };

        this.defaultContainersetConfig = {
            pull: true,
            image: null,
            instances: 0,
            volumes: [],
            env: [],
            ports: [],
            restart: true,
            volumesFrom: [],
            isDataContainer: false
        };

        this.config = Object.assign(this.defaultConfig, config);
        this.plugins = {};
        this.hooks = {
            beforeCreate : [],
            beforeCreateLate : []
        };

        logger.level = this.config.logLevel;
        logger.debug(this.config);
        cleanup.Cleanup(this.config);
    }

    /**
     * Initializes the scaler and starts all services the first time
     */
    init() {
        for (var i in this.config.containers) {
            var defaultConfig = JSON.parse(JSON.stringify(this.defaultContainersetConfig)), // copy the variables, otherwise they are referenced
                containerset = JSON.parse(JSON.stringify(this.config.containers[i]));
            containerset = Object.assign(defaultConfig, containerset); // merge default config with the containerset
            containerset.id = i; // object key of containerset is the same as the id.
            containerset.image = containerset.image.toLocaleLowerCase();

            // add latest tag if no tag is there
            if(containerset.image.split(':').length < 2) {
                containerset.image += ":latest";
            }

            // docker.io will be removed from the image string, because docker does that too.
            containerset.image = containerset.image.replace(/^(docker.io\/)/,"");

            if(containerset.isDataContainer) {
                this.spawnDataContainer(containerset);
            } else {
                this.spawnWorkerContainer(containerset);
            }
        }
    }

    /**
     * Spawns worker containers based on containerset config
     *
     * @param containerset Object with containerset config
     */
    spawnWorkerContainer(containerset) {
        var self = this;

        this.getContainerByGroupId(containerset.id).then(async(function(runningContainers) {
            if (runningContainers.length < containerset.instances) {
                var neededContainers = containerset.instances - runningContainers.length;

                for (var i = 0; i < neededContainers; i++) {
                    try {
                        // we need to wait until the container is running,
                        // to avoid starting to much containers
                        await(self.runContainer(containerset));
                    } catch(err) {
                        logger.warn(err);
                    }
                }
            }
        })).catch(function(err) {
            logger.error("Couldn't count running containers: %s", err);
        }).then(function() {
            // restart process when finished
            helper.Timer.add(function () {
                self.spawnWorkerContainer(containerset);
            }, self.config.scaleInterval * 1000);
        });
    }

    /**
     * Spawns data container based on containerset config
     *
     * @param containerset Object with containerset config
     */
    spawnDataContainer(containerset) {
        var self = this;

        this.getContainerByGroupId(containerset.id, true).then(async(function(existingContainers) {
            var hasNewestImage = false;

            try {
                var newestImage = await(self.getImageByRepoTag(containerset.image));
            } catch(err) {
                logger.error("Couldn't get newest image: %s", err);
                return;
            }

            for(var i in existingContainers) {
                var existingContainer = existingContainers[i];

                if(newestImage != null && existingContainer.ImageID == newestImage.Id) {
                    hasNewestImage = true
                }
            }

            if (!hasNewestImage) {
                try {
                    // we need to wait until the container is running,
                    // to avoid starting to much containers
                    await(self.runContainer(containerset));
                } catch(err) {
                    logger.warn(err);
                }
            }
        })).catch(function(err) {
            logger.error("Couldn't count running containers: %s", err);
        }).then(function() {
            // restart process when finished
            helper.Timer.add(function () {
                self.spawnDataContainer(containerset);
            }, self.config.scaleInterval * 1000);
        });
    }


    runContainer(containerset) {
        var self = this;

        containerset = JSON.parse(JSON.stringify(containerset)); // copy variable to stop referencing
        logger.info('Starting instance of %s.', containerset.image);

        return new Promise(function(resolve, reject) {
            self.createContainer(containerset).then(function(newContainer) {
                self.startContainer(newContainer).then(function() {
                    resolve(newContainer);
                }).catch(function(err) {
                    logger.error("Couldn't start %s. Will try in next cycle. Error: %s", containerset.image, err);
                    reject(err);
                });
            }).catch(function(err) {
                logger.warn("Couldn't create %s. Will try in next cycle. Error: %s", containerset.image, err);
                reject(err);
            });
        });
    }

    createContainer(containerset) {
        var self = this;

        return new Promise(function(resolve, reject) {
            var containersetConfig = {
                Image: containerset.image,
                name: containerset.name || containerset.id + "-" + self.generateId(8),
                Labels: {
                    'auto-deployed': 'true',
                    'source-image': containerset.image,
                    'group-id': containerset.id,
                    'data-container': containerset.isDataContainer.toString()
                },
                Env: containerset.env,
                PortBindings: {},
                ExposedPorts: {},
                Privileged: containerset.privileged || false,
                Binds: [],
                Volumes: {},
                VolumesFrom: []
            };

            // Workaround for old versions of scaler @TODO remove when not needed anymore
            if(containerset.isDataContainer) {
                containersetConfig.Labels['norestart'] = 'true';
            }

            try {
                self.runHook('beforeCreate', containerset, containersetConfig);
                self.runHook('beforeCreateLate', containerset, containersetConfig);
            } catch(err) {
                if(err instanceof hookException) {
                    return reject(err.message);
                }

                return reject(err);
            }

            docker.createContainer(containersetConfig, function(err, newContainer) {
                if(err) {
                    return reject(err);
                }

                resolve(newContainer);
            });
        });
    }

    startContainer(container) {
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

    /**
     * Get all containers from a set.
     *
     * @param id string Id of the container group
     * @param all boolean show non-running containers too.
     * @returns {Promise}
     */
    getContainerByGroupId(id, all) {
        all = all || false;

        return new Promise(function(resolve, reject) {
            if(id == undefined || id == null) {
                return reject("You need an id.");
            }

            logger.debug('Searching containers with id %s', id);

            // Only search for auto-deployed containers
            var listOpts = {
                all: all,
                filters: {
                    label: ['auto-deployed']
                }
            };

            if(!all) {
                // we need to hide non-running containers
                listOpts.filters.status = ['running'];
            }

            docker.listContainers(listOpts, function (err, containers) {
                if(err) {
                    return reject(err);
                }

                var containerList = [];
                for (var i in containers) {
                    var container = containers[i];

                    if (container.Labels['group-id'] != undefined && container.Labels['group-id'] == id) {
                        containerList.push(container);
                    }
                }

                resolve(containerList);
            });
        });
    }

    /**
     * Get docker image by repo tag
     * @param repoTag Docker repo tag (e.g. rootlogin/shared:latest)
     * @returns {Promise}
     */
    getImageByRepoTag(repoTag) {
        return new Promise(function(resolve, reject) {
            docker.listImages({},function(err, images) {
                if(err) {
                    return reject(err);
                }

                // Workaround for docker. They don't support filter by repotag.
                for(var i in images) {
                    var image = images[i];

                    if(image.RepoTags != null && image.RepoTags.indexOf(repoTag) != -1) {
                        // we found the image, stop and resolve promise
                        return resolve(image);
                    }
                }

                // we didn't found anything, null
                resolve(null);
            });
        });
    }

    /**
     * Gets the newest running container by it's group id.
     * @param id
     * @returns {Promise}
     */
    getNewestContainerByGroupId(id) {
        return new Promise(function(resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    label: ['auto-deployed']
                }
            };

            docker.listContainers(listOpts,function(err, containers) {
                if(err) {
                    return reject(err);
                }

                // Workaround for docker. They don't support filter by name.
                var result = null;
                for(var i in containers) {
                    var container = containers[i];

                    if(container.Labels['group-id'] != undefined && container.Labels['group-id'] == id) {
                        if(result === null) {
                            result = container;
                        } else if(result.Created < container.Created) {
                            result = container;
                        }
                    }
                }

                resolve(result);
            });
        });
    }

    getDataContainers() {
        return new Promise(function(resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    label: [
                        'auto-deployed',
                        'data-container'
                    ]
                }
            };

            docker.listContainers(listOpts,function(err, containers) {
                if(err) {
                    return reject(err);
                }

                // Workaround for docker. They don't support filter by label value.
                var result = [];
                for(var i in containers) {
                    var container = containers[i];

                    if(container.Labels['data-container'] == 'true') {
                        result.push(container);
                    }
                }

                resolve(result);
            });
        });
    }

    getAllRunningContainers() {
        var listOpts = {
            filters: {
                status: ['running'],
                label: ['auto-deployed']
            }
        };

        return new Promise(function(resolve, reject) {
            docker.listContainers(listOpts, function(err, containers) {
                if(err) {
                    return reject(err);
                }

                resolve(containers);
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

    removeContainer(container) {
        return new Promise(function(resolve, reject) {
            var container = docker.getContainer(container.Id); //@TODO Check null

            container.remove(function(err) {
                if(err) {
                    return reject(err);
                }
                resolve(container);
            })
        });
    }

    removeVolume(name) {
        return new Promise(function(resolve, reject) {
            var volume = docker.getVolume(name);

            volume.remove({}, function(err) {
                if(err) {
                    reject(err, name);
                }

                resolve(name);
            });
        });
    }

    removeImage(name) {
        return new Promise(function(resolve, reject) {
            var image = docker.getImage(name);

            image.remove({}, function(err) {
                if(err) {
                    reject(err, name);
                }

                resolve(name);
            });
        });
    }

    inspectContainer(id) {
        return new Promise(function(resolve, reject) {
            var container = docker.getContainer(id);

            container.inspect(function(err, data) {
                if(err) {
                    return reject(err);
                }

                resolve(data);
            })
        });
    }

    loadPlugin(plugin) {
        logger.info("Found " + plugin.pluginName + " plugin...");
        this.plugins[plugin.pluginName] = new plugin(this);
    }

    runHook(hook) {
        var args = Array.prototype.slice.call(arguments);

        for(var i in this.hooks[hook]) {
            this.hooks[hook][i](this.config, args);
        }
    }

    /**
     * Special trim function that allows you to trim a string,
     * that it only has numbers and chars at the beginning and end.
     *
     * @param str String to trim
     * @returns {*} Trimmed string
     */
    trim(str) {
        var regex = /[a-zA-Z0-9]/;

        while(!regex.test(str.charAt(0))) {
            str = str.slice(1);

        }

        while(!regex.test(str.charAt(str.length - 1))){
            str = str.slice(0, -1);
        }

        return str;
    }

    /**
     * Generates an id
     * @param len
     * @returns {string}
     */
    generateId(len) {
        return crypto.randomBytes(len).toString('hex').substr(len);
    }
}

exports.DockerScaler = DockerScaler;
