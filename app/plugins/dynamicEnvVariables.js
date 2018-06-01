'use strict';

const fs = require('fs'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),
    os = require("os"),
    request = require('request'),
    dns = require('dns');

/*
var checkIp = new Promise(function (resolve, reject) {
    request('http://169.254.169.254/latest/meta-data/local-ipv4', function (error, response, body) {
        console.log("------------------------------------------------------------FIRST");
        if (!error && response.statusCode == 200) {
            resolve(body);
            // dynamicVariables['{{IP}}'] = body;
        } else {
            resolve("127.0.0.1");
            // dynamicVariables['{{IP}}'] = "127.0.0.1";
        }
    })
});
*/

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
        var ipAddress;
        var dynamicVariables = {
            "{{SERVER_VERSION}}": dockerInfo.ServerVersion,
            "{{ARCHITECTURE}}": dockerInfo.Architecture,
            "{{HTTP_PROXY}}": dockerInfo.HttpProxy,
            "{{HTTPS_PROXY}}": dockerInfo.HttpsProxy,
        };

        if (fs.existsSync('/.dockerenv')) {
            dynamicVariables['{{HOST_NAME}}'] = dockerInfo.Name.split('.')[0];
        } else {
            dynamicVariables['{{HOST_NAME}}'] = os.hostname().split('.')[0];
        }
        // var sequence = Futures.sequence();
        // sequence
        //     .then(function (next) {
        //         http.get({ host: '169.254.169.254', path: '/latest/meta-data/local-ipv4' }, next);
        //
        //
        //     })

        /*
        var dnscallback = function(err,addresses,family) {
            console.log("Got IP: "+ addresses);
            dynamicVariables["{{IP}}"] = addresses;
        };

        if (fs.existsSync('/.dockerenv')) {
            console.log("trying to resolve IP with hostname from dockerinfo");
            dns.lookup(dockerInfo.Name, await(dnscallback));
        }else{
            console.log("trying to resolve IP with hostname");
            dns.lookup(os.hostname(), await(dnscallback));
        }
*/
        var checkIp = new Promise(function (resolve, reject) {
            if (fs.existsSync('/.dockerenv')) {
                console.log("trying to resolve IP with hostname from dockerinfo");
                dns.lookup(dockerInfo.Name, function (err, addresses, family) {
                    console.log("Got IP: "+ addresses);
                    resolve(addresses);
                });
            }else {
                console.log("trying to resolve IP with hostname");
                dns.lookup(os.hostname(), function (err, addresses, family) {
                    console.log("Got IP: "+ addresses);
                    resolve(addresses);
                });
            }
        });

        dynamicVariables["{{IP}}"] = await(checkIp);

        console.log("dynamicVariables[\"{{IP}}\"] is: " + dynamicVariables["{{IP}}"]);
        //            dynamicVariables["{{IP}}"] = await(checkIp);
        console.log("------------------------------------------------------------SECOND");
        return dynamicVariables;
    }
});

dynamicEnvVariablesPlugin.pluginName = "dynamicEnvVariables";

module.exports = dynamicEnvVariablesPlugin;