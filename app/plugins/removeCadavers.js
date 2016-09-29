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

        var exitedContainers = await(getCadavers());

        for(var i in exitedContainers) {
            var container = exitedContainers[i];

            scaler.removeContainer(container.Id);
            logger.info("Removed exited container %s.", container.Id);
        }

        helper.Timer.add(function () {
            checkCadavers()
        }, scaler.config.removeCadavers.checkInterval * 1000);
    });

    var getCadavers = function() {
        return new Promise(function(resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    status: ["exited"],
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

    if(scaler.config.removeCadavers.enabled) {
        checkCadavers();
    }
};

removeCadavers.pluginName = "removeCadavers";

module.exports = removeCadavers;