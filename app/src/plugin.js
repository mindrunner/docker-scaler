const helper = require('./helper');

class Plugin {

    constructor(name, scaler) {
        this._name = name;
        this._scaler = scaler;
        this._logger = helper.Logger.getInstance();
        this._docker = helper.Docker.getInstance();
        this._intervals = [];

    }

    getName() {
        return this._name;
    }

    init() {
        const self = this;
        this._intervals.push(setInterval(function () {
            self._logger.info("%s: Plugin heartbeat.", self.getName());
        }, 60000));
        this._scaler._beforeCreateHook.push(this);
        this._scaler._beforeCreateLateHook.push(this);
    }

    deinit() {
        this._intervals.forEach(function(item) {
            clearInterval(item);
        });
    }

    async beforeCreate(config, containerset, containersetConfig) {

    }

   async beforeCreateLate(config, containerset, containersetConfig) {

    }
}

module.exports = Plugin;