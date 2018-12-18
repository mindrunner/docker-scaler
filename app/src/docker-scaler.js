const
    cleanup = require('./cleanup'),
    helper = require('./helper'),
    fs = require('fs'),
    path = require('path'),
    Plugin = require('./plugin'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

class DockerScaler {

    constructor(config) {
        this._name = "scaler";

        this.defaultConfig = {
            maxAge: 0, // Max age in seconds after a container should get killed, set 0 to disable
            pullInterval: 1800, // Interval between pulls in seconds.
            ageCheckInterval: 30, // Interval in seconds to check if the age of the running instances
            slowKill: 1, // Amount of containers that get killed at once, if they are to old. Set 0 to disable.
            slowKillWait: 10, // Time in seconds to wait after slowKill, limit was reached. (should be shorter than ageCheckInterval)
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
        logger.debug("%s: %s", this._name, JSON.stringify(this.config));

        cleanup.Cleanup(this, this.config);
    }

    /**
     * Initializes the scaler and starts all services the first time
     */
    init() {
        const self = this;
        const handelContainers = this.config.handleContainers;

        //Read config file and update required infromations
        for (const i in handelContainers.containers) {
            const
                defaultConfig = JSON.parse(JSON.stringify(this.defaultContainersetConfig)), // copy the variables, otherwise they are referenced
                containerset = handelContainers.containers[i] = Object.assign(defaultConfig, handelContainers.containers[i]); // merge default config with the containerset

            containerset.id = i; // object key of containerset is the same as the id.
            //TODO: Remove This - Is there any specific ground to remove the line which make the image name in lowercase?
            //Im Artifactory database from what I have seen the cass is insensitive and it gives mor  Es gibt more freedom at user level to recude errors when a capital letter is entered by mistakes.
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
        }

        //Load plugins
        const plugins = fs.readdirSync(path.resolve(__dirname, "plugins"));
        for (const i in plugins) {
            const PluginImpl = require("./plugins/" + plugins[i]);
            if (PluginImpl.prototype instanceof Plugin) {
                const plugin = new PluginImpl(this);
                logger.info("%s: Found new Plugin: %s",  this._name, plugin.getName());
                this.loadPlugin(plugin);
            }
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

    loadPlugin(plugin) {
        logger.info("%s: Loading %s plugin...", this._name, plugin.getName());
        plugin.init();
        this.plugins.push(plugin);
    }

    unloadPlugin(plugin) {
        logger.info("%s: Unloading %s plugin...", this._name, plugin.getName());
        try {
            plugin.deinit();
        } catch (e) {
            logger.error("%s: Deinitialization of Plugin %s failed", this._name ,  plugin.getName());
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

    deinit() {
        const self = this;
        this.plugins.forEach(function (item) {
            self.unloadPlugin(item)
        });

    }
}

module.exports = DockerScaler;
