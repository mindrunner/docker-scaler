const Plugin = require('../plugin');

class ImagePullPlugin extends Plugin {

    /**
     * Constructor
     *
     * @param scaler
     */
    constructor(scaler) {
        super("ImagePullPlugin", scaler);
        const self = this;
        for (const i in this._scaler.config.containers) {
            const containerset = self._scaler.config.containers[i];
            if (containerset.pull) {
                self.pullContainerset(containerset);
                this._intervals.push(setInterval(function () {
                    self.pullContainerset(containerset);
                }, self._scaler.config.pullInterval * 1000));
            } else {
                this._logger.info("%s: Pulling disabled for %s", this.getName(), containerset.name);
            }
        }
    }

    /**
     * Pulls a containerset and starts itself again.
     *
     * @param containerset
     */
    async pullContainerset(containerset) {
        const self = this;
        try {
            await this.pullImage(containerset.image);
            this._logger.info("%s: Successfully pulled %s.", this.getName(), containerset.image);
        } catch (e) {
            this._logger.error("%s: Error pulling %s: %s", this.getName(), containerset.image, e);
        }
    }

    /**
     * Pulls the image and returns the id
     *
     * @param image
     * @returns {Promise}
     */
    async pullImage(image) {
        const self = this;

        const pullOpts = {};

        // this._logger.debug(util.inspect(image, {showHidden: false, depth: null}))
        // this._logger.debug(util.inspect(self._scaler.config.auth, {showHidden: false, depth: null}))

        try {
            if (self._scaler.config.auth !== {}) {
                pullOpts.authconfig = self._scaler.config.auth;
                this._logger.info("%s: Pulling image: %s as %s user", this.getName(), image, pullOpts.authconfig.username);
            } else {
                this._logger.info("%s: Pulling image: %s as anonymous user", this.getName(), image);
            }
        } catch (e) {
            this._logger.warn("%s: Something went wrong with the authconfig: %s", this.getName(), e);
        }

        const stream = await this._docker.pull(image, pullOpts);

        stream.on('data', (data) => {
            let event = JSON.parse(data);
            if (event.progressDetail !== undefined
                && event.progressDetail.current !== undefined
                && event.progressDetail.total !== undefined) {
                const percent = Math.round(100 / event.progressDetail.total * event.progressDetail.current);
                this._logger.debug('%s: %s: %s (%d%)', this.getName(), event.id, event.status, percent);
            } else if (event.id !== undefined) {
                this._logger.debug('%s: %s: %s', this.getName(), event.id, event.status);
            } else {
                this._logger.debug('%s: %s', this.getName(), event.status);
            }
        });
        stream.on('end', () => this._logger.info(`End pulling ${image}`));
    }
}

module.exports = ImagePullPlugin;