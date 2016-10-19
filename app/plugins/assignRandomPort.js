'use strict';

const fs = require('fs'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network');

var assignRandomPortPlugin = async(function (scaler) {
    scaler.hooks.beforeCreate.push(function (config, args) {
        var container = args[1],
            containerConfig = args[2];
        if (container.randomPort != undefined && container.randomPort) {
            var randomPort = Math.floor(Math.random() * (config.maxPort - config.minPort + 1) + config.minPort);
            containerConfig.PortBindings[randomPort + "/tcp"] = [{
                HostIp: "0.0.0.0",
                HostPort: randomPort.toString()
            }];
            containerConfig.ExposedPorts[randomPort.toString() + "/tcp"] = {};
            containerConfig.Env.push("RANDOM_PORT=" + randomPort);
        }

        if (container.randomPorts != undefined && Array.isArray(container.randomPorts)) {
            for (var i in container.randomPorts) {
                var irandomPort = Math.floor(Math.random() * (config.maxPort - config.minPort + 1) + config.minPort);
                var port = container.randomPorts[i] + "/tcp";
                containerConfig.PortBindings[port] = [{
                    HostIp: "0.0.0.0",
                    HostPort: irandomPort.toString()
                }];
                containerConfig.Env.push("RANDOM_PORT_" + container.randomPorts[i] + "=" + irandomPort);
            }
        }
    });
});

assignRandomPortPlugin.pluginName = "assignRandomPort";

module.exports = assignRandomPortPlugin;