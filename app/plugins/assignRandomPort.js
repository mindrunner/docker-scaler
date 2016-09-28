'use strict';

const fs = require('fs'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),
    portscanner = require('portscanner');

var assignRandomPortPlugin = async(function (scaler) {
    scaler.hooks.beforeCreate.push(function(config, args) {
        var container = args[1],
            containerConfig = args[2],
            runningContainers = await(scaler.getDockerInfo()).Containers;

        if(container.randomPort != undefined && container.randomPort) {
            var randomPort = await(getRandomOpenPort(config.minPort + runningContainers, config.maxPort));

            containerConfig.PortBindings[randomPort + "/tcp"] = [{
                HostIp: "0.0.0.0",
                HostPort: randomPort.toString()
            }];

            containerConfig.Env.push("RANDOM_PORT=" + randomPort);
        }

        if(container.randomPorts != undefined && Array.isArray(container.randomPorts)) {
            for(var i in container.randomPorts) {
                var extPort = await(getRandomOpenPort(config.minPort + runningContainers, config.maxPort)),
                    port = container.randomPorts[i] + "/tcp";

                containerConfig.PortBindings[port] = [{
                  HostIp: "0.0.0.0",
                  HostPort: extPort.toString()
                }];

                containerConfig.Env.push("RANDOM_PORT" + i + "=" + extPort);
            }
        }
    });

    function getRandomOpenPort(minPort, maxPort) {
        return new Promise(function (resolve, reject) {
            var host = "127.0.0.1";

            if(fs.existsSync('/.dockerenv')) {
                network.get_gateway_ip(function(err, ip) {
                    if(err) {
                        throw new Error("Couldn't get gateway ip: " + err);
                    }
                    portscanner.findAPortNotInUse(minPort, maxPort, host, callback);
                });
            } else {
                portscanner.findAPortNotInUse(minPort, maxPort, host, callback);
            }

            function callback(err, port) {
                if(err) {
                    return reject(err);
                }

                resolve(port);
            }
        });
    }
});

assignRandomPortPlugin.pluginName = "assignRandomPort";

module.exports = assignRandomPortPlugin;