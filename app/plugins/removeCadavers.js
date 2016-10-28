'use strict';

const async = require('asyncawait/async'),
    await = require('asyncawait/await'),

    helper = require('../src/helper'),

    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

var removeCadavers = function (scaler) {
    const defaultConfig = {
        enabled: false,
        checkInterval: 30,
        removeDanglingImages: true,
        removeDanglingVolumes: true
    };
    scaler.config.removeCadavers = Object.assign(defaultConfig, scaler.config.removeCadavers);

    var checkCadavers = async(function() {
        logger.debug("Searching cadavers...");

        var cadavers = []
            .concat(await(getNonRunningByState('created')))
            .concat(await(getNonRunningByState('exited')))
            .concat(await(getNonRunningByState('dead')));

        cadavers = uniqueArray(cadavers);

        for(var i in cadavers) {
            var container = cadavers[i];

            try {
                logger.debug("Removing container %s.", image.Id);
                container = await(scaler.removeContainer(container));
                logger.info("Removed container %s.", container.Id);
            } catch(err) {
                logger.error("Couldn't remove container Error: %s", err);
            }

            if(container.Labels['data-container'] == 'true') {
                for (var j in container.Mounts) {
                    var mount = container.Mounts[j];

                    try {
                        logger.debug("Removing volume %s.", mount.Name);
                        await(scaler.removeVolume(mount.Name));
                        logger.info("Removed volume %s.", mount.Name);
                    } catch(err) {
                        logger.error("Couldn't remove volume %s. Error: %s", mount.Name, err);
                    }
                }
            }
        }

        if(scaler.config.removeCadavers.removeDanglingImages) {
            var danglingImages = await(getDanglingImages());

            for(var i in danglingImages) {
                var image = danglingImages[i];

                try {
                    logger.debug("Removing dangling image %s.", image.Id);
                    await(scaler.removeImage(image.Id));
                    logger.info("Removed dangling image %s.", image.Id);
                } catch (err) {
                    logger.warn("Couldn't remove dangling image %s. Error: %s", image.Id, err);
                }
            }
        }

        if(scaler.config.removeCadavers.removeDanglingVolumes) {
            var danglingVolumes = await(getDanglingVolumes());

            for(var i in danglingVolumes) {
                var volume = danglingVolumes[i];

                try {
                    logger.debug("Removing dangling volume %s.", volume.Name);
                    await(scaler.removeVolume(volume.Name));
                    logger.info("Removed dangling volume %s.", volume.Name);
                } catch(err) {
                    logger.warn("Couldn't remove dangling volume %s. Error: %s", volume.Name, err);
                }
            }
        }

        helper.Timer.add(function () {
            checkCadavers()
        }, scaler.config.removeCadavers.checkInterval * 1000);
    });

    var getNonRunningByState = function(state) {
        return new Promise(function(resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    status: [state],
                    label: [
                        'auto-deployed',
                        'data-container'
                    ]
                }
            };
            docker.listContainers(listOpts, async(function(err, containers) {
                if(err) {
                    return reject(err);
                }

                var result = [];
                for(var i in containers) {
                    var container = containers[i];

                    // Don't remove data-containers
                    if(container.Labels['data-container'] == 'true') {
                        try {
                            var newestContainer = await(scaler.getNewestContainerByGroupId(container.Labels['group-id']));

                            if(newestContainer.Id != container.Id) {
                                var dependentContainers = await(getDependentContainers(container.Mounts));
                                if(dependentContainers.length == 0) {
                                    result.push(container); // Not the newest and no dependent containers. Remove.
                                }
                            }
                        } catch(err) {
                            logger.warning("Couldn't get dependent containers: %s", err);
                        }
                    } else {
                        result.push(container);
                    }
                }

                resolve(result);
            }));
        });
    };

    var getDanglingImages = function() {
        return new Promise(function(resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    dangling: ['true']
                }
            };
            docker.listImages(listOpts, function(err, containers) {
                if(err) {
                    return reject(err);
                }

                resolve(containers);
            });
        });
    };

    var getDanglingVolumes = function() {
        return new Promise(function(resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    dangling: ['true']
                }
            };
            docker.listVolumes(listOpts, function(err, volumes) {
                if(err) {
                    return reject(err);
                }

                // strange behavior in docker api. volumes list is a list in a list.
                resolve(volumes.Volumes);
            });
        });
    };

    var getDependentContainers = function(mounts) {
        return new Promise(function(resolve, reject) {
            // only saving mount ids for easier comparing.
            var mountIds = [];
            for(var i in mounts) {
                var mount = mounts[i];
                mountIds.push(mount.Name);
            }
            scaler.getAllRunningContainers().then(function(containers) {
                var result = [];
                for(i in containers) {
                    var container = containers[i];

                    for(var j in container.Mounts) {
                        mount = container.Mounts[j];

                        if(mountIds.indexOf(mount.Name) != -1) {
                            result.push(container);
                        }
                    }
                }
                resolve(result);
            }).catch(function(err) {
                reject(err);
            });
        });
    };

    var uniqueArray = function(xs) {
        return xs.filter(function(x, i) {
            return xs.indexOf(x) === i
        })
    };

    if(scaler.config.removeCadavers.enabled) {
        checkCadavers();
    }
};

removeCadavers.pluginName = "removeCadavers";

module.exports = removeCadavers;