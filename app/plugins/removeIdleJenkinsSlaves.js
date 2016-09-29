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

    var checkIdleSlaves = async(function() {
        logger.debug("Checking if there are idle containers.");
        try {
            var idleNodes = await(getIdles());
            logger.info("Found %d idle containers.", idleNodes.length);

            for(var i in idleNodes) {
                var idleNodeId = idleNodes[i],
                    container = await(findContainer(idleNodeId));

                if(container == null) {
                    logger.debug("Idle container %s is not running on this host... continue...", idleNodeId);
                    continue;
                }

                logger.debug("Idle container %s (%s) is running on this host... Killing...", container.Id, idleNodeId);
                var containerInfo = await(scaler.inspectContainer(container.Id));
                await(removeIdleHostFromJenkins(idleNodeId));
                if(containerInfo.State.Running) {
                    await(scaler.killContainer(container.Id));
                }
                await(scaler.removeContainer(container.Id));
                logger.info("Removed idle container %s.", container.Id)
            }
        } catch(err) {
            logger.error(err);
        }

        helper.Timer.add(function () {
            checkIdleSlaves();
        }, scaler.config.removeIdleJenkinsSlaves.checkInterval * 1000);
    });

    var findContainer = function(id) {
        return new Promise(function(resolve, reject) {
            var listOpts = {
                all: true,
                filters: {
                    label: ['auto-deployed']
                }
            };
            docker.listContainers(listOpts, function(err, containers) {
                if(err) {
                    return reject(err);
                }
                for(var i in containers) {
                    var container = containers[i];
                    if(container.Names[0].slice(-8) == id) {
                        return resolve(container);
                    }

                    resolve(null);
                }
            });
        });
    };

    var getIdles = function() {
        return new Promise(function(resolve, reject) {
            request({
                url: scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText", //URL to hit
                method: 'POST',
                form: {
                    script: getIdleSlavesAndSetOfflineAfterMaxAgeScript()
                },
                auth: {
                    user: scaler.config.removeIdleJenkinsSlaves.username,
                    pass: scaler.config.removeIdleJenkinsSlaves.password
                }
            }, function(error, response, body){
                if(error) {
                    return reject(error);
                }

                resolve(body.trim().split("\n"));
            });

        });
    };

    var getIdleSlavesAndSetOfflineAfterMaxAgeScript = function() {
        return `import hudson.FilePath
import hudson.model.Node
import hudson.model.Slave
import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.instance
def jenkinsNodes = jenkins.nodes

for (Node node in jenkinsNodes) 
{
    // Make sure slave is online
    if (!node.getComputer().isOffline()) 
    {        
        def time = System.currentTimeMillis();
        def startTime = node.getComputer().getConnectTime();
        def age = Math.round((time - startTime) / 1000);
        
        if(age > ${scaler.config.removeIdleJenkinsSlaves.maxAge}) {
            node.getComputer().setTemporarilyOffline(true, null);
        }
    } else {
        if(node.getComputer().countBusy() == 0)
        {
            println "$node.nodeName"[-8..-1]
        }
    }
}`;
    };

    var removeIdleHostFromJenkins = function(nodeId) {
        return new Promise(function(resolve, reject) {
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
            }, function(error, response, body){
                if(error) {
                    return reject(error);
                }

                resolve(body);
            });

        });
    };

    var removeIdleHostFromJenkinsScript = function(nodeId) {
        return `import hudson.FilePath
import hudson.model.Node
import hudson.model.Slave
import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.instance
def jenkinsNodes = jenkins.nodes

for (Node node in jenkinsNodes) 
{
    // Make sure slave is online
    if (node.getComputer().isOffline()) 
    {        
        def nodeId = node.nodeName[-8..-1]
        
        if(nodeId == "${nodeId}") {
            node.getComputer().doDoDelete();
        }
    }
}`;
    };

    if(scaler.config.removeIdleJenkinsSlaves.enabled) {
        checkIdleSlaves();
    }
};

removeIdleJenkinsSlaves.pluginName = "removeIdleJenkinsSlaves";

module.exports = removeIdleJenkinsSlaves;