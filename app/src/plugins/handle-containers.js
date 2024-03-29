const
    Plugin = require('../plugin'),
    crypto = require('crypto'),
    hookException = require('../exceptions/hook-exception');

class HandleContainers extends Plugin {

    constructor(scaler) {
        super("HandleContainers", scaler);
        this._defaultContainersetConfig = {
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
    }

    init() {
        super.init();
        const self = this;
        const handleContainers = this._scaler.config.handleContainers;

        this.UpdateConfigData();

        for (const i in handleContainers.containers) {
            const containerset = handleContainers.containers[i]; // = Object.assign(defaultConfig, this.config.handleContainers[i]); // merge default config with the containerset

            this.timerCheckContainer(containerset);
            this._intervals.push(setInterval(function(){self.timerCheckContainer(containerset)}, handleContainers.checkInterval * 1000));
        }
    }

    timerCheckContainer(containerset) {
        if (containerset.isDataContainer) {
            this.spawnDataContainer(containerset);
        } else {
            this.spawnWorkerContainer(containerset);
        }
    }

    async createContainer(containerset) {

        //Default data for a container
        const containersetConfig = {
            Image: containerset.image,
            name: containerset.name || containerset.id + "-" + HandleContainers.generateId(8),
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
            await this.runHooks(containerset, containersetConfig);
            await this.runLateHooks(containerset, containersetConfig);
        } catch (err) {
            if (err instanceof hookException) {
                throw err.message;
            }
            throw err;
        }

        try {
            return await this._docker.createContainer(containersetConfig);
        } catch (err) {
            throw err;
        }
    }

    /**
     * Spawns worker containers based on containerset config
     *
     * @param containerset Object with containerset config
     */
    async spawnWorkerContainer(containerset) {

        try {
            let runningContainers = await this.getContainerByGroupId(containerset.id);
            if (runningContainers.length < containerset.instances) {
                const neededContainers = containerset.instances - runningContainers.length;

                for (let i = 0; i < neededContainers; i++) {
                    try {
                        // we need to wait until the container is running,
                        // to avoid starting to much containers
                        await this.runContainer(containerset);
                    } catch (err) {
                        this._logger.info("%s: %s", this.getName(), err);
                    }
                }
            }
        } catch (e) {
            this._logger.error("%s: Couldn't count running containers: %s", this.getName(), e);

        }
    }

    /**
     * Spawns data container based on containerset config
     *
     * @param containerset Object with containerset config
     */
    async spawnDataContainer(containerset) {

        try {
            let existingContainers = await this.getContainerByGroupId(containerset.id, true);
            this._logger.debug("%s: getContainerByGroupId", this.getName());
            let hasNewestImage = false;

            try {
                this._logger.debug("%s: looking for newest image:", this.getName(), containerset.image);
                const newestImage = await this.getImageByRepoTag(containerset.image);
                if (newestImage == null) {
                    this._logger.debug("%s: no image found for: %s", this.getName(), containerset.image);
                } else {
                    this._logger.debug("%s: found newest image: %s", this.getName(), newestImage);
                    this._logger.debug("%s: enumerating existing containers", this.getName());
                    for (const i in existingContainers) {
                        const existingContainer = existingContainers[i];
                        this._logger.debug("%s: existing container %d: %s", this.getName(), i, existingContainers[i]);
                        this._logger.debug("%s: existingContainer.imageID: %s", this.getName(), existingContainer.ImageID);
                        this._logger.debug("%s: newestImage.Id: %s", this.getName(), newestImage.Id);

                        if (newestImage != null && existingContainer.ImageID === newestImage.Id) {
                            hasNewestImage = true;
                            this._logger.debug("%s: Found a match! Will not spawn new Container!", this.getName());
                        }
                    }
                }
            } catch (err) {
                this._logger.error("%s: Couldn't find newest image: %s", this.getName(), err);
                return;
            }

            if (!hasNewestImage) {
                try {
                    this._logger.info("%s: There is no Data container with most recent image for %s, spaning new one!", this.getName(), containerset.image);
                    // we need to wait until the container is running,
                    // to avoid starting to much containers
                    await this.runContainer(containerset);
                } catch (err) {
                    this._logger.error("%s: %s", this.getName(), err);
                }
            }

        } catch (e) {
            this._logger.error("%s: Couldn't count running containers: %s", this.getName(), e);
        }

    }

    /**
     * Generates an id
     * @param len
     * @returns {string}
     */
    static generateId(len) {
        return crypto.randomBytes(len).toString('hex').substr(len);
    }

    UpdateConfigData() {
        const handleContainers = this._scaler.config.handleContainers;
        this._logger.info("%s: Updating data read from the config file.", this.getName()) ;
        for (const i in handleContainers.containers) {
            const containerset = Object.assign(this._defaultContainersetConfig, handleContainers.containers[i]); // merge default config with current container data.

            containerset.id = i; // object key of containerset is the same as the id.
            //Im Artifactory database, the cass muss be lowercase we could remove next line but it might cause additional execution issue.
            containerset.image = containerset.image.toLocaleLowerCase();

            // add latest tag if no tag is there
            if (containerset.image.split(':').length < 2) {
                containerset.image += ":latest";
            }

            // make sure, the imagename does not contain the implicit docker.io registry host, so that we can later
            // search for both images (with and without host prefix) in getImageByRepoTag. This makes sure we support
            // old (1.10) and new (1.12) docker versions.
            // We keep the next line unless there is a good reason to remove it.
            containerset.image = containerset.image.replace(/^(docker.io\/)/, "");
            handleContainers.containers[i] = Object.assign( {}, containerset);
        }
    }

    async runLateHooks(containerset, containersetConfig) {
        for (const i in this._scaler._beforeCreateLateHook) {
            const plugin = this._scaler._beforeCreateLateHook[i];
            await plugin.beforeCreateLate(this._scaler.config, containerset, containersetConfig);
        }
    }

    async runHooks(containerset, containersetConfig) {
        for (const i in this._scaler._beforeCreateHook) {
            const plugin = this._scaler._beforeCreateHook[i];
            await plugin.beforeCreate(this._scaler.config, containerset, containersetConfig);
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
        all = all || false;

        if (id === undefined || id == null) {
            throw("You need an id.");
        }

        this._logger.debug('%s: Searching containers with id %s', this.getName(), id);

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
            return await this._docker.listContainers(listOpts);
        } catch (e) {
            throw e;
        }
    }

    async runContainer(containerset) {
        containerset = JSON.parse(JSON.stringify(containerset)); // copy variable to stop referencing
        this._logger.info('%s: Starting instance of %s.', this.getName(), containerset.image);

        let newContainer = null;
        try {
            newContainer = await this.createContainer(containerset);
        } catch (err) {
            this._logger.error("%s: Couldn't create %s. Will try in next cycle. Error: %s", this.getName(), containerset.image, err);
            throw err;
        }
        try {
            await this.startContainer(newContainer);
        } catch (err) {
            this._logger.error("%s: Couldn't start %s. Will try in next cycle. Error: %s", this.getName(), containerset.image, err);
            throw err;
        }
    }

    /**
     * Get docker image by repo tag
     * @param repoTag Docker repo tag (e.g. rootlogin/shared:latest)
     * @returns {Promise}
     */
    async getImageByRepoTag(repoTag) {
        try {
            let images = await this._docker.listImages({});
            for (const i in images) {
                const image = images[i];
                this._logger.debug("%s: found image: %s", this.getName(), JSON.stringify(image));
                this._logger.debug("%s: withId: %s", this.getName(), image.Id);
                this._logger.debug("%s: with RepoTags: %s", this.getName(), image.RepoTags);
                if (image.RepoTags != null) {
                    if (image.RepoTags.indexOf(repoTag) !== -1) {
                        this._logger.debug("%s: image %s match found", this.getName(), image.RepoTags);
                        return image;
                    }
                }

                this._logger.debug("%s: image %s does neither match %s nor %s", this.getName(), image.RepoTags, repoTag, repoTag.replace(/^/, 'docker.io\/'));
            }
        } catch (e) {
            this._logger.debug("%s: error listing images:", this.getName(), e);
            throw e;
        }
    }

    async startContainer(container) {
        try {
            await container.start();
            this._logger.info("%s, Container %s was started.", this.getName(), container.id);
        } catch (e) {
            this._logger.error("%s, Container %s could not be started.", this.getName(), container.id);
            throw e;
        }
    }

}

module.exports = HandleContainers;