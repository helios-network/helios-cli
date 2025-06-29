const ora = require('ora');
const path = require("path");
const executeMultipleShellCommand = require('../utils/executeMultipleShellCommand');
const executeShellCommand = require('../utils/executeShellCommandLine');
const fs = require("fs");


function server(options) {
    return new Promise(async (resolve, reject) => {
        try {
            const command = options.argv._[1];
            if (command == undefined) {
                reject('Please specify a command.');
                return;
            }
            // const output = await containerExec(['bash', '-c', 'echo "Hello from inside the container"']);
            // console.log(output);

            const commandsPath = path.join(options.npmNodeModulesGlobalDir, 'lib/commands/server');
            const commands = [... fs.readdirSync(commandsPath)]
                .filter(x => !['example.js'].includes(x)  && x.endsWith('.js'))
                .map(x => [x, require(path.join(commandsPath, x))])
                .map(x => ({ name: x[0].replace('.js', ''), use: x[1], type: 'normal' }));
            const selectedCommand = commands.find(x => x.name === command);

            if (selectedCommand != undefined) {
                selectedCommand.use({ ...options, command: undefined })
                    .then(() => resolve())
                    .catch(error => reject(error))
            } else {
                reject(`Command node ${command} not found.`);
            }
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = server;