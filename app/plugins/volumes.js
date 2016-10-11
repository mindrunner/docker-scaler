'use strict';

const async = require('asyncawait/async'),
    await = require('asyncawait/await'),

    helper = require('../src/helper'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

var volumes = async(function (scaler) {
    scaler.hooks.beforeCreate.push(function (config, args) {
        var container = args[1],
            containerConfig = args[2];

        var fsMode;
        for(var i in container.volumes) {
            var volume = container.volumes[i].split(":"),
                volumeFrom = volume[0],
                volumeTo = volume[1];

            fsMode = volume[2] || "rw";

            containerConfig.Volumes[volumeTo] = {};
            containerConfig.Binds.push(volumeFrom + ":" + volumeTo + ":" + fsMode);
        }

        for(i in container.volumes_from) {
            var volumesFrom = container.volumes_from[i].split(":"),
                containerName = volumesFrom[0];

            fsMode = volumesFrom[1] || "rw";

            var sourceContainer = await(scaler.getContainerByName(containerName));
            if(sourceContainer == null) {
                logger.error("Didn't found container %s.", containerName);
                continue;
            }

            for(var j in sourceContainer.Mounts) {
                var mount = sourceContainer.Mounts[j];

                if(containerConfig.Volumes[mount.Destination] != undefined) {
                    logger.warn("Mountpoint %s already exists!", mount.Destination);
                    continue;
                }

                containerConfig.Volumes[mount.Destination] = {};
            }

            containerConfig.VolumesFrom.push(sourceContainer.Id + ":" + fsMode);
        }
    });
});

volumes.pluginName = "volumes";

module.exports = volumes;