const ora = require('ora');
const path = require("path");
const executeMultipleShellCommand = require('../utils/executeMultipleShellCommand');
const executeShellCommand = require('../utils/executeShellCommandLine');
const stopNode = require('./node/stop');
const getPathHelios = require('../utils/getPathHelios');

function cmds(options) {
    var array = [
        {
            cmd: (success, failure) => {
                try {
                    stopNode({...options, disabledLogs: true}).then(() => {
                        success();
                    }).catch((e) => {
                        failure(e);
                    });
                } catch(e) {
                    failure(e)
                }
            }
        },
        { // check docker
            cmd: (success, failure) => {
                try {
                    const path = getPathHelios();
                    if (!path) {
                        failure("No path found, please start a node first");
                        return;
                    }

                    executeShellCommand("docker compose --project-directory=\"" + path + "\" down" + (options.argv.remove == "true" ? " -v" : ""), () => {
                        success();
                    }, () => {
                        failure("Docker compose down failed");
                    }, false, console.log);
                } catch(e) { failure(e) }
            }
        },
    ]

    return array;
}

function stop(options) {
    return new Promise((resolve, reject) => {
        const exeCmds = cmds(options);
        executeMultipleShellCommand(exeCmds, 0, executeMultipleShellCommand, (error) => {
            if (error) {
                ora("NodeManager stopped successfully").fail();
                reject(error);
                return;
            }
            ora("NodeManager stopped successfully").succeed();
            resolve(undefined);
        });
    });
};

module.exports = stop;