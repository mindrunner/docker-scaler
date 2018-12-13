const
    Plugin = require('../plugin'),
    fs = require('fs'),
    os = require("os"),
    request = require('axios'),
    dns = require('dns'),
    dnsPromises = dns.promises;

class DynamicEnvVariablesPlugin extends Plugin {

    constructor(scaler) {
        super("DynamicEnvVariablesPlugin", scaler);
    }

    static replaceDynamicVariables(dynamicVariables, string) {
        for (const i in dynamicVariables) {
            string = string.replace(i, dynamicVariables[i]);
        }
        return string;
    }

    async getDynamicVariables() {
        let dockerInfo = await this._docker.info();

        const dynamicVariables = {
            "{{SERVER_VERSION}}": dockerInfo.ServerVersion,
            "{{ARCHITECTURE}}": dockerInfo.Architecture,
            "{{HTTP_PROXY}}": dockerInfo.HttpProxy,
            "{{HTTPS_PROXY}}": dockerInfo.HttpsProxy,
        };

        const dnsLookup = async () => {
            let name = "";
            if (fs.existsSync('/.dockerenv')) {
                name = dockerInfo.Name;
            } else {
                name = os.hostname();
            }

            try {

                let result = await dnsPromises.lookup(name);
                this._logger.info("Got IP: " + result.address);
                return result.address;
            } catch (e) {
                throw e;
            }
        };


        const checkIp = async () => {
            try {
                // We need Timeout so we dont take minutes to create containers
                let response = await request.get('http://169.254.169.254/latest/meta-data/local-ipv4',{
                    timeout: 500
                });
                if (response.status === 200) {
                    return response.data;
                } else {
                    return await dnsLookup();
                }
            } catch (e) {
                return await dnsLookup();
            }
        };

        let hostname = "localhost";

        if (fs.existsSync('/.dockerenv')) {
            this._logger.debug("%s: Found docker environment, Hostname: %s", this.getName(), dockerInfo.Name);
            hostname = dockerInfo.Name;
        } else {
            this._logger.debug("%s: Found non-docker environment, Hostname: %s", this.getName(), os.hostname());
            hostname = os.hostname();
        }

        if (hostname.indexOf(".") > -1) {
            dynamicVariables['{{HOST_NAME}}'] = hostname.split('.')[0];
        } else {
            dynamicVariables['{{HOST_NAME}}'] = hostname;
        }

        try {
            dynamicVariables["{{IP}}"] = await checkIp();
        } catch (e) {
            this._logger.error("Could not resolve hostname: %s", e);
        }


        //10.104.132.xxx -> NCSI
        //10.171.160.xxx -> AWS
        //10.171.161.xxx -> AWS
        dynamicVariables["{{PLATFORM}}"] = "unknown"
        if (dynamicVariables["{{IP}}"].indexOf("10.104.132.") > -1) {
            dynamicVariables["{{PLATFORM}}"] = "ncsi"
        }

        if (dynamicVariables["{{IP}}"].indexOf("10.171.160.") > -1) {
            dynamicVariables["{{PLATFORM}}"] = "aws"
        }

        if (dynamicVariables["{{IP}}"].indexOf("10.171.161.") > -1) {
            dynamicVariables["{{PLATFORM}}"] = "aws"
        }

        return dynamicVariables;
    }

    async beforeCreateLate(config, containerset, containersetConfig) {
        const dynamicVariables = await this.getDynamicVariables();

        dynamicVariables['{{CONTAINER_NAME}}'] = containersetConfig.name;

        for (const i in containersetConfig.Env) {
            const env = containersetConfig.Env[i];
            let envKey = env.substr(0, env.indexOf('='));
            let envValue = env.substr(env.indexOf('=') + 1);

            containersetConfig.Env[i] = envKey + "=" + DynamicEnvVariablesPlugin.replaceDynamicVariables(dynamicVariables, envValue);

            // allowing copy of env variables
            for (const j in containersetConfig.Env) {
                const envs = containersetConfig.Env[j];
                envKey = envs.substr(0, envs.indexOf('='));
                envValue = envs.substr(envs.indexOf('=') + 1);
                containersetConfig.Env[i] = containersetConfig.Env[i].replace("{{" + envKey + "}}", envValue);
            }
        }
    }

}

module.exports = DynamicEnvVariablesPlugin;
