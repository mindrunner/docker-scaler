#!groovy

pipeline {
    agent { label 'java' }
    tools {
        maven 'Apache Maven 3.3'
        jdk 'OpenJDK 1.8 64-Bit'
    }

    stages {
        stage("Linting Scripts and Build Image for Feature") {
            when {
                not { anyOf { branch 'master'; tag '*' ; branch 'develop' } }
            }
            steps {
                script {
                    def branchName =  "${env.BRANCH_NAME}".substring("${env.BRANCH_NAME}".indexOf("/")+1)
                    cloud_buildDockerImage(artifactoryProject: "wzu",
                            ocApp: 'scaler',
                            ocAppVersion: branchName,
                            dockerDir: ".")
                }
            }
        }
        stage("Build Image for Develop") {
            when {
                branch 'develop'
            }
            steps {
                cloud_buildDockerImage(artifactoryProject: "wzu",
                        ocApp: 'scaler',
                        ocAppVersion: 'latest-dev',
                        dockerDir: ".")
            }
        }
        stage("Build Image for Master") {
            when {
                branch 'master'
            }
            steps {
                cloud_buildDockerImage(artifactoryProject: "wzu",
                        ocApp: 'scaler',
                        ocAppVersion: 'latest',
                        dockerDir: ".")
            }
        }
        stage("Build Image for Tag") {
            when {
                buildingTag()
            }
            steps {
                script {
                    def tagName = "${env.TAG_NAME}";
                    cloud_buildDockerImage(artifactoryProject: "wzu",
                            ocApp: 'scaler',
                            ocAppVersion: tagName,
                            dockerDir: ".")
                }
            }
        }
    }
}
