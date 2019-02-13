const
    Plugin = require('../plugin'),
    helper = require('../helper'),
    util = require('util');

class RemoveCadaversPlugin extends Plugin {

    constructor(scaler) {
        super("RemoveCadaversPlugin", scaler);

        this._defaultConfig = {
            enabled: false,
            checkInterval: 30,
            removeDanglingImages: true,
            removeDanglingVolumes: true
        };

        this._scaler.config.removeCadavers = Object.assign(this._defaultConfig, this._scaler.config.removeCadavers);
        const self = this;

        if (self._scaler.config.removeCadavers.enabled) {
            this._intervals.push(setInterval(function () {
                self.checkCadavers();
            }, self._scaler.config.removeCadavers.checkInterval * 1000));
        }
    }

    async getDanglingImages() {
        this._logger.info("%s: getDanglingImages", this.getName());
        const listOpts = {
            all: true,
            filters: {
                dangling: ['true']
            }
        };

        try {
            return await this._docker.listImages(listOpts);
        } catch (e) {
            throw e;
        }
    };

   async getNonRunningByState(state, id) {
        this._logger.info("%s: getNonRunningByState", this.getName());
        const listOpts = {
            all: true,
            filters: {
                status: [state],
                    label: ['auto-deployed=true',
                        'group-id=' + id]
            }
        };


        try {
            let containers = await this._docker.listContainers(listOpts);
            const result = [];
            for (const i in containers) {
                const container = containers[i];
                // Don't remove data-containers
                if (container.Labels['data-container'] === 'true') {
                    this._logger.info("Found a non-running data-container %s, searching for newer revision", container.Id);
                    try {
                        this._logger.info("Looking for the most recent conrainer with group-id %s", container.Labels['group-id']);
                        const newestContainer = await helper.getNewestContainerByGroupId(container.Labels['group-id']);
                        if (newestContainer.Id !== container.Id) {
                            const dependendContainers = await this.getDependendContainers(container.Mounts);
                            if (dependendContainers.length === 0) {
                                result.push(container);
                            } else {
                                this._logger.debug("dependencies:");
                                this._logger.debug(util.inspect(dependendContainers, {showHidden: false, depth: null}))
                                this._logger.info("Container %s has dependencies, not removing", container.Id);
                            }
                        } else {
                            this._logger.info("No newer containers found.");
                        }
                    } catch (err) {
                        this._logger.error("%s: Couldn't get dependent containers: %s", this.getName(), err);
                    }
                } else {
                    result.push(container);
                }
            }
            return result;
        } catch (e) {
            throw e;
        }
    };

   async getDanglingVolumes() {
       this._logger.info("%s: getDanglingVolumes", this.getName());

       const listOpts = {
           all: true,
           filters: {
               dangling: ['true']
           }
       };

       try {
           let volumes = this._docker.listVolumes(listOpts);
           // strange behavior in docker api. volumes list is a list in a list.
           return volumes.Volumes;
       } catch (e) {
           throw e;
       }
    };

   async getDependendContainers(mounts) {
       this._logger.info("%s: getDependendContainers", this.getName());
       let mount;
       // only saving mount ids for easier comparing.
       const mountIds = [];
       for (let i in mounts) {
           mount = mounts[i];
           mountIds.push(mount.Name);
       }

       try {
           let containers = await this.getAllRunningContainers();
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
       } catch (e) {
           throw e;
       }
    };

   uniqueArray(xs)  {
       return xs.filter((x, i) => {
           return xs.indexOf(x) === i
       })
   };

   async checkCadavers() {
       this._logger.debug("%s: Searching cadavers...", this.getName());

       let cadavers = [];

       for (const i in this._scaler.config.handleContainers.containers) {
           const id = this._scaler.config.handleContainers.containers[i].id;
           let created = await this.getNonRunningByState('created', id);
           let exited = await this.getNonRunningByState('exited', id);
           let dead = await this.getNonRunningByState('dead', id);

           this._logger.info("%s: Found %i created %s containers", this.getName(), created.length, id);
           this._logger.info("%s: Found %i exited %s containers", this.getName(), exited.length, id);
           this._logger.info("%s: Found %i dead %s containers", this.getName(), dead.length, id);

           cadavers = cadavers.concat(created, exited, dead);
           cadavers = this.uniqueArray(cadavers);
       }

       this._logger.info("%s: Found %i candidates for removing", this.getName(), cadavers.length);
       this._logger.debug(util.inspect(cadavers, {showHidden: false, depth: null}));

       for (let i in cadavers) {
           const container = cadavers[i];
           try {
               this._logger.debug("%s: Removing container %s.", this.getName(), container.Id);
               await helper.removeContainer(container.Id);
               this._logger.info("%s: Removed container %s.", this.getName(), container.Id);
           } catch (err) {
               this._logger.error("%s: Couldn't remove container Error: %s", this.getName(), err);
           }

           if (container.Labels['data-container'] === 'true') {
               for (const j in container.Mounts) {
                   const mount = container.Mounts[j];
                   try {
                       this._logger.debug("%s: Removing volume %s.", this.getName(), mount.Name);
                       await this.removeVolume(mount.Name);
                       this._logger.debug("%s: Removed volume %s.", this.getName(), mount.Name);
                   } catch (err) {
                       this._logger.error("%s: Couldn't remove volume %s. Error: %s", this.getName(), mount.Name, err);
                   }
               }
           }
       }

       if (this._scaler.config.removeCadavers.removeDanglingImages) {
           const danglingImages = await this.getDanglingImages();
           for (let i in danglingImages) {
               const image = danglingImages[i];
              try {
                   this._logger.debug("%s: Removing dangling image %s.", this.getName(), image.Id);
                   await this.removeImage(image.Id);
                   this._logger.debug("%s: Removed dangling image %s.", this.getName(), image.Id);
              } catch (err) {
                   this._logger.error("%s: Couldn't remove dangling image %s. Error: %s", this.getName(), image.Id, err);
               }
           }
       }

       if (this._scaler.config.removeCadavers.removeDanglingVolumes) {
           const danglingVolumes = await this.getDanglingVolumes();

           for (let i in danglingVolumes) {
               const volume = danglingVolumes[i];
               try {
                   this._logger.debug("%s: Removing dangling volume %s.", this.getName(), volume.Name);
                   await this.removeVolume(volume.Name);
                   this._logger.debug("%s: Removed dangling volume %s.", this.getName(), volume.Name);
               } catch (err) {
                   this._logger.error("%s: Couldn't remove dangling volume %s. Error: %s", this.getName(), volume.Name, err);
               }
           }
       }
   };

   async getAllRunningContainers() {
       const listOpts = {
           filters: {
               status: ['running'],
               label: ['auto-deployed=true']
          }
       };
       return await this._docker.listContainers(listOpts);
   }

   async removeVolume(name) {
       const volume = this._docker.getVolume(name);
       await volume.remove({});
       return name;
   }

   async removeImage(name) {
       const image = this._docker.getImage(name);
       await image.remove({});
       return name;
   }
}

module.exports = RemoveCadaversPlugin;