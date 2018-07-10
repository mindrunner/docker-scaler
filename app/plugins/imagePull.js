'use strict';

const
    helper = require('../src/helper'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

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

        for (const i in this.scaler.config.containers) {
            const containerset = this.scaler.config.containers[i];
            this.pullContainerset(containerset);
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
                let image = await this.pullImage(containerset.image);
                logger.info("%s: Successfully pulled %s.", self.pluginName, image);
                helper.Timer.add(function () {
                    self.pullContainerset(containerset);
                }, self.scaler.config.pullInterval * 1000);
                return image;
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

        if (self.scaler.config.auth !== {}) {
            pullOpts.authconfig = self.scaler.config.auth;
        }
        logger.info("%s: Pulling image: %s", self.pluginName, image);

        const stream = await docker.pull(image, pullOpts);
        stream.on('data', (data) => logger.debug(data));
        stream.on('end', () => logger.info(`End pulling ${image}`));
    }
}

imagePull.pluginName = "imagePull";

module.exports = imagePull;