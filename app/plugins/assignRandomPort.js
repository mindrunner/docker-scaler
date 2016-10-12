'use strict';

const fs = require('fs'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),
    portastic = require('portastic');

var assignRandomPortPlugin = async(function (scaler) {
    scaler.hooks.beforeCreate.push(function (config, args) {
        var container = args[1],
            containerConfig = args[2],
            runningContainers = await(scaler.getDockerInfo()).Containers;

        if (container.randomPort != undefined && container.randomPort) {
            var randomPort = await(portastic.find({
                min: config.minPort + runningContainers,
                max: config.maxPort,
                retrieve: 1
            }));

            containerConfig.PortBindings[randomPort + "/tcp"] = [{
                HostIp: "0.0.0.0",
                HostPort: randomPort.toString()
            }];
            containerConfig.ExposedPorts[randomPort.toString() + "/tcp"] = {};
            containerConfig.Env.push("RANDOM_PORT=" + randomPort);
        }

        if (container.randomPorts != undefined && Array.isArray(container.randomPorts)) {
            var j = 0;
            for (var i in container.randomPorts) {
                var randomPort = await(portastic.find({
                    min: config.minPort + runningContainers + parseInt(i),
                    max: config.maxPort,
                    retrieve: 1
                }));

                var port = container.randomPorts[i] + "/tcp";
                containerConfig.PortBindings[port] = [{
                    HostIp: "0.0.0.0",
                    HostPort: randomPort.toString()
                }];
                containerConfig.ExposedPorts[randomPort.toString() + "/tcp"] = {};
                containerConfig.Env.push("RANDOM_PORT_" + container.randomPorts[i] + "=" + randomPort);
            }
        }
    });
});

assignRandomPortPlugin.pluginName = "assignRandomPort";

module.exports = assignRandomPortPlugin;