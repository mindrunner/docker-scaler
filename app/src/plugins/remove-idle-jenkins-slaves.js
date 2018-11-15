const Plugin = require('../plugin');
const request = require('request-promise-native');

// Use this to debug HTTP Requests
// require('request-debug')(request);


class RemoveIdleJenkinsSlavesPlugin extends Plugin {

    constructor(scaler) {
        super("RemoveIdleJenkinsSlavesPlugin", scaler);

        this._defaultConfig = {
            removeIdleJenkinsSlaves: {
                enabled: false,
                checkInterval: 30,
                maxAge: 60,
                jenkinsMaster: "http://example.com",
                username: null,
                password: null
            }
        };

        this._scaler.config = Object.assign(this._defaultConfig, this._scaler.config);

        this._scriptUrl = this._scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText";

        this._postRequest = request.defaults({
                method: 'POST',
                auth: {
                    user: this._scaler.config.removeIdleJenkinsSlaves.username,
                    pass: this._scaler.config.removeIdleJenkinsSlaves.password
                }
            }
        );

        const self = this;
        if (self._scaler.config.removeIdleJenkinsSlaves.enabled) {
            this._intervals.push(setInterval(function () {
                self.checkSlaves();
            }, this._scaler.config.removeIdleJenkinsSlaves.checkInterval * 1000));
        }


    }

    async checkSlaves() {
        try {
            let c = await this.getCrumb();
            let crumbField = c.split(":")[0];
            let crumb = c.split(":")[1];
            let headers = {};
            headers[crumbField] = crumb;
            this._postRequest = this._postRequest.defaults({headers});
        } catch (ex) {
            this._logger.warn("Jenkins does not support CSRF Header, consider activating the CSRF protection");
        }

        await this.checkAge();
        await this.checkIdles();
    };


    getIdleSlavesJenkinsScript() {
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

    getAllNodesJenkinsScript() {
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

    removeIdleHostFromJenkinsScript(nodeId) {
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

    setOldNodeOfflineJenkinsScript(nodeId) {
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

    async getCrumb() {
        const crumbUrl = this._scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + `/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)`;
        const getCrumbRequest = request.defaults({
            method: 'GET',
            auth: {
                user: this._scaler.config.removeIdleJenkinsSlaves.username,
                pass: this._scaler.config.removeIdleJenkinsSlaves.password
            }
        });
        try {
            return await getCrumbRequest(crumbUrl);
        } catch (e) {
            throw e
        }
    };

    async setOldNodeOffline(nodeId) {
        const req = this._postRequest.defaults({
            form: {
                script: this.setOldNodeOfflineJenkinsScript(nodeId)
            }
        });

        try {
            return await req(this._scriptUrl);
        } catch (e) {
            throw e;
        }
    };

    async removeIdleHostFromJenkins(nodeId) {
        const req = this._postRequest.defaults({
            form: {
                script: this.removeIdleHostFromJenkinsScript(nodeId)
            }
        });
        try {
            return await req(this._scriptUrl);
        } catch (e) {
            this._logger.error("Cannot remove. %s", e);
        }
    };

    async getNodes() {
        const req = this._postRequest.defaults({
            form: {
                script: this.getAllNodesJenkinsScript()
            }
        });

        try {
            let body = await req(this._scriptUrl);
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
        } catch (e) {
            throw e;
        }


    };

    async getIdles() {
        const idlesRequest = this._postRequest.defaults({
            form: {
                script: this.getIdleSlavesJenkinsScript()
            }
        });


        try {
            let body = await idlesRequest(this._scriptUrl);
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
        } catch (e) {
            throw e;
        }


    };

    async findContainer(id) {
        const listOpts = {
            all: true,
            filters: {
                label: ['auto-deployed']
            }
        };


        try {
            let containers = await this._docker.listContainers(listOpts);
            for (const i in containers) {
                const container = containers[i],
                    containerId = container.Names[0].slice(-8);

                if (containerId.trim() === id.trim()) {
                    return container;
                }
            }
            return null;

        } catch (e) {
            throw e;
        }
    };

    async checkIdles() {
        this._logger.debug("%s: Checking idle slaves...", this.getName());
        try {
            const idleNodes = await this.getIdles();
            this._logger.debug("%s: Found %d idle containers.", this.getName(), idleNodes.length);

            for (const i in idleNodes) {
                try {
                    const idleNodeId = idleNodes[i];
                    const container = await this.findContainer(idleNodeId);

                    if (container == null) {
                        this._logger.debug("%s: Idle container %s is not running on removeIdleJenkinsSlaves host... continue...", this.getName(), idleNodeId);
                        continue;
                    }


                    let cankill = false;
                    for (const c in this._scaler.config.containers) {
                        if (container.Labels["group-id"] === c) {
                            cankill = true;
                        }
                    }

                    if(!cankill) {
                        this._logger.debug("%s: Container %s does not belong to me. Won't kill.", this.getName(), container.Id, age);
                        continue;
                    }


                    this._logger.debug("%s: Idle container %s (%s) is running on removeIdleJenkinsSlaves host... Killing...", this.getName(), container.Id, idleNodeId);
                    const containerInfo = await this._scaler.inspectContainer(container.Id);

                    try {
                        await this.removeIdleHostFromJenkins(idleNodeId);
                    } catch (err) {
                        this._logger.error("%s: Container %s not registered in Jenkins", this.getName(), container.Id)
                    }
                    if (containerInfo.State.Running) {
                        await this._scaler.killContainer(container.Id);
                    }
                    await this._scaler.removeContainer(container.Id);
                    this._logger.debug("%s: Removed idle container %s.", this.getName(), container.Id)
                } catch (err) {
                    this._logger.error("%s: %s", this.getName(), err);
                }
            }
        } catch (err) {
            this._logger.error("%s: %s", this.getName(), err);
        }
    };

    async checkAge() {
        this._logger.debug("%s: Checking slaves states...", this.getName());
        try {
            const nodes = await this.getNodes();
            this._logger.debug("%s: Found %d containers.", this.getName(), nodes.length);

            for (const i in nodes) {
                try {
                    const nodeId = nodes[i];
                    const container = await this.findContainer(nodeId);

                    if (container == null) {
                        this._logger.debug("%s: Container %s is not running on removeIdleJenkinsSlaves host... continue...", this.getName(), nodeId);
                        continue;
                    }

                    this._logger.debug("%s: Container %s (%s) is running on removeIdleJenkinsSlaves host... checking...", this.getName(), container.Id, nodeId);
                    const age = Math.floor(Date.now() / 1000) - container.Created;

                    let cankill = false;
                    for (const c in this._scaler.config.containers) {
                        if (container.Labels["group-id"] === c) {
                            cankill = true;
                        }
                    }

                    if(!cankill) {
                        this._logger.debug("%s: Container %s does not belong to me. Won't kill.", this.getName(), container.Id, age);
                        continue;
                    }


                    if (age < this._scaler.config.removeIdleJenkinsSlaves.maxAge) {
                        this._logger.debug("%s: Container %s (Age: %ds) is young enough. Won't kill.", this.getName(), container.Id, age);
                        continue;
                    }

                    await this.setOldNodeOffline(nodeId);
                    this._logger.info("%s: Container %s (Age: %ds) was to old. Set offline.", this.getName(), container.Id, age);
                } catch (err) {
                    this._logger.error("%s: %s", this.getName(), err);
                }
            }
        } catch (err) {
            this._logger.error("%s: %s", this.getName(), err);
        }
    };
}


module.exports = RemoveIdleJenkinsSlavesPlugin;