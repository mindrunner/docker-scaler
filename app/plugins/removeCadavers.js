'use strict';

const
    helper = require('../src/helper'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

const removeCadavers = function (scaler) {

    const getDanglingImages = function () {
        const listOpts = {
            all: true,
            filters: {
                dangling: ['true']
            }
        };
        docker.listImages(listOpts).then((containers) => {
            return containers;
        }).catch((err) => {
            throw err;
        });
    };

    const getNonRunningByState = async function (state) {
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
        docker.listContainers(listOpts).then((containers) => {
            const result = [];
            for (const i in containers) {
                const container = containers[i];
                // Don't remove data-containers
                if (container.Labels['data-container'] === 'true') {
                    try {
                        const newestContainer = async () => {
                            return await scaler.getNewestContainerByGroupId(container.Labels['group-id']);
                        };

                        if (newestContainer.Id !== container.Id) {
                            const dependentContainers = async () => {
                                return await getDependentContainers(container.Mounts);
                            };
                            if (dependentContainers.length === 0) {
                                result.push(container); // Not the newest and no dependent containers. Remove.
                            }
                        }
                    } catch (err) {
                        logger.warning("%s: Couldn't get dependent containers: %s", removeCadavers.pluginName, err);
                    }
                } else {
                    result.push(container);
                }
            }
            return result;
        }).catch((err) => {
            throw err;
        });
    };

    const getDanglingVolumes = function () {
        const listOpts = {
            all: true,
            filters: {
                dangling: ['true']
            }
        };
        docker.listVolumes(listOpts).then((volumes) => {
            // strange behavior in docker api. volumes list is a list in a list.
            return volumes.Volumes;
        }).catch((err) => {
            throw err;
        });
    };

    const getDependentContainers = function (mounts) {
        let mount;
        // only saving mount ids for easier comparing.
        const mountIds = [];
        for (let i in mounts) {
            mount = mounts[i];
            mountIds.push(mount.Name);
        }
        scaler.getAllRunningContainers().then((containers) => {
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
        }).catch((err) => {
            throw err;
        });
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
        cadavers.concat(await getNonRunningByState('created'));
        cadavers.concat(await getNonRunningByState('exited'));
        cadavers.concat(await getNonRunningByState('dead'));

        cadavers = uniqueArray(cadavers);

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
                        logger.info("%s: Removed volume %s.", removeCadavers.pluginName, mount.Name);
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
                    logger.info("%s: Removed dangling image %s.", removeCadavers.pluginName, image.Id);
                } catch (err) {
                    logger.warn("%s: Couldn't remove dangling image %s. Error: %s", removeCadavers.pluginName, image.Id, err);
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
                    logger.info("%s: Removed dangling volume %s.", removeCadavers.pluginName, volume.Name);
                } catch (err) {
                    logger.warn("%s: Couldn't remove dangling volume %s. Error: %s", removeCadavers.pluginName, volume.Name, err);
                }
            }
        }

        helper.Timer.add(function () {
            checkCadavers()
        }, scaler.config.removeCadavers.checkInterval * 1000);
    };

    if (scaler.config.removeCadavers.enabled) {
        checkCadavers();
    }
};

removeCadavers.pluginName = "removeCadavers";

module.exports = removeCadavers;