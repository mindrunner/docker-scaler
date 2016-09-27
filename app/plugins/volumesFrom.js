'use strict';

const async = require('asyncawait/async'),
    await = require('asyncawait/await'),

    helper = require('../src/helper'),
    docker = helper.Docker.getInstance();

var volumesFrom = async(function(scaler) {

    scaler.hooks.beforeCreate.push(function(config, args) {
        var container = args[1],
            containerConfig = args[2];

        for(var i in container.volumes_from) {
            var volumesFrom = container.volumes_from[i].split(":"),
                containerName = volumesFrom[0],
                fsMode = volumesFrom[1] || "rw";

            container = await(scaler.getContainerByName(containerName));

            containerConfig.VolumesFrom.push(container.Id + ":" + fsMode);
        }
    });
});

volumesFrom.pluginName = "volumesFrom";

module.exports = volumesFrom;