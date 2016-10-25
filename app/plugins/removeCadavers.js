'use strict';

const async = require('asyncawait/async'),
    await = require('asyncawait/await'),

    helper = require('../src/helper'),

    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

// Init function
var removeCadavers;

removeCadavers = function (scaler) {
    const defaultConfig = {
        removeCadavers: {
            enabled: false,
            checkInterval: 30
        }
    };
    scaler.config = Object.assign(defaultConfig, scaler.config);

    var checkCadavers = async(function() {
        logger.debug("Searching cadavers...");

        var cadavers = []
            .concat(await(getNonRunningByState('created')))
            .concat(await(getNonRunningByState('exited')))
            .concat(await(getNonRunningByState('dead')));

        cadavers = uniqueArray(cadavers);

        for(var i in cadavers) {
            var container = cadavers[i];
            scaler.removeContainer(container).then(function(container) {
                if(container.Labels['data-container'] == 'true') {
                    for (var j in container.Mounts) {
                        var mount = container.Mounts[j];
                        scaler.removeVolume(mount.Name).then(function (name) { //@TODO Check null
                            logger.info("Removed volume %s.", name);
                        }).catch(function (err, name) {
                            logger.warn("Couldn't remove volume %s. Error: %s", name, err);
                        });
                    }
                }
            }).catch(function(err) {
                logger.warn("Couldn't remove container Error: %s", err);
            });
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