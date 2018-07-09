'use strict';

const assignRandomPortPlugin = function (scaler) {
    scaler.hooks.beforeCreate.push(function (config, args) {
        const container = args[1],
            containerConfig = args[2];
        if (container.randomPort !== undefined && container.randomPort) {
            const randomPort = Math.floor(Math.random() * (config.maxPort - config.minPort + 1) + config.minPort);
            containerConfig.PortBindings[randomPort + "/tcp"] = [{
                HostIp: "0.0.0.0",
                HostPort: randomPort.toString()
            }];
            containerConfig.ExposedPorts[randomPort.toString() + "/tcp"] = {};
            containerConfig.Env.push("RANDOM_PORT=" + randomPort);
        }

        if (container.randomPorts !== undefined && Array.isArray(container.randomPorts)) {
            for (const i in container.randomPorts) {
                const irandomPort = Math.floor(Math.random() * (config.maxPort - config.minPort + 1) + config.minPort);
                const port = container.randomPorts[i] + "/tcp";
                containerConfig.PortBindings[port + "/tcp"] = [{
                    HostIp: "0.0.0.0",
                    HostPort: irandomPort.toString()
                }];
                containerConfig.ExposedPorts[port + "/tcp"] = {};
                containerConfig.Env.push("RANDOM_PORT_" + container.randomPorts[i] + "=" + irandomPort);
            }
        }
    });
};

assignRandomPortPlugin.pluginName = "assignRandomPort";

module.exports = assignRandomPortPlugin;