'use strict';

const
    request = require('request-promise-native'),
    helper = require('../src/helper'),
    logger = helper.Logger.getInstance(),
    docker = helper.Docker.getInstance();

// Use this to debug HTTP Requests
// require('request-debug')(request);

let removeIdleJenkinsSlaves = function (scaler) {
    const getIdleSlavesJenkinsScript = function () {
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

    const getAllNodesJenkinsScript = function () {
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

    const removeIdleHostFromJenkinsScript = function (nodeId) {
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

    const setOldNodeOfflineJenkinsScript = function (nodeId) {
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

    const getCrumb = () => {
        const crumbUrl = scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + `/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)`;
        const getCrumbRequest = request.defaults({
            method: 'GET',
            auth: {
                user: scaler.config.removeIdleJenkinsSlaves.username,
                pass: scaler.config.removeIdleJenkinsSlaves.password
            }
        });
        return getCrumbRequest(crumbUrl)
            .then(function (htmlString) {
                return htmlString;
            }).catch(function (err) {
                throw err;
            });
    };

    const setOldNodeOffline = (nodeId) => {
        const req = postRequest.defaults({
            form: {
                script: setOldNodeOfflineJenkinsScript(nodeId)
            }
        });
        return req(scriptUrl)
            .then(function (htmlString) {
                return htmlString;
            }).catch(function (err) {
                throw err;
            });
    };

    const removeIdleHostFromJenkins = (nodeId) => {
        const req = postRequest.defaults({
            form: {
                script: removeIdleHostFromJenkinsScript(nodeId)
            }
        });
        return req(scriptUrl)
            .then(function (htmlString) {
                return htmlString;
            }).catch(function (err) {
                throw err;
            });
    };

    const getNodes = () => {
        const req = postRequest.defaults({
            form: {
                script: getAllNodesJenkinsScript()
            }
        });
        return req(scriptUrl)
            .then(function (body) {
                const serverList = body.trim().split("\n");
                if (serverList.length === 0) {
                    throw "Didn't get any server from API";
                }

                for (const i in serverList) {
                    const server = serverList[i].trim();
                    if (server.length === 0) {
                        continue;
                    }
                    if (server.length !== 8) {
                        throw "Got error from server:\n" + body;
                    }
                }
                return serverList;
            }).catch(function (err) {
                throw err;
            });
    };

    const getIdles = () => {
        const req = postRequest.defaults({
            form: {
                script: getIdleSlavesJenkinsScript()
            }
        });
        return req(scriptUrl)
            .then(function (body) {
                const serverList = body.trim().split("\n");
                if (serverList.length === 0) {
                    throw "Didn't get any server from API";
                }

                for (const i in serverList) {
                    const server = serverList[i].trim();
                    if (server.length === 0) {
                        continue;
                    }
                    if (server.length !== 8) {
                        throw "Got error from server:\n" + body;
                    }
                }
                return serverList;
            }).catch(function (err) {
                throw err;
            });
    };

    const findContainer = (id) => {
        const listOpts = {
            all: true,
            filters: {
                label: ['auto-deployed']
            }
        };
        return docker.listContainers(listOpts)
            .then(function (containers) {
                for (const i in containers) {
                    const container = containers[i],
                        containerId = container.Names[0].slice(-8);

                    if (containerId.trim() === id.trim()) {
                        return container;
                    }
                }
                return null;
            }).catch(function (err) {
                throw err;
            });
    };

    const checkIdles = async function () {
        logger.debug("%s: Checking idle slaves...", removeIdleJenkinsSlaves.pluginName);
        try {
            const idleNodes = await getIdles();
            logger.info("%s: Found %d idle containers.", removeIdleJenkinsSlaves.pluginName, idleNodes.length);

            for (const i in idleNodes) {
                try {
                    const idleNodeId = idleNodes[i];
                    const container = await findContainer(idleNodeId);

                    if (container == null) {
                        logger.debug("%s: Idle container %s is not running on removeIdleJenkinsSlaves host... continue...", removeIdleJenkinsSlaves.pluginName, idleNodeId);
                        continue;
                    }

                    logger.debug("%s: Idle container %s (%s) is running on removeIdleJenkinsSlaves host... Killing...", removeIdleJenkinsSlaves.pluginName, container.Id, idleNodeId);
                    const containerInfo = await scaler.inspectContainer(container.Id);

                    try {
                        removeIdleHostFromJenkins(idleNodeId);
                    } catch (err) {
                        logger.warn("%s: Container %s not registered in Jenkins", removeIdleJenkinsSlaves.pluginName, container.Id)
                    }
                    if (containerInfo.State.Running) {
                        await scaler.killContainer(container.Id);
                    }
                    await scaler.removeContainer(container.Id);
                    logger.info("%s: Removed idle container %s.", removeIdleJenkinsSlaves.pluginName, container.Id)
                } catch (err) {
                    logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
                }
            }
        } catch (err) {
            logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
        }
    };

    const checkAge = async function () {
        logger.debug("%s: Checking slaves states...", removeIdleJenkinsSlaves.pluginName);
        try {
            const nodes = await getNodes();
            logger.info("%s: Found %d containers.", removeIdleJenkinsSlaves.pluginName, nodes.length);

            for (const i in nodes) {
                try {
                    const nodeId = nodes[i];
                    const container = await findContainer(nodeId);

                    if (container == null) {
                        logger.debug("%s: Container %s is not running on removeIdleJenkinsSlaves host... continue...", removeIdleJenkinsSlaves.pluginName, nodeId);
                        continue;
                    }

                    logger.debug("%s: Container %s (%s) is running on removeIdleJenkinsSlaves host... checking...", removeIdleJenkinsSlaves.pluginName, container.Id, nodeId);
                    const age = Math.floor(Date.now() / 1000) - container.Created;
                    if (age < scaler.config.removeIdleJenkinsSlaves.maxAge) {
                        logger.debug("%s: Container %s (Age: %ds) is young enough. Won't kill.", removeIdleJenkinsSlaves.pluginName, container.Id, age);
                        continue;
                    }

                    setOldNodeOffline(nodeId);
                    logger.info("%s: Container %s (Age: %ds) was to old. Set offline.", removeIdleJenkinsSlaves.pluginName, container.Id, age);
                } catch (err) {
                    logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
                }
            }
        } catch (err) {
            logger.error("%s: %s", removeIdleJenkinsSlaves.pluginName, err);
        }
    };

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

    const scriptUrl = scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText";

    let postRequest = request.defaults({
            method: 'POST',
            auth: {
                user: scaler.config.removeIdleJenkinsSlaves.username,
                pass: scaler.config.removeIdleJenkinsSlaves.password
            }
        }
    );

    const checkSlaves = async () => {
        try {
            let c = await getCrumb();
            let crumbField = c.split(":")[0];
            let crumb = c.split(":")[1];
            let headers = {};
            headers[crumbField] = crumb;
            postRequest = postRequest.defaults({headers});
        } catch (ex) {
            logger.info("Jenkins does not support CRSF Header.");
        }

        await checkAge();
        await checkIdles();

        helper.Timer.add(function () {
            checkSlaves();
        }, scaler.config.removeIdleJenkinsSlaves.checkInterval * 1000);
    };

    if (scaler.config.removeIdleJenkinsSlaves.enabled) {
        checkSlaves();
    }
};

removeIdleJenkinsSlaves.pluginName = "removeIdleJenkinsSlaves";

module.exports = removeIdleJenkinsSlaves;