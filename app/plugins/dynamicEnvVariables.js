'use strict';

const fs = require('fs'),
    helper = require('../src/helper'),
    os = require("os"),
    request = require('request-promise-native'),
    dns = require('dns'),
    dnsPromises = dns.promises,
    logger = helper.Logger.getInstance();


const dynamicEnvVariablesPlugin = function (scaler) {

    scaler.hooks.beforeCreateLate.push(function (config, args) {
        const
            containerConfig = args[2],
            dynamicVariables = getDynamicVariables();

        dynamicVariables['{{CONTAINER_NAME}}'] = containerConfig.name;

        for (const i in containerConfig.Env) {
            const env = containerConfig.Env[i];
            let envKey = env.substr(0, env.indexOf('='));
            let envValue = env.substr(env.indexOf('=') + 1);

            containerConfig.Env[i] = envKey + "=" + replaceDynamicVariables(dynamicVariables, envValue);

            // allowing copy of env variables
            for (const j in containerConfig.Env) {
                const envs = containerConfig.Env[j];
                envKey = envs.substr(0, envs.indexOf('='));
                envValue = envs.substr(envs.indexOf('=') + 1);
                containerConfig.Env[i] = containerConfig.Env[i].replace("{{" + envKey + "}}", envValue);
            }
        }
    });

    function replaceDynamicVariables(dynamicVariables, string) {
        for (const i in dynamicVariables) {
            string = string.replace(i, dynamicVariables[i]);
        }

        return string;
    }

    function getDynamicVariables() {
        const dockerInfo = async () => {
            return await scaler.getDockerInfo()
        };
        const dynamicVariables = {
            "{{SERVER_VERSION}}": dockerInfo.ServerVersion,
            "{{ARCHITECTURE}}": dockerInfo.Architecture,
            "{{HTTP_PROXY}}": dockerInfo.HttpProxy,
            "{{HTTPS_PROXY}}": dockerInfo.HttpsProxy,
        };

        const options = {
            uri: 'http://169.254.169.254/latest/meta-data/local-ipv4',
            resolveWithFullResponse: true,
            timeout: 1000
        };

        const dnsLookup = async (name) => {
            return dnsPromises.lookup(name)
                .then((result) => {
                    logger.info("Got IP: " + result.address);
                    return result.address;
                }).catch((err) => {
                    throw err;
                });
        };

        const checkIp = async () => {
            return request(options).then((response) => {
                if (response.statusCode === 200) {
                    return response.body;
                } else {
                    if (fs.existsSync('/.dockerenv')) {
                        logger.info("trying to resolve IP with hostname from dockerinfo");
                        return dnsLookup(dockerInfo.Name);
                    } else {
                        logger.info("trying to resolve IP with hostname");
                        return dnsLookup(os.hostname());
                    }
                }
            }).catch(() => {
                if (fs.existsSync('/.dockerenv')) {
                    logger.info("trying to resolve IP with hostname from dockerinfo");
                    return dnsLookup(dockerInfo.Name);
                } else {
                    logger.info("trying to resolve IP with hostname");
                    return dnsLookup(os.hostname());
                }
            });
        };

        let hostname = "localhost";

        if (fs.existsSync('/.dockerenv')) {
            logger.debug("Found docker environment, Hostname: %s", dockerInfo.Name);
            hostname = dockerInfo.Name;
        } else {
            logger.debug("Found non-docker environment, Hostname: %s", os.hostname());
            hostname = os.hostname();
        }

        if(hostname.indexOf(".") > -1) {
            dynamicVariables['{{HOST_NAME}}'] = hostname.split('.')[0];
        } else {
            dynamicVariables['{{HOST_NAME}}'] = hostname;
        }

        try {
            dynamicVariables["{{IP}}"] = async () => {
                await checkIp()
            };
        } catch (e) {
            logger.error("Could not resolve hostname: %s", e);
        }
        return dynamicVariables;
    }
};

dynamicEnvVariablesPlugin.pluginName = "dynamicEnvVariables";

module.exports = dynamicEnvVariablesPlugin;
