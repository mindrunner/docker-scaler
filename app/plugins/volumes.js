'use strict';

const
    helper = require('../src/helper'),
    hookException = require('../src/exceptions/hookException'),
    logger = helper.Logger.getInstance();

const volumes = function (scaler) {
    scaler.hooks.beforeCreate.push(async function (config, args) {
        const container = args[1],
            containerConfig = args[2];

        let fsMode;
        for (let i in container.volumes) {
            const volume = container.volumes[i].split(":"),
                volumeFrom = volume[0],
                volumeTo = volume[1] || null;

            fsMode = volume[2] || "rw";

            if (volumeTo != null) {
                containerConfig.Volumes[volumeTo] = {};
                containerConfig.Binds.push(volumeFrom + ":" + volumeTo + ":" + fsMode);
            } else {
                containerConfig.Volumes[volumeFrom] = {};
            }
        }

        for (let i in container.volumesFrom) {
            const volumesFrom = container.volumesFrom[i].split(":"),
                groupId = volumesFrom[0];

            fsMode = volumesFrom[1] || "rw";

            const sourceContainer = await scaler.getNewestContainerByGroupId(groupId);
            if (sourceContainer == null) {
                throw new hookException("Didn't find data container " + groupId);
            }

            // we need to enable every existing mountpoint of the source container on the target
            for (const j in sourceContainer.Mounts) {
                const mount = sourceContainer.Mounts[j];

                // check if a mountpoint already is in use
                if (containerConfig.Volumes[mount.Destination] === undefined) {
                    containerConfig.Volumes[mount.Destination] = {};
                } else {
                    logger.warn("%s: Mountpoint %s already exists!", volumes.pluginName, mount.Destination);
                }
            }

            containerConfig.VolumesFrom.push(sourceContainer.Id + ":" + fsMode);
        }
    });
};

volumes.pluginName = "volumes";

module.exports = volumes;