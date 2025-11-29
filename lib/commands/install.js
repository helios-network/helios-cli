const ora = require('ora');
const path = require("path");
const executeMultipleShellCommand = require('../utils/executeMultipleShellCommand');
const executeShellCommand = require('../utils/executeShellCommandLine');

function installCmds(options) {
    
    var array = [
        { // check docker
            cmd: (success, failure) => {
                try {
                    executeShellCommand("docker --version", (stdout) => {
                        success();
                    }, () => {
                        failure("Docker is not installed");
                    }, false, console.log);
                } catch(e) { failure(e) }
            }
        },
        {
            cmd: (success, failure) => { try {
                if (options.argv["_"][1] && options.argv["_"][1].startsWith("v")) {
                    executeShellCommand(`docker pull heliosfoundation/docker-helios-nodemanager:${options.argv["_"][1]}`, (stdout) => {
                        executeShellCommand(`docker tag heliosfoundation/docker-helios-nodemanager:${options.argv["_"][1]} heliosfoundation/docker-helios-nodemanager:latest`, (stdout) => {
                            success();
                        }, () => {
                            failure("Docker tag failed");
                        }, false, console.log);
                    }, () => {
                        failure("Docker pull failed");
                    }, false, console.log);
                    return ;
                }
                executeShellCommand("docker pull heliosfoundation/docker-helios-nodemanager:latest", (stdout) => {
                    success();
                }, () => {
                    failure("Docker pull failed");
                }, false, console.log);
             } catch(e) { failure(e) } }
        },
        { // prune docker images <none>
            cmd: (success, failure) => { try {
                executeShellCommand("docker image prune -f", (stdout) => {
                    success();
                }, () => {
                    failure("Docker image prune failed");
                }, false, console.log);
            } catch(e) { failure(e) } }
        }
    ]

    return array;
}

function install(options) {
    return new Promise((resolve, reject) => {
        const exeCmds = installCmds(options);
        executeMultipleShellCommand(exeCmds, 0, executeMultipleShellCommand, (error) => {
            if (error != undefined) {
                reject(error);
                return;
            }
            ora("Installation Successfully finished.").succeed();
            resolve(undefined);
        });
    });
};

module.exports = install;