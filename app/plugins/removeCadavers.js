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

            try {
                scaler.removeContainer(container.Id);
                logger.info("Removed exited container %s.", container.Id);
            } catch(err) {
                logger.error("Couldn't remove container %s: %s", container.Id, err);
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
                    label: ['auto-deployed']
                }
            };
            docker.listContainers(listOpts, function(err, containers) {
                if(err) {
                    return reject(err);
                }

                var result = [];
                for(var i in containers) {
                    if(containers[i].Labels['norestart'] != undefined) {
                        continue;
                    }

                    result.push(containers[i]);
                }

                resolve(result);
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