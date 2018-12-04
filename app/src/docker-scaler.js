const
    crypto = require('crypto'),
    cleanup = require('./cleanup'),
    helper = require('./helper'),
    fs = require('fs'),
    path = require('path'),
    Plugin = require('./plugin'),

    hookException = require('./exceptions/hook-exception'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance(),
    interval = [];

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
            Ulimits: null,
            MemorySwap: 0,
            NetworkMode: "bridge",
            CpuPercent: 80,
            ExtraHosts: []
        };

        this.config = Object.assign(this.defaultConfig, config);
        this.plugins = [];

        this._beforeCreateHook = [];
        this._beforeCreateLateHook = [];


        logger.level = this.config.logLevel;
        logger.debug("%s: %s", this.pluginName, JSON.stringify(this.config));


        cleanup.Cleanup(this, this.config);
    }

    /**
     * Initializes the scaler and starts all services the first time
     */
    init() {
        const self = this;

        const plugins = fs.readdirSync(path.resolve(__dirname, "plugins"));
        for (const i in plugins) {
            const PluginImpl = require("./plugins/" + plugins[i]);
            if (PluginImpl.prototype instanceof Plugin) {
                const plugin = new PluginImpl(this);
                logger.info("Found new Plugin: %s", plugin.getName());
                this.loadPlugin(plugin);
            }
        }
        for (const i in this.config.containers) {
            const
                defaultConfig = JSON.parse(JSON.stringify(this.defaultContainersetConfig)), // copy the variables, otherwise they are referenced
                containerset = this.config.containers[i] = Object.assign(defaultConfig, this.config.containers[i]); // merge default config with the containerset

            containerset.id = i; // object key of containerset is the same as the id.
            //TODO: Remove This
            containerset.image = containerset.image.toLocaleLowerCase();

            // add latest tag if no tag is there
            if (containerset.image.split(':').length < 2) {
                containerset.image += ":latest";
            }

            // make sure, the imagename does not contain the implicit docker.io registry host, so that we can later
            // search for both images (with and without host prefix) in getImageByRepoTag. This makes sure we support
            // old (1.10) and new (1.12) docker versions.
            //TODO: Remove
            containerset.image = containerset.image.replace(/^(docker.io\/)/, "");

            if (containerset.isDataContainer) {
                self.spawnDataContainer(containerset);
            } else {
                self.spawnWorkerContainer(containerset);
            }


            interval.push(setInterval(function () {
                if (containerset.isDataContainer) {
                    self.spawnDataContainer(containerset);
                } else {
                    self.spawnWorkerContainer(containerset);
                }
            }, self.config.scaleInterval * 1000));
        }
    }

    /**
     * Spawns worker containers based on containerset config
     *
     * @param containerset Object with containerset config
     */
    async spawnWorkerContainer(containerset) {
        const self = this;
        try {
            let runningContainers = await this.getContainerByGroupId(containerset.id);
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
        } catch (e) {
            logger.error("%s: Couldn't count running containers: %s", this.pluginName, e);

        }


    }

    /**
     * Spawns data container based on containerset config
     *
     * @param containerset Object with containerset config
     */
    async spawnDataContainer(containerset) {
        const self = this;

        try {
            let existingContainers = await this.getContainerByGroupId(containerset.id, true);
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

        } catch (e) {
            logger.error("%s: Couldn't count running containers: %s", self.pluginName, e);
        }

    }


    async runContainer(containerset) {
        const self = this;

        containerset = JSON.parse(JSON.stringify(containerset)); // copy variable to stop referencing
        logger.info('%s: Starting instance of %s.', this.pluginName, containerset.image);

        let newContainer = null;
        try {
            newContainer = await self.createContainer(containerset);
        } catch (err) {
            logger.error("%s: Couldn't create %s. Will try in next cycle. Error: %s", self.pluginName, containerset.image, err);
            throw err;
        }
        try {
            await self.startContainer(newContainer);
        } catch (err) {
            logger.error("%s: Couldn't start %s. Will try in next cycle. Error: %s", self.pluginName, containerset.image, err);
            throw err;
        }
    }

    async createContainer(containerset) {
        const self = this;

        //TODO: Non-redundant defaults
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
            Ulimits: containerset.Ulimits || null,
            Binds: [],
            Volumes: {},
            VolumesFrom: [],
            ExtraHosts: containerset.ExtraHosts
        };

        try {
            await self.runHooks(containerset, containersetConfig);
            await self.runLateHooks(containerset, containersetConfig);
        } catch (err) {
            if (err instanceof hookException) {
                throw err.message;
            }
            throw err;
        }

        try {
            return await docker.createContainer(containersetConfig);
        } catch (err) {
            throw err;
        }
    }

    async startContainer(container) {
        const self = this;
        try {
            await container.start();
            logger.info("%s, Container %s was started.", self.pluginName, container.id);
        } catch (e) {
            logger.error("%s, Container %s could not be started.", self.pluginName, container.id);
            throw e;
        }
    }

    /**
     * Get all containers from a set.
     *
     * @param id string Id of the container group
     * @param all boolean show non-running containers too.
     * @returns {Promise}
     */
    async getContainerByGroupId(id, all) {
        const self = this;
        all = all || false;

        if (id === undefined || id == null) {
            throw("You need an id.");
        }

        logger.debug('%s: Searching containers with id %s', self.pluginName, id);

        const listOpts = {
            all: all,
            filters: {
                label: ['auto-deployed=true',
                    'group-id=' + id]
            }
        };

        if (!all) {
            listOpts.filters.status = ['running'];
        }

        try {
            return await docker.listContainers(listOpts);
        } catch (e) {
            throw e;
        }
    }

    /**
     * Get docker image by repo tag
     * @param repoTag Docker repo tag (e.g. rootlogin/shared:latest)
     * @returns {Promise}
     */
    async getImageByRepoTag(repoTag) {
        const self = this;
        try {
            let images = await docker.listImages({});
            for (const i in images) {
                const image = images[i];
                logger.debug("%s: found image: %s", self.pluginName, JSON.stringify(image));
                logger.debug("%s: withId: %s", self.pluginName, image.Id);
                logger.debug("%s: with RepoTags: %s", self.pluginName, image.RepoTags);
                if (image.RepoTags != null) {
                    if (image.RepoTags.indexOf(repoTag) !== -1) {
                        logger.debug("%s: image %s match found", self.pluginName, image.RepoTags);
                        return image;
                    }
                }

                logger.debug("%s: image %s does neither match %s nor %s", self.pluginName, image.RepoTags, repoTag, repoTag.replace(/^/, 'docker.io\/'));
            }
        } catch (e) {
            logger.debug("%s: error listing images:", self.pluginName, e);
            throw e;
        }
    }

    /**
     * Gets the newest running container by it's group id.
     * @param id
     * @returns {Promise}
     */
    async getNewestContainerByGroupId(id) {
        const listOpts = {
            all: true,
            filters: {
                label: ['auto-deployed=true',
                    'group-id=' + id]
            }
        };

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

    async getDataContainers() {
        const listOpts = {
            all: true,
            filters: {
                label: [
                    'auto-deployed=true',
                    'data-container=true'
                ]
            }
        };

        try {
            return await docker.listContainers(listOpts);
        } catch (e) {
            throw e;
        }
    }

    async getAllRunningContainers() {
        const listOpts = {
            filters: {
                status: ['running'],
                label: ['auto-deployed=true']
            }
        };
        return await docker.listContainers(listOpts);
    }

    async getDockerInfo() {
        return await docker.info();
    }

    async stopContainer(id) {
        const container = docker.getContainer(id);
        try {
            await container.stop({});
        } catch (e) {
            if (e.statusCode !== 304) {
                throw e;
            }
        }
    }

    async killContainer(id) {
        const container = docker.getContainer(id);
        try {
            await container.kill({});
        } catch (e) {
            if (e.statusCode !== 304) {
                throw e;
            }
        }
    }

    async removeContainer(id) {
        let container = docker.getContainer(id); //@TODO Check null
        await container.remove({});
        return container;
    }

    async removeVolume(name) {
        const volume = docker.getVolume(name);
        await volume.remove({});
        return name;
    }

    async removeImage(name) {
        const image = docker.getImage(name);
        await image.remove({});
        return name;
    }

    async inspectContainer(id) {
        const container = docker.getContainer(id);
        return await container.inspect({});
    }

    loadPlugin(plugin) {
        logger.info("%s: Loading %s plugin...", this.pluginName, plugin.getName());
        plugin.init();
        this.plugins.push(plugin);
    }

    unloadPlugin(plugin) {
        logger.info("%s: Unloading %s plugin...", this.pluginName, plugin.getName());
        try {
            plugin.deinit();
        } catch (e) {
            logger.error("Deinitialization of Plugin %s failed", plugin.getName());
        }
    }

    async runHooks(containerset, containersetConfig) {
        for (const i in this._beforeCreateHook) {
            const plugin = this._beforeCreateHook[i];
            await plugin.beforeCreate(this.config, containerset, containersetConfig);
        }
    }

    async runLateHooks(containerset, containersetConfig) {
        for (const i in this._beforeCreateLateHook) {
            const plugin = this._beforeCreateLateHook[i];
            await plugin.beforeCreateLate(this.config, containerset, containersetConfig);
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


    deinit() {
        const self = this;
        this.plugins.forEach(function (item) {
            self.unloadPlugin(item)
        });

        interval.forEach(function (item) {
            clearInterval(item);
        });
    }
}

module.exports = DockerScaler;
