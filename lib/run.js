const fs = require('fs');

const path = require('path');

function run(argv, fn) {
    const command = argv.command;

    const currentDir = __dirname;
    const npmNodeModulesGlobalDir = path.join(currentDir, '..');

    processCommand(command, {
        argv,
        pwd: process.cwd(),
        npmNodeModulesGlobalDir: npmNodeModulesGlobalDir,
    }, err => {
        if (err) console.error(err);
        fn(err ? 1 : 0);
    });
};

function processCommand(commandKey, env, fn) {

    const commandsPath = path.join(env.npmNodeModulesGlobalDir, 'lib/commands');
    const commands = [... fs.readdirSync(commandsPath)]
        .filter(x => !['example.js'].includes(x)  && x.endsWith('.js'))
        .map(x => [x, require(path.join(commandsPath, x))])
        .map(x => ({ name: x[0].replace('.js', ''), use: x[1], type: 'normal' }));
    const command = commands.find(x => x.name === commandKey);

    if (command != undefined) {
        if (env.argv.help || env.argv.h) {
            command.use({ command: commandKey, ...env })
                .then(() => fn())
                .catch(error => {
                    if (error && error.message && error.message.includes('help')) {
                        fn();
                    } else {
                        fn(error);
                    }
                });
        } else {
            command.use({ command: commandKey, ...env })
                .then(() => fn())
                .catch(error => fn(error))
        }
    } else {
        fn(`Command ${commandKey} not found.`);
    }
};

module.exports = run;