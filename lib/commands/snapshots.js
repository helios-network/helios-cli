const path = require('path');
const fs = require('fs');

function showHelp() {
    console.log('Helios Snapshots Provider - Docker Container Management');
    console.log('');
    console.log('Usage: helios snapshots <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  start              Start the snapshots provider container');
    console.log('  stop               Stop and remove the snapshots provider container');
    console.log('');
    console.log('Options for start:');
    console.log('  -p, --port <port>  Set server port (default: 5050)');
    console.log('  -H, --host <host>  Set hostname for URLs (default: snapshots.helioschainlabs.org)');
    console.log('  -r, --rate <rate>  Set max download rate in MB/s (default: 100)');
    console.log('');
    console.log('Examples:');
    console.log('  helios snapshots start');
    console.log('  helios snapshots start -p 8080');
    console.log('  helios snapshots start -p 8080 -H example.com -r 50');
    console.log('  helios snapshots stop');
    console.log('');
    console.log('Note: Make sure the Docker image is built first:');
    console.log('  docker build -t helios-backups-provider:latest <path-to-helios-backups-provider>');
    console.log('');
}

function snapshots(options) {
    return new Promise(async (resolve, reject) => {
        try {
            const command = options.argv._[1];
            if (command == undefined) {
                showHelp();
                resolve(undefined);
                return;
            }

            const commandsPath = path.join(options.npmNodeModulesGlobalDir, 'lib/commands/snapshots');
            const commands = [... fs.readdirSync(commandsPath)]
                .filter(x => !['example.js'].includes(x) && x.endsWith('.js'))
                .map(x => [x, require(path.join(commandsPath, x))])
                .map(x => ({ name: x[0].replace('.js', ''), use: x[1], type: 'normal' }));
            const selectedCommand = commands.find(x => x.name === command);

            if (selectedCommand != undefined) {
                selectedCommand.use({ command: `${options.command} ${command}`, ...options })
                    .then(() => resolve())
                    .catch(error => reject(error))
            } else {
                reject(`Command snapshots ${command} not found. Available commands: ${commands.map(c => c.name).join(', ')}`);
            }
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = snapshots;
