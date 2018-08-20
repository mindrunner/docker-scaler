'use strict';

const
    helper = require('../src/helper'),
    util = require('util'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance(),
    interval = [];

const removeCadavers = function (scaler) {

    const getDanglingImages = async function () {
        logger.info("%s: getDanglingImages", removeCadavers.pluginName);
        const listOpts = {
            all: true,
            filters: {
                dangling: ['true']
            }
        };

        try {
            return await docker.listImages(listOpts);
        } catch (e) {
            throw e;
        }
    };

    const getNonRunningByState = async function (state) {
        logger.info("%s: getNonRunningByState", removeCadavers.pluginName);
        const listOpts = {
            all: true,
            filters: {
                status: [state],
                label: [
                    'auto-deployed',
                    'data-container'
                ]
            }
        };


        try {
            let containers = await docker.listContainers(listOpts);
            const result = [];
            for (const i in containers) {
                const container = containers[i];
                // Don't remove data-containers
                if (container.Labels['data-container'] === 'true') {
                    logger.info("Found a non-running data-container %s, searching for newer revision", container.Id);
                    try {
                        logger.info("Looking for the most recent conrainer with group-id %s", container.Labels['group-id']);
                        const newestContainer = await scaler.getNewestContainerByGroupId(container.Labels['group-id']);
                        if (newestContainer.Id !== container.Id) {
                            const dependendContainers = await getDependendContainers(container.Mounts);
                            if (dependendContainers.length === 0) {
                                result.push(container);
                            } else {
                                logger.debug("dependencies:");
                                logger.debug(util.inspect(dependendContainers, {showHidden: false, depth: null}))
                                logger.info("Container %s has dependencies, not removing", container.Id);
                            }
                        } else {
                            logger.info("No newer containers found.");
                        }
                    } catch (err) {
                        logger.error("%s: Couldn't get dependent containers: %s", removeCadavers.pluginName, err);
                    }
                } else {
                    result.push(container);
                }
            }
            return result;
        } catch (e) {
            throw e;
        }
    };

    const getDanglingVolumes = async function () {
        logger.info("%s: getDanglingVolumes", removeCadavers.pluginName);
        const listOpts = {
            all: true,
            filters: {
                dangling: ['true']
            }
        };

        try {
            let volumes = docker.listVolumes(listOpts);
            // strange behavior in docker api. volumes list is a list in a list.
            return volumes.Volumes;
        } catch (e) {
            throw e;
        }
    };

    const getDependendContainers = async function (mounts) {
        logger.info("%s: getDependendContainers", removeCadavers.pluginName);
        let mount;
        // only saving mount ids for easier comparing.
        const mountIds = [];
        for (let i in mounts) {
            mount = mounts[i];
            mountIds.push(mount.Name);
        }

        try {
            let containers = await scaler.getAllRunningContainers();
            const result = [];
            for (let i in containers) {
                const container = containers[i];

                for (const j in container.Mounts) {
                    mount = container.Mounts[j];

                    if (mountIds.indexOf(mount.Name) !== -1) {
                        result.push(container);
                    }
                }
            }
            return result;
        } catch (e) {
            throw e;
        }
    };

    const uniqueArray = (xs) => {
        return xs.filter((x, i) => {
            return xs.indexOf(x) === i
        })
    };

    const defaultConfig = {
        enabled: false,
        checkInterval: 30,
        removeDanglingImages: true,
        removeDanglingVolumes: true
    };
    scaler.config.removeCadavers = Object.assign(defaultConfig, scaler.config.removeCadavers);

    const checkCadavers = async function () {
        logger.debug("%s: Searching cadavers...", removeCadavers.pluginName);

        let cadavers = [];
        let created = await getNonRunningByState('created');
        let exited = await getNonRunningByState('exited');
        let dead = await getNonRunningByState('dead');

        logger.info("%s: Found %i created contianers", removeCadavers.pluginName, created.length);
        logger.info("%s: Found %i exited contianers", removeCadavers.pluginName, exited.length);
        logger.info("%s: Found %i dead contianers", removeCadavers.pluginName, dead.length);

        cadavers = cadavers.concat(created, exited, dead);
        cadavers = uniqueArray(cadavers);

        logger.info("%s: Found %i candidates for removing", removeCadavers.pluginName, cadavers.length);
        logger.debug(util.inspect(cadavers, {showHidden: false, depth: null}))

        for (let i in cadavers) {
            const container = cadavers[i];
            try {
                logger.debug("%s: Removing container %s.", removeCadavers.pluginName, container.Id);
                await scaler.removeContainer(container);
                logger.info("%s: Removed container %s.", removeCadavers.pluginName, container.Id);
            } catch (err) {
                logger.error("%s: Couldn't remove container Error: %s", removeCadavers.pluginName, err);
            }

            if (container.Labels['data-container'] === 'true') {
                for (const j in container.Mounts) {
                    const mount = container.Mounts[j];
                    try {
                        logger.debug("%s: Removing volume %s.", removeCadavers.pluginName, mount.Name);
                        await scaler.removeVolume(mount.Name);
                        logger.debug("%s: Removed volume %s.", removeCadavers.pluginName, mount.Name);
                    } catch (err) {
                        logger.error("%s: Couldn't remove volume %s. Error: %s", removeCadavers.pluginName, mount.Name, err);
                    }
                }
            }
        }

        if (scaler.config.removeCadavers.removeDanglingImages) {
            const danglingImages = await getDanglingImages();
            for (let i in danglingImages) {
                const image = danglingImages[i];
                try {
                    logger.debug("%s: Removing dangling image %s.", removeCadavers.pluginName, image.Id);
                    await scaler.removeImage(image.Id);
                    logger.debug("%s: Removed dangling image %s.", removeCadavers.pluginName, image.Id);
                } catch (err) {
                    logger.error("%s: Couldn't remove dangling image %s. Error: %s", removeCadavers.pluginName, image.Id, err);
                }
            }
        }

        if (scaler.config.removeCadavers.removeDanglingVolumes) {
            const danglingVolumes = await getDanglingVolumes();

            for (let i in danglingVolumes) {
                const volume = danglingVolumes[i];
                try {
                    logger.debug("%s: Removing dangling volume %s.", removeCadavers.pluginName, volume.Name);
                    await scaler.removeVolume(volume.Name);
                    logger.debug("%s: Removed dangling volume %s.", removeCadavers.pluginName, volume.Name);
                } catch (err) {
                    logger.error("%s: Couldn't remove dangling volume %s. Error: %s", removeCadavers.pluginName, volume.Name, err);
                }
            }
        }

    };

    interval.push(setInterval(function () {
        if (scaler.config.removeCadavers.enabled) {
            checkCadavers();
        }
    }, scaler.config.removeCadavers.checkInterval * 1000));
};

removeCadavers.pluginName = "removeCadavers";
removeCadavers.deinit = function () {
    interval.forEach(function (item) {
        clearInterval(item);
    });
};
module.exports = removeCadavers;