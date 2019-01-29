const Plugin = require('../plugin');
const hookException = require('../exceptions/hook-exception');

class VolumesPlugin extends Plugin {

    constructor(scaler) {
        super("VolumesPlugin", scaler);
    }

    async beforeCreate(config, containerset, containersetConfig) {
        let fsMode;
        for (let i in containerset.volumes) {
            const volume = containerset.volumes[i].split(":"),
                volumeFrom = volume[0],
                volumeTo = volume[1] || null;

            fsMode = volume[2] || "rw";

            if (volumeTo != null) {
                containersetConfig.Volumes[volumeTo] = {};
                containersetConfig.Binds.push(volumeFrom + ":" + volumeTo + ":" + fsMode);
            } else {
                containersetConfig.Volumes[volumeFrom] = {};
            }
        }

        for (let i in containerset.volumesFrom) {
            const volumesFrom = containerset.volumesFrom[i].split(":"),
                groupId = volumesFrom[0];

            fsMode = volumesFrom[1] || "rw";

            const sourceContainer = await helper.getNewestContainerByGroupId(groupId);
            if (sourceContainer == null) {
                throw new hookException("Didn't find data container " + groupId);
            }

            // we need to enable every existing mountpoint of the source container on the target
            for (const j in sourceContainer.Mounts) {
                const mount = sourceContainer.Mounts[j];

                // check if a mountpoint already is in use
                if (containersetConfig.Volumes[mount.Destination] === undefined) {
                    containersetConfig.Volumes[mount.Destination] = {};
                } else {
                    this._logger.warn("%s: Mountpoint %s already exists!", this.getName(), mount.Destination);
                }
            }

            containerConfig.VolumesFrom.push(sourceContainer.Id + ":" + fsMode);
        }
    }

}

module.exports = VolumesPlugin;