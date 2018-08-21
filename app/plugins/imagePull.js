'use strict';

const
    helper = require('../src/helper'),
    util = require('util'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance(),
    interval = [];

/**
 * This plugin allows pulling of images
 */
class imagePull {

    /**
     * Constructor
     *
     * @param scaler
     */
    constructor(scaler) {
        this.scaler = scaler;
        this.pluginName = "imagePull";
        const self = this;

        for (const i in this.scaler.config.containers) {
            interval.push(setInterval(function () {
                const containerset = self.scaler.config.containers[i];
                self.pullContainerset(containerset);
            }, self.scaler.config.pullInterval * 1000));


        }
    }

    /**
     * Pulls a containerset and starts itself again.
     *
     * @param containerset
     */
    async pullContainerset(containerset) {
        const self = this;

        if (containerset.pull) {
            try {
                await this.pullImage(containerset.image);
                logger.info("%s: Successfully pulled %s.", self.pluginName, containerset.image);
            } catch (e) {
                logger.error("%s: Error pulling %s: %s", self.pluginName, containerset.image, e);
            }
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

        // logger.debug(util.inspect(image, {showHidden: false, depth: null}))
        // logger.debug(util.inspect(self.scaler.config.auth, {showHidden: false, depth: null}))

        try {
            if (self.scaler.config.auth !== {}) {
                pullOpts.authconfig = self.scaler.config.auth;
                logger.info("%s: Pulling image: %s as %s user", self.pluginName, image, pullOpts.authconfig.username);
            } else {
                logger.info("%s: Pulling image: %s as anonymous user", self.pluginName, image);
            }
        } catch (e) {
            logger.warn("%s: Something went wrong with the authconfig: %s", self.pluginName, e);
        }

        const stream = await docker.pull(image, pullOpts);

        stream.on('data', (data) => {
            let event = JSON.parse(data);
            if (event.progressDetail !== undefined
                && event.progressDetail.current !== undefined
                && event.progressDetail.total !== undefined) {
                const percent = Math.round(100 / event.progressDetail.total * event.progressDetail.current);
                logger.debug('%s: %s: %s (%d%)', self.pluginName, event.id, event.status, percent);
            } else if (event.id !== undefined) {
                logger.debug('%s: %s: %s', self.pluginName, event.id, event.status);
            } else {
                logger.debug('%s: %s', self.pluginName, event.status);
            }
        });
        stream.on('end', () => logger.info(`End pulling ${image}`));
    }
}

imagePull.pluginName = "imagePull";

imagePull.deinit = function () {
    interval.forEach(function(item) {
        clearInterval(item);
    });
};

module.exports = imagePull;