# Scaler

This docker container lets you spawn sibling containers and monitor them. It scales them up or down, depending on your configuration.

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

## Configuration

```javascript
{
  "scaleInterval": 15, // Interval in seconds to check container scaling.
  
  "maxAge": 0, // Defines the maximum age of a container in seconds, set 0 to disable.  
  "ageCheckInterval": 30, // Interval in seconds to check age of containers.
  
  "slowKill": 1, // Maximum amount of containers to remove at once, if they are to old.
  "slowKillWait": 10, // Wait-time in seconds after reaching the slowKill limit.
  
  "autoPullInterval": 0, // Interval in seconds to pull new images, set 0 to disable
  
  "logLevel": "debug", // Loglevel of the scaler.
  
  "containers": [ // List of containers to run
    {
      "image": "httpd:latest", // Image to run.
      "instances": 5, // Amount of instances to run.
      "volumes": ["/tmp:/var/www/"] // List of volumes to mount.
    }
  ]
}
```