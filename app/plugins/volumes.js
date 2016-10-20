'use strict';

const async = require('asyncawait/async'),
    await = require('asyncawait/await'),

    helper = require('../src/helper'),
    hookException = require('../src/exceptions/hookException'),

    logger = helper.Logger.getInstance();

var volumes = async(function (scaler) {
    scaler.hooks.beforeCreate.push(function (config, args) {
        var container = args[1],
            containerConfig = args[2];

        var fsMode;
        for(var i in container.volumes) {
            var volume = container.volumes[i].split(":"),
                volumeFrom = volume[0],
                volumeTo = volume[1] || null;

            fsMode = volume[2] || "rw";

            if(volumeTo != null) {
                containerConfig.Volumes[volumeTo] = {};
                containerConfig.Binds.push(volumeFrom + ":" + volumeTo + ":" + fsMode);
            } else {
                containerConfig.Volumes[volumeFrom] = {};
            }
        }

        for(i in container.volumesFrom) {
            var volumesFrom = container.volumesFrom[i].split(":"),
                groupId = volumesFrom[0];

            fsMode = volumesFrom[1] || "rw";

            var sourceContainer = await(scaler.getNewestContainerByGroupId(groupId));
            if(sourceContainer == null) {
                throw new hookException("Didn't found data container " + groupId);
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