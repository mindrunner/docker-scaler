'use strict';

const async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    request = require('request'),

    helper = require('../src/helper'),

    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

// Init function
var removeIdleJenkinsSlaves;

removeIdleJenkinsSlaves = function (scaler) {
    const defaultConfig = {
        removeIdleJenkinsSlaves: {
            enabled: false,
            checkInterval: 30,
            maxAge: 60,
            jenkinsMaster: "http://example.com",
            username: null,
            password: null
        }
    };

    scaler.config = Object.assign(defaultConfig, scaler.config);

    var checkSlaves = async(function () {
        checkAge();
        checkIdles();

        helper.Timer.add(function () {
            checkSlaves();
        }, scaler.config.removeIdleJenkinsSlaves.checkInterval * 1000);
    });

    var checkAge = function () {
        logger.debug("%s: Checking slaves states...", removeIdleJenkinsSlaves.pluginName);
        try {
            var nodes = await(getNodes());
            logger.info("%s: Found %d containers.", removeIdleJenkinsSlaves.pluginName, nodes.length);

            for (var i in nodes) {
                try {
                    var nodeId = nodes[i];
                    var container = await(findContainer(nodeId));

                    if (container == null) {
                        logger.debug("%s: Container %s is not running on removeIdleJenkinsSlaves host... continue...", removeIdleJenkinsSlaves.pluginName, nodeId);
                        continue;
                    }

                    logger.debug("%s: Container %s (%s) is running on removeIdleJenkinsSlaves host... checking...", removeIdleJenkinsSlaves.pluginName, container.Id, nodeId);
                    var age = Math.floor(Date.now() / 1000) - container.Created;
                    if (age < scaler.config.removeIdleJenkinsSlaves.maxAge) {
                        logger.debug("%s: Container %s (Age: %ds) is young enough. Won't kill.", removeIdleJenkinsSlaves.pluginName, container.Id, age);
                        continue;
                    }

                    await(setOldNodeOffline(nodeId));
                    logger.info("%s: Container %s (Age: %ds) was to old. Set offline.", removeIdleJenkinsSlaves.pluginName, container.Id, age);
                } catch (err) {
                    logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
                }
            }
        } catch (err) {
            logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
        }
    };

    var checkIdles = function () {
        logger.debug("%s: Checking idle slaves...", removeIdleJenkinsSlaves.pluginName);
        try {
            var idleNodes = await(getIdles());
            logger.info("%s: Found %d idle containers.", removeIdleJenkinsSlaves.pluginName, idleNodes.length);

            for (var i in idleNodes) {
                try {
                    var idleNodeId = idleNodes[i];
                    var container = await(findContainer(idleNodeId));

                    if (container == null) {
                        logger.debug("%s: Idle container %s is not running on removeIdleJenkinsSlaves host... continue...", removeIdleJenkinsSlaves.pluginName, idleNodeId);
                        continue;
                    }

                    logger.debug("%s: Idle container %s (%s) is running on removeIdleJenkinsSlaves host... Killing...", removeIdleJenkinsSlaves.pluginName, container.Id, idleNodeId);
                    var containerInfo = await(scaler.inspectContainer(container.Id));
                    try {
                        await(removeIdleHostFromJenkins(idleNodeId));
                    } catch (err) {
                        logger.warn("%s: Container %s not registered in Jenkins", removeIdleJenkinsSlaves.pluginName, container.Id)
                    }
                    if (containerInfo.State.Running) {
                        await(scaler.killContainer(container.Id));
                    }
                    await(scaler.removeContainer(container.Id));
                    logger.info("%s: Removed idle container %s.", removeIdleJenkinsSlaves.pluginName, container.Id)
                } catch (err) {
                    logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
                }
            }
        } catch (err) {
            logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
        }
    };

    var findContainer = function (id) {
        return new Promise(function (resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    label: ['auto-deployed']
                }
            };
            docker.listContainers(listOpts, function (err, containers) {
                if (err) {
                    return reject(err);
                }
                for (var i in containers) {
                    var container = containers[i],
                        containerId = container.Names[0].slice(-8);

                    if (containerId.trim() == id.trim()) {
                        return resolve(container);
                    }
                }

                resolve(null);
            });
        });
    };

    var getIdles = function () {
        return new Promise(function (resolve, reject) {
            request({
                url: scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText", //URL to hit
                method: 'POST',
                form: {
                    script: getIdleSlavesJenkinsScript()
                },
                auth: {
                    user: scaler.config.removeIdleJenkinsSlaves.username,
                    pass: scaler.config.removeIdleJenkinsSlaves.password
                }
            }, function (error, response, body) {
                if (error) {
                    return reject(error);
                }

                var serverList = body.trim().split("\n");
                if (serverList.length == 0) {
                    return reject("Didn't get any server from API");
                }

                for (var i in serverList) {
                    var server = serverList[i].trim();
                    if (server.length == 0) {
                        continue;
                    }
                    if (server.length != 8) {
                        return reject("Got error from server:\n" + body);
                    }
                }

                resolve(serverList);
            });

        });
    };

    var getNodes = function () {
        return new Promise(function (resolve, reject) {
            request({
                url: scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText", //URL to hit
                method: 'POST',
                form: {
                    script: getAllNodesJenkinsScript()
                },
                auth: {
                    user: scaler.config.removeIdleJenkinsSlaves.username,
                    pass: scaler.config.removeIdleJenkinsSlaves.password
                }
            }, function (error, response, body) {
                if (error) {
                    return reject(error);
                }

                var serverList = body.trim().split("\n");
                if (serverList.length == 0) {
                    return reject("Didn't get any server from API");
                }

                for (var i in serverList) {
                    var server = serverList[i].trim();
                    if (server.length == 0) {
                        continue;
                    }
                    if (server.length != 8) {
                        return reject("Got error from server:\n" + body);
                    }
                }

                resolve(serverList);
            });
        });
    };

    var removeIdleHostFromJenkins = function (nodeId) {
        return new Promise(function (resolve, reject) {
            request({
                url: scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText", //URL to hit
                method: 'POST',
                form: {
                    script: removeIdleHostFromJenkinsScript(nodeId)
                },
                auth: {
                    user: scaler.config.removeIdleJenkinsSlaves.username,
                    pass: scaler.config.removeIdleJenkinsSlaves.password
                }
            }, function (error, response, body) {
                if (error) {
                    return reject(error);
                }

                resolve(body);
            });

        });
    };

    var getIdleSlavesJenkinsScript = function () {
        return `import hudson.FilePath
import hudson.model.Node
import hudson.model.Slave
import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.instance
def jenkinsNodes = jenkins.nodes

for(Node node in jenkinsNodes)
{
    if(node.nodeName.length() < 8) {
        continue;
    }

    // When slave is offline and does nothing
    if(node.getComputer().isOffline() && node.getComputer().countBusy() == 0)
    {
        def nodeId = node.nodeName[-8..-1]
        println nodeId
    }
}`;
    };

    var setOldNodeOffline = function (nodeId) {
        return new Promise(function (resolve, reject) {
            request({
                url: scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText", //URL to hit
                method: 'POST',
                form: {
                    script: setOldNodeOfflineJenkinsScript(nodeId)
                },
                auth: {
                    user: scaler.config.removeIdleJenkinsSlaves.username,
                    pass: scaler.config.removeIdleJenkinsSlaves.password
                }
            }, function (error, response, body) {
                if (error) {
                    return reject(error);
                }

                resolve(body);
            });

        });
    };

    var setOldNodeOfflineJenkinsScript = function (nodeId) {
        return `import hudson.FilePath
import hudson.model.Node
import hudson.model.Slave
import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.instance
def jenkinsNodes = jenkins.nodes

for (Node node in jenkinsNodes) 
{
    if(node.nodeName.length() < 8) {
        continue;
    }
    
    // Make sure slave is online
    if (!node.getComputer().isOffline()) 
    {        
        def nodeId = node.nodeName[-8..-1]
        
        if(nodeId == "${nodeId}") {
            node.getComputer().setTemporarilyOffline(true, null);
            println "true"
        }
    }
}`;
    };

    var removeIdleHostFromJenkinsScript = function (nodeId) {
        return `import hudson.FilePath
import hudson.model.Node
import hudson.model.Slave
import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.instance
def jenkinsNodes = jenkins.nodes

for (Node node in jenkinsNodes) 
{
    if(node.nodeName.length() < 8) {
        continue;
    }
    
    // Make sure slave is online
    if (node.getComputer().isOffline()) 
    {        
        def nodeId = node.nodeName[-8..-1]
        
        if(nodeId == "${nodeId}") {
            node.getComputer().doDoDelete();
            println "true"
        }
    }
}`;
    };

    var getAllNodesJenkinsScript = function () {
        return `import hudson.FilePath
import hudson.model.Node
import hudson.model.Slave
import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.instance
def jenkinsNodes = jenkins.nodes

for (Node node in jenkinsNodes)
{
    if(node.nodeName.length() < 8) {
        continue;
    }

    def nodeId = node.nodeName[-8..-1]
    println nodeId
}`;
    };

    if (scaler.config.removeIdleJenkinsSlaves.enabled) {
        checkSlaves();
    }
};

removeIdleJenkinsSlaves.pluginName = "removeIdleJenkinsSlaves";

module.exports = removeIdleJenkinsSlaves;