# Scaler

This docker container lets you spawn sibling containers and monitor them. It scales them up or down, depending on your configuration.
Scaler has to run on each host where containers should be scaled; each host may have its individual configuration.

## Dependencies

  * Docker

## Usage

### With docker-compose (recommended)

The easiest way to use this piece of software is `docker-compose`.

  1. Download the compose file and change your settings: `wget https://raw.githubusercontent.com/SchweizerischeBundesbahnen/docker-scaler/master/docker-compose.yml`.
  2. Download the sample configuration and change it according to your needs: `wget -O config.json https://github.com/SchweizerischeBundesbahnen/docker-scaler/raw/master/config/config.dist.json`
  3. Run the container: `docker-compose up -d`
  4. You should see your running containers with `docker ps`.
  
### Without docker-compose

You can also run scaler manually like this: `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v $PWD/config:/opt/docker-autoscale/config schweizerischebundesbahnen/docker-autoscale`

### With wzu-docker:
```
vi /etc/wzu-docker/_scripts/init-compose/scaler-t-config/config/config.json
sudo service scaler-t reinit
```

## Development

* Checkout in IntelliJ
* nodejs-Plugin needed
* needs to have a docker.sock available
* start always with scaler.js as start, WorkingDir is app

## Remote Debug

* using auf inspect
* random-port mappiog in docker.compose
* ssh-tunnelling necessary: ssh -l32279:localhost:32778 ncsi@i90215.sbb.ch //32279 on localhost maps on 32279 on host
* attach to node.sj : choose "switch", set break point and have fun

## Configuration

The configuration has to be made in JSON and needs to be mounted to _/opt/docker-autoscale/config_ as _config.json_.

```
{
   
  "logLevel": "debug", // Loglevel of the scaler.
  
  "handleContainers" : { // Auto create containers
    "checkInterval": 15, // Interval in seconds to check container scaling.
    "containers": { // List of containers to run
      "test-volume": { // the container id
        "pull": true, // auto pull new images
        "image": "xaamin/shared-volume",
        "isDataContainer": true // enables the data volume handling
      },
      "webserver": { // the container id
        "pull": true,
        "image": "httpd:latest", // Image to run.
        "name" : "test-volume", // Allows you to set a dedictated name, but only for one instance.
        "instances": 5, // Amount of instances to run.
        "volumes": ["/tmp:/var/www/"] // List of volumes to mount.
        "volumesFrom": ["test-volume:ro"], //Use volumes from other images, use the container id.
        "env": ["HELLO=WORLD"], // Environment variables 
        "randomPorts": [80, 443], // List of randomports to open
        "randomPort": false, // open a dedictated random port
        "restart": true // auto restart containers
      }
    }
  },
  "removeIdleJenkinsSlaves": { // auto-remove container nodes from jenkins ci
      "enabled": true,
      "jenkinsMaster": "https://ci.example.com",
      "username": "myuser",
      "password": "mypass",
      "checkInterval": 30, //seconds
      "maxAge": 600 // maximum Age in seconds after container gets marked for deletion.
    },
    "removeCadavers": { // auto remove exited containers
      "enabled": false,
      "checkInterval": 30, // seconds,
      "removeDanglingImages": true,
      "removeDanglingVolumes": true
    },
    "auth": { // authentication on docker hub
      "serveraddress": "https://index.docker.io/v1",
      "username": "myuser",
      "password": "mypass",
      "email": "my@email.ch"
    }
}
```

# Architecture

The following section is based on the handover from Lukas, 4th december.
Each scaler is able to handle multiple images. It is possible to run multiple scaler as long as the image-ids are disjunct.
Examples are TSS where the multiple scalers are running on, all with the same configuration as on AWS.
One scaler is only able to handle slaves for one master, not because of the spawning but because of the lookup if a job is currently running before switch off.

## Entrypoint

Entrypoint pro forma is scaler.js, which invokes the docker-scaler.js.

### docker-scaler.js

* Loading: First, it loads all plugins in the plugins-folder in the init-method. It stores the plugins in an array allowing clean decommissioning (deinit)
* Starting Container afterwards
* several utility method for interacting with docker from the plugins

### plugin.js and implementing classes

* plugin.js: Interface acting as as superclass for all plugins offering invocation of all plugins. All plugins muss inherit this class.
* All implementing classes offer some disjunct functionality like e.g. deregistering slaves from the master, assigning random port, etc.
* some plugins are used just as hooks (beforeCreate, beforeCreateLate in assign-random-port and dynamic-env-variables)
* other plugins are continuously invoked. The timer is set in the init-method (for example in image-pull, remove-cadavers, remove-idle-jenkins-slaves)