'use strict';

const
    crypto = require('crypto'),
    cleanup = require('./cleanup'),
    helper = require('./helper'),
    hookException = require('./exceptions/hookException'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

class DockerScaler {

    constructor(config) {
        this.pluginName = "scaler";
        this.defaultConfig = {
            maxAge: 0, // Max age in seconds after a container should get killed, set 0 to disable
            scaleInterval: 10, // Interval in seconds, to check if enough instances are running
            pullInterval: 1800, // Interval between pulls in seconds.
            ageCheckInterval: 30, // Interval in seconds to check if the age of the running instances
            slowKill: 1, // Amount of containers that get killed at once, if they are to old. Set 0 to disable.
            slowKillWait: 10, // Time in seconds to wait after slowKill, limit was reached. (should be shorter than ageCheckInterval)
            containers: {},
            logLevel: 'info',
            minPort: 40000, //settings for random ports
            maxPort: 50000,
            auth: {},
            ExtraHosts: []
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
            isDataContainer: false,
            Memory: 0,
            MemorySwap: 0,
            NetworkMode: "bridge",
            CpuPercent: 80,
            ExtraHosts: []
        };

        this.config = Object.assign(this.defaultConfig, config);
        this.plugins = {};
        this.hooks = {
            beforeCreate: [],
            beforeCreateLate: []
        };


        logger.level = this.config.logLevel;
        logger.debug("%s: %s", this.pluginName, this.config);
        cleanup.Cleanup(this.config);
    }

    /**
     * Initializes the scaler and starts all services the first time
     */
    init() {
        for (const i in this.config.containers) {
            const defaultConfig = JSON.parse(JSON.stringify(this.defaultContainersetConfig)), // copy the variables, otherwise they are referenced
                containerset = this.config.containers[i] = Object.assign(defaultConfig, this.config.containers[i]); // merge default config with the containerset

            containerset.id = i; // object key of containerset is the same as the id.
            containerset.image = containerset.image.toLocaleLowerCase();

            // add latest tag if no tag is there
            if (containerset.image.split(':').length < 2) {
                containerset.image += ":latest";
            }

            // make sure, the imagename does not contain the implicit docker.io registry host, so that we can later
            // search for both images (with and without host prefix) in getImageByRepoTag. This makes sure we support
            // old (1.10) and new (1.12) docker versions.
            containerset.image = containerset.image.replace(/^(docker.io\/)/, "");

            if (containerset.isDataContainer) {
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
        const self = this;
        this.getContainerByGroupId(containerset.id).then(async function (runningContainers) {
            if (runningContainers.length < containerset.instances) {
                const neededContainers = containerset.instances - runningContainers.length;

                for (let i = 0; i < neededContainers; i++) {
                    try {
                        // we need to wait until the container is running,
                        // to avoid starting to much containers
                        await self.runContainer(containerset);
                    } catch (err) {
                        logger.error("%s: %s", self.pluginName, err);
                    }
                }
            }
        }).catch(function (err) {
            logger.error("%s: Couldn't count running containers: %s", this.pluginName, err);
        }).then(function () {
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
        const self = this;

        this.getContainerByGroupId(containerset.id, true).then(async function (existingContainers) {
            logger.debug("%s: getContainerByGroupId", self.pluginName);
            let hasNewestImage = false;

            try {
                logger.debug("%s: looking for newest image:", self.pluginName, containerset.image);
                const newestImage = await self.getImageByRepoTag(containerset.image);
                if (newestImage == null) {
                    logger.debug("%s: no image found for: %s", self.pluginName, containerset.image);
                } else {
                    logger.debug("%s: found newest image: %s", self.pluginName, newestImage);
                    logger.debug("%s: enumerating existing containers", self.pluginName);
                    for (const i in existingContainers) {
                        const existingContainer = existingContainers[i];
                        logger.debug("%s: existing container %d: %s", self.pluginName, i, existingContainers[i]);
                        logger.debug("%s: existingContainer.imageID: %s", self.pluginName, existingContainer.ImageID);
                        logger.debug("%s: newestImage.Id: %s", self.pluginName, newestImage.Id);

                        if (newestImage != null && existingContainer.ImageID === newestImage.Id) {
                            hasNewestImage = true;
                            logger.debug("%s: Found a match! Will not spawn new Container!", self.pluginName);
                        }
                    }
                }
            } catch (err) {
                logger.error("%s: Couldn't find newest image: %s", self.pluginName, err);
                return;
            }

            if (!hasNewestImage) {
                try {
                    logger.info("%s: There is no Data container with most recent image for %s, spaning new one!", self.pluginName, containerset.image);
                    // we need to wait until the container is running,
                    // to avoid starting to much containers
                    await self.runContainer(containerset);
                } catch (err) {
                    logger.error("%s: %s", self.pluginName, err);
                }
            }
        }).catch(function (err) {
            logger.error("%s: Couldn't count running containers: %s", self.pluginName, err);
        }).then(function () {
            // restart process when finished
            helper.Timer.add(function () {
                self.spawnDataContainer(containerset);
            }, self.config.scaleInterval * 1000);
        });
    }


    runContainer(containerset) {
        const self = this;

        containerset = JSON.parse(JSON.stringify(containerset)); // copy variable to stop referencing
        logger.info('%s: Starting instance of %s.', this.pluginName, containerset.image);

        return new Promise(function (resolve, reject) {
            self.createContainer(containerset).then(function (newContainer) {
                self.startContainer(newContainer).then(function () {
                    resolve(newContainer);
                }).catch(function (err) {
                    logger.error("%s: Couldn't start %s. Will try in next cycle. Error: %s", self.pluginName, containerset.image, err);
                    reject(err);
                });
            }).catch(function (err) {
                logger.error("%s: Couldn't create %s. Will try in next cycle. Error: %s", self.pluginName, containerset.image, err);
                reject(err);
            });
        });
    }

    createContainer(containerset) {
        const self = this;

        return new Promise(function (resolve, reject) {
            const containersetConfig = {
                Image: containerset.image,
                name: containerset.name || containerset.id + "-" + DockerScaler.generateId(8),
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
                Memory: containerset.Memory || 0,
                MemorySwap: containerset.MemorySwap || 0,
                CpuPercent: containerset.CpuPercent || 80,
                NetworkMode: containerset.NetworkMode || "bridge",
                Binds: [],
                Volumes: {},
                VolumesFrom: [],
                ExtraHosts: containerset.ExtraHosts
            };

            // Workaround for old versions of scaler @TODO remove when not needed anymore
            if (containerset.isDataContainer) {
                containersetConfig.Labels['norestart'] = 'true';
            }

            try {
                self.runHook('beforeCreate', containerset, containersetConfig);
                self.runHook('beforeCreateLate', containerset, containersetConfig);
            } catch (err) {
                if (err instanceof hookException) {
                    return reject(err.message);
                }

                return reject(err);
            }

            docker.createContainer(containersetConfig, function (err, newContainer) {
                if (err) {
                    return reject(err);
                }

                resolve(newContainer);
            });
        });
    }

    startContainer(container) {
        const self = this;
        return new Promise(function (resolve, reject) {
            container.start(null, function (err) {
                if (err) {
                    return reject(err);
                }
                logger.info("%s, Container %s was started.", self.pluginName, container.id);
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
        const self = this;
        all = all || false;

        return new Promise(function (resolve, reject) {
            if (id === undefined || id == null) {
                return reject("You need an id.");
            }

            logger.debug('%s: Searching containers with id %s', self.pluginName, id);

            // Only search for auto-deployed containers
            const listOpts = {
                all: all,
                filters: {
                    label: ['auto-deployed']
                }
            };

            if (!all) {
                // we need to hide non-running containers
                listOpts.filters.status = ['running'];
            }

            docker.listContainers(listOpts, function (err, containers) {
                if (err) {
                    return reject(err);
                }

                const containerList = [];
                for (const i in containers) {
                    const container = containers[i];

                    if (container.Labels['group-id'] !== undefined && container.Labels['group-id'] === id) {
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
        const self = this;
        return new Promise(function (resolve, reject) {
            docker.listImages({}, function (err, images) {
                if (err) {
                    logger.debug("%s: error listing images:", self.pluginName, err);
                    return reject(err);
                }

                // Workaround for docker. They don't support filter by repotag.
                for (const i in images) {
                    const image = images[i];
                    logger.debug("%s: found image: %s", self.pluginName, image);
                    logger.debug("%s: withId: %s", self.pluginName, image.Id);
                    logger.debug("%s: with RepoTags: %s", self.pluginName, image.RepoTags);
                    if (image.RepoTags != null) {
                        if (image.RepoTags.indexOf(repoTag) !== -1) {
                            // we found the image, stop and resolve promise
                            logger.debug("%s: image %s match found on newer docker version (1.12)", self.pluginName, image.RepoTags);
                            return resolve(image);
                        }
                    }

                    logger.debug("%s: image %s does neither match %s nor %s", self.pluginName, image.RepoTags, repoTag, repoTag.replace(/^/, 'docker.io\/'));
                }

                // we didn't find anything, resolve with null
                //TODO: reject?
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
        return new Promise(function (resolve, reject) {
            const listOpts = {
                all: true,
                filters: {
                    label: ['auto-deployed']
                }
            };

            docker.listContainers(listOpts, function (err, containers) {
                if (err) {
                    return reject(err);
                }

                // Workaround for docker. They don't support filter by name.
                let result = null;
                for (const i in containers) {
                    const container = containers[i];

                    if (container.Labels['group-id'] !== undefined && container.Labels['group-id'] === id) {
                        if (result === null) {
                            result = container;
                        } else if (result.Created < container.Created) {
                            result = container;
                        }
                    }
                }

                resolve(result);
            });
        });
    }

    getDataContainers() {
        return new Promise(function (resolve, reject) {
            const listOpts = {
                all: true,
                filters: {
                    label: [
                        'auto-deployed',
                        'data-container'
                    ]
                }
            };

            docker.listContainers(listOpts, function (err, containers) {
                if (err) {
                    return reject(err);
                }

                // Workaround for docker. They don't support filter by label value.
                let result = [];
                for (const i in containers) {
                    const container = containers[i];

                    if (container.Labels['data-container'] === 'true') {
                        result.push(container);
                    }
                }

                resolve(result);
            });
        });
    }

    getAllRunningContainers() {
        const listOpts = {
            filters: {
                status: ['running'],
                label: ['auto-deployed']
            }
        };

        return new Promise(function (resolve, reject) {
            docker.listContainers(listOpts, function (err, containers) {
                if (err) {
                    return reject(err);
                }

                resolve(containers);
            })
        });
    }

    getDockerInfo() {
        return new Promise(function (resolve, reject) {
            docker.info(function (err, data) {
                if (err) {
                    return reject(err);
                }

                resolve(data);
            });
        });
    }

    stopContainer(id) {
        return new Promise(function (resolve, reject) {
            const container = docker.getContainer(id);

            container.stop(function (err) {
                if (err && err.statusCode !== 304) {
                    return reject(err);
                }

                resolve();
            })
        });
    }

    killContainer(id) {
        return new Promise(function (resolve, reject) {
            const container = docker.getContainer(id);

            container.kill(function (err) {
                if (err && err.statusCode !== 304) {
                    return reject(err);
                }

                resolve();
            })
        });
    }

    removeContainer(container) {
        return new Promise(function (resolve, reject) {
            container = docker.getContainer(container.Id); //@TODO Check null
            container.remove(function (err) {
                if (err) {
                    return reject(err);
                }
                resolve(container);
            })
        });
    }

    removeVolume(name) {
        return new Promise(function (resolve, reject) {
            const volume = docker.getVolume(name);

            volume.remove({}, function (err) {
                if (err) {
                    reject(err, name);
                }

                resolve(name);
            });
        });
    }

    removeImage(name) {
        return new Promise(function (resolve, reject) {
            const image = docker.getImage(name);

            image.remove({}, function (err) {
                if (err) {
                    reject(err, name);
                }

                resolve(name);
            });
        });
    }

    inspectContainer(id) {
        return new Promise(function (resolve, reject) {
            const container = docker.getContainer(id);

            container.inspect(function (err, data) {
                if (err) {
                    return reject(err);
                }

                resolve(data);
            })
        });
    }

    loadPlugin(plugin) {
        logger.info("%s: Found %s plugin...", this.pluginName, plugin.pluginName);
        this.plugins[plugin.pluginName] = new plugin(this);
    }

    runHook(hook) {
        const args = Array.prototype.slice.call(arguments);

        for (const i in this.hooks[hook]) {
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
    static trim(str) {
        const regex = /[a-zA-Z0-9]/;

        while (!regex.test(str.charAt(0))) {
            str = str.slice(1);

        }

        while (!regex.test(str.charAt(str.length - 1))) {
            str = str.slice(0, -1);
        }

        return str;
    }

    /**
     * Generates an id
     * @param len
     * @returns {string}
     */
    static generateId(len) {
        return crypto.randomBytes(len).toString('hex').substr(len);
    }
}

exports.DockerScaler = DockerScaler;
