const Plugin = require('../plugin');

class AssignRandomPortPlugin extends Plugin {

    constructor(scaler) {
        super("AssignRandomPortPlugin", scaler);
    }

    async beforeCreate(config, containerset, containersetConfig) {
        if (containerset.randomPort !== undefined && containerset.randomPort) {
            const randomPort = Math.floor(Math.random() * (config.maxPort - config.minPort + 1) + config.minPort);
            containersetConfig.PortBindings[randomPort + "/tcp"] = [{
                HostIp: "0.0.0.0",
                HostPort: randomPort.toString()
            }];
            containersetConfig.ExposedPorts[randomPort.toString() + "/tcp"] = {};
            containersetConfig.Env.push("RANDOM_PORT=" + randomPort);
        }

        if (containerset.randomPorts !== undefined && Array.isArray(containerset.randomPorts)) {
            for (const i in containerset.randomPorts) {
                const irandomPort = Math.floor(Math.random() * (config.maxPort - config.minPort + 1) + config.minPort);
                const port = containerset.randomPorts[i] + "/tcp";
                containersetConfig.PortBindings[port + "/tcp"] = [{
                    HostIp: "0.0.0.0",
                    HostPort: irandomPort.toString()
                }];
                containersetConfig.ExposedPorts[port + "/tcp"] = {};
                containersetConfig.Env.push("RANDOM_PORT_" + containerset.randomPorts[i] + "=" + irandomPort);
            }
        }
    }
}

module.exports = AssignRandomPortPlugin;