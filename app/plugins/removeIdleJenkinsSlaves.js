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
    const idleScript = `import hudson.FilePath
import hudson.model.Node
import hudson.model.Slave
import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.instance
def jenkinsNodes =jenkins.nodes

for (Node node in jenkinsNodes) 
{
  // Make sure slave is online
  if (!node.getComputer().isOffline()) 
  {           
    //Make sure that the slave busy executor number is 0.
    if(node.getComputer().countBusy()==0)
    {
       println "$node.nodeName"
    }
  }  
}
`;
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
        var idleNodes = await(getIdles());

        logger.debug("Checking if there are idle containers.");
        for(var i in idleNodes) {
            var idleNode = idleNodes[i].substring(14),
                container = await(scaler.getContainerByName(idleNode));

            if(container == null) {
                continue;
            }

            var age = Math.round(new Date()) - container.Created;
            if(age < maxAge) {
                continue;
            }

            await(scaler.killContainer(container.Id));
            await(scaler.removeContainer(container.Id));
            logger.info("Removed idle container %s.", container.Id)
        }

        helper.Timer.add(function () {
            checkIdleSlaves()
        }, scaler.config.removeIdleJenkinsSlaves.checkInterval * 1000);
    });

    var getIdles = function() {
        return new Promise(function(resolve, reject) {
            request({
                url: scaler.config.removeIdleJenkinsSlaves.jenkinsMaster + "/scriptText", //URL to hit
                method: 'POST',
                form: {
                    script: idleScript
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

    if(scaler.config.removeIdleJenkinsSlaves.enabled) {
        checkIdleSlaves();
    }
};

removeIdleJenkinsSlaves.pluginName = "removeIdleJenkinsSlaves";

module.exports = removeIdleJenkinsSlaves;