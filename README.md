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

## Configuration

The configuration has to be made in JSON and needs to be mounted to _/opt/docker-autoscale/config_ as _config.json_.

```javascript
{
  "scaleInterval": 15, // Interval in seconds to check container scaling.
  
  "logLevel": "debug", // Loglevel of the scaler.
  
  "containers": [ // List of containers to run
    {
      "pull": true, // You can disable image pulling
      "image": "httpd:latest", // Image to run.
      "name" : "test-volume", // Allows you to set a dedictated name, but only for one instance.
      "instances": 5, // Amount of instances to run.
      "volumes": ["/tmp:/var/www/"] // List of volumes to mount.
      "volumes_from": ["test-volume:ro"], //Use volumes from other images, use the container name.
      "env": ["HELLO=WORLD"], // Environment variables 
      "randomPorts": [], // List of randomports to open
      "randomPort": false, // open a dedictated random port
       "restart": true, // auto restart containers
    }
  ],
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
      "checkInterval": 30 // seconds
    },
    "auth": { // authentication on docker hub
      "serveraddress": "https://index.docker.io/v1",
      "username": "myuser",
      "password": "mypass",
      "email": "my@email.ch"
    }
}
```