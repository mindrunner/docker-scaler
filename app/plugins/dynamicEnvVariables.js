'use strict';

const fs = require('fs'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),
    os = require("os");

var dynamicEnvVariablesPlugin = function (scaler) {
    scaler.hooks.beforeCreateLate.push(function(config, args) {
        var container = args[1],
            containerConfig = args[2],
            dynamicVariables = JSON.parse(JSON.stringify(dynamicEnvVariablesPlugin.dynamicVariables));

        dynamicVariables['{{CONTAINER_NAME}}'] = containerConfig.name;

        for(var i in containerConfig.Env) {
            var env = containerConfig.Env[i].split("="),
                envKey = env[0],
                envValue = env[1];

            containerConfig.Env[i] = envKey + "=" + replaceDynamicVariables(dynamicVariables, envValue);

            // allowing copy of env variables
            for(var j in containerConfig.Env) {
                var envs = containerConfig.Env[j].split("=");

                containerConfig.Env[i] = containerConfig.Env[i].replace("{{" + envs[0] + "}}", envs[1]);
            }
        }
    });

    function replaceDynamicVariables(dynamicVariables, string) {
        for(var i in dynamicVariables) {
            string = string.replace(i, dynamicVariables[i]);
        }

        return string;
    }
};

dynamicEnvVariablesPlugin.dynamicVariables = {
    "{{HOST_NAME}}": os.hostname()
};

dynamicEnvVariablesPlugin.pluginName = "dynamicEnvVariables";

module.exports = dynamicEnvVariablesPlugin;