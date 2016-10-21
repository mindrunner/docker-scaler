'use strict';

const fs = require('fs'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),
    os = require("os");

var dynamicEnvVariablesPlugin = async(function (scaler) {
    scaler.hooks.beforeCreateLate.push(function (config, args) {
        var container = args[1],
            containerConfig = args[2],
            dynamicVariables = getDynamicVariables();

        dynamicVariables['{{CONTAINER_NAME}}'] = containerConfig.name;

        for (var i in containerConfig.Env) {
            var env = containerConfig.Env[i];
            var envKey = env.substr(0, env.indexOf('='));
            var envValue = env.substr(env.indexOf('=') + 1);

            containerConfig.Env[i] = envKey + "=" + replaceDynamicVariables(dynamicVariables, envValue);

            // allowing copy of env variables
            for (var j in containerConfig.Env) {
                var envs = containerConfig.Env[j];
                var envKey = envs.substr(0, envs.indexOf('='));
                var envValue = envs.substr(envs.indexOf('=') + 1);
                containerConfig.Env[i] = containerConfig.Env[i].replace("{{" + envKey + "}}", envValue);
            }
        }
    });

    function replaceDynamicVariables(dynamicVariables, string) {
        for (var i in dynamicVariables) {
            string = string.replace(i, dynamicVariables[i]);
        }

        return string;
    }

    function getDynamicVariables() {
        var dockerInfo = await(scaler.getDockerInfo());
        var dynamicVariables = {
            "{{SERVER_VERSION}}": dockerInfo.ServerVersion,
            "{{ARCHITECTURE}}": dockerInfo.Architecture,
            "{{HTTP_PROXY}}": dockerInfo.HttpProxy,
            "{{HTTPS_PROXY}}": dockerInfo.HttpsProxy
        };

        if (fs.existsSync('/.dockerenv')) {
            dynamicVariables['{{HOST_NAME}}'] = dockerInfo.Name.split('.')[0];
        } else {
            dynamicVariables['{{HOST_NAME}}'] = os.hostname().split('.')[0];
        }

        return dynamicVariables;
    }
});

dynamicEnvVariablesPlugin.pluginName = "dynamicEnvVariables";

module.exports = dynamicEnvVariablesPlugin;