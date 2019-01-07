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
            //pullInterval: 1800, // Interval between pulls in seconds.
            ageCheckInterval: 30, // Interval in seconds to check if the age of the running instances
            slowKill: 1, // Amount of containers that get killed at once, if they are to old. Set 0 to disable.
            slowKillWait: 10, // Time in seconds to wait after slowKill, limit was reached. (should be shorter than ageCheckInterval)
            logLevel: 'info',
            minPort: 40000, //settings for random ports
            maxPort: 50000,
            auth: {},
            ExtraHosts: []
        };

        //Read config file and merge default config with it
        this.config = Object.assign(this.defaultConfig, config);
        this.plugins = [];

        this._beforeCreateHook = [];
        this._beforeCreateLateHook = [];


        logger.level = this.config.logLevel;
        logger.debug("%s: %s", this._name, JSON.stringify(this.config));

        cleanup.Cleanup(this, this.config);
    }

    /// Initializes the scaler and starts all services the first time
    init() {
        const self = this;

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

    deinit() {
        const self = this;
        this.plugins.forEach(function (item) {
            self.unloadPlugin(item)
        });
    }
}

// required to expose the class on the other .js file (scaler.js).
module.exports = DockerScaler;
